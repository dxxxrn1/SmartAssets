// ─── 3D Model Provider Abstraction & Fallback Orchestrator ───────────────────
// Coordinates 3D spatial model fulfillment for SmartAssets marketplace listings:
//   1. Primary Provider: Tripo 3D AI v3 (Image-to-3D photogrammetric synthesis)
//   2. Fallback System:  SmartAssets Curated GLB Catalog (commercially licensed, category-matched)
//
// Policy Enforcements:
//   - Zero client-exposed secrets (Tripo API key remains strictly server-side)
//   - Atomic Cross-Instance Concurrency limits (MODEL_MAX_CONCURRENT_JOBS, default 3)
//   - Atomic Per-listing attempt caps (MODEL_MAX_ATTEMPTS_PER_LISTING, default 2)
//   - Stale-job recovery that reclaims abandoned processing tasks (>10 minutes)
//   - Deterministic catalog fallback on Tripo failure, quota exhaustion, or unconfigured provider
//   - Automatic catalog assignment only above CATALOG_MATCH_THRESHOLD (default 0.70)
//   - Candidate match suggestions surfaced for seller review if confidence is below threshold
//   - Catalog fallback incurs ZERO third-party API spend

const supabase = require('../connection/supabaseClient');
const defaultTripoService = require('./tripoService');
const modelCatalogService = require('./modelCatalogService');

let activeTripoAdapter = defaultTripoService;

// Shared atomic job claim engine (powers multi-instance locking across simulated instances and local tests)
class SharedJobClaimEngine {
  constructor() {
    this.jobs = new Map(); // listingId -> { status, attempts, updatedAt, taskId, error }
  }

  reset() {
    this.jobs.clear();
  }

  async claim(listingId, { maxConcurrent = 3, maxAttempts = 2, staleIntervalMinutes = 10 } = {}) {
    const key = String(listingId);
    const now = Date.now();
    const staleMs = staleIntervalMinutes * 60 * 1000;

    const existing = this.jobs.get(key);
    if (existing) {
      if (existing.status === 'ready') {
        return {
          claimed: false,
          code: 'ALREADY_READY',
          message: '3D model is already ready for this listing.',
          model: existing,
        };
      }
      if (existing.status === 'processing' && now - existing.updatedAt < staleMs) {
        return {
          claimed: false,
          code: 'IN_PROGRESS',
          message: '3D model generation is already in progress.',
          model: existing,
        };
      }
      if (existing.attempts >= maxAttempts) {
        return {
          claimed: false,
          code: 'ATTEMPT_LIMIT_REACHED',
          message: `Maximum 3D generation attempts (${maxAttempts}) reached for this listing.`,
          attemptCount: existing.attempts,
        };
      }
    }

    // Check active concurrency across all listings
    let activeCount = 0;
    for (const [id, j] of this.jobs.entries()) {
      if (id !== key && j.status === 'processing' && now - j.updatedAt < staleMs) {
        activeCount++;
      }
    }

    if (activeCount >= maxConcurrent) {
      return {
        claimed: false,
        code: 'CONCURRENCY_LIMIT_REACHED',
        message: `3D generation queue is currently at capacity (${maxConcurrent} concurrent jobs).`,
        activeCount,
      };
    }

    const nextAttempts = (existing?.attempts || 0) + 1;
    this.jobs.set(key, {
      status: 'processing',
      attempts: nextAttempts,
      updatedAt: now,
      provider: 'tripo',
    });

    return {
      claimed: true,
      attemptCount: nextAttempts,
    };
  }

  release(listingId, status = 'failed', details = {}) {
    const key = String(listingId);
    const existing = this.jobs.get(key) || { attempts: 1 };
    this.jobs.set(key, {
      ...existing,
      status,
      ...details,
      updatedAt: Date.now(),
    });
  }
}

const sharedClaimEngine = new SharedJobClaimEngine();

function getMaxConcurrentJobs() {
  const val = parseInt(process.env.MODEL_MAX_CONCURRENT_JOBS, 10);
  return !isNaN(val) && val > 0 ? val : 3;
}

function getMaxAttemptsPerListing() {
  const val = parseInt(process.env.MODEL_MAX_ATTEMPTS_PER_LISTING, 10);
  return !isNaN(val) && val > 0 ? val : 2;
}

/**
 * Claims a generation slot atomically across Render instances.
 * In production (NODE_ENV !== 'test'): strictly uses the database RPC 'claim_model_generation_job'
 * and fails closed if the database RPC is unreachable or fails.
 * In test mode (NODE_ENV === 'test'): uses the sharedClaimEngine to test multi-instance locking.
 */
async function claimGenerationSlot(listingId, options = {}) {
  const maxConcurrent = options.maxConcurrent || getMaxConcurrentJobs();
  const maxAttempts = options.maxAttempts || getMaxAttemptsPerListing();
  const staleIntervalMinutes = options.staleIntervalMinutes || 10;

  if (process.env.NODE_ENV !== 'test') {
    const { data, error } = await supabase.rpc('claim_model_generation_job', {
      p_listing_id: listingId,
      p_max_concurrent: maxConcurrent,
      p_max_attempts: maxAttempts,
      p_stale_interval_minutes: staleIntervalMinutes,
    });

    if (error) {
      console.error('[ModelProviderService] Database job reservation failed:', error.message);
      const failClosedErr = new Error(`Capacity reservation service unavailable: ${error.message}`);
      failClosedErr.code = 'RESERVATION_SERVICE_UNAVAILABLE';
      failClosedErr.statusCode = 503;
      throw failClosedErr;
    }

    if (!data) {
      const err = new Error('Capacity reservation returned empty response from database.');
      err.code = 'RESERVATION_SERVICE_UNAVAILABLE';
      err.statusCode = 503;
      throw err;
    }

    return data;
  }

  return sharedClaimEngine.claim(listingId, { maxConcurrent, maxAttempts, staleIntervalMinutes });
}

/**
 * Releases or updates the state of a generation slot.
 */
async function releaseGenerationSlot(listingId, status, details = {}) {
  if (process.env.NODE_ENV !== 'test') {
    const { error } = await supabase.rpc('release_model_generation_job', {
      p_listing_id: listingId,
      p_status: status,
      p_task_id: details.taskId || null,
      p_glb_url: details.glbUrl || null,
      p_error_message: details.errorMessage || null,
    });
    if (error) {
      console.error('[ModelProviderService] Failed to release generation slot in database:', error.message);
    }
  } else {
    sharedClaimEngine.release(listingId, status, details);
  }
}

/**
 * Encodes provider name and task ID into a durable string (`tripo:<id>` or `catalog:<id>`).
 */
function encodeProviderTaskId(provider, rawTaskId) {
  if (!rawTaskId) return null;
  const cleanId = String(rawTaskId).replace(/^(tripo|catalog):/i, '');
  const cleanProv = String(provider || 'tripo').toLowerCase() === 'catalog' ? 'catalog' : 'tripo';
  return `${cleanProv}:${cleanId}`;
}

function decodeProviderTaskId(storedTaskId, explicitProvider = null) {
  if (!storedTaskId) {
    return { provider: explicitProvider || 'tripo', taskId: null };
  }
  const str = String(storedTaskId);
  const match = str.match(/^(tripo|catalog):(.+)$/i);
  if (match) {
    return {
      provider: match[1].toLowerCase(),
      taskId: match[2],
    };
  }
  return {
    provider: explicitProvider || 'tripo',
    taskId: str,
  };
}

/**
 * Classifies whether a Tripo error qualifies for automated catalog fallback.
 */
function isEligibleForCatalogFallback(errOrReason) {
  if (!errOrReason) return true;
  const msg = String(errOrReason?.message || errOrReason || '').toLowerCase();
  const status = errOrReason?.status || errOrReason?.statusCode || 0;
  return (
    status === 402 ||
    status === 429 ||
    status >= 500 ||
    msg.includes('insufficient tripo credits') ||
    msg.includes('credit') ||
    msg.includes('quota') ||
    msg.includes('balance') ||
    msg.includes('tripo_api_key is not configured') ||
    msg.includes('tripo is not configured') ||
    msg.includes('failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('connection error') ||
    msg.includes('api error') ||
    msg.includes('getaddrinfo')
  );
}

/**
 * Dispatches a 3D model generation request:
 *   1. Performs atomic database reservation (concurrency and attempt budgets).
 *   2. Attempts Tripo Image-to-3D photogrammetric synthesis.
 *   3. If Tripo fails or is unconfigured, releases slot and queries Curated Model Catalog.
 *   4. If catalog confidence >= threshold, returns catalog match for auto-assignment.
 *   5. If confidence < threshold, returns candidate matches for seller review.
 */
async function dispatchModelGeneration({ listingId, imageUrl, listing = {}, options = {}, existingModel = null }) {
  const key = String(listingId);
  const maxConcurrent = getMaxConcurrentJobs();
  const maxAttempts = getMaxAttemptsPerListing();

  // 1. Atomic reservation across instances
  const claim = await claimGenerationSlot(key, { maxConcurrent, maxAttempts });

  if (!claim.claimed) {
    if (claim.code === 'CONCURRENCY_LIMIT_REACHED') {
      const err = new Error(
        `3D generation queue is currently at capacity (${maxConcurrent} concurrent jobs). Please try again shortly.`,
      );
      err.code = 'CONCURRENCY_LIMIT_REACHED';
      err.statusCode = 429;
      throw err;
    }

    if (claim.code === 'IN_PROGRESS') {
      const err = new Error('3D model generation is already in progress for this listing.');
      err.code = 'IN_PROGRESS';
      err.statusCode = 409;
      err.model = claim.model;
      throw err;
    }

    if (claim.code === 'ALREADY_READY') {
      return {
        provider: claim.model?.provider || 'tripo',
        isAlreadyReady: true,
        model: claim.model,
      };
    }

    if (claim.code === 'ATTEMPT_LIMIT_REACHED') {
      // Query catalog fallback when max attempts reached
      const catalogMatches = await modelCatalogService.matchCatalogModels({
        listing,
        category: listing?.category,
        title: listing?.name || listing?.title,
        tags: listing?.tags,
        brand: listing?.brand,
      });

      if (catalogMatches.length > 0 && catalogMatches[0].isAutoEligible) {
        return {
          provider: 'catalog',
          fallbackUsed: true,
          isAutoMatch: true,
          catalogModel: catalogMatches[0].model,
          score: catalogMatches[0].score,
          reasons: catalogMatches[0].reasons,
          attemptCount: claim.attemptCount || maxAttempts,
          maxAttempts,
        };
      }

      const err = new Error(
        `Maximum 3D generation attempts (${maxAttempts}) reached for this listing to protect credit budget.`,
      );
      err.code = 'ATTEMPT_LIMIT_REACHED';
      err.statusCode = 429;
      err.catalogMatches = catalogMatches;
      throw err;
    }
  }

  const currentAttempt = claim.attemptCount || 1;

  // 2. Primary Path: Tripo 3D AI
  let tripoError = null;
  const isTripoReady =
    typeof activeTripoAdapter.isTripoConfigured === 'function'
      ? activeTripoAdapter.isTripoConfigured()
      : Boolean((process.env.TRIPO_API_KEY || process.env.TRIPO_SECRETE_KEY || '').trim());

  if (isTripoReady) {
    try {
      const taskResult = await activeTripoAdapter.createImageToModelTask(imageUrl, options);
      const rawTaskId = typeof taskResult === 'object' ? taskResult.taskId : taskResult;

      return {
        provider: 'tripo',
        rawTaskId,
        encodedTaskId: encodeProviderTaskId('tripo', rawTaskId),
        attemptCount: currentAttempt,
        maxAttempts,
        usedFallback: false,
      };
    } catch (err) {
      tripoError = err;
      await releaseGenerationSlot(key, 'failed', { errorMessage: err.message });
      console.warn(`[ModelProviderService] Primary Tripo dispatch failed for listing ${key}: ${err.message}`);
    }
  } else {
    tripoError = new Error('Tripo 3D provider is not configured (TRIPO_API_KEY missing).');
    await releaseGenerationSlot(key, 'failed', { errorMessage: tripoError.message });
  }

  // 3. Fallback Path: Curated Model Catalog
  if (isEligibleForCatalogFallback(tripoError)) {
    console.log(`[ModelProviderService] Triggering curated catalog fallback for listing ${key}...`);

    const catalogMatches = await modelCatalogService.matchCatalogModels({
      listing,
      category: listing?.category,
      title: listing?.name || listing?.title,
      tags: listing?.tags,
      brand: listing?.brand,
    });

    const topMatch = catalogMatches[0] || null;

    if (topMatch && topMatch.isAutoEligible) {
      console.log(
        `[ModelProviderService] Found high-confidence catalog match "${topMatch.model.name}" (score: ${topMatch.score}) for listing ${key}.`,
      );
      return {
        provider: 'catalog',
        rawTaskId: topMatch.model.id,
        encodedTaskId: encodeProviderTaskId('catalog', topMatch.model.id),
        attemptCount: currentAttempt,
        maxAttempts,
        usedFallback: true,
        isAutoMatch: true,
        catalogModel: topMatch.model,
        score: topMatch.score,
        reasons: topMatch.reasons,
        primaryError: tripoError?.message,
      };
    }

    if (catalogMatches.length > 0) {
      console.log(
        `[ModelProviderService] Found ${catalogMatches.length} candidate catalog models below auto-threshold for seller review.`,
      );
      return {
        provider: 'catalog',
        attemptCount: currentAttempt,
        maxAttempts,
        usedFallback: true,
        isAutoMatch: false,
        candidateMatches: catalogMatches,
        primaryError: tripoError?.message,
      };
    }
  }

  // 4. No acceptable model exists
  const failureErr = new Error(
    `3D model unavailable: AI generation could not be completed (${tripoError?.message || 'provider error'}) and no category catalog model matched.`,
  );
  failureErr.code = 'NO_MODEL_AVAILABLE';
  failureErr.statusCode = 502;
  failureErr.primaryError = tripoError?.message;
  throw failureErr;
}

/**
 * Polls the active provider for a listing's in-flight 3D task.
 * If Tripo reports task failure during polling, triggers the Curated Catalog fallback.
 */
async function pollListingModelTask({ listingId, modelRow, listing = null }) {
  const key = String(listingId);
  const maxAttempts = getMaxAttemptsPerListing();
  const decoded = decodeProviderTaskId(modelRow?.tripo_task_id, modelRow?.provider);

  // If already a catalog model, return ready directly
  if (decoded.provider === 'catalog' || modelRow?.source === 'category_catalog') {
    await releaseGenerationSlot(key, 'ready');
    return {
      status: 'ready',
      provider: 'catalog',
      source: 'category_catalog',
      glb_url: modelRow?.glb_url,
      catalogModelId: decoded.taskId,
      attribution: modelRow?.attribution,
      license: modelRow?.license,
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  const rawTaskId = decoded.taskId;
  if (!rawTaskId) {
    return {
      status: 'failed',
      provider: 'tripo',
      error: 'No active provider task ID found for listing model.',
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  let taskInfo;
  try {
    taskInfo = await activeTripoAdapter.pollTaskUntilComplete(rawTaskId, 1, 1000);
  } catch (err) {
    console.warn(`[ModelProviderService] Polling exception for task ${rawTaskId}:`, err.message);
    return {
      status: 'processing',
      provider: 'tripo',
      progress: 25,
      error: err.message,
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  if (taskInfo.status === 'success' && taskInfo.glbUrl) {
    await releaseGenerationSlot(key, 'ready', { glbUrl: taskInfo.glbUrl, taskId: rawTaskId });
    return {
      status: 'ready',
      provider: 'tripo',
      source: 'ai_generated',
      glbUrl: taskInfo.glbUrl,
      pbrModel: taskInfo.pbrModel,
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  if (taskInfo.status === 'running' || taskInfo.status === 'queued') {
    return {
      status: 'processing',
      provider: 'tripo',
      progress: taskInfo.progress || 35,
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  // Tripo task reached terminal failure
  console.warn(`[ModelProviderService] Tripo task ${rawTaskId} failed (${taskInfo.error}). Querying catalog fallback...`);
  await releaseGenerationSlot(key, 'failed', { errorMessage: taskInfo.error });

  const catalogMatches = await modelCatalogService.matchCatalogModels({
    listing,
    category: listing?.category,
    title: listing?.name || listing?.title,
    tags: listing?.tags,
    brand: listing?.brand,
  });

  const topMatch = catalogMatches[0] || null;

  if (topMatch && topMatch.isAutoEligible) {
    return {
      status: 'catalog_fallback',
      provider: 'catalog',
      source: 'category_catalog',
      catalogModel: topMatch.model,
      score: topMatch.score,
      reasons: topMatch.reasons,
      attemptCount: modelRow?.attempt_count || 1,
      maxAttempts,
    };
  }

  return {
    status: 'failed',
    provider: 'tripo',
    progress: 0,
    error: taskInfo.error || 'Tripo 3D model generation failed.',
    candidateMatches: catalogMatches,
    attemptCount: modelRow?.attempt_count || 1,
    maxAttempts,
  };
}

function markJobFinished(listingId) {
  releaseGenerationSlot(String(listingId), 'ready');
}

function setTripoAdapterForTest(customAdapter) {
  activeTripoAdapter = customAdapter || defaultTripoService;
}

function resetProviderAdaptersForTest() {
  activeTripoAdapter = defaultTripoService;
  sharedClaimEngine.reset();
}

module.exports = {
  dispatchModelGeneration,
  pollListingModelTask,
  claimGenerationSlot,
  releaseGenerationSlot,
  SharedJobClaimEngine,
  encodeProviderTaskId,
  decodeProviderTaskId,
  isEligibleForCatalogFallback,
  getMaxConcurrentJobs,
  getMaxAttemptsPerListing,
  markJobFinished,
  setTripoAdapterForTest,
  resetProviderAdaptersForTest,
};
