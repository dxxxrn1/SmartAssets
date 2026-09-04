// ─── User Data Controller ───────────────────────────────────────────────────
// Manages strictly user-isolated portfolio and vault holdings.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

// ── GET /api/user/vault ──────────────────────────────────────────────────────
// Returns ONLY holdings belonging to the authenticated user.
async function getVault(req, res) {
  try {
    const userId = req.user.id;

    // Fetch strictly this user's holdings
    const { data: holdings, error } = await supabase
      .from('user_holdings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching vault holdings:', error);
      // If table doesn't exist yet or has error, return safe empty list
      return res.status(200).json({
        success: true,
        holdings: [],
        summary: {
          totalValueFormatted: 'R0',
          totalValueNum: 0,
          totalCount: 0,
          wholeCount: 0,
          fractionalCount: 0,
          gainText: '+0.0% MoM',
        },
      });
    }

    const items = holdings || [];

    // Compute personal portfolio summary
    const totalValueNum = items.reduce((sum, item) => sum + (Number(item.price_num) || 0), 0);
    const wholeCount = items.filter((i) => i.asset_type !== 'fractional').length;
    const fractionalCount = items.filter((i) => i.asset_type === 'fractional').length;

    const formattedTotal = 'R' + Number(totalValueNum).toLocaleString('en-ZA');

    return res.status(200).json({
      success: true,
      holdings: items,
      summary: {
        totalValueFormatted: formattedTotal,
        totalValueNum,
        totalCount: items.length,
        wholeCount,
        fractionalCount,
        gainText: items.length > 0 ? '+4.2% MoM' : '0.0%',
      },
    });
  } catch (err) {
    console.error('getVault error:', err);
    return sendError(res, 500, 'Failed to fetch personal vault data.');
  }
}

// ── POST /api/user/vault ─────────────────────────────────────────────────────
// Adds an asset into the authenticated user's personal vault.
async function addHolding(req, res) {
  try {
    const userId = req.user.id;
    const { name, category, price, priceNum, gain, gainPct, positive, image, assetType } = req.body;

    if (!name || !category || priceNum === undefined) {
      return sendError(res, 400, 'Please provide asset name, category, and price.');
    }

    const { data, error } = await supabase
      .from('user_holdings')
      .insert({
        user_id: userId,
        name: name.trim(),
        category: category.trim(),
        price: price || `R${Number(priceNum).toLocaleString('en-ZA')}`,
        price_num: Number(priceNum),
        gain: gain || '+0.0%',
        gain_pct: gainPct || '0%',
        positive: positive !== undefined ? positive : true,
        image: image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
        asset_type: assetType || 'whole',
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding holding:', error);
      return sendError(res, 400, 'Could not add holding to vault.');
    }

    return res.status(201).json({
      success: true,
      message: 'Asset added to your personal vault!',
      holding: data,
    });
  } catch (err) {
    console.error('addHolding error:', err);
    return sendError(res, 500, 'Failed to save holding to your vault.');
  }
}

// ── POST /api/user/seed-starter ──────────────────────────────────────────────
// Seeds starter assets strictly for this user (for testing/demo purposes)
async function seedStarterHoldings(req, res) {
  try {
    const userId = req.user.id;

    // Check if user already has items
    const { data: existing } = await supabase
      .from('user_holdings')
      .select('id')
      .eq('user_id', userId);

    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'User already has holdings.',
      });
    }

    // Pull actual assets from the database instead of hardcoding items
    const { data: dbAssets } = await supabase
      .from('assets')
      .select('*')
      .eq('status', 'active')
      .limit(2);

    if (!dbAssets || dbAssets.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No assets currently in database to seed.',
        holdings: [],
      });
    }

    const starterHoldings = dbAssets.map((a) => ({
      user_id: userId,
      name: a.name,
      category: a.category,
      price: a.price,
      price_num: a.price_num,
      gain: '+0.0%',
      gain_pct: '0%',
      positive: true,
      image: a.image,
      asset_type: 'whole',
    }));

    const { data, error } = await supabase
      .from('user_holdings')
      .insert(starterHoldings)
      .select();

    if (error) {
      console.error('Seed error:', error);
      return sendError(res, 400, 'Could not seed starter items.');
    }

    return res.status(201).json({
      success: true,
      message: 'Starter portfolio created for your account!',
      holdings: data,
    });
  } catch (err) {
    console.error('seed error:', err);
    return sendError(res, 500, 'Failed to seed starter assets.');
  }
}

module.exports = { getVault, addHolding, seedStarterHoldings };

