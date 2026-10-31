// ─── SmartAssets: Admin GLB Catalog Importer ─────────────────────────────────
// Validates, optimizes, and registers a commercial-licensed 3D model into the catalog.
//
// Usage:
//   node Backend/scripts/importCatalogModel.js --file ./model.glb \
//       --name "Antique Rangefinder Camera" --category "Collectibles" \
//       --creator "Maximillan Kamps" --license "CC0-1.0" \
//       --attribution "Antique Camera by Maximillan Kamps, (C) 2018 UX3D (CC0 1.0). Hosted by Smart Assets." \
//       --tags "camera,vintage,antique,brass,collectibles"
//
// License Validation Rules:
// - Whitelists: CC0-1.0, CC-BY-4.0, Public Domain, SmartAssets-Proprietary
// - Strictly REJECTS Non-Commercial (-NC) or No-Derivatives (-ND) licenses.
// - Fail-Closed Storage: Models MUST be genuinely uploaded and verified on SmartAssets
//   storage. Never relies on external third-party raw URLs or expiring links.

const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const supabase = require('../src/connection/supabaseClient');
const { optimizeGlbBuffer } = require('../src/services/modelOptimizer');

const APPROVED_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'Public Domain', 'SmartAssets-Proprietary'];

function validateLicense(licenseStr) {
  if (!licenseStr) return false;
  const upper = String(licenseStr).toUpperCase().trim();
  if (upper.includes('-NC') || upper.includes('NON-COMMERCIAL') || upper.includes('-ND') || upper.includes('NO-DERIVATIVES')) {
    return false; // Strictly rejected for commercial app distribution
  }
  return APPROVED_LICENSES.some((l) => l.toUpperCase() === upper);
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      parsed[key] = val;
    }
  }
  return parsed;
}

async function verifyHostedGlbUrl(url) {
  if (!url) throw new Error('Cannot verify empty hosted GLB URL.');
  try {
    const res = await axios.get(url, {
      headers: { Range: 'bytes=0-1023' },
      timeout: 15000,
      responseType: 'arraybuffer',
    });

    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`Hosted URL returned HTTP ${res.status}`);
    }

    const contentType = String(res.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('gltf') && !contentType.includes('octet-stream') && !contentType.includes('binary')) {
      throw new Error(`Invalid content type "${contentType}" for hosted 3D model.`);
    }

    const buffer = Buffer.from(res.data);
    if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) {
      throw new Error('Hosted URL does not return a valid glTF binary (missing 0x46546c67 header).');
    }

    return true;
  } catch (err) {
    throw new Error(`Verification of hosted URL failed: ${err.message}`);
  }
}

async function importCatalogModel(options) {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Licensed GLB Catalog Importer        ');
  console.log('======================================================\n');

  const {
    file,
    url,
    sourceUrl,
    name,
    category,
    creator,
    rightsHolder,
    license,
    licenseUrl,
    attribution,
    tags,
    brand,
    productType,
    placement = 'table',
    widthCm = 30,
    heightCm = 30,
    depthCm = 30,
    dryRun = false,
  } = options;

  if (!name || !category || !creator || !license || !attribution) {
    throw new Error('Missing required fields: --name, --category, --creator, --license, --attribution are mandatory.');
  }

  // 1. Strict License Check (Commercial Allowlist Only)
  if (!validateLicense(license)) {
    throw new Error(
      `License "${license}" is not approved for commercial redistribution. Approved licenses: ${APPROVED_LICENSES.join(', ')} (NC and ND licenses are prohibited).`,
    );
  }

  // 2. Read GLB Binary
  let buffer;
  const sourceGlbUrl = url || sourceUrl;
  if (file) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`GLB file not found at: ${filePath}`);
    }
    buffer = fs.readFileSync(filePath);
  } else if (sourceGlbUrl) {
    const res = await axios.get(sourceGlbUrl, { responseType: 'arraybuffer', timeout: 35000 });
    buffer = Buffer.from(res.data);
  } else {
    throw new Error('Must provide either --file <path> or --url <glb_url>.');
  }

  // 3. Validate GLB Magic Header (0x46546C67 = "glTF")
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Invalid GLB file: Missing "glTF" binary magic header (0x46546c67).');
  }

  console.log(`🔍 Validated GLB header. Raw size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // 4. Run @gltf-transform optimization
  console.log('⚡ Optimizing GLB with @gltf-transform (dedup, prune, re-sample)...');
  const optimized = await optimizeGlbBuffer(buffer, false);
  console.log(`✨ Optimized: ${optimized.sizeBytes} bytes, ${optimized.triangleCount} triangles.`);

  // 5. Upload to Supabase Storage 'models' bucket with Fail-Closed Guarantee
  const fileSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 50);
  const filename = `catalog/${fileSlug}.glb`;

  if (dryRun) {
    console.log('ℹ️ [DryRun] Validated metadata, rights, and buffer optimization locally.');
    console.log('   NOTE: Dry-run does NOT upload to remote storage or modify database rows.');
    return {
      name,
      category,
      size_bytes: optimized.sizeBytes,
      triangle_count: optimized.triangleCount,
      license,
      attribution,
      dryRun: true,
    };
  }

  console.log(`☁️ Uploading to storage bucket "models" as "${filename}"...`);
  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from('models')
    .upload(filename, optimized.optimizedBuffer, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(
      `Storage upload failed for ${filename}: ${uploadErr.message}. Catalog import aborted (fail-closed: never use raw external URLs).`,
    );
  }

  if (!uploadData?.path) {
    throw new Error(`Storage upload returned empty path for ${filename}. Import aborted.`);
  }

  const { data: pubData } = supabase.storage.from('models').getPublicUrl(uploadData.path);
  if (!pubData?.publicUrl) {
    throw new Error(`Failed to resolve public URL for uploaded object: ${uploadData.path}. Import aborted.`);
  }

  const finalGlbUrl = pubData.publicUrl;
  console.log(`🔍 Verifying hosted storage object at: ${finalGlbUrl}...`);
  await verifyHostedGlbUrl(finalGlbUrl);
  console.log(`✅ Verified hosted storage URL is live: ${finalGlbUrl}`);

  // 6. Insert/Upsert Record into catalog_models
  const record = {
    name,
    category,
    categories: [category],
    tags: tags ? tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : [category.toLowerCase()],
    brand: brand || null,
    product_type: productType || null,
    glb_url: finalGlbUrl,
    placement,
    width_cm: Number(widthCm),
    height_cm: Number(heightCm),
    depth_cm: Number(depthCm),
    dimensions_approximate: true,
    size_bytes: optimized.sizeBytes,
    triangle_count: optimized.triangleCount,
    source_name: 'SmartAssets Curated Licensed Catalog',
    source_url: sourceGlbUrl || null,
    creator,
    notes: rightsHolder ? `Rights holder: ${rightsHolder}` : null,
    license,
    attribution,
    is_active: true,
    is_approved: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('catalog_models')
    .insert(record)
    .select('*')
    .single();

  if (insertErr) {
    console.error('❌ Database insertion failed:', insertErr.message);
    throw insertErr;
  }

  console.log(`\n🎉 Model successfully imported and activated! ID: ${inserted.id}`);
  console.log(`   Hosted GLB URL: ${inserted.glb_url}`);
  console.log(`   Attribution: ${inserted.attribution}`);
  return inserted;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  importCatalogModel(args).catch((err) => {
    console.error('\n❌ Import error:', err.message);
    process.exit(1);
  });
}

module.exports = { importCatalogModel, validateLicense, verifyHostedGlbUrl, APPROVED_LICENSES };
