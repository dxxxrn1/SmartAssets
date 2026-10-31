// ─── SmartAssets: Curated 3D Model Catalog Service ───────────────────────────
// Manages retrieval, deterministic category/keyword matching, and assignment of
// licensed, SmartAssets-owned GLBs for marketplace listings.

const path = require('path');
const fs = require('fs');
const supabase = require('../connection/supabaseClient');

const SEED_FILE = path.resolve(__dirname, '../../data/curatedCatalogSeed.json');
let fallbackCatalogCache = null;

function resolveCatalogGlbUrl(model) {
  if (!model) return model;
  if (!model.glb_url && model.storage_path) {
    const bucket = model.storage_bucket || 'models';
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(model.storage_path);
      return {
        ...model,
        glb_url: data?.publicUrl || null,
      };
    } catch (_) {
      return model;
    }
  }
  return model;
}

function getFallbackCatalog() {
  if (fallbackCatalogCache) return fallbackCatalogCache;
  try {
    if (fs.existsSync(SEED_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      fallbackCatalogCache = raw.map(resolveCatalogGlbUrl);
      return fallbackCatalogCache;
    }
  } catch (err) {
    console.warn('[ModelCatalogService] Could not read fallback seed file:', err.message);
  }
  return [];
}

/**
 * Minimum confidence score required to automatically assign a category catalog model
 * without requiring explicit seller review (configurable via env, default 0.70).
 */
function getCatalogMatchThreshold() {
  const val = parseFloat(process.env.CATALOG_MATCH_THRESHOLD);
  return !isNaN(val) && val > 0 && val <= 1.0 ? val : 0.7;
}

/**
 * Fetch all active, approved catalog models from Supabase,
 * falling back to the local seed catalog if database table is not yet migrated.
 */
async function getAllActiveCatalogModels() {
  if (process.env.NODE_ENV === 'test') {
    return getFallbackCatalog().filter((m) => m.is_active !== false);
  }
  try {
    const { data, error } = await supabase
      .from('catalog_models')
      .select('*')
      .eq('is_active', true)
      .eq('is_approved', true);

    if (error || !data || data.length === 0) {
      return getFallbackCatalog().filter((m) => m.is_active !== false);
    }
    return data;
  } catch (_) {
    return getFallbackCatalog().filter((m) => m.is_active !== false);
  }
}

/**
 * Retrieve a single catalog model by its stable UUID.
 */
async function getCatalogModelById(id) {
  if (!id) return null;
  if (process.env.NODE_ENV === 'test') {
    return getFallbackCatalog().find((m) => String(m.id) === String(id)) || null;
  }
  try {
    const { data, error } = await supabase
      .from('catalog_models')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && data) return data;
  } catch (_) {}

  // Fallback to local seed cache
  return getFallbackCatalog().find((m) => String(m.id) === String(id)) || null;
}

/**
 * Tokenize a string into cleaned, lowercased searchable keywords.
 */
function tokenize(str) {
  if (!str || typeof str !== 'string') return [];
  const STOP_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'with', 'for', 'in', 'on', 'at', 'to', 'of', 'by']);
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Match active catalog models against listing metadata using deterministic scoring.
 * @param {object} params
 * @param {object} [params.listing] - Listing database row
 * @param {string} [params.category] - Listing category
 * @param {string} [params.title] - Listing title / name
 * @param {string[]|string} [params.tags] - Listing tags
 * @param {string} [params.brand] - Listing brand / maker
 * @param {number} [params.limit=5] - Maximum ranked matches to return
 * @returns {Promise<Array<{ model: object, score: number, reasons: object, isAutoEligible: boolean }>>}
 */
async function matchCatalogModels({
  listing = null,
  category = null,
  title = null,
  tags = null,
  brand = null,
  limit = 5,
} = {}) {
  const listingCategory = String(category || listing?.category || '').trim().toLowerCase();
  const listingTitle = String(title || listing?.name || listing?.title || '').trim().toLowerCase();
  const listingBrand = String(brand || listing?.brand || listing?.maker || '').trim().toLowerCase();

  let listingTags = [];
  if (Array.isArray(tags)) {
    listingTags = tags.map((t) => String(t).toLowerCase());
  } else if (typeof tags === 'string') {
    listingTags = tags.split(',').map((t) => t.trim().toLowerCase());
  } else if (Array.isArray(listing?.tags)) {
    listingTags = listing.tags.map((t) => String(t).toLowerCase());
  }

  const titleTokens = tokenize(listingTitle);
  const catalogList = await getAllActiveCatalogModels();
  const threshold = getCatalogMatchThreshold();

  const scoredMatches = [];

  for (const model of catalogList) {
    let score = 0;
    const reasons = {
      categoryExact: false,
      categoryRelated: false,
      matchedKeywords: [],
      brandMatched: false,
      tagOverlapCount: 0,
    };

    const modelCat = String(model.category || '').toLowerCase();
    const modelCats = (Array.isArray(model.categories) ? model.categories : [modelCat]).map((c) =>
      String(c).toLowerCase(),
    );
    const modelTags = (Array.isArray(model.tags) ? model.tags : []).map((t) => String(t).toLowerCase());
    const modelBrand = String(model.brand || '').toLowerCase();
    const modelName = String(model.name || '').toLowerCase();

    // 1. Category Matching (Max 0.40)
    if (listingCategory && (modelCat === listingCategory || modelCats.includes(listingCategory))) {
      score += 0.4;
      reasons.categoryExact = true;
    } else if (
      listingCategory &&
      (modelCat.includes(listingCategory) ||
        listingCategory.includes(modelCat) ||
        modelCats.some((c) => c.includes(listingCategory) || listingCategory.includes(c)))
    ) {
      score += 0.25;
      reasons.categoryRelated = true;
    }

    // 2. Title Keyword Matching against catalog name & tags (Max 0.35)
    let keywordScore = 0;
    for (const token of titleTokens) {
      if (modelTags.includes(token) || modelName.includes(token)) {
        keywordScore += 0.1;
        reasons.matchedKeywords.push(token);
      }
    }
    score += Math.min(0.35, keywordScore);

    // 3. Tag Overlap (Max 0.15)
    let tagMatches = 0;
    for (const t of listingTags) {
      if (modelTags.includes(t)) {
        tagMatches++;
      }
    }
    if (tagMatches > 0) {
      reasons.tagOverlapCount = tagMatches;
      score += Math.min(0.15, tagMatches * 0.05);
    }

    // 4. Brand / Product Type Match (Max 0.15)
    if (
      listingBrand &&
      modelBrand &&
      (listingBrand === modelBrand || listingBrand.includes(modelBrand) || modelBrand.includes(listingBrand))
    ) {
      score += 0.15;
      reasons.brandMatched = true;
    }

    // Normalize final score to 2 decimal places [0.00, 1.00]
    const finalScore = Math.min(1.0, Math.round(score * 100) / 100);

    // Keep matches with at least 0.30 confidence
    if (finalScore >= 0.3) {
      scoredMatches.push({
        model,
        score: finalScore,
        reasons,
        isAutoEligible: finalScore >= threshold,
      });
    }
  }

  // Sort descending by score
  scoredMatches.sort((a, b) => b.score - a.score);

  return scoredMatches.slice(0, limit);
}

/**
 * Assign a specific catalog model to a marketplace listing.
 */
async function assignCatalogModelToListing({ listingId, catalogModelId, matchScore = 1.0, matchReasons = {} }) {
  const catalogModel = await getCatalogModelById(catalogModelId);
  if (!catalogModel || catalogModel.is_active === false || catalogModel.is_approved === false) {
    throw new Error(`Catalog model with ID ${catalogModelId} not found, inactive, or unapproved.`);
  }

  const updateRecord = {
    listing_id: listingId,
    status: 'ready',
    source: 'category_catalog',
    catalog_model_id: catalogModel.id,
    glb_url: catalogModel.glb_url,
    placement: catalogModel.placement || 'floor',
    width_cm: catalogModel.width_cm,
    height_cm: catalogModel.height_cm,
    depth_cm: catalogModel.depth_cm,
    dimensions_approximate: catalogModel.dimensions_approximate !== false,
    attribution: catalogModel.attribution,
    license: catalogModel.license,
    match_confidence: matchScore,
    match_reasons: matchReasons,
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('listing_models')
    .upsert(updateRecord, { onConflict: 'listing_id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to assign catalog model: ${error.message}`);
  }

  return {
    listingModel: data,
    catalogModel,
  };
}

module.exports = {
  getCatalogMatchThreshold,
  getAllActiveCatalogModels,
  getCatalogModelById,
  matchCatalogModels,
  assignCatalogModelToListing,
  getFallbackCatalog,
};
