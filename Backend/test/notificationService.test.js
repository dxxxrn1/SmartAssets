const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
const rows = [];
let failNext = false;
const filters = [];

function builder(table, action, payload) {
  const query = { table, action, payload, where: [] };
  const b = {
    insert(value) { query.action = 'insert'; query.payload = value; return b; },
    update(value) { query.action = 'update'; query.payload = value; return b; },
    select() { return b; },
    eq(key, value) { query.where.push([key, value]); return b; },
    order() { return b; }, limit() { return b; },
    single() { return execute(query, true); },
    maybeSingle() { return execute(query, true); },
    then(resolve, reject) { return execute(query, false).then(resolve, reject); },
  };
  return b;
}
function execute(q, single) {
  if (failNext) { failNext = false; return Promise.resolve({ data: null, error: { message: 'database unavailable' } }); }
  if (q.action === 'insert') {
    const row = { ...q.payload, created_at: q.payload.created_at || new Date().toISOString() };
    rows.unshift(row);
    return Promise.resolve({ data: single ? row : [row], error: null });
  }
  let found = rows.filter((row) => q.where.every(([key, value]) => row[key] === value));
  if (q.action === 'update') {
    found.forEach((row) => Object.assign(row, q.payload));
    filters.push(q.where.slice());
  }
  return Promise.resolve({ data: single ? (found[0] || null) : found, error: null });
}
const fakeSupabase = { from(table) { return builder(table, 'select', null); } };
Module._load = function(request, parent, isMain) {
  if (/notificationService\.js$/.test(parent?.filename || '') && request === '../connection/supabaseClient') return fakeSupabase;
  if (/notificationService\.js$/.test(parent?.filename || '') && request === './auditLogService') return { logEvent() {} };
  return originalLoad.call(this, request, parent, isMain);
};
const service = require('../src/services/notificationService');
Module._load = originalLoad;

(async () => {
  const created = await service.sendNotification({ userId: 'user-a', type: 'deposit_pending_review', title: 'Deposit submitted', message: 'Pending.' });
  assert.strictEqual(created.userId, 'user-a');
  assert.strictEqual((await service.getUserNotifications('user-a')).length, 1);
  assert.strictEqual((await service.getUserNotifications('user-b')).length, 0);
  assert.strictEqual(await service.markNotificationAsRead(created.id, 'user-b'), false);
  assert.strictEqual(await service.markNotificationAsRead(created.id, 'user-a'), true);
  assert.strictEqual((await service.getUserNotifications('user-a'))[0].read, true);
  assert(filters.some((entries) => entries.some(([key, value]) => key === 'id' && value === created.id) && entries.some(([key, value]) => key === 'user_id' && value === 'user-a')),
    'read update must filter by both notification ID and authenticated user ID');
  failNext = true;
  await assert.rejects(service.getUserNotifications('user-a'), /database unavailable/);
  console.log('Notification service isolation and persistence checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
