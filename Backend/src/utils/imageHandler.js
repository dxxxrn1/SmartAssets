// ─── Image Handler Utility ──────────────────────────────────────────────────
// Primary public media upload pipeline via Cloudinary (`smartassets/assets`, `smartassets/avatars`, etc.)
// with automatic content-hash deduplicated local fallback for offline test environments.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isCloudinaryConfigured, uploadPublicMedia } = require('./cloudinary');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/assets');
const KYC_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/kyc');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(KYC_UPLOADS_DIR)) {
  fs.mkdirSync(KYC_UPLOADS_DIR, { recursive: true });
}

/**
 * Uploads a base64 image data URI or URL to Cloudinary (`smartassets/${folder}`).
 * Falls back to local content-hash deduplicated file only if Cloudinary is offline/unconfigured.
 */
async function uploadImageToCloud(base64OrUrl, folder = 'assets', req = null, userId = null) {
  if (!base64OrUrl || typeof base64OrUrl !== 'string') return base64OrUrl;

  // Already a remote URL (Cloudinary or external HTTPS)
  if (base64OrUrl.startsWith('http://') || base64OrUrl.startsWith('https://')) {
    return base64OrUrl;
  }

  if (base64OrUrl.startsWith('data:image/') && isCloudinaryConfigured()) {
    try {
      const cloudUrl = await uploadPublicMedia(base64OrUrl, folder, {
        userId: userId || req?.user?.id || null,
      });
      if (cloudUrl) {
        console.log(`☁️ [Cloudinary] Uploaded public image to smartassets/${folder}: ${cloudUrl}`);
        return cloudUrl;
      }
    } catch (cloudErr) {
      console.warn(`⚠️ [Cloudinary] Upload warning (falling back to local storage): ${cloudErr.message}`);
    }
  }

  return saveBase64Image(base64OrUrl, folder, req);
}

/**
 * Extracts and saves a base64 image data URI to static storage on disk.
 * Uses SHA-256 content-hash deduplication so the exact same image is never saved twice.
 */
function saveBase64Image(base64Str, prefix = 'asset', req = null) {
  if (!base64Str || typeof base64Str !== 'string') return base64Str;
  if (!base64Str.startsWith('data:image/')) return base64Str;

  try {
    const matches = base64Str.match(/^data:image\/([a-zA-Z0-9.+_-]+);base64,(.+)$/);
    if (!matches) return base64Str;

    const rawExt = matches[1].toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt === 'svg+xml' ? 'svg' : rawExt;
    const data = matches[2];
    const buffer = Buffer.from(data, 'base64');

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
    const cleanPrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
    const fileName = `${cleanPrefix}_${hash}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    // Also asynchronously mirror to Cloudinary if configured
    if (isCloudinaryConfigured() && !cleanPrefix.startsWith('kyc')) {
      uploadPublicMedia(base64Str, 'assets', { publicId: `${cleanPrefix}_${hash}` }).catch(() => {});
    }

    if (req) {
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      return `${protocol}://${host}/uploads/assets/${fileName}`;
    }

    return `/uploads/assets/${fileName}`;
  } catch (err) {
    console.warn('⚠️ [ImageHandler] Failed to save base64 image to disk:', err.message);
    return base64Str;
  }
}

/**
 * Normalizes an image URL for client delivery.
 * Preserves Cloudinary and HTTPS URLs directly; normalizes relative /uploads/ paths to active host.
 */
function normalizeImageUrl(url, req = null) {
  if (!url || typeof url !== 'string') return url;

  if (url.includes('asset_6f80eb') || url.includes('b1tmz')) {
    return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
  }

  // Return Cloudinary or external HTTPS URLs untouched
  if (url.startsWith('https://res.cloudinary.com/') || url.startsWith('https://')) {
    return url;
  }

  // Offload large base64 data URIs
  if (url.startsWith('data:image/')) {
    if (url.length > 2000) {
      return saveBase64Image(url, 'asset', req);
    }
    return url;
  }

  // Handle uploaded assets and KYC compliance documents
  const uploadsMatch = url.match(/\/uploads\/(?:assets|kyc|avatars)\/[^"'\s?#]+/i);
  if (uploadsMatch) {
    const assetPath = uploadsMatch[0];
    if (req) {
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      return `${protocol}://${host}${assetPath}`;
    }
    if (process.env.EXPO_PUBLIC_API_BASE_URL) {
      const baseOrigin = process.env.EXPO_PUBLIC_API_BASE_URL.replace(/\/api\/?$/, '');
      return `${baseOrigin}${assetPath}`;
    }
    return assetPath;
  }

  return url;
}

/**
 * Normalizes primary image and images array on an asset object.
 */
function normalizeAssetImages(asset, req = null) {
  if (!asset) return asset;
  const normalized = { ...asset };
  if (normalized.image) {
    normalized.image = normalizeImageUrl(normalized.image, req);
  }
  if (Array.isArray(normalized.images)) {
    normalized.images = normalized.images.map((img) => normalizeImageUrl(img, req));
  }
  return normalized;
}

/**
 * Safely removes legacy runaway `cached_*` files from the uploads directory.
 */
function purgeCachedBloat() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return 0;
    const files = fs.readdirSync(UPLOADS_DIR);
    let count = 0;
    for (const f of files) {
      if (f.startsWith('cached_')) {
        try {
          fs.unlinkSync(path.join(UPLOADS_DIR, f));
          count++;
        } catch (_) {}
      }
    }
    if (count > 0) {
      console.log(`🧹 [ImageHandler] Cleaned ${count} duplicate cached files from disk bloat.`);
    }
    return count;
  } catch (e) {
    console.warn('⚠️ [ImageHandler] Error during cached bloat purge:', e.message);
    return 0;
  }
}

purgeCachedBloat();

module.exports = {
  uploadImageToCloud,
  saveBase64Image,
  normalizeImageUrl,
  normalizeAssetImages,
  purgeCachedBloat,
  UPLOADS_DIR,
  KYC_UPLOADS_DIR,
};
