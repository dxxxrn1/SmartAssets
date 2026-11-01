// ─── 3D Model Controller ───────────────────────────────────────────────────────
// Manages AI 3D model generation, SmartAssets curated catalog fallback, and
// status polling for marketplace listings.

const supabase = require('../connection/supabaseClient');
const tripoService = require('../services/tripoService');
const modelProviderService = require('../services/modelProviderService');
const modelCatalogService = require('../services/modelCatalogService');
const { processAndSaveGlb } = require('../services/modelOptimizer');
const { sendError } = require('../utils/errorHandler');

// In-memory rate limiter: tracks last request timestamp per user and per listing polling
const userLastRequest = new Map();
const listingLastPoll = new Map();
const pollPromises = new Map(); // Prevents overlapping concurrent status resolutions

const USER_RATE_LIMIT_MS = 5000; // Min 5 seconds between generation requests
const MIN_POLL_INTERVAL_MS = 2500; // Respect rate limits on provider status polling
const MAX_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes timeout

/**
 * Authoritatively checks if a user has the 'admin' role in public.profiles.
 * Never relies on email string heuristics or client-supplied claims.
 */
async function isUserAdmin(userId) {
  if (!userId) return false;
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) return false;
    return profile.role === 'admin';
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
  const host = req?.get ? (req.get('host') || 'localhost:5000') : 'localhost:5000';
  const protocol = req?.protocol || 'http';
  const cleanPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  return `${protocol}://${host}${cleanPath}`;
}

/**
 * POST /api/models/generate
 * Generates an AI 3D model for a listing using Tripo API with Curated Catalog fallback.
 * Requires: Authorization header (Supabase JWT), seller or authoritative admin permission.
 * Body: { listingId, forceRetry?: boolean }
 */
async function generateModel(req, res) {
  try {
    const { listingId, forceRetry } = req.body || {};
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
        `Too many requests. Please wait ${Math.ceil((USER_RATE_LIMIT_MS - (now - lastTime)) / 1000)}s before generating again.`,
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

    // 3. Authorization check: must be the listing's verified seller or an authoritative admin
    // Never treat ownerless listings as owned by the requester
    const isAdmin = await isUserAdmin(userId);
    const listingOwnerId = listing.user_id || listing.seller_id;
    const isSeller = Boolean(listingOwnerId && String(listingOwnerId) === String(userId));

    if (!isSeller && !isAdmin) {
      return sendError(
        res,
        403,
        'Forbidden: Only the verified listing seller or an administrator can trigger 3D model generation.',
      );
    }

    // 4. Check existing model status (idempotency guard)
    const { data: existingModel } = await supabase
      .from('listing_models')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (existingModel) {
      if (existingModel.status === 'ready' && !forceRetry) {
        return res.json({
          success: true,
          status: 'ready',
          source: existingModel.source || 'ai_generated',
          message: 'A 3D model already exists and is ready for this listing.',
          model: existingModel,
          canRetry: false,
        });
      }

      if (existingModel.status === 'processing') {
        const ageMs = now - new Date(existingModel.created_at || existingModel.updated_at).getTime();
        if (ageMs < MAX_PROCESSING_TIMEOUT_MS) {
          return res.json({
            success: true,
            status: 'processing',
            message: 'Model generation is already in progress.',
            model: existingModel,
            canRetry: false,
          });
        }
      }
    }

    // 5. Extract photo URL and spatial dimensions
    const rawPhoto =
      listing.image ||
      listing.imageUrl ||
      (Array.isArray(listing.images) && listing.images.length > 0 ? listing.images[0] : null);
    const photoUrl = resolvePhotoUrl(rawPhoto, req);

    if (!photoUrl) {
      return sendError(
        res,
        400,
        'Listing does not have a valid photograph URL to generate a 3D model.',
      );
    }

    const category = (listing.category || '').toLowerCase();
    const isWallArt =
      category.includes('art') || category.includes('paint') || category.includes('print');
    const placement = isWallArt ? 'wall' : 'floor';

    const widthCm = Number(listing.dimensions?.widthCm || listing.width_cm || 60);
    const heightCm = Number(listing.dimensions?.heightCm || listing.height_cm || 80);
    const depthCm = Number(listing.dimensions?.depthCm || listing.depth_cm || (isWallArt ? 5 : 45));

    // 6. Dispatch generation task (Tripo primary with Curated Catalog fallback)
    console.log(`[ModelController] Dispatching 3D fulfillment for listing ${listingId}...`);
    let dispatchResult = null;
    try {
      dispatchResult = await modelProviderService.dispatchModelGeneration({
        listingId,
        imageUrl: photoUrl,
        listing,
        options: {
          model: 'v3.1-20260211',
          face_limit: 40000,
        },
        existingModel,
      });
    } catch (dispatchErr) {
      console.warn(`[ModelController] Dispatch failure for listing ${listingId}:`, dispatchErr.message);
      const statusCode = dispatchErr.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        status: 'failed',
        error: dispatchErr.message || '3D model generation failed to initiate.',
        code: dispatchErr.code || 'DISPATCH_ERROR',
        candidateMatches: dispatchErr.catalogMatches || [],
        canRetry: (dispatchErr.ledger?.attempts || 0) < modelProviderService.getMaxAttemptsPerListing(),
      });
    }

    // ── Case A: Fallback Matched & Auto-Assigned Catalog Model ─────────────────
    if (dispatchResult.provider === 'catalog' && dispatchResult.isAutoMatch && dispatchResult.catalogModel) {
      console.log(
        `[ModelController] Auto-assigning catalog model "${dispatchResult.catalogModel.name}" (score ${dispatchResult.score}) for listing ${listingId}`,
      );

      const catalogRecord = {
        listing_id: listingId,
        status: 'ready',
        source: 'category_catalog',
        catalog_model_id: dispatchResult.catalogModel.id,
        glb_url: dispatchResult.catalogModel.glb_url,
        provider: 'catalog',
        placement: dispatchResult.catalogModel.placement || placement,
        width_cm: dispatchResult.catalogModel.width_cm || widthCm,
        height_cm: dispatchResult.catalogModel.height_cm || heightCm,
        depth_cm: dispatchResult.catalogModel.depth_cm || depthCm,
        attribution: dispatchResult.catalogModel.attribution,
        license: dispatchResult.catalogModel.license,
        match_confidence: dispatchResult.score,
        match_reasons: dispatchResult.reasons,
        error_message: null,
        attempt_count: dispatchResult.attemptCount || 1,
        updated_at: new Date().toISOString(),
      };

      const { data: savedCatalogModel, error: catSaveErr } = await supabase
        .from('listing_models')
        .upsert(catalogRecord, { onConflict: 'listing_id' })
        .select('*')
        .single();

      if (catSaveErr) {
        console.warn('[ModelController] Could not persist catalog model to DB:', catSaveErr.message);
      }

      return res.json({
        success: true,
        status: 'ready',
        source: 'category_catalog',
        isCatalogFallback: true,
        message: 'Assigned category-level approximation from Smart Assets licensed catalog.',
        model: savedCatalogModel || catalogRecord,
        attribution: dispatchResult.catalogModel.attribution,
        license: dispatchResult.catalogModel.license,
        canRetry: false,
      });
    }

    // ── Case B: Catalog Models Exist Below Auto-Threshold (Seller Review) ─────
    if (dispatchResult.provider === 'catalog' && !dispatchResult.isAutoMatch) {
      return res.json({
        success: false,
        status: 'failed',
        code: 'SELLER_REVIEW_REQUIRED',
        message:
          'AI 3D generation is currently unavailable. Plausible category catalog models were found for seller review.',
        candidateMatches: dispatchResult.candidateMatches || [],
        canRetry: true,
      });
    }

    // ── Case C: Tripo Task In-Flight ──────────────────────────────────────────
    console.log(
      `[ModelController] Dispatched to provider "${dispatchResult.provider}" (task: ${dispatchResult.rawTaskId})`,
    );

    const modelRecord = {
      listing_id: listingId,
      status: 'processing',
      tripo_task_id: dispatchResult.encodedTaskId,
      provider: 'tripo',
      source: 'ai_generated',
      placement,
      width_cm: widthCm,
      height_cm: heightCm,
      depth_cm: depthCm,
      attempt_count: dispatchResult.attemptCount || 1,
      error_message: null,
      updated_at: new Date().toISOString(),
    };

    const { data: upsertedModel, error: upsertErr } = await supabase
      .from('listing_models')
      .upsert(modelRecord, { onConflict: 'listing_id' })
      .select('*')
      .single();

    if (upsertErr) {
      if (upsertErr.code === '42P01' || upsertErr.message?.includes('schema cache')) {
        return res.json({
          success: true,
          status: 'processing',
          message: '3D model task initiated with Tripo v3.',
          taskId: dispatchResult.rawTaskId,
          model: modelRecord,
          canRetry: false,
        });
      }
      console.error('[ModelController] Failed to persist listing_models record:', upsertErr.message);
      return sendError(res, 500, `Database error: ${upsertErr.message}`);
    }

    return res.json({
      success: true,
      status: 'processing',
      progress: 15,
      taskId: dispatchResult.rawTaskId,
      provider: 'tripo',
      source: 'ai_generated',
      model: upsertedModel || modelRecord,
      canRetry: false,
    });
  } catch (err) {
    console.error('[ModelController] generateModel unexpected error:', err.message);
    return sendError(res, 500, err.message || 'Internal server error during 3D generation.');
  }
}

/**
 * GET /api/models/status/:listingId
 * Retrieves current 3D model status, polls active provider, and optimizes finalized GLB.
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
      if (
        fetchErr.message?.includes('schema cache') ||
        fetchErr.code === 'PGRST204' ||
        fetchErr.code === '42P01'
      ) {
        return res.json({
          success: true,
          status: 'none',
          message:
            'listing_models table not yet migrated in Supabase. Run 20261022_listing_models.sql in Supabase SQL Editor.',
          model: null,
          canRetry: true,
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
        canRetry: true,
      });
    }

    // If already ready, return immediately
    if (model.status === 'ready') {
      return res.json({
        success: true,
        status: 'ready',
        source: model.source || 'ai_generated',
        attribution: model.attribution || null,
        license: model.license || null,
        matchConfidence: model.match_confidence || null,
        model,
        canRetry: false,
      });
    }

    const maxAttempts = modelProviderService.getMaxAttemptsPerListing();
    const attemptsUsed = Number(model.attempt_count) || 1;
    const canRetry = attemptsUsed < maxAttempts;

    if (model.status === 'failed') {
      return res.json({
        success: false,
        status: 'failed',
        error: model.error_message || 'Model generation failed.',
        model,
        canRetry,
      });
    }

    // Model is 'processing'
    if (!model.tripo_task_id) {
      return res.json({
        success: true,
        status: 'processing',
        model,
        canRetry: false,
      });
    }

    // Check timeout
    const createdAt = new Date(model.created_at || model.updated_at).getTime();
    if (Date.now() - createdAt > MAX_PROCESSING_TIMEOUT_MS) {
      const timeoutMsg = '3D generation timed out after 10 minutes.';
      await supabase
        .from('listing_models')
        .update({
          status: 'failed',
          error_message: timeoutMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', listingId);

      return res.json({
        success: false,
        status: 'failed',
        error: timeoutMsg,
        model: { ...model, status: 'failed', error_message: timeoutMsg },
        canRetry,
      });
    }

    // Rate-limit polling requests (min 2.5s interval per listing)
    const now = Date.now();
    const lastPoll = listingLastPoll.get(listingId) || 0;
    if (now - lastPoll < MIN_POLL_INTERVAL_MS && !pollPromises.has(listingId)) {
      return res.json({
        success: true,
        status: 'processing',
        model,
        canRetry: false,
      });
    }
    listingLastPoll.set(listingId, now);

    // If a polling/optimization cycle is in-flight for this listing, reuse it
    if (pollPromises.has(listingId)) {
      const ongoingResult = await pollPromises.get(listingId);
      return res.json(ongoingResult);
    }

    // Fetch listing for potential catalog fallback matching during polling
    const { data: assetRow } = await supabase
      .from('assets')
      .select('id, name, title, category, tags, brand, maker, image, images')
      .eq('id', listingId)
      .maybeSingle();

    // Execute polling pipeline
    const pollPromise = (async () => {
      try {
        const pollResult = await modelProviderService.pollListingModelTask({
          listingId,
          modelRow: model,
          listing: assetRow,
        });

        // 1. Automatic Fallback to Curated Catalog
        if (pollResult.status === 'catalog_fallback' && pollResult.catalogModel) {
          console.log(
            `[ModelController] Auto-promoting to catalog model "${pollResult.catalogModel.name}" during polling for listing ${listingId}`,
          );

          const catalogUpdate = {
            status: 'ready',
            source: 'category_catalog',
            catalog_model_id: pollResult.catalogModel.id,
            glb_url: pollResult.catalogModel.glb_url,
            provider: 'catalog',
            dimensions_approximate: pollResult.catalogModel.dimensions_approximate !== false,
            attribution: pollResult.catalogModel.attribution,
            license: pollResult.catalogModel.license,
            match_confidence: pollResult.score,
            match_reasons: pollResult.reasons,
            error_message: null,
            updated_at: new Date().toISOString(),
          };

          const { data: updatedModel } = await supabase
            .from('listing_models')
            .update(catalogUpdate)
            .eq('listing_id', listingId)
            .select('*')
            .single();

          return {
            success: true,
            status: 'ready',
            source: 'category_catalog',
            isCatalogFallback: true,
            model: updatedModel || { ...model, ...catalogUpdate },
            attribution: pollResult.catalogModel.attribution,
            license: pollResult.catalogModel.license,
            canRetry: false,
          };
        }

        // 2. Still queued or processing
        if (pollResult.status === 'queued' || pollResult.status === 'processing') {
          return {
            success: true,
            status: 'processing',
            progress: pollResult.progress || 0,
            provider: pollResult.provider,
            model,
            canRetry: false,
          };
        }

        // 3. Task failed
        if (pollResult.status === 'failed') {
          const failMsg =
            pollResult.error ||
            '3D model is being prepared / try again later. Please check back shortly.';
          await supabase
            .from('listing_models')
            .update({
              status: 'failed',
              error_message: failMsg,
              updated_at: new Date().toISOString(),
            })
            .eq('listing_id', listingId);

          return {
            success: false,
            status: 'failed',
            error: failMsg,
            candidateMatches: pollResult.candidateMatches || [],
            model: { ...model, status: 'failed', error_message: failMsg },
            canRetry: pollResult.attemptCount < pollResult.maxAttempts,
          };
        }

        // 4. Task succeeded! Run glTF optimization & store in Cloudinary / Supabase
        if (pollResult.status === 'success' && pollResult.modelUrl) {
          console.log(
            `[ModelController] Tripo task succeeded! Optimizing model for listing ${listingId}...`,
          );

          const optResult = await processAndSaveGlb(pollResult.modelUrl, listingId);

          const updateRecord = {
            status: 'ready',
            source: 'ai_generated',
            glb_url: optResult.glbUrl,
            size_bytes: optResult.sizeBytes,
            triangle_count: optResult.triangleCount,
            error_message: null,
            updated_at: new Date().toISOString(),
          };

          const { data: updatedModel } = await supabase
            .from('listing_models')
            .update(updateRecord)
            .eq('listing_id', listingId)
            .select('*')
            .single();

          return {
            success: true,
            status: 'ready',
            source: 'ai_generated',
            model: updatedModel || {
              ...model,
              ...updateRecord,
            },
            canRetry: false,
          };
        }

        return {
          success: true,
          status: 'processing',
          progress: pollResult.progress || 0,
          model,
          canRetry: false,
        };
      } catch (pollErr) {
        console.warn(`[ModelController] Polling error for listing ${listingId}:`, pollErr.message);
        return {
          success: true,
          status: 'processing',
          model,
          warning: pollErr.message,
          canRetry: false,
        };
      } finally {
        pollPromises.delete(listingId);
        modelProviderService.markJobFinished(listingId);
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
 * GET /api/models/catalog/matches/:listingId
 * Retrieves ranked list of approved catalog models matching a listing.
 */
async function getCatalogMatches(req, res) {
  try {
    const { listingId } = req.params;
    if (!listingId) {
      return sendError(res, 400, 'listingId parameter is required.');
    }

    let listing = null;
    try {
      const { data, error: listingErr } = await supabase
        .from('assets')
        .select('id, name, title, category, tags, brand, maker')
        .eq('id', listingId)
        .maybeSingle();
      if (!listingErr && data) {
        listing = data;
      }
    } catch (_) {}

    // If listing record is not yet synced in DB, fall back to query metadata or active catalog
    if (!listing) {
      const { category, title, name, tags, brand } = req.query || {};
      listing = {
        id: listingId,
        category: category || '',
        title: title || name || '',
        name: name || title || '',
        tags: tags ? (Array.isArray(tags) ? tags : String(tags).split(',').map((s) => s.trim())) : [],
        brand: brand || '',
      };
    }

    const matches = await modelCatalogService.matchCatalogModels({
      listing,
      category: listing.category,
      title: listing.name || listing.title,
      tags: listing.tags,
      brand: listing.brand || listing.maker,
      limit: 6,
    });

    return res.json({
      success: true,
      listingId,
      matches,
      matchThreshold: modelCatalogService.getCatalogMatchThreshold(),
    });
  } catch (err) {
    console.error('[ModelController] getCatalogMatches error:', err.message);
    return sendError(res, 500, err.message || 'Error matching catalog models.');
  }
}

/**
 * POST /api/models/catalog/select
 * Allows a listing seller or admin to manually select a catalog model for their listing.
 * Body: { listingId, catalogModelId }
 */
async function selectCatalogModel(req, res) {
  try {
    const { listingId, catalogModelId } = req.body || {};
    if (!listingId || !catalogModelId) {
      return sendError(res, 400, 'listingId and catalogModelId are required in body.');
    }

    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, 'Unauthorized: user context is missing.');
    }

    // Check listing ownership or admin role
    const { data: listing, error: listingErr } = await supabase
      .from('assets')
      .select('id, user_id, seller_id')
      .eq('id', listingId)
      .maybeSingle();

    if (listingErr || !listing) {
      return sendError(res, 404, `Listing not found with ID ${listingId}`);
    }

    const isAdmin = await isUserAdmin(userId);
    const ownerId = listing.user_id || listing.seller_id;
    const isOwner = Boolean(ownerId && String(ownerId) === String(userId));

    if (!isOwner && !isAdmin) {
      return sendError(res, 403, 'Forbidden: Only the listing seller or an administrator can assign a catalog model.');
    }

    const result = await modelCatalogService.assignCatalogModelToListing({
      listingId,
      catalogModelId,
      matchScore: 1.0,
      matchReasons: { manualSelection: true, selectedBy: userId },
    });

    return res.json({
      success: true,
      status: 'ready',
      source: 'category_catalog',
      message: 'Catalog model successfully assigned to listing.',
      model: result.listingModel,
      catalogModel: result.catalogModel,
      attribution: result.catalogModel.attribution,
      license: result.catalogModel.license,
      dimensions_approximate: result.catalogModel.dimensions_approximate !== false,
    });
  } catch (err) {
    console.error('[ModelController] selectCatalogModel error:', err.message);
    const statusCode =
      err.message?.includes('not found') ||
      err.message?.includes('inactive') ||
      err.message?.includes('unapproved')
        ? 400
        : 500;
    return sendError(res, statusCode, err.message || 'Failed to select catalog model.');
  }
}

/**
 * GET /api/models/balance
 * Returns current Tripo API credit balance.
 */
async function getBalance(_req, res) {
  try {
    const balance = await tripoService.checkCreditBalance();
    return res.json({
      success: true,
      balance: balance.balance,
      frozen: balance.frozen,
      catalogAvailable: true,
    });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
}

module.exports = {
  generateModel,
  getModelStatus,
  getCatalogMatches,
  selectCatalogModel,
  getBalance,
  isUserAdmin,
};
