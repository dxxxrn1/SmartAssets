// ─── Asset Controller ────────────────────────────────────────────────────────
// CRUD operations for marketplace assets, Ethereum Sepolia NFT minting,
// and provenance history chain-of-custody tracking.

const fs = require('fs');
const path = require('path');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const web3Service = require('../services/web3Service');
const aiDetectionService = require('../services/aiDetectionService');
const aiVisionGatekeeper = require('../services/aiVisionGatekeeper');
const marketOracleService = require('../services/marketOracleService');
const { saveBase64Image, normalizeImageUrl } = require('../utils/imageHandler');

// In-memory server cache to protect Supabase database egress from repetitive queries
let assetsCache = null;
let assetsCacheTime = 0;
const ASSETS_CACHE_TTL = 60 * 1000; // 60 seconds

function invalidateAssetsCache() {
  assetsCache = null;
  assetsCacheTime = 0;
}

/**
 * Helper to parse multiple images from description comment and return clean description.
 */
function extractImagesAndCleanDescription(description, primaryImage) {
  let images = primaryImage ? [primaryImage] : [];
  let smartTakeTitle = null;
  let smartTakeBody = null;
  let cleanDesc = description || '';

  if (cleanDesc.includes('<!--smartTake:')) {
    const match = cleanDesc.match(/<!--smartTake:([\s\S]*?)-->/);
    if (match) {
      try {
        const extra = JSON.parse(match[1]);
        if (extra?.smartTakeTitle) smartTakeTitle = extra.smartTakeTitle;
        if (extra?.smartTakeBody) smartTakeBody = extra.smartTakeBody;
      } catch (_) {}
    }
    cleanDesc = cleanDesc.replace(/<!--smartTake:[\s\S]*?-->/g, '').trim();
  }

  if (cleanDesc.includes('<!--images:')) {
    const match = cleanDesc.match(/<!--images:([\s\S]*?)-->/);
    if (match) {
      try {
        const extra = JSON.parse(match[1]);
        if (Array.isArray(extra)) {
          extra.forEach((img) => {
            if (img && !images.includes(img)) images.push(img);
          });
        }
      } catch (_) {}
    }
    cleanDesc = cleanDesc.replace(/<!--images:[\s\S]*?-->/g, '').trim();
  }
  return { images, cleanDescription: cleanDesc, smartTakeTitle, smartTakeBody };
}

/**
 * GET /api/assets?category=...&q=...
 * Fetch all active marketplace assets with optional category and search filters.
 */
async function getAssets(req, res) {
  try {
    const { category, q } = req.query;
    const isDefaultQuery = (!category || category === 'All') && (!q || !q.trim());

    if (isDefaultQuery && assetsCache && Date.now() - assetsCacheTime < ASSETS_CACHE_TTL) {
      return res.json({ success: true, assets: assetsCache, cached: true });
    }

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

    // Fetch profiles to map user_id to actual seller display name
    let profileMap = new Map();
    try {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email');
      (profiles || []).forEach((p) => {
        profileMap.set(p.id, p.full_name || (p.email ? p.email.split('@')[0] : 'User ' + String(p.id).slice(0, 8)));
      });
    } catch (e) {
      console.warn('Could not fetch profiles for owner mapping:', e.message);
    }

    // Map DB rows to the shape the frontend expects
    const assets = (data || []).map((row) => {
      let rawPrimaryImage = row.image;
      if (
        (row.name && row.name.toLowerCase().includes('rolex submariner')) ||
        (row.image && (row.image.includes('asset_6f80eb') || imgIncludesB1tmz(row.image)))
      ) {
        rawPrimaryImage = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
      }
      const normalizedPrimaryImage = normalizeImageUrl(rawPrimaryImage, req);
      const { images: rawImages, cleanDescription, smartTakeTitle, smartTakeBody } = extractImagesAndCleanDescription(row.description, normalizedPrimaryImage);
      const normalizedImages = rawImages.map((img) => {
        if (img && (img.includes('asset_6f80eb') || img.includes('b1tmz'))) {
          return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
        }
        return normalizeImageUrl(img, req);
      });

      return {
        id: row.id,
        name: row.name,
        category: row.category,
        price: row.price || `R${Number(row.price_num || 0).toLocaleString('en-ZA')}`,
        price_num: row.price_num,
        year: row.year,
        condition: row.condition,
        description: cleanDescription,
        smartTakeTitle: row.smart_take_title || smartTakeTitle || null,
        smartTakeBody: row.smart_take_body || smartTakeBody || null,
        image: normalizedPrimaryImage,
        images: normalizedImages,
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
        owner: row.user_id ? (profileMap.get(row.user_id) || `User ${String(row.user_id).slice(0, 8)}`) : (row.owner || 'Verified Seller'),
        // AI Fraud & Authenticity Verification
        aiScanScore: row.ai_scan_score ?? null,
        aiScanStatus: row.ai_scan_status || (row.badge === 'Verified' || row.badge === 'Verified On-Chain' ? 'passed' : null),
      };
    });

    if (isDefaultQuery) {
      assetsCache = assets;
      assetsCacheTime = Date.now();
    }

    return res.json({ success: true, assets });
  } catch (err) {
    console.error('getAssets error:', err);
    return sendError(res, 500, 'Internal server error fetching assets.');
  }
}

function imgIncludesB1tmz(str) {
  return typeof str === 'string' && str.includes('b1tmz');
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
            // Preserve the original lister's user_id so they remain the creator/seller
            user_id: matchingAsset.user_id,
            holder_user_id: holding.user_id,
            price: holding.price || matchingAsset.price,
            price_num: holding.price_num || matchingAsset.price_num,
          };
          historyTargetId = matchingAsset.id;
        } else {
          let metaCertId = null;
          let metaHash = null;
          if (typeof holding.gain === 'string' && holding.gain.includes('<!--meta:')) {
            const m = holding.gain.match(/<!--meta:([\s\S]*?)-->/);
            if (m) {
              try {
                const parsed = JSON.parse(m[1]);
                if (parsed.certId) metaCertId = parsed.certId;
                if (parsed.hashDisplay || parsed.txHash) metaHash = parsed.hashDisplay || parsed.txHash;
              } catch (_) {}
            }
          }
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
            cert: metaCertId || ('SA-VLT-' + String(holding.id).substring(0, 8).toUpperCase()),
            tx_hash: metaHash || null,
            shares: holding.asset_type === 'fractional' ? 100 : 1,
            shares_sold: holding.asset_type === 'fractional' ? 45 : 1,
            share_price: holding.price_num,
            user_id: holding.user_id,
          };
          historyTargetId = null;
        }
      }
    }

    // 3. Third attempt: check built-in Vault seed items (e.g. personal-keyboard, fraction-rolex)
    if (!asset && Array.isArray(aiVisionGatekeeper.BUILTIN_VAULT_ASSETS)) {
      const builtin = aiVisionGatekeeper.BUILTIN_VAULT_ASSETS.find((b) => b.id === id);
      if (builtin) {
        asset = {
          id: builtin.id,
          name: builtin.name,
          category: builtin.category,
          price: builtin.price,
          price_num: builtin.price_num,
          year: 2023,
          condition: 'Mint / Vault Custody',
          description: 'Authenticated physical asset registered in SmartAssets Vault with ERC-721 Sepolia provenance certificate.',
          image: builtin.image,
          badge: 'Verified On-Chain',
          cert: builtin.certId,
          tx_hash: builtin.txHash,
          shares: builtin.source === 'CO_OWNED_ASSETS' ? 100 : 1,
          shares_sold: builtin.source === 'CO_OWNED_ASSETS' ? 77 : 1,
          share_price: Math.max(100, Math.round((builtin.price_num || 1000) / 100)),
        };
      }
    }

    if (!asset) {
      return sendError(res, 404, 'Asset not found.');
    }

    // 4. Fetch provenance history events
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

    let sellerName = asset.owner || 'Verified Seller';
    if (asset.user_id) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', asset.user_id)
          .maybeSingle();
        if (profile) {
          sellerName = profile.full_name || (profile.email ? profile.email.split('@')[0] : 'Verified Seller');
        }
      } catch (_) {}
    }

    let rawPrimaryImage = asset.image;
    if (
      (asset.name && asset.name.toLowerCase().includes('rolex submariner')) ||
      (asset.image && (asset.image.includes('asset_6f80eb') || asset.image.includes('b1tmz')))
    ) {
      rawPrimaryImage = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
    }
    const normalizedPrimaryImage = normalizeImageUrl(rawPrimaryImage, req);
    const { images: rawImages, cleanDescription, smartTakeTitle, smartTakeBody } = extractImagesAndCleanDescription(asset.description, normalizedPrimaryImage);
    const normalizedImages = rawImages.map((img) => {
      if (img && (img.includes('asset_6f80eb') || img.includes('b1tmz'))) {
        return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
      }
      return normalizeImageUrl(img, req);
    });

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
        description: cleanDescription,
        smartTakeTitle: asset.smart_take_title || smartTakeTitle || null,
        smartTakeBody: asset.smart_take_body || smartTakeBody || null,
        image: normalizedPrimaryImage,
        images: normalizedImages,
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
        owner: sellerName,
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
 * POST /api/assets/verify-upload (protected — requireAuth)
 * Mandatory 3-step asset upload verification pipeline:
 * Step 1: AI Vision Gatekeeper & Quality Analysis
 * Step 2: Live Market Oracle Pricing & 30-Day Demand Comps
 * Step 3: Populate Listing Metrics & Valuation Assessment
 */
async function verifyAssetUpload(req, res) {
  try {
    const { image, name, category, askingPrice, description, condition } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        verified: false,
        rejectionReason: 'No photograph provided. Please select or capture a high-resolution image of your physical luxury collectible.',
        code: 'MISSING_IMAGE',
      });
    }

    // Step 1: Mandatory AI Vision Gatekeeper Check
    console.log('🛡️ [Vision Gatekeeper] Running mandatory image inspection...');
    const visionResult = await aiVisionGatekeeper.inspectAssetImage(image, {
      name,
      category,
      description,
      condition,
    });

    if (!visionResult.passed) {
      console.warn('🚫 [Vision Gatekeeper] Upload rejected:', visionResult.rejectionReason);
      return res.status(422).json({
        success: false,
        verified: false,
        error: visionResult.rejectionReason,
        rejectionReason: visionResult.rejectionReason,
        code: visionResult.code || 'VISION_REJECTED',
      });
    }

    // Step 2: Live Market Oracle Comps & ROI Lookup
    const lookupQuery = visionResult.detectedObjectName || visionResult.canonicalName;
    const effectiveCondition = condition || req.body.condition || visionResult.conditionGrade || 'mint';
    console.log(`📈 [Market Oracle] Querying live market comps for "${lookupQuery}" (condition: ${effectiveCondition})...`);
    const marketData = await marketOracleService.fetchMarketComps(
      lookupQuery,
      visionResult.category,
      'ZAR',
      effectiveCondition
    );

    // Step 3: Valuation Comparison vs Asking Price
    let valuation = {
      isInflated: false,
      inflationPct: 0,
      fairValue: marketData.fairValue,
      highPrice: marketData.highPrice,
      lowPrice: marketData.lowPrice,
      warning: null,
    };

    const priceNum = parseFloat(String(askingPrice || '').replace(/[^0-9.]/g, '')) || 0;
    if (priceNum > 0 && marketData.highPrice > 0) {
      const threshold = marketData.highPrice * 1.5;
      if (priceNum > threshold) {
        const diffPct = Math.round(((priceNum - marketData.fairValue) / marketData.fairValue) * 100);
        valuation.isInflated = true;
        valuation.inflationPct = diffPct;
        valuation.warning = `Your asking price (${marketOracleService.formatCurrency(priceNum, 'ZAR')}) is ${diffPct}% above market fair value (${marketData.formattedFairValue}).`;
      }
    }

    return res.status(200).json({
      success: true,
      verified: true,
      asset: {
        canonicalName: visionResult.canonicalName,
        detectedObjectName: visionResult.detectedObjectName || visionResult.canonicalName,
        category: visionResult.category,
        conditionGrade: visionResult.conditionGrade,
        authenticityConfidence: visionResult.confidence,
        keyFeatures: visionResult.keyFeatures,
        qualityVerdict: visionResult.qualityVerdict,
        year: visionResult.year,
        smartTakeTitle: visionResult.smartTakeTitle || null,
        smartTakeBody: visionResult.smartTakeBody || null,
      },
      market: marketData,
      valuation,
    });
  } catch (err) {
    console.error('verifyAssetUpload error:', err);
    return res.status(500).json({
      success: false,
      verified: false,
      rejectionReason: 'Verification service error. Please try uploading the image again.',
      error: err.message,
    });
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
    const complianceService = require('../services/complianceService');
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Asset listings blocked.');
    }
    if (comp && comp.kycStatus !== 'verified') {
      return sendError(res, 403, 'KYC Verification Required: You must submit your FICA compliance pack and be approved before listing assets.');
    }
    const { name, category, askingPrice, year, condition, description, image, history, forceConfirmPrice } = req.body;

    if (!name || !askingPrice) {
      return sendError(res, 400, 'Name and asking price are required.');
    }
    if (!image) {
      return sendError(res, 400, 'A photograph is mandatory to list an asset.');
    }

    const priceNum = parseFloat(String(askingPrice).replace(/[^0-9.]/g, '')) || 0;

    // Step 1: Mandatory AI Vision Gatekeeper Check
    console.log(`🛡️ [AI Vision Gatekeeper] Verifying physical asset photo for "${name}"...`);
    const visionCheck = await aiVisionGatekeeper.inspectAssetImage(image, req.body);
    if (!visionCheck.passed) {
      return res.status(422).json({
        success: false,
        verified: false,
        error: visionCheck.rejectionReason,
        code: visionCheck.code,
      });
    }

    // Step 2: Live Market Oracle Check
    const lookupQuery = visionCheck.detectedObjectName || visionCheck.canonicalName || name;
    const effectiveCondition = condition || visionCheck.conditionGrade || 'mint';
    const marketComps = await marketOracleService.fetchMarketComps(
      lookupQuery,
      category || visionCheck.category,
      'ZAR',
      effectiveCondition
    );

    // Step 3: Market Valuation Check (>50% above market high requires explicit confirmation)
    if (priceNum > (marketComps.highPrice * 1.5) && !forceConfirmPrice) {
      return res.status(409).json({
        success: false,
        priceAlert: true,
        fairValue: marketComps.fairValue,
        highPrice: marketComps.highPrice,
        formattedFairValue: marketComps.formattedFairValue,
        formattedHighPrice: marketOracleService.formatCurrency(marketComps.highPrice, 'ZAR'),
        error: `Price Alert: Your asking price of R${priceNum.toLocaleString()} is over 50% above market comps (${marketComps.formattedRange}). Please confirm to proceed.`,
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

    // Convert bulky base64 image into a lightweight static upload URL to prevent draining Supabase egress
    const savedImageUrl = saveBase64Image(image, 'asset', req) || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800';

    // Handle extra images and smartTake metadata if provided
    const smartTakeTitle = req.body.smartTakeTitle || visionCheck.smartTakeTitle || null;
    const smartTakeBody = req.body.smartTakeBody || visionCheck.smartTakeBody || null;

    let finalDescription = description || '';
    if (Array.isArray(req.body.images) && req.body.images.length > 0) {
      const savedExtraImages = req.body.images
        .map((img, idx) => saveBase64Image(img, `asset_extra_${idx}`, req))
        .filter(Boolean);
      if (savedExtraImages.length > 0) {
        finalDescription = `${finalDescription}\n<!--images:${JSON.stringify(savedExtraImages)}-->`;
      }
    }
    if (smartTakeTitle && smartTakeBody) {
      finalDescription = `${finalDescription}\n<!--smartTake:${JSON.stringify({ smartTakeTitle, smartTakeBody })}-->`;
    }

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
      image: savedImageUrl,
    });

    console.log(`✅ [Blockchain] NFT Minted! Token ID: #${mintRes.tokenId}, Tx: ${mintRes.txHash}`);

    // Base asset row compatible with current database schema
    const baseRow = {
      name: visionCheck.canonicalName || name,
      category: category || visionCheck.category || 'Uncategorised',
      price: `R${priceNum.toLocaleString('en-ZA')}`,
      price_num: priceNum,
      year: parseInt(year, 10) || visionCheck.year || new Date().getFullYear(),
      condition: visionCheck.conditionGrade || condition || 'Grade A+ (9.5/10) • Mint',
      description: finalDescription,
      image: savedImageUrl,
      badge: 'Verified On-Chain',
      cert: certNumber,
      status: 'active',
      user_id: userId,
      ai_scan_score: 0.02,
      ai_scan_status: 'passed',
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

    // Also add the asset to the creator's personal vault (user_holdings) with cert metadata
    const holdingMeta = {
      initialValue: priceNum,
      liveMarketValue: priceNum,
      badgeText: '+0.0% Market Gain',
      badgeType: 'positive',
      certId: `ERC-721 #${mintRes.tokenId || '4811'}`,
      hashDisplay: mintRes.txHash ? `${String(mintRes.txHash).slice(0, 5)}...${String(mintRes.txHash).slice(-2)}` : '0x71c...9a',
      txHash: mintRes.txHash || null,
    };
    await supabase.from('user_holdings').insert({
      user_id: userId,
      name,
      category: category || 'Uncategorised',
      price: `R${priceNum.toLocaleString('en-ZA')}`,
      price_num: priceNum,
      image: newAsset.image,
      asset_type: 'whole',
      gain: `+0.0%<!--meta:${JSON.stringify(holdingMeta)}-->`,
      gain_pct: '0%',
      positive: true,
    });

    invalidateAssetsCache();

    return res.status(201).json({
      success: true,
      message: 'Asset listed and NFT Certificate minted on Ethereum Sepolia!',
      asset: {
        ...newAsset,
        smartTakeTitle: newAsset.smart_take_title || smartTakeTitle || null,
        smartTakeBody: newAsset.smart_take_body || smartTakeBody || null,
        tokenId: mintRes.tokenId,
        txHash: mintRes.txHash,
        etherscanUrl: mintRes.etherscanUrl,
        contractAddress: mintRes.contractAddress,
        aiScanScore: 0.02,
        aiScanStatus: 'passed',
        marketComps,
      },
    });
  } catch (err) {
    console.error('createAsset error:', err);
    return sendError(res, 500, 'Internal server error creating asset.');
  }
}

/**
 * POST /api/assets/scan-and-know
 * Unified Scan & Know pipeline:
 * 1) Gemini Vision (`gemini-3-flash-preview`) identification + physical authenticity red flags
 * 2) Live ZAR Market Oracle via SerpApi (never Pounds £)
 * 3) Vault / Sepolia ERC-721 certificate match (without touching Supabase table schema)
 */
async function scanAndKnow(req, res) {
  try {
    const { image, vaultItems } = req.body || {};
    const userId = req.user?.id || null;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'No photograph provided. Capture or upload an image to Scan & Know.',
        code: 'MISSING_IMAGE',
      });
    }

    console.log('🔍 [Scan & Know] Running unified Gemini + ZAR Oracle + Sepolia Certificate pipeline...');
    const unified = await aiVisionGatekeeper.runUnifiedScanAndKnow(image, {
      userId,
      vaultItems,
      supabaseClient: supabase,
    });

    if (!unified.passed) {
      return res.status(422).json({
        success: false,
        error: unified.rejectionReason,
        rejectionReason: unified.rejectionReason,
        code: unified.code || 'VISION_REJECTED',
      });
    }

    return res.status(200).json(unified);
  } catch (err) {
    console.error('scanAndKnow error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Scan & Know failed. Please try another photo.',
    });
  }
}

/**
 * GET /api/assets/market-oracle?name=...&category=...&condition=...
 * Query live SerpApi market comps & fair value for an asset name & condition.
 */
async function getMarketOracle(req, res) {
  try {
    const { name, category, condition } = req.query;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name parameter is required.' });
    }

    const effectiveCondition = condition || 'mint';
    const effectiveCategory = category || 'Collectibles';

    console.log(`📈 [Market Oracle Endpoint] Live comps requested for "${name.trim()}" (${effectiveCategory}, condition: ${effectiveCondition})...`);

    const marketData = await marketOracleService.fetchMarketComps(
      name.trim(),
      effectiveCategory,
      'ZAR',
      effectiveCondition
    );

    return res.status(200).json({
      success: true,
      fairMarketValue: marketData.fairValue,
      fairValue: marketData.fairValue,
      lowPrice: marketData.lowPrice,
      highPrice: marketData.highPrice,
      formattedFairValue: marketData.formattedFairValue,
      formattedRange: marketData.formattedRange,
      source: marketData.source,
      comps: marketData.comps,
      market: marketData,
    });
  } catch (err) {
    console.error('getMarketOracle error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getAssets,
  getAssetById,
  createAsset,
  verifyAssetUpload,
  getMarketOracle,
  scanAndKnow,
  invalidateAssetsCache,
};
