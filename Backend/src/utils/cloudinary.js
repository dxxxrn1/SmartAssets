// ─── SmartAssets Cloudinary Media Service ────────────────────────────────────
// Handles signed and server-side public media uploads for:
// - Marketplace Asset Photos ('assets')
// - User Profile Avatars ('avatars')
// - 3D GLB Models ('models_3d')
// - Public Provenance Certificates ('certificates')
// Note: Private KYC documents NEVER use Cloudinary; they go strictly to Supabase Private Storage.

const cloudinary = require('cloudinary').v2;

const ALLOWED_FOLDERS = ['assets', 'certificates', 'models_3d', 'avatars'];

function configureCloudinary() {
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    return true;
  }
  return false;
}

configureCloudinary();

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Uploads a base64 data URI, Buffer, or remote URL to Cloudinary.
 * @param {string|Buffer} fileInput - Base64 data URI (data:image/jpeg;base64,...), Buffer, or URL
 * @param {string} folder - 'assets' | 'avatars' | 'models_3d' | 'certificates'
 * @param {object} options - Optional public_id, resource_type, userId
 * @returns {Promise<string>} Secure HTTPS URL on res.cloudinary.com
 */
async function uploadPublicMedia(fileInput, folder = 'assets', options = {}) {
  if (!fileInput) return null;

  // If it's already a remote HTTP/HTTPS URL (e.g. already on Cloudinary or external CDN), return as-is
  if (
    typeof fileInput === 'string' &&
    (fileInput.startsWith('https://res.cloudinary.com/') ||
      fileInput.startsWith('http://') ||
      fileInput.startsWith('https://'))
  ) {
    return fileInput;
  }

  if (!configureCloudinary()) {
    throw new Error('Cloudinary credentials are not configured in environment variables.');
  }

  const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'assets';
  const targetFolder = options.userId
    ? `smartassets/${safeFolder}/${options.userId}`
    : `smartassets/${safeFolder}`;

  const uploadOptions = {
    folder: targetFolder,
    resource_type: options.resourceType || 'auto',
    overwrite: true,
  };

  if (options.publicId) {
    uploadOptions.public_id = options.publicId;
  }

  if (Buffer.isBuffer(fileInput)) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) return reject(error);
        return resolve(result.secure_url);
      });
      uploadStream.end(fileInput);
    });
  }

  const result = await cloudinary.uploader.upload(fileInput, uploadOptions);
  return result.secure_url;
}

/**
 * Generates short-lived signed upload parameters for direct client uploads to Cloudinary.
 * Keeps CLOUDINARY_API_SECRET strictly on the backend.
 */
function generateSignedUploadParams(folder = 'assets', userId = 'public') {
  if (!configureCloudinary()) {
    throw new Error('Cloudinary is not configured.');
  }
  if (!ALLOWED_FOLDERS.includes(folder)) {
    const err = new Error(`Invalid upload folder "${folder}". Allowed: ${ALLOWED_FOLDERS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const timestamp = Math.round(Date.now() / 1000);
  const targetFolder = `smartassets/${folder}/${userId}`;
  const paramsToSign = {
    timestamp,
    folder: targetFolder,
  };

  if (process.env.CLOUDINARY_PRESET) {
    paramsToSign.upload_preset = process.env.CLOUDINARY_PRESET;
  }

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    ...paramsToSign,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  };
}

module.exports = {
  cloudinary,
  ALLOWED_FOLDERS,
  isCloudinaryConfigured,
  uploadPublicMedia,
  generateSignedUploadParams,
};
