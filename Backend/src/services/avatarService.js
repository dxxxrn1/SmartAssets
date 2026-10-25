// ─── Avatar Service ─────────────────────────────────────────────────────────
// Uploads user profile pictures to Cloudinary (`smartassets/avatars`) and stores
// the permanent URL in the Supabase database (`profiles.avatar_url` column).

const supabase = require('../connection/supabaseClient');
const { isCloudinaryConfigured, uploadPublicMedia } = require('../utils/cloudinary');

const memoryCache = new Map();

/**
 * Save an avatar for a user — uploads base64 data URIs to Cloudinary (`smartassets/avatars`)
 * and stores the resulting URL in `profiles.avatar_url`.
 */
async function saveUserAvatar(userId, avatarInput) {
  if (!userId || !avatarInput) return null;

  let finalAvatarUrl = avatarInput;

  // Upload base64 avatars to Cloudinary so DB stores a clean CDN URL
  if (
    typeof avatarInput === 'string' &&
    avatarInput.startsWith('data:image/') &&
    isCloudinaryConfigured()
  ) {
    try {
      const cloudUrl = await uploadPublicMedia(avatarInput, 'avatars', {
        userId,
        publicId: `avatar_${userId}`,
      });
      if (cloudUrl) {
        finalAvatarUrl = cloudUrl;
        console.log(`☁️ [AvatarService] Uploaded avatar to Cloudinary for user ${userId}: ${cloudUrl}`);
      }
    } catch (cloudErr) {
      console.warn('⚠️ [AvatarService] Cloudinary upload warning (storing directly in DB):', cloudErr.message);
    }
  }

  memoryCache.set(userId, finalAvatarUrl);

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: finalAvatarUrl })
      .eq('id', userId);

    if (error) {
      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert(
          { id: userId, avatar_url: finalAvatarUrl },
          { onConflict: 'id', ignoreDuplicates: false }
        );
      if (upsertErr) {
        console.warn('⚠️ [AvatarService] DB upsert warning:', upsertErr.message);
      }
    }

    console.log(`🖼️ [AvatarService] Saved avatar to DB for user ${userId}`);
    return finalAvatarUrl;
  } catch (err) {
    console.warn('⚠️ [AvatarService] DB Save exception (using memory cache):', err.message);
    return finalAvatarUrl;
  }
}

/**
 * Get the stored avatar URL for a user from the database.
 */
async function getUserAvatar(userId) {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data?.avatar_url) {
      memoryCache.set(userId, data.avatar_url);
      return data.avatar_url;
    }
  } catch (err) {
    console.warn('⚠️ [AvatarService] DB fetch warning:', err.message);
  }

  return memoryCache.get(userId) || null;
}

/**
 * Delete a user's avatar from the database.
 */
async function deleteUserAvatar(userId) {
  if (!userId) return;

  memoryCache.delete(userId);

  try {
    await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', userId);

    console.log(`🗑️ [AvatarService] Cleared avatar from DB for user ${userId}`);
  } catch (err) {
    console.warn('⚠️ [AvatarService] Delete warning:', err.message);
  }
}

module.exports = {
  saveUserAvatar,
  getUserAvatar,
  deleteUserAvatar,
};
