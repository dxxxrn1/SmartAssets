// ─── Notification Service ─────────────────────────────────────────────────────
// Authoritative notification dispatcher for multi-party escrow transactions.
// Notifies buyer, seller, and compliance administrators across every lifecycle milestone.

const supabase = require('../connection/supabaseClient');
const auditLogService = require('./auditLogService');

// In-memory runtime notifications buffer
const notificationsMap = new Map(); // userId -> Notification[]

/**
 * Creates and dispatches a notification to a specific user.
 */
async function sendNotification({
  userId,
  type,
  title,
  message,
  orderId = null,
  assetId = null,
  metadata = {},
}) {
  const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
  const now = new Date().toISOString();

  const notification = {
    id: notifId,
    userId,
    type,
    title,
    message,
    orderId,
    assetId,
    metadata,
    read: false,
    createdAt: now,
  };

  // Add to in-memory map
  if (userId) {
    const userNotifs = notificationsMap.get(userId) || [];
    userNotifs.unshift(notification);
    if (userNotifs.length > 100) userNotifs.pop();
    notificationsMap.set(userId, userNotifs);
  }

  // Also log to audit ledger
  auditLogService.logEvent({
    eventType: `ESCROW_NOTIFICATION_${type.toUpperCase()}`,
    actorId: userId || 'system',
    category: 'Escrow',
    description: `[Order #${orderId || 'N/A'}] ${title}: ${message}`,
  });

  // Try saving to Supabase if notifications table exists
  try {
    await supabase.from('notifications').insert({
      id: notifId,
      user_id: userId,
      type,
      title,
      message,
      order_id: orderId,
      metadata,
      read: false,
      created_at: now,
    });
  } catch (_e) {
    // If notifications table does not exist in schema, in-memory & audit log maintain fidelity
  }

  console.log(`🔔 [Notification] [${type}] User ${userId || 'System'}: ${title}`);
  return notification;
}

/**
 * Retrieve notifications for a specific user.
 */
async function getUserNotifications(userId) {
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (_e) {}

  return notificationsMap.get(userId) || [];
}

/**
 * Mark a notification as read.
 */
async function markNotificationAsRead(notifId, userId) {
  if (userId && notificationsMap.has(userId)) {
    const list = notificationsMap.get(userId) || [];
    const item = list.find((n) => n.id === notifId);
    if (item) item.read = true;
  }

  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notifId);
  } catch (_e) {}

  return { success: true };
}

module.exports = {
  sendNotification,
  getUserNotifications,
  markNotificationAsRead,
};
