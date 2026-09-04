// ─── Asset Controller ────────────────────────────────────────────────────────
// CRUD operations for marketplace assets and provenance history.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

/**
 * GET /api/assets?category=...&q=...
 * Fetch all active marketplace assets with optional category and search filters.
 */
async function getAssets(req, res) {
  try {
    const { category, q } = req.query;

    let query = supabase
      .from('assets')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    if (q && q.trim()) {
      query = query.or(`name.ilike.%${q.trim()}%,category.ilike.%${q.trim()}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Assets fetch error:', error);
      return sendError(res, 500, 'Failed to fetch marketplace assets.');
    }

    // Map DB rows to the shape the frontend expects
    const assets = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      price: row.price || `£${Number(row.price_num || 0).toLocaleString()}`,
      price_num: row.price_num,
      year: row.year,
      condition: row.condition,
      description: row.description,
      image: row.image,
      badge: row.badge || 'Certified',
      cert: row.cert || 'SmartAssets Verified',
      shares: row.shares || 100,
      sharesSold: row.shares_sold || 0,
      sharePrice: row.share_price || Math.round((row.price_num || 1000) / 100),
      gain: row.gain || '+0.0%',
    }));

    return res.json({ success: true, assets });
  } catch (err) {
    console.error('getAssets error:', err);
    return sendError(res, 500, 'Internal server error fetching assets.');
  }
}

/**
 * GET /api/assets/:id
 * Fetch a single asset along with its provenance history events.
 */
async function getAssetById(req, res) {
  try {
    const { id } = req.params;

    const { data: asset, error: assetErr } = await supabase
      .from('assets')
      .select('*')
      .eq('id', id)
      .single();

    if (assetErr || !asset) {
      return sendError(res, 404, 'Asset not found.');
    }

    const { data: history, error: histErr } = await supabase
      .from('asset_history')
      .select('*')
      .eq('asset_id', id)
      .order('year', { ascending: false });

    if (histErr) {
      console.error('History fetch error:', histErr);
    }

    return res.json({
      success: true,
      asset: {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        price: asset.price || `£${Number(asset.price_num || 0).toLocaleString()}`,
        price_num: asset.price_num,
        year: asset.year,
        condition: asset.condition,
        description: asset.description,
        image: asset.image,
        badge: asset.badge || 'Certified',
        cert: asset.cert || 'SmartAssets Verified',
      },
      history: (history || []).map((h) => ({
        id: h.id,
        year: String(h.year),
        event: h.event,
        party: h.party,
        hash: h.hash,
        verified: h.verified,
      })),
    });
  } catch (err) {
    console.error('getAssetById error:', err);
    return sendError(res, 500, 'Internal server error fetching asset details.');
  }
}

/**
 * POST /api/assets  (protected — requireAuth)
 * Create a new asset listing with optional image and provenance history events.
 */
async function createAsset(req, res) {
  try {
    const userId = req.user.id;
    const { name, category, askingPrice, year, condition, description, image, history } = req.body;

    if (!name || !askingPrice) {
      return sendError(res, 400, 'Name and asking price are required.');
    }

    const priceNum = parseFloat(String(askingPrice).replace(/[^0-9.]/g, '')) || 0;

    // Insert the asset
    const { data: newAsset, error: insertErr } = await supabase
      .from('assets')
      .insert({
        name,
        category: category || 'Uncategorised',
        price: `£${priceNum.toLocaleString()}`,
        price_num: priceNum,
        year: parseInt(year, 10) || new Date().getFullYear(),
        condition: condition || 'Not specified',
        description: description || '',
        image: image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
        badge: 'New Listing',
        cert: 'Pending Verification',
        status: 'active',
        user_id: userId,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Asset insert error:', insertErr);
      return sendError(res, 500, 'Failed to create asset listing.');
    }

    // Insert provenance history events
    if (Array.isArray(history) && history.length > 0) {
      const historyRows = history.map((h) => ({
        asset_id: newAsset.id,
        year: parseInt(h.year, 10) || new Date().getFullYear(),
        event: h.event || 'Provenance event',
        party: h.party || 'Unknown',
        hash: '0x' + Math.random().toString(16).slice(2, 10) + '...' + Math.random().toString(16).slice(2, 6),
        verified: true,
      }));

      const { error: histErr } = await supabase.from('asset_history').insert(historyRows);
      if (histErr) {
        console.error('History insert error:', histErr);
      }
    }

    // Also add the asset to the creator's personal vault (user_holdings)
    await supabase.from('user_holdings').insert({
      user_id: userId,
      name,
      category: category || 'Uncategorised',
      price: `£${priceNum.toLocaleString('en-GB')}`,
      price_num: priceNum,
      image: newAsset.image,
      asset_type: 'whole',
      gain: '+0.0%',
      gain_pct: '0%',
      positive: true,
    });

    return res.status(201).json({
      success: true,
      message: 'Asset listed successfully!',
      asset: newAsset,
    });
  } catch (err) {
    console.error('createAsset error:', err);
    return sendError(res, 500, 'Internal server error creating asset.');
  }
}

module.exports = { getAssets, getAssetById, createAsset };

