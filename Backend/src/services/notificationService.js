// ─── Notification Service ─────────────────────────────────────────────────────
// Durable notification persistence. User-facing reads and updates are always scoped
// to the authenticated user; database failures are surfaced instead of hiding notices
// in process memory that disappears on restart.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const auditLogService = require('./auditLogService');

function mapNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    orderId: row.order_id || null,
    metadata: row.metadata || {},
    read: Boolean(row.read),
    createdAt: row.created_at,
  };
}

async function sendNotification({ userId, type, title, message, orderId = null, assetId = null, metadata = {} }) {
  if (!userId) throw new Error('A recipient user ID is required for notifications.');
  const id = crypto.randomUUID();
  const { data, error } = await supabase.from('notifications').insert({
    id,
    user_id: userId,
    type,
    title,
    message,
    order_id: orderId,
    metadata: { ...metadata, ...(assetId ? { assetId } : {}) },
    read: false,
  }).select('*').single();
  if (error) {
    // Escrow notifications are supplementary to the escrow state transition. Never
    // claim delivery or keep an in-memory copy when durable storage is unavailable.
    console.error('[Notification] Durable insert failed:', error.message);
    return null;
  }
  auditLogService.logEvent({
    eventType: `NOTIFICATION_${String(type || 'update').toUpperCase()}`,
    actorId: userId,
    category: 'Notification',
    description: `${title}: ${message}`,
  });
  return mapNotification(data);
}

async function getUserNotifications(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from('notifications').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message || 'Notification database operation failed.');
  return (data || []).map(mapNotification);
}

async function markNotificationAsRead(notifId, userId) {
  if (!notifId || !userId) return false;
  const { data, error } = await supabase.from('notifications').update({ read: true })
    .eq('id', notifId).eq('user_id', userId).select('id').maybeSingle();
  if (error) throw new Error(error.message || 'Notification database operation failed.');
  return Boolean(data);
}

module.exports = { sendNotification, getUserNotifications, markNotificationAsRead };
