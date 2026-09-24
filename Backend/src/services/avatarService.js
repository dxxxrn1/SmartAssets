// ─── Avatar Service ─────────────────────────────────────────────────────────
// Stores and retrieves user profile pictures directly in the Supabase database
// (profiles.avatar_url column) with resilient memory caching.

const supabase = require('../connection/supabaseClient');

const memoryCache = new Map();

/**
 * Save an avatar for a user — stores the base64 data URI directly
 * in the profiles.avatar_url column in the database.
 */
async function saveUserAvatar(userId, avatarInput) {
  if (!userId || !avatarInput) return null;

  memoryCache.set(userId, avatarInput);

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarInput })
      .eq('id', userId);

    if (error) {
      // If profile row doesn't exist yet, try upsert
      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert(
          { id: userId, avatar_url: avatarInput },
          { onConflict: 'id', ignoreDuplicates: false }
        );
      if (upsertErr) {
        console.warn('⚠️ [AvatarService] DB upsert warning:', upsertErr.message);
      }
    }

    console.log(`🖼️ [AvatarService] Saved avatar to DB for user ${userId} (${avatarInput.length} chars)`);
    return avatarInput;
  } catch (err) {
    console.warn('⚠️ [AvatarService] DB Save exception (using memory cache):', err.message);
    return avatarInput;
  }
}

/**
 * Get the stored avatar data URI for a user from the database.
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
