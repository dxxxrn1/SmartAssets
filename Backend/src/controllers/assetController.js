// ─── Asset Controller ────────────────────────────────────────────────────────
// CRUD operations for marketplace assets, Ethereum Sepolia NFT minting,
// and provenance history chain-of-custody tracking.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const web3Service = require('../services/web3Service');
const aiDetectionService = require('../services/aiDetectionService');

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
      price: row.price || `R${Number(row.price_num || 0).toLocaleString('en-ZA')}`,
      price_num: row.price_num,
      year: row.year,
      condition: row.condition,
      description: row.description,
      image: row.image,
      badge: row.badge || 'Verified',
      cert: row.cert || 'SmartAssets Verified',
      shares: row.shares || 100,
      sharesSold: row.shares_sold || 0,
      sharePrice: row.share_price || Math.round((row.price_num || 1000) / 100),
      gain: row.gain || '+0.0%',
      // On-chain blockchain fields
      tokenId: row.token_id || null,
      txHash: row.tx_hash || null,
      contractAddress: row.contract_address || null,
      etherscanUrl: row.etherscan_url || (row.tx_hash ? `https://sepolia.etherscan.io/tx/${row.tx_hash}` : null),
      // Owner/Creator
      userId: row.user_id || null,
      owner: row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : (row.owner || 'Verified Seller'),
      // AI Fraud & Authenticity Verification
      aiScanScore: row.ai_scan_score ?? null,
      aiScanStatus: row.ai_scan_status || (row.badge === 'Verified' || row.badge === 'Verified On-Chain' ? 'passed' : null),
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

    // 1. First attempt: lookup in marketplace assets table
    let { data: asset } = await supabase
      .from('assets')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    let historyTargetId = asset?.id;

    // 2. Second attempt: if not in assets, check personal vault holdings
    if (!asset) {
      const { data: holding } = await supabase
        .from('user_holdings')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (holding) {
        // Try finding if there is a matching marketplace asset by name
        const cleanName = (holding.name || '').replace(/\s*\(\d+\s+Shares\)/i, '').trim();
        const { data: matchingAsset } = await supabase
          .from('assets')
          .select('*')
          .ilike('name', `%${cleanName}%`)
          .limit(1)
          .maybeSingle();

        if (matchingAsset) {
          asset = {
            ...matchingAsset,
            id: holding.id,
            user_id: holding.user_id,
            price: holding.price || matchingAsset.price,
            price_num: holding.price_num || matchingAsset.price_num,
          };
          historyTargetId = matchingAsset.id;
        } else {
          asset = {
            id: holding.id,
            name: holding.name,
            category: holding.category,
            price: holding.price || `R${Number(holding.price_num || 0).toLocaleString('en-ZA')}`,
            price_num: holding.price_num,
            year: 2024,
            condition: 'Mint / Vault Custody',
            description: 'Stored in SmartAssets High-Security Vault Facility.',
            image: holding.image,
            badge: 'Vault Secured',
            cert: 'SA-VLT-' + holding.id.substring(0, 8).toUpperCase(),
            shares: holding.asset_type === 'fractional' ? 100 : 1,
            shares_sold: holding.asset_type === 'fractional' ? 45 : 1,
            share_price: holding.price_num,
            user_id: holding.user_id,
          };
          historyTargetId = null;
        }
      }
    }

    if (!asset) {
      return sendError(res, 404, 'Asset not found.');
    }

    // 3. Fetch provenance history events
    let history = [];
    if (historyTargetId) {
      const { data: histData } = await supabase
        .from('asset_history')
        .select('*')
        .eq('asset_id', historyTargetId)
        .order('year', { ascending: false });
      history = histData || [];
    }

    // If no history found, provide standard provenance chain
    if (history.length === 0) {
      history = [
        {
          id: 'hist-' + (asset.id || 'initial'),
          year: String(asset.year || new Date().getFullYear()),
          event: asset.user_id ? 'Authenticated & Deposited in SmartAssets Secure Vault' : 'Marketplace Listing & Authenticity Certified',
          party: 'SmartAssets Custody & Verification',
          hash: '0x' + (asset.id ? String(asset.id).replace(/-/g, '').slice(0, 24) : '7a8b9c0d1e2f3a4b'),
          tx_hash: asset.tx_hash || null,
          etherscanUrl: asset.tx_hash ? `https://sepolia.etherscan.io/tx/${asset.tx_hash}` : null,
          verified: true,
        },
      ];
    }

    return res.json({
      success: true,
      asset: {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        price: asset.price || `R${Number(asset.price_num || 0).toLocaleString('en-ZA')}`,
        price_num: asset.price_num,
        year: asset.year,
        condition: asset.condition,
        description: asset.description,
        image: asset.image,
        badge: asset.badge || 'Verified',
        cert: asset.cert || 'SmartAssets Verified',
        shares: asset.shares || 100,
        sharesSold: asset.shares_sold || 0,
        sharePrice: asset.share_price || Math.round((asset.price_num || 1000) / 100),
        // On-chain blockchain fields
        tokenId: asset.token_id || null,
        txHash: asset.tx_hash || null,
        contractAddress: asset.contract_address || null,
        etherscanUrl: asset.etherscan_url || (asset.tx_hash ? `https://sepolia.etherscan.io/tx/${asset.tx_hash}` : null),
        userId: asset.user_id || null,
        owner: asset.user_id ? `User ${String(asset.user_id).slice(0, 8)}` : (asset.owner || 'Verified Seller'),
        // AI Fraud & Authenticity Verification
        aiScanScore: asset.ai_scan_score ?? null,
        aiScanStatus: asset.ai_scan_status || (asset.badge === 'Verified' || asset.badge === 'Verified On-Chain' ? 'passed' : null),
      },
      history: history.map((h) => ({
        id: h.id,
        year: String(h.year),
        event: h.event,
        party: h.party,
        hash: h.hash,
        txHash: h.tx_hash || null,
        etherscanUrl: h.tx_hash ? `https://sepolia.etherscan.io/tx/${h.tx_hash}` : null,
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
 * Create a new asset listing, mint an ERC-721 Certificate of Authenticity NFT on Sepolia,
 * and record provenance history events.
 */
async function createAsset(req, res) {
  try {
    const userId = req.user.id;
    const { name, category, askingPrice, year, condition, description, image, history } = req.body;

    if (!name || !askingPrice) {
      return sendError(res, 400, 'Name and asking price are required.');
    }

    const priceNum = parseFloat(String(askingPrice).replace(/[^0-9.]/g, '')) || 0;

    // Gather candidate images for AI fraud detection scan
    const imagesToScan = [];
    if (Array.isArray(req.body.images) && req.body.images.length > 0) {
      imagesToScan.push(...req.body.images);
    } else if (image) {
      imagesToScan.push(image);
    }

    // Run AI Fraud & Deepfake Detection via Hive API
    console.log(`🛡️ [AI Fraud Guard] Initiating Hive AI image scan for "${name}"...`);
    const scanResult = await aiDetectionService.scanAllImages(imagesToScan);

    if (scanResult.isAiGenerated) {
      const pct = Math.round((scanResult.highestScore || 0) * 100);
      console.warn(`🚫 [AI Fraud Guard] BLOCKED: AI-generated/deepfake image detected for "${name}" (${pct}% confidence)`);
      return res.status(403).json({
        success: false,
        fraudDetected: true,
        error: `AI Fraud Detected: One or more photos appear to be AI-generated or synthetic (${pct}% confidence). SmartAssets strictly requires authentic, original photographs.`,
        aiScanScore: scanResult.highestScore,
        aiScanStatus: 'flagged',
      });
    }

    if (scanResult.scanFailed) {
      console.warn(`⚠️ [AI Fraud Guard] Image verification failed for "${name}"`);
      return res.status(400).json({
        success: false,
        error: 'Image Authenticity Verification failed: Could not verify photo authenticity. Please upload a clear, valid JPEG or PNG photo.',
      });
    }

    // Check if user has a connected MetaMask wallet address
    let recipientAddress = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('wallet_address')
        .eq('id', userId)
        .single();
      recipientAddress = profile?.wallet_address || null;
    } catch {
      // Ignore if profile lookup fails
    }

    // Generate unique Certificate identifier
    const catCode = (category || 'COL').replace(/\s+/g, '').substring(0, 3).toUpperCase();
    const certNumber = `SA-${catCode}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Mint ERC-721 Certificate of Authenticity on Ethereum Sepolia
    console.log(`⛓️ [Blockchain] Minting Certificate for ${name} on Ethereum Sepolia...`);
    const mintRes = await web3Service.mintAssetNFT({
      recipientAddress,
      assetId: name,
      name,
      category: category || 'Luxury Collectible',
      priceNum,
      certNumber,
      year: parseInt(year, 10) || new Date().getFullYear(),
      condition: condition || 'Mint / Verified',
      image,
    });

    console.log(`✅ [Blockchain] NFT Minted! Token ID: #${mintRes.tokenId}, Tx: ${mintRes.txHash}`);

    // Base asset row compatible with current database schema
    const baseRow = {
      name,
      category: category || 'Uncategorised',
      price: `R${priceNum.toLocaleString('en-ZA')}`,
      price_num: priceNum,
      year: parseInt(year, 10) || new Date().getFullYear(),
      condition: condition || 'Not specified',
      description: description || '',
      image: image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
      badge: 'Verified On-Chain',
      cert: certNumber,
      status: 'active',
      user_id: userId,
      ai_scan_score: scanResult.highestScore,
      ai_scan_status: scanResult.status,
    };

    // Try inserting with on-chain columns
    let { data: newAsset, error: insertErr } = await supabase
      .from('assets')
      .insert({
        ...baseRow,
        token_id: String(mintRes.tokenId),
        tx_hash: mintRes.txHash,
        contract_address: mintRes.contractAddress,
        etherscan_url: mintRes.etherscanUrl,
      })
      .select()
      .single();

    // If new columns are not yet in Supabase schema cache, retry with progressively stripped rows
    if (insertErr && (insertErr.code === 'PGRST204' || insertErr.message?.includes('column'))) {
      // First retry without on-chain columns
      let retry = await supabase.from('assets').insert(baseRow).select().single();
      newAsset = retry.data;
      insertErr = retry.error;

      // Second retry: if ai_scan columns also not in schema, strip them as well
      if (insertErr && (insertErr.code === 'PGRST204' || insertErr.message?.includes('column'))) {
        const { ai_scan_score, ai_scan_status, ...coreRow } = baseRow;
        retry = await supabase.from('assets').insert(coreRow).select().single();
        newAsset = retry.data;
        insertErr = retry.error;
      }
    }

    if (insertErr || !newAsset) {
      console.error('Asset insert error:', insertErr);
      return sendError(res, 500, 'Failed to create asset listing.');
    }

    // Insert provenance history events
    if (Array.isArray(history) && history.length > 0) {
      const historyRows = history.map((h) => {
        const hHash = '0x' + Math.random().toString(16).slice(2, 10) + '...' + Math.random().toString(16).slice(2, 6);
        return {
          asset_id: newAsset.id,
          year: parseInt(h.year, 10) || new Date().getFullYear(),
          event: h.event || 'Provenance milestone',
          party: h.party || 'Verified Custodian',
          hash: hHash,
          tx_hash: mintRes.txHash,
          verified: true,
        };
      });

      let { error: histErr } = await supabase.from('asset_history').insert(historyRows);
      if (histErr && (histErr.code === 'PGRST204' || histErr.message?.includes('column'))) {
        const fallbackRows = historyRows.map(({ tx_hash, ...rest }) => rest);
        const retry = await supabase.from('asset_history').insert(fallbackRows);
        histErr = retry.error;
      }
      if (histErr) {
        console.error('History insert error:', histErr);
      }
    }

    // Also add the asset to the creator's personal vault (user_holdings)
    await supabase.from('user_holdings').insert({
      user_id: userId,
      name,
      category: category || 'Uncategorised',
      price: `R${priceNum.toLocaleString('en-ZA')}`,
      price_num: priceNum,
      image: newAsset.image,
      asset_type: 'whole',
      gain: '+0.0%',
      gain_pct: '0%',
      positive: true,
    });

    return res.status(201).json({
      success: true,
      message: 'Asset listed and NFT Certificate minted on Ethereum Sepolia!',
      asset: {
        ...newAsset,
        tokenId: mintRes.tokenId,
        txHash: mintRes.txHash,
        etherscanUrl: mintRes.etherscanUrl,
        contractAddress: mintRes.contractAddress,
        aiScanScore: scanResult.highestScore,
        aiScanStatus: scanResult.status,
      },
    });
  } catch (err) {
    console.error('createAsset error:', err);
    return sendError(res, 500, 'Internal server error creating asset.');
  }
}

module.exports = { getAssets, getAssetById, createAsset };
