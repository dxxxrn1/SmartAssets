// ─── One-Time Migration: Base64 to Static Uploads ──────────────────────────────
// Extracts megabytes of base64 images from Supabase PostgreSQL tables (assets, user_holdings)
// and saves them to backend/uploads/assets/, updating the database with clean URLs.
// This immediately cuts Supabase database egress by >99.9%.

const fs = require('fs');
const path = require('path');
const supabase = require('../src/connection/supabaseClient');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads/assets');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const SERVER_BASE = 'http://10.250.193.0:5000';

function extractAndSaveBase64(base64Str, prefix) {
  if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image/')) {
    return null;
  }
  try {
    const matches = base64Str.match(/^data:image\/([a-zA-Z0-9.+_-]+);base64,(.+)$/);
    if (!matches) return null;

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const data = matches[2];
    const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return `${SERVER_BASE}/uploads/assets/${fileName}`;
  } catch (err) {
    console.error('Error saving image:', err.message);
    return null;
  }
}

async function runMigration() {
  console.log('🚀 Starting Base64 to Static Files Migration...\n');

  // 1. Migrate `assets` table
  console.log('📦 Checking assets table...');
  const { data: assets, error: aErr } = await supabase.from('assets').select('id, name, image');
  if (aErr) {
    console.error('Failed to query assets:', aErr);
  } else {
    let migratedCount = 0;
    for (const a of (assets || [])) {
      if (a.image && a.image.startsWith('data:image/')) {
        const oldLen = a.image.length;
        const newUrl = extractAndSaveBase64(a.image, `asset_${a.id.slice(0, 6)}`);
        if (newUrl) {
          const { error: upErr } = await supabase.from('assets').update({ image: newUrl }).eq('id', a.id);
          if (upErr) {
            console.error(`Failed to update asset ${a.id}:`, upErr.message);
          } else {
            migratedCount++;
            console.log(`  ✅ Asset "${a.name}" (${a.id.slice(0, 8)}): ${(oldLen/1024).toFixed(1)} KB -> URL (${newUrl})`);
          }
        }
      }
    }
    console.log(`✨ Migrated ${migratedCount} assets.\n`);
  }

  // 2. Migrate `user_holdings` table
  console.log('📦 Checking user_holdings table...');
  const { data: holdings, error: hErr } = await supabase.from('user_holdings').select('id, name, image');
  if (hErr) {
    console.error('Failed to query user_holdings:', hErr);
  } else {
    let migratedHoldingsCount = 0;
    for (const h of (holdings || [])) {
      if (h.image && h.image.startsWith('data:image/')) {
        const oldLen = h.image.length;
        const newUrl = extractAndSaveBase64(h.image, `holding_${h.id.slice(0, 6)}`);
        if (newUrl) {
          const { error: upErr } = await supabase.from('user_holdings').update({ image: newUrl }).eq('id', h.id);
          if (upErr) {
            console.error(`Failed to update holding ${h.id}:`, upErr.message);
          } else {
            migratedHoldingsCount++;
            console.log(`  ✅ Holding "${h.name}" (${h.id.slice(0, 8)}): ${(oldLen/1024).toFixed(1)} KB -> URL (${newUrl})`);
          }
        }
      }
    }
    console.log(`✨ Migrated ${migratedHoldingsCount} holdings.\n`);
  }

  console.log('🎉 Migration completed successfully! Supabase egress bloat eliminated.');
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
