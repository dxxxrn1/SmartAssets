// ─── SmartAssets: Curated Catalog Model Seeder ────────────────────────────────
// Populates public.catalog_models with verified, commercially-licensed GLB assets.
//
// Usage:
//   node Backend/scripts/seedCuratedCatalog.js [--dry-run] [--check-remote]
//
// Modes:
//   - Standard: Downloads source GLBs, validates binary header, optimizes via @gltf-transform,
//     uploads to Supabase models bucket, verifies hosted CDN access, and upserts catalog records.
//   - --dry-run: Audits metadata schema, creator provenance, and license allowlist locally.
//     Explicitly does NOT claim live storage, network, or database success.
//   - --check-remote: Fetches remote source GLBs and validates magic headers without storage or DB writes.

const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const supabase = require('../src/connection/supabaseClient');
const { validateLicense, verifyHostedGlbUrl, APPROVED_LICENSES } = require('./importCatalogModel');
const { optimizeGlbBuffer } = require('../src/services/modelOptimizer');

const SEED_FILE = path.resolve(__dirname, '../data/curatedCatalogSeed.json');

async function downloadAndVerifyGlb(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 35000 });
  const buffer = Buffer.from(res.data);
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Downloaded asset lacks valid glTF magic header (0x46546c67)');
  }
  return buffer;
}

async function seedCuratedCatalog(options = {}) {
  const isDryRun = options.dryRun || process.argv.includes('--dry-run');
  const isCheckRemote = options.checkRemote || process.argv.includes('--check-remote');

  console.log('\n======================================================');
  console.log('   SMARTASSETS • Curated 3D Model Catalog Seeder      ');
  console.log('======================================================\n');

  if (isDryRun) {
    console.log('ℹ️ [DryRun Mode Active]');
    console.log('   Validating metadata, rights, and licensing locally without database mutation.');
    console.log('   NOTE: Dry-run does NOT prove remote storage upload, remote network fetch, or live database write success.\n');
  } else if (isCheckRemote) {
    console.log('🔍 [Remote Source Verification Mode Active]');
    console.log('   Probing and verifying upstream source GLB binaries without mutating storage or database.\n');
  } else {
    console.log('🚀 [Live Synchronization Mode Active]');
    console.log('   Downloading source GLBs, validating, optimizing, uploading to storage, verifying, and persisting.\n');
  }

  if (!fs.existsSync(SEED_FILE)) {
    console.error(`❌ Seed file not found at ${SEED_FILE}`);
    throw new Error(`Seed file missing at ${SEED_FILE}`);
  }

  const raw = fs.readFileSync(SEED_FILE, 'utf8');
  const catalogEntries = JSON.parse(raw);

  console.log(`📦 Loaded ${catalogEntries.length} verified catalog models for audit.\n`);

  let successCount = 0;
  const failureList = [];

  for (const entry of catalogEntries) {
    console.log(`- Auditing "${entry.name}" (${entry.category}) [License: ${entry.license}]...`);

    // 1. Strict License & Metadata Check
    if (!validateLicense(entry.license)) {
      const err = `License "${entry.license}" for "${entry.name}" is not approved for commercial redistribution.`;
      console.error(`  ❌ ${err}`);
      failureList.push({ name: entry.name, error: err });
      continue;
    }

    if (!entry.creator || !entry.attribution) {
      const err = `Model "${entry.name}" is missing required creator or attribution metadata.`;
      console.error(`  ❌ ${err}`);
      failureList.push({ name: entry.name, error: err });
      continue;
    }

    // 2. Dry-Run path
    if (isDryRun) {
      console.log(`  ✅ [DryRun] Validated metadata & license for "${entry.name}".`);
      successCount++;
      continue;
    }

    // 3. Remote Source Verification Mode (--check-remote)
    if (isCheckRemote) {
      const candidateUrls = [entry.source_glb_url, ...(entry.fallback_source_urls || [])].filter(Boolean);
      if (candidateUrls.length === 0) {
        const err = `Model "${entry.name}" lacks source_glb_url for remote check.`;
        failureList.push({ name: entry.name, error: err });
        continue;
      }
      let checkOk = false;
      for (const url of candidateUrls) {
        try {
          console.log(`  📥 Checking source GLB from ${url}...`);
          const buffer = await downloadAndVerifyGlb(url);
          console.log(`  ✅ Verified glTF binary: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
          successCount++;
          checkOk = true;
          break;
        } catch (checkErr) {
          console.warn(`  ⚠️ Candidate URL failed for ${entry.name}: ${checkErr.message}`);
        }
      }
      if (!checkOk) {
        const err = `All candidate URLs failed for ${entry.name}`;
        console.error(`  ❌ Remote check failed for ${entry.name}: ${err}`);
        failureList.push({ name: entry.name, error: err });
      }
      continue;
    }

    // 4. Live Synchronization Pipeline (Fail-Closed)
    try {
      const candidateUrls = [entry.source_glb_url, ...(entry.fallback_source_urls || [])].filter(Boolean);
      if (candidateUrls.length === 0) {
        throw new Error(`Model "${entry.name}" is missing source_glb_url.`);
      }

      let rawBuffer = null;
      let lastDownloadErr = null;
      for (const url of candidateUrls) {
        try {
          console.log(`  📥 Fetching source GLB from ${url}...`);
          rawBuffer = await downloadAndVerifyGlb(url);
          break;
        } catch (dlErr) {
          lastDownloadErr = dlErr;
          console.warn(`  ⚠️ Candidate URL failed for ${entry.name}: ${dlErr.message}`);
        }
      }
      if (!rawBuffer) {
        throw new Error(lastDownloadErr ? lastDownloadErr.message : `No candidate GLB URL could be fetched for "${entry.name}".`);
      }

      console.log(`  ⚡ Optimizing GLB with @gltf-transform (${(rawBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);
      const optimized = await optimizeGlbBuffer(rawBuffer, false);

      const bucket = entry.storage_bucket || 'models';
      const fileSlug = entry.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 50);
      const storagePath = entry.storage_path || `catalog/${fileSlug}.glb`;

      console.log(`  ☁️ Uploading to storage bucket "${bucket}" (${storagePath})...`);
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, optimized.optimizedBuffer, {
          contentType: 'model/gltf-binary',
          upsert: true,
        });

      if (uploadErr) {
        throw new Error(`Storage upload failed: ${uploadErr.message}`);
      }

      const { data: pubData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path || storagePath);
      if (!pubData?.publicUrl) {
        throw new Error('Could not resolve public storage URL from Supabase client.');
      }

      const finalGlbUrl = pubData.publicUrl;
      console.log(`  🔍 Probing hosted URL at ${finalGlbUrl}...`);
      await verifyHostedGlbUrl(finalGlbUrl);
      console.log(`  ✅ Hosted storage verified.`);

      const record = {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        categories: entry.categories || [entry.category],
        tags: entry.tags || [entry.category.toLowerCase()],
        brand: entry.brand || null,
        product_type: entry.product_type || null,
        glb_url: finalGlbUrl,
        thumbnail_url: entry.thumbnail_url || null,
        placement: entry.placement || 'table',
        width_cm: Number(entry.width_cm || 30),
        height_cm: Number(entry.height_cm || 30),
        depth_cm: Number(entry.depth_cm || 30),
        dimensions_approximate: true,
        size_bytes: optimized.sizeBytes,
        triangle_count: optimized.triangleCount,
        source_name: entry.source_name || 'Khronos glTF Sample Assets',
        source_url: entry.source_url || null,
        creator: entry.creator,
        notes: entry.rights_holder ? `Rights holder: ${entry.rights_holder}` : null,
        license: entry.license,
        attribution: entry.attribution,
        is_active: true,
        is_approved: true,
        updated_at: new Date().toISOString(),
      };

      const { error: dbErr } = await supabase
        .from('catalog_models')
        .upsert(record, { onConflict: 'id' });

      if (dbErr) {
        if (dbErr.code === '42P01' || dbErr.message?.includes('does not exist')) {
          throw new Error('Table public.catalog_models does not exist. Apply 20261101_curated_model_catalog.sql first.');
        }
        throw new Error(`Database upsert error: ${dbErr.message}`);
      }

      successCount++;
      console.log(`  ✅ Successfully synced and activated "${entry.name}".`);
    } catch (syncErr) {
      console.error(`  ❌ Sync failed for "${entry.name}": ${syncErr.message}`);
      failureList.push({ name: entry.name, error: syncErr.message });
      // Strictly fail-closed: do not activate record
    }
  }

  console.log(`\n======================================================`);
  console.log(`Outcome: ${successCount}/${catalogEntries.length} succeeded.`);
  if (failureList.length > 0) {
    console.error(`Failures (${failureList.length}):`);
    failureList.forEach((f) => console.error(` - ${f.name}: ${f.error}`));
    console.log('======================================================\n');
    throw new Error(`${failureList.length} catalog models failed processing.`);
  }

  console.log('🎉 Catalog seeding/audit completed cleanly.\n');
  return { successCount, total: catalogEntries.length };
}

if (require.main === module) {
  seedCuratedCatalog().catch((err) => {
    console.error('❌ Seeding process error:', err.message);
    process.exit(1);
  });
}

module.exports = { seedCuratedCatalog, downloadAndVerifyGlb };
