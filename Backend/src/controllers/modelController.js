// ─── 3D Model Controller ───────────────────────────────────────────────────────
// Manages AI 3D model generation and status polling for marketplace listings.

const supabase = require('../connection/supabaseClient');
const tripoService = require('../services/tripoService');
const { processAndSaveGlb } = require('../services/modelOptimizer');
const { sendError } = require('../utils/errorHandler');

// In-memory rate limiter: tracks last request timestamp per user and per listing polling
const userLastRequest = new Map();
const listingLastPoll = new Map();
const pollPromises = new Map(); // Prevents overlapping concurrent status resolutions

const USER_RATE_LIMIT_MS = 5000; // Min 5 seconds between generation requests
const MIN_POLL_INTERVAL_MS = 2500; // Respect rate limits on Tripo status polling
const MAX_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes timeout

/**
 * Checks if a user is an admin via their email or profile role.
 */
async function isUserAdmin(userId, email) {
  if (email && email.toLowerCase().includes('admin')) return true;
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', userId)
      .maybeSingle();
    return Boolean(
      profile?.role === 'admin' ||
      (profile?.email && profile.email.toLowerCase().includes('admin'))
    );
  } catch (_) {
    return false;
  }
}

/**
 * Normalizes photo URLs (handles relative backend uploads into full URLs if needed).
 */
function resolvePhotoUrl(rawUrl, req) {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }
  const host = req.get('host') || 'localhost:5000';
  const protocol = req.protocol || 'http';
  const cleanPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  return `${protocol}://${host}${cleanPath}`;
}

/**
 * POST /api/models/generate
 * Generates an AI 3D model for a listing using Tripo API.
 * Requires: Authorization header (Supabase JWT), seller or admin permission.
 * Body: { listingId }
 */
async function generateModel(req, res) {
  try {
    const { listingId } = req.body;
    if (!listingId) {
      return sendError(res, 400, 'listingId is required in request body.');
    }

    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, 'Unauthorized: user context is missing.');
    }

    // 1. Rate limiting per user
    const now = Date.now();
    const lastTime = userLastRequest.get(userId) || 0;
    if (now - lastTime < USER_RATE_LIMIT_MS) {
      return sendError(
        res,
        429,
        `Too many requests. Please wait ${Math.ceil((USER_RATE_LIMIT_MS - (now - lastTime)) / 1000)}s before generating again.`
      );
    }
    userLastRequest.set(userId, now);

    // 2. Fetch the listing from Supabase
    const { data: listing, error: listingErr } = await supabase
      .from('assets')
      .select('*')
      .eq('id', listingId)
      .maybeSingle();

    if (listingErr || !listing) {
      return sendError(res, 404, `Listing not found with ID ${listingId}`);
    }

    // 3. Authorization check: must be the listing's seller or an admin
    const isAdmin = await isUserAdmin(userId, req.user?.email);
    const isSeller = listing.user_id === userId || !listing.user_id; // allow legacy listings if unassigned

    if (!isSeller && !isAdmin) {
      return sendError(res, 403, 'Forbidden: Only the listing seller or an admin can trigger 3D model generation.');
    }

    // 4. Check if a 'ready' or 'processing' model already exists (no duplicate credit spend)
    const { data: existingModel } = await supabase
      .from('listing_models')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (existingModel) {
      if (existingModel.status === 'ready') {
        return res.json({
          success: true,
          status: 'ready',
          message: 'A 3D model already exists and is ready for this listing.',
          model: existingModel,
        });
      }

      if (existingModel.status === 'processing') {
        // If it was created less than 10 minutes ago, still considered actively processing
        const ageMs = now - new Date(existingModel.created_at || existingModel.updated_at).getTime();
        if (ageMs < MAX_PROCESSING_TIMEOUT_MS) {
          return res.json({
            success: true,
            status: 'processing',
            message: 'Model generation is already in progress.',
            model: existingModel,
          });
        }
      }
    }

    // 5. Check Tripo credit balance first
    const balanceInfo = await tripoService.checkCreditBalance();
    if (balanceInfo.balance <= 0) {
      return sendError(
        res,
        402,
        `Insufficient Tripo credits for 3D model generation (Available: ${balanceInfo.balance.toFixed(
          2
        )} credits). Please purchase credits on platform.tripo3d.ai.`
      );
    }

    // 6. Extract photo URL and dimensions
    const rawPhoto = listing.image || listing.imageUrl || (Array.isArray(listing.images) ? listing.images[0] : null);
    const photoUrl = resolvePhotoUrl(rawPhoto, req);

    if (!photoUrl) {
      return sendError(res, 400, 'Listing does not have a valid image photo URL to generate a 3D model.');
    }

    const category = (listing.category || '').toLowerCase();
    const isWallArt = category.includes('art') || category.includes('paint') || category.includes('print');
    const placement = isWallArt ? 'wall' : 'floor';

    const widthCm = Number(listing.dimensions?.widthCm || listing.width_cm || 60);
    const heightCm = Number(listing.dimensions?.heightCm || listing.height_cm || 80);
    const depthCm = Number(listing.dimensions?.depthCm || listing.depth_cm || (isWallArt ? 5 : 45));

    // 7. Dispatch generation task to Tripo v3 API
    console.log(`[ModelController] Dispatching Tripo image-to-3d task for listing ${listingId}...`);
    const taskId = await tripoService.createImageToModelTask(photoUrl, {
      model: 'v3.1-20260211',
      face_limit: 40000,
      texture: true,
      pbr: true,
    });

    console.log(`[ModelController] Tripo task created: ${taskId}`);

    // 8. Upsert tracking record in listing_models table
    const modelRecord = {
      listing_id: listingId,
      status: 'processing',
      tripo_task_id: taskId,
      source: 'ai_generated',
      placement,
      width_cm: widthCm,
      height_cm: heightCm,
      depth_cm: depthCm,
      error_message: null,
      updated_at: new Date().toISOString(),
    };

    const { data: savedModel, error: dbErr } = await supabase
      .from('listing_models')
      .upsert(modelRecord, { onConflict: 'listing_id' })
      .select('*')
      .single();

    if (dbErr) {
      console.error('[ModelController] Database error saving model tracking record:', dbErr);
      return sendError(res, 500, `Database error recording 3D task: ${dbErr.message}`);
    }

    // 9. Return immediately with processing status
    return res.status(202).json({
      success: true,
      status: 'processing',
      taskId,
      message: '3D model generation started successfully.',
      model: savedModel,
    });
  } catch (err) {
    console.error('[ModelController] generateModel error:', err.message);
    return sendError(res, 500, err.message || 'Internal error initiating 3D model generation.');
  }
}

/**
 * GET /api/models/status/:listingId
 * Retrieves the current 3D model generation status for a listing.
 * Automatically polls Tripo if processing and triggers server-side optimization on success.
 */
async function getModelStatus(req, res) {
  try {
    const { listingId } = req.params;
    if (!listingId) {
      return sendError(res, 400, 'listingId parameter is required.');
    }

    // 1. Fetch current record from listing_models
    const { data: model, error: fetchErr } = await supabase
      .from('listing_models')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (fetchErr) {
      if (fetchErr.message?.includes('schema cache') || fetchErr.code === 'PGRST204' || fetchErr.code === '42P01') {
        return res.json({
          success: true,
          status: 'none',
          message: 'listing_models table not yet migrated in Supabase. Run 20261022_listing_models.sql in Supabase SQL Editor.',
          model: null,
        });
      }
      return sendError(res, 500, `Database error: ${fetchErr.message}`);
    }

    if (!model) {
      return res.json({
        success: true,
        status: 'none',
        message: 'No 3D model has been generated for this listing yet.',
        model: null,
      });
    }

    // If already finalized, return immediately
    if (model.status === 'ready') {
      return res.json({
        success: true,
        status: 'ready',
        model,
      });
    }

    if (model.status === 'failed') {
      return res.json({
        success: false,
        status: 'failed',
        error: model.error_message || 'Model generation failed.',
        model,
      });
    }

    // 2. Model is currently 'processing'
    if (!model.tripo_task_id) {
      return res.json({
        success: true,
        status: 'processing',
        model,
      });
    }

    // Check 10-minute timeout
    const createdAt = new Date(model.created_at || model.updated_at).getTime();
    if (Date.now() - createdAt > MAX_PROCESSING_TIMEOUT_MS) {
      const timeoutMsg = '3D generation timed out after 10 minutes.';
      await supabase
        .from('listing_models')
        .update({ status: 'failed', error_message: timeoutMsg, updated_at: new Date().toISOString() })
        .eq('listing_id', listingId);

      return res.json({
        success: false,
        status: 'failed',
        error: timeoutMsg,
        model: { ...model, status: 'failed', error_message: timeoutMsg },
      });
    }

    // Rate-limit polling requests to Tripo (min 2.5s interval per listing)
    const now = Date.now();
    const lastPoll = listingLastPoll.get(listingId) || 0;
    if (now - lastPoll < MIN_POLL_INTERVAL_MS && !pollPromises.has(listingId)) {
      return res.json({
        success: true,
        status: 'processing',
        model,
      });
    }
    listingLastPoll.set(listingId, now);

    // If an optimization/polling task is already in-flight for this listing, wait for it
    if (pollPromises.has(listingId)) {
      const ongoingResult = await pollPromises.get(listingId);
      return res.json(ongoingResult);
    }

    // 3. Poll Tripo v3 API
    const pollPromise = (async () => {
      try {
        const taskInfo = await tripoService.getTaskStatus(model.tripo_task_id);

        if (taskInfo.status === 'queued' || taskInfo.status === 'running') {
          return {
            success: true,
            status: 'processing',
            progress: taskInfo.progress || 0,
            model,
          };
        }

        if (taskInfo.status === 'failed' || taskInfo.status === 'banned' || taskInfo.status === 'cancelled') {
          const failMsg = taskInfo.error || 'Tripo generation failed.';
          await supabase
            .from('listing_models')
            .update({ status: 'failed', error_message: failMsg, updated_at: new Date().toISOString() })
            .eq('listing_id', listingId);

          return {
            success: false,
            status: 'failed',
            error: failMsg,
            model: { ...model, status: 'failed', error_message: failMsg },
          };
        }

        if (taskInfo.status === 'success' && taskInfo.modelUrl) {
          console.log(`[ModelController] Tripo task succeeded! Optimizing model for listing ${listingId}...`);

          // Execute optimization pipeline (dedup, prune, texture 1024px max, simplify if > 50k triangles, upload)
          const optResult = await processAndSaveGlb(taskInfo.modelUrl, listingId);

          const { data: updatedModel, error: updateErr } = await supabase
            .from('listing_models')
            .update({
              status: 'ready',
              glb_url: optResult.glbUrl,
              size_bytes: optResult.sizeBytes,
              triangle_count: optResult.triangleCount,
              error_message: null,
              updated_at: new Date().toISOString(),
            })
            .eq('listing_id', listingId)
            .select('*')
            .single();

          if (updateErr) {
            console.error('[ModelController] Failed to record ready status in DB:', updateErr);
          }

          return {
            success: true,
            status: 'ready',
            model: updatedModel || {
              ...model,
              status: 'ready',
              glb_url: optResult.glbUrl,
              size_bytes: optResult.sizeBytes,
              triangle_count: optResult.triangleCount,
            },
          };
        }

        return {
          success: true,
          status: 'processing',
          progress: taskInfo.progress || 0,
          model,
        };
      } catch (pollErr) {
        console.warn(`[ModelController] Polling error for task ${model.tripo_task_id}:`, pollErr.message);
        return {
          success: true,
          status: 'processing',
          model,
          warning: pollErr.message,
        };
      } finally {
        pollPromises.delete(listingId);
      }
    })();

    pollPromises.set(listingId, pollPromise);
    const result = await pollPromise;
    return res.json(result);
  } catch (err) {
    console.error('[ModelController] getModelStatus error:', err.message);
    return sendError(res, 500, err.message || 'Internal error checking model status.');
  }
}

/**
 * GET /api/models/balance
 * Returns the current Tripo API credit balance (useful for admin monitoring).
 */
async function getBalance(_req, res) {
  try {
    const balance = await tripoService.checkCreditBalance();
    return res.json({
      success: true,
      balance: balance.balance,
      frozen: balance.frozen,
    });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
}

module.exports = {
  generateModel,
  getModelStatus,
  getBalance,
};
