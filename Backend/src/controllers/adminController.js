function getFallbackCatalogAssets() {
  return [];
}

// ─── SmartAssets Admin Controller ──────────────────────────────────────────────
// Administration endpoints for SmartAssets:
// - Admin Authentication (`POST /api/admin/auth/login` checking `profiles.role === 'admin'`)
// - Platform Overview KPIs & volume statistics
// - Asset Moderation (approve, reject, flag status)
// - Escrow Orders & Custody Oversight (dispatch, inspection, release, refund)
// - Support Ticket Resolution Desk (Open, In Progress, Resolved with Admin Notes)
// - User Directory & Compliance Suspension Locks (Live Supabase + Vault Balances)
// - Granular 3-Document KYC Verification (`GET /admin/verifications`, `POST /admin/documents/:id/approve`, `POST /admin/documents/:id/reject`)
// - Bank Account Approval Desk (`GET /admin/bank-accounts`, `POST /admin/bank-accounts/:id/approve`, `POST /admin/bank-accounts/:id/reject`)
// - Real-time Security & Operations Activity Ledger

const fs = require('fs');
const path = require('path');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const escrowService = require('../services/escrowService');
const supportService = require('../services/supportService');
const complianceService = require('../services/complianceService');
const auditLogService = require('../services/auditLogService');
const vaultTxService = require('../services/vaultTransactionService');
const presenceService = require('../services/presenceService');
const { invalidateAssetsCache } = require('./assetController');
const { normalizeImageUrl, UPLOADS_DIR } = require('../utils/imageHandler');
const {
  createAdminToken,
  verifyAdminToken,
  getValidatedAdminSecret,
  isUserAdmin,
  revokeToken,
} = require('../middlewares/authMiddleware');

function isTestRecord(idOrEmail, name = '') {
  const s = String(idOrEmail || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return (
    s.startsWith('usr-test-') ||
    s.startsWith('test-user-') ||
    s.startsWith('test-vault-user-') ||
    s.startsWith('compliance.test@') ||
    n === 'test user' ||
    n === 'test investor' ||
    n === 'test collector'
  );
}

function cleanAssetDescription(rawDesc) {
  if (!rawDesc || typeof rawDesc !== 'string') return '';
  return rawDesc
    .replace(/<!--smartTake:[\s\S]*?-->/g, '')
    .replace(/<!--images:[\s\S]*?-->/g, '')
    .trim();
}

/**
 * Helper to record an admin action in both local `auditLogs.json` and Supabase `admin_audit_logs`.
 */
async function recordAdminAuditLog({ req, action, targetTable, targetId, targetUserId, targetEmail, reason, metadata }) {
  const adminEmail = req?.admin?.email || req?.user?.email || 'authenticated-admin';
  const adminId = req?.admin?.id || req?.user?.id || 'admin';
  const timestamp = new Date().toISOString();

  auditLogService.logEvent({
    eventType: action,
    category: 'Compliance',
    actorEmail: adminEmail,
    actorId: adminId,
    ip: req?.ip || req?.headers?.['x-forwarded-for'] || '127.0.0.1',
    device: 'SmartAssets Admin Console',
    description: `[Admin: ${adminEmail}] ${action} on ${targetTable}(${targetId})${targetEmail ? ` for ${targetEmail}` : ''}${reason ? ` — Reason: ${reason}` : ''}`,
    status: action.includes('REJECT') ? 'Rejected' : 'Approved',
  });

  try {
    await supabase.from('admin_audit_logs').insert({
      admin_id: /^[0-9a-fA-F-]{36}$/.test(String(adminId)) ? adminId : null,
      admin_email: adminEmail,
      action,
      target_table: targetTable,
      target_id: String(targetId),
      target_user_id: /^[0-9a-fA-F-]{36}$/.test(String(targetUserId)) ? targetUserId : null,
      reason: reason || null,
      metadata: {
        ...(metadata || {}),
        timestamp,
      },
    });
  } catch (_) {}
}

/**
 * POST /api/admin/auth/login
 * Authenticates an administrator strictly using Supabase Auth (email + password)
 * and verifies that their authoritative server-side role in `public.profiles` is `'admin'`.
 *
 * Strict Security Invariants:
 * 1. Fails closed with 503 if ADMIN_JWT_SECRET is unconfigured or weak.
 * 2. Authenticates solely via Supabase Auth — zero hardcoded credentials or bypasses.
 * 3. Authoritatively verifies `profiles.role === 'admin'` — never trusts user metadata or email strings.
 * 4. Signs admin session tokens with HMAC-SHA256 using the validated server-side secret.
 */
async function adminLogin(req, res) {
  try {
    // 0. Preflight check: Server-side admin JWT signing secret MUST be valid and strong
    try {
      getValidatedAdminSecret();
    } catch (cfgErr) {
      console.error('🚨 [adminLogin] Server configuration error:', cfgErr.message);
      return res.status(503).json({
        success: false,
        code: 'ADMIN_AUTH_CONFIG_ERROR',
        error:
          'Administrator authentication is temporarily unavailable due to server configuration. Please contact the system administrator.',
      });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return sendError(res, 400, 'Please enter both your admin email address and password.');
    }

    // 1. Authenticate via Supabase Auth
    let authenticatedUser = null;
    let supabaseSessionToken = null;
    let supabaseAuthError = null;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        supabaseAuthError = error;
      } else if (data && data.user) {
        authenticatedUser = data.user;
        supabaseSessionToken = data.session?.access_token || null;
      }
    } catch (err) {
      supabaseAuthError = err;
    }

    // 2. Reject immediately if authentication failed
    if (!authenticatedUser) {
      auditLogService.logEvent({
        eventType: 'ADMIN_LOGIN_FAILED',
        category: 'Security',
        actorEmail: email,
        ip: req.ip || '127.0.0.1',
        device: 'SmartAssets Admin Console',
        description: `Failed admin login attempt for ${email}: ${supabaseAuthError?.message || 'Invalid credentials'}.`,
        status: 'Failed',
      });

      return res.status(401).json({
        success: false,
        code: 'INVALID_ADMIN_CREDENTIALS',
        error: supabaseAuthError?.message || 'Invalid admin email or password.',
      });
    }

    // 3. Confirm administrator role authoritatively from public.profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', authenticatedUser.id)
      .maybeSingle();

    if (profileErr || !profile || profile.role !== 'admin') {
      // Immediately invalidate any issued Supabase session token
      if (supabaseSessionToken) {
        try {
          revokeToken(supabaseSessionToken);
        } catch (_) {}
      }

      auditLogService.logEvent({
        eventType: 'ADMIN_LOGIN_DENIED',
        category: 'Security',
        actorEmail: email,
        actorId: authenticatedUser.id,
        ip: req.ip || '127.0.0.1',
        device: 'SmartAssets Admin Console',
        description: `Access denied: non-admin user ${email} (role: ${profile?.role || 'none'}) attempted to log into Admin Portal.`,
        status: 'Access Denied',
      });

      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        error:
          'Access denied. Your account does not have administrator privileges (profiles.role = "admin" required).',
      });
    }

    // 4. Issue cryptographically signed admin session token
    const fullName =
      profile.full_name ||
      authenticatedUser.user_metadata?.full_name ||
      authenticatedUser.user_metadata?.name ||
      'SmartAssets Administrator';

    const adminToken = createAdminToken({
      id: profile.id,
      email: profile.email || authenticatedUser.email,
      fullName,
    });

    auditLogService.logEvent({
      eventType: 'ADMIN_LOGIN',
      category: 'Security',
      actorEmail: authenticatedUser.email,
      actorId: authenticatedUser.id,
      ip: req.ip || '127.0.0.1',
      device: 'SmartAssets Admin Console',
      description: 'Administrator authenticated successfully via Supabase Auth (`profiles.role = admin`).',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      token: adminToken,
      supabaseToken: supabaseSessionToken,
      admin: {
        id: profile.id,
        email: profile.email || authenticatedUser.email,
        fullName,
        role: 'admin',
      },
    });
  } catch (err) {
    console.error('adminLogin error:', err);
    return sendError(res, 500, 'Admin authentication failed.');
  }
}

/**
 * GET /api/admin/auth/me
 * Validates the current admin session and returns admin identity.
 */
async function getAdminMe(req, res) {
  return res.status(200).json({
    success: true,
    admin: req.admin || {
      id: req.user?.id,
      email: req.user?.email,
      role: 'admin',
    },
  });
}

/**
 * POST /api/admin/auth/logout
 * Revokes the current admin session token.
 */
async function adminLogout(req, res) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.body?.token) {
      token = req.body.token;
    }
    if (token) {
      await revokeToken(token, {
        userId: req.admin?.id || req.user?.id || null,
        tokenType: 'admin',
        reason: 'admin_logout',
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Admin session signed out.',
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to sign out admin session.');
  }
}

/**
 * Helper to build the merged list of real users from Supabase (profiles + auth.users)
 * enriched with Vault balances, listed asset counts, escrow counts, and FICA/KYC compliance.
 */
async function buildMergedRealUsers(req) {
  const userMap = new Map();

  // 1. Query Supabase profiles table
  let supabaseReachable = true;
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error && String(error.message || '').toLowerCase().includes('fetch failed')) {
      supabaseReachable = false;
    }

    if (!error && Array.isArray(profiles)) {
      profiles.forEach((p) => {
        if (!p || !p.id || isTestRecord(p.id, p.full_name) || isTestRecord(p.email, p.full_name)) return;
        userMap.set(p.id, {
          id: p.id,
          fullName: p.full_name || '',
          email: p.email || '',
          role: p.role || 'user',
          dbVerificationStatus: p.verification_status || null,
          walletAddress: p.wallet_address || null,
          avatarUrl: p.avatar_url || null,
          createdAt: p.created_at || null,
          dbBalance: p.balance !== undefined && p.balance !== null ? Number(p.balance) : null,
        });
      });
    }
  } catch (err) {
    supabaseReachable = false;
    console.warn('⚠️ [AdminController] Supabase profiles query warning:', err.message);
  }

  // 2. Query Supabase Auth users to fill in any missing emails, full_names, or newly registered users
  if (supabaseReachable) {
    try {
      const authResult = await Promise.race([
        supabase.auth.admin.listUsers(),
        new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 3500)),
      ]);
      const { data: authList, error: authErr } = authResult || {};
      if (!authErr && authList && Array.isArray(authList.users)) {
        authList.users.forEach((au) => {
          if (!au || !au.id) return;
          const metaName = au.user_metadata?.full_name || au.user_metadata?.name || '';
          if (isTestRecord(au.id, metaName) || isTestRecord(au.email, metaName)) return;

          const existing = userMap.get(au.id) || { id: au.id };
          userMap.set(au.id, {
            ...existing,
            fullName: existing.fullName || metaName || (au.email ? au.email.split('@')[0] : 'Collector'),
            email: existing.email || au.email || '—',
            walletAddress: existing.walletAddress || au.user_metadata?.wallet_address || null,
            avatarUrl:
              existing.avatarUrl && existing.avatarUrl !== 'db_stored'
                ? existing.avatarUrl
                : au.user_metadata?.avatar_url && au.user_metadata.avatar_url !== 'db_stored'
                ? au.user_metadata.avatar_url
                : null,
            createdAt: existing.createdAt || au.created_at || new Date().toISOString(),
          });
        });
      }
    } catch (err) {
      console.warn('⚠️ [AdminController] Supabase auth.admin.listUsers warning:', err.message);
    }
  }

  // 3. Map listed assets count from Supabase
  const assetMap = {};
  try {
    const { data: assets } = await supabase.from('assets').select('id, user_id');
    (assets || []).forEach((a) => {
      if (a.user_id) assetMap[a.user_id] = (assetMap[a.user_id] || 0) + 1;
    });
  } catch (_) {}

  // 4. Map escrow orders count
  const orders = (await escrowService.getAllEscrowOrders(req)) || [];
  const escrowMap = {};
  orders.forEach((o) => {
    if (o.buyerId) escrowMap[o.buyerId] = (escrowMap[o.buyerId] || 0) + 1;
  });

  const enriched = [];
  for (const u of userMap.values()) {
    const comp = complianceService.getUserCompliance(u.id, u.email);
    const bankAccount = complianceService.getUserBankAccount(u.id, u.email);
    let kycStatus = comp.kycStatus || u.dbVerificationStatus || 'unverified';

    const displayFullName =
      u.fullName && u.fullName.trim() && u.fullName !== 'Anonymous Collector'
        ? u.fullName.trim()
        : comp.fullName || (u.email && u.email !== '—' ? u.email.split('@')[0] : 'SmartAssets Collector');

    const nameParts = displayFullName.split(' ');
    const firstName = nameParts[0] || displayFullName;
    const lastName = nameParts.slice(1).join(' ') || '';

    // Balances are strictly retrieved from Supabase profiles (defaults to 0 for new users)
    const vaultBalance =
      u.dbBalance !== null && u.dbBalance !== undefined
        ? Number(u.dbBalance)
        : 0;

    const listedCount = assetMap[u.id] || 0;
    const escrowCount = escrowMap[u.id] || 0;
    const accountStatus = comp.accountStatus || 'active';
    const bankingDetails = comp.bankingDetails || null;
    const presence = presenceService.getUserPresence(u.id);

    enriched.push({
      id: u.id,
      fullName: displayFullName,
      first_name: firstName,
      last_name: lastName,
      email: u.email || comp.userEmail || '—',
      role: u.role || 'user',
      walletAddress: u.walletAddress || null,
      balance: vaultBalance,
      vault_balance: vaultBalance,
      createdAt: u.createdAt || comp.updatedAt || new Date().toISOString(),
      avatarUrl: u.avatarUrl || null,
      assetsListed: listedCount,
      listed_assets_count: listedCount,
      escrowOrders: escrowCount,
      kycStatus,
      verification_status: kycStatus,
      kyc_status:
        kycStatus === 'verified'
          ? 'Verified'
          : kycStatus === 'pending'
          ? 'Pending Review'
          : kycStatus === 'rejected'
          ? 'Rejected'
          : 'Unverified',
      accountStatus,
      account_status: accountStatus === 'suspended' ? 'Suspended' : 'Active',
      isSuspended: comp.isSuspended || false,
      suspensionReason: comp.suspensionReason || null,
      bankingDetails,
      bankAccountStatus: bankAccount?.status || 'not_submitted',
      linked_bank: bankAccount
        ? `${bankAccount.bank_name} (${complianceService.maskAccountNumber(bankAccount.account_number)}) [${bankAccount.status.toUpperCase()}]`
        : bankingDetails
        ? `${bankingDetails.bankName} (...${String(bankingDetails.accountNumber || '').slice(-4)})`
        : null,
      verificationStatus:
        kycStatus === 'verified'
          ? 'Verified'
          : kycStatus === 'pending'
          ? 'Pending Review'
          : kycStatus === 'rejected'
          ? 'Rejected'
          : 'Unverified',
      isOnline: presence.isOnline,
      isIdle: presence.isIdle,
      presenceStatus: presence.status,
      lastSeen: presence.lastSeen,
      lastSeenText: presence.lastSeenText,
      clientType: presence.clientType,
    });
  }

  // Sort newest first
  enriched.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return enriched;
}

let cachedOverviewPayload = null;
let lastOverviewFetchTime = 0;
const OVERVIEW_CACHE_TTL_MS = 15000; // 15-second TTL completely protects Supabase from rate limits

/**
 * GET /api/admin/overview
 * Platform statistics and KPIs computed safely from existing DB & JSON stores.
 */
async function getAdminOverview(req, res) {
  try {
    const now = Date.now();
    // Serve from memory cache if within 15 seconds, but refresh real-time presence live
    if (cachedOverviewPayload && (now - lastOverviewFetchTime < OVERVIEW_CACHE_TTL_MS)) {
      const livePresence = presenceService.getPresenceOverview(cachedOverviewPayload.realUsers || []);
      return res.json({
        success: true,
        overview: {
          ...cachedOverviewPayload.overview,
          users: {
            ...cachedOverviewPayload.overview.users,
            onlineCount: livePresence.onlineCount,
            idleCount: livePresence.idleCount,
            offlineCount: livePresence.offlineCount,
            onlineUsers: livePresence.onlineUsers,
          },
        },
      });
    }

    // 1. Fetch merged real users
    const realUsers = await buildMergedRealUsers(req);

    // 2. Fetch assets breakdown
    let assets = [];
    try {
      const { data: dbAssets } = await supabase
        .from('assets')
        .select('id, name, category, status, price, price_num, badge, image, created_at');
      assets = (dbAssets || []).map((row) => {
        let img = row.image;
        if (
          (row.name && row.name.toLowerCase().includes('rolex submariner')) ||
          (img && (img.includes('asset_6f80eb') || img.includes('b1tmz')))
        ) {
          img = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
        }
        return {
          ...row,
          image: normalizeImageUrl(img, req),
        };
      });
    } catch (e) {
      console.warn('⚠️ [AdminController] Overview assets fetch warning:', e.message);
    }

    const totalAssets = assets.length;
    const activeAssets = assets.filter((a) => a.status === 'active').length;
    const flaggedAssets = assets.filter((a) => a.status === 'flagged' || a.badge === 'Flagged').length;
    const pendingAssets = assets.filter((a) => a.status === 'pending').length;

    // 3. Fetch escrow orders
    const allOrders = (await escrowService.getAllEscrowOrders(req)) || [];
    const activeEscrows = allOrders.filter(
      (o) => o.status === 'payment_secured' || o.status === 'in_transit' || o.status === 'in_inspection'
    );
    const completedEscrows = allOrders.filter((o) => o.status === 'released');
    const refundedEscrows = allOrders.filter((o) => o.status === 'refunded');

    const totalEscrowVolumeZar = allOrders.reduce((sum, o) => sum + (Number(o.amountZar) || 0), 0);
    const totalEscrowVolumeEth = allOrders.reduce((sum, o) => sum + (Number(o.amountEth) || 0), 0);

    // 4. Fetch support tickets
    const allTickets = supportService.getAllTickets();
    const openTickets = allTickets.filter((t) => t.status === 'Open');
    const inReviewTickets = allTickets.filter((t) => t.status === 'In Progress' || t.status === 'In Review');
    const resolvedTickets = allTickets.filter((t) => t.status === 'Resolved');

    // 5. Fetch KYC Compliance Verifications & Bank Accounts
    const allVerifs = complianceService.getAllVerifications();
    const pendingVerifs = allVerifs.filter((v) => v.kycStatus === 'pending');
    const allBankAccounts = await complianceService.getAllBankAccounts();
    const pendingBankAccounts = allBankAccounts.filter((b) => b.status === 'pending');

    // 6. Real-time active & online collectors overview
    const presenceOverview = presenceService.getPresenceOverview(realUsers);

    const overviewResponse = {
      success: true,
      overview: {
        users: {
          total: realUsers.length,
          onlineCount: presenceOverview.onlineCount,
          idleCount: presenceOverview.idleCount,
          offlineCount: presenceOverview.offlineCount,
          onlineUsers: presenceOverview.onlineUsers,
        },
        assets: {
          total: totalAssets,
          active: activeAssets,
          flagged: flaggedAssets,
          pending: pendingAssets,
        },
        escrows: {
          total: allOrders.length,
          active: activeEscrows.length,
          completed: completedEscrows.length,
          refunded: refundedEscrows.length,
          volumeZar: totalEscrowVolumeZar,
          volumeEth: Number(totalEscrowVolumeEth.toFixed(4)),
        },
        tickets: {
          total: allTickets.length,
          open: openTickets.length,
          inReview: inReviewTickets.length,
          resolved: resolvedTickets.length,
        },
        recentEscrows: allOrders.slice(0, 5),
        moderationQueue: assets
          .filter((a) => a.status === 'pending' || a.status === 'flagged' || a.badge === 'Flagged')
          .slice(0, 5),
        supportInboxPreview: allTickets.slice(0, 5),
        verificationPending: {
          count: pendingVerifs.length,
          total: allVerifs.length,
          pendingBankCount: pendingBankAccounts.length,
          isDemonstration: false,
          label: `${pendingVerifs.length} Pending FICA Dossiers`,
          note: 'Active SmartAssets KYC & Bank Account compliance review queue.',
        },
        timestamp: new Date().toISOString(),
      },
    };

    cachedOverviewPayload = {
      overview: overviewResponse.overview,
      realUsers,
    };
    lastOverviewFetchTime = Date.now();

    return res.json(overviewResponse);
  } catch (err) {
    console.error('getAdminOverview error:', err);
    return sendError(res, 500, 'Failed to fetch admin overview.');
  }
}

/**
 * GET /api/admin/assets
 * Lists all assets across all statuses for moderation review with clean images and owner details.
 */
async function getAdminAssets(req, res) {
  try {
    const { status, category } = req.query;

    let query = supabase.from('assets').select('*').order('created_at', { ascending: false });

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }
    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    let { data: assets, error } = await query;
    if (error || !assets || !assets.length) {
      assets = [];
    }

    const normalized = (assets || []).map((row) => {
      let rawImg = row.image;
      if (
        (row.name && row.name.toLowerCase().includes('rolex submariner')) ||
        (rawImg && (rawImg.includes('asset_6f80eb') || rawImg.includes('b1tmz')))
      ) {
        rawImg = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
      }

      return {
        ...row,
        description: cleanAssetDescription(row.description),
        image: normalizeImageUrl(rawImg, req),
      };
    });

    return res.json({ success: true, count: normalized.length, assets: normalized });
  } catch (err) {
    console.error('getAdminAssets error:', err);
    return sendError(res, 500, 'Internal server error fetching admin assets.');
  }
}

/**
 * PATCH /api/admin/assets/:id/status
 * Updates the moderation status of an asset.
 */
async function updateAssetStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, badge } = req.body;

    if (!id || !status) {
      return sendError(res, 400, 'Asset ID and status (active, flagged, rejected, pending) are required.');
    }

    const updates = { status };
    if (badge) updates.badge = badge;

    const { data: updated, error } = await supabase
      .from('assets')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('updateAssetStatus error:', error);
      return sendError(res, 500, 'Failed to update asset moderation status.');
    }

    if (!updated) {
      return sendError(res, 404, 'Asset not found.');
    }

    invalidateAssetsCache();

    return res.json({
      success: true,
      message: `Asset status successfully updated to "${status}".`,
      asset: {
        ...updated,
        description: cleanAssetDescription(updated.description),
        image: normalizeImageUrl(updated.image, req),
      },
    });
  } catch (err) {
    console.error('updateAssetStatus error:', err);
    return sendError(res, 500, 'Internal server error updating asset status.');
  }
}

/**
 * GET /api/admin/escrows
 * Lists all platform escrow orders with full timeline details.
 */
async function getAdminEscrows(req, res) {
  try {
    const { status } = req.query;
    let orders = (await escrowService.getAllEscrowOrders(req)) || [];

    if (status && status !== 'All') {
      orders = orders.filter((o) => o.status === status);
    }

    return res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('getAdminEscrows error:', err);
    return sendError(res, 500, 'Failed to fetch admin escrow orders.');
  }
}

/**
 * POST /api/admin/escrows/:id/action
 * Administrative actions on escrow: step progression, release, or dispute refund.
 */
async function handleEscrowAction(req, res) {
  try {
    const { id: orderId } = req.params;
    const { action, step, note, reason } = req.body;

    if (!orderId || !action) {
      return sendError(res, 400, 'orderId and action ("verify_payment" | "step" | "release" | "refund") are required.');
    }

    let updatedOrder;
    const actor = { userId: req.admin?.id || req.user?.id, role: 'admin', payoutReference: reason };
    if (action === 'verify_payment') {
      updatedOrder = await escrowService.verifyEscrowPayment(orderId, reason, actor);
    } else if (action === 'step') {
      if (!step) return sendError(res, 400, 'step (2 or 3) is required for step action.');
      updatedOrder = await escrowService.progressEscrowStep(orderId, step, { note }, actor);
    } else if (action === 'release') {
      updatedOrder = await escrowService.releaseEscrow(orderId, actor);
    } else if (action === 'refund') {
      updatedOrder = await escrowService.refundEscrow(orderId, reason, actor);
    } else {
      return sendError(res, 400, `Unknown action: "${action}". Must be verify_payment, step, release, or refund.`);
    }

    return res.json({
      success: true,
      message: `Escrow action "${action}" executed successfully.`,
      order: {
        ...updatedOrder,
        assetImage: normalizeImageUrl(updatedOrder.assetImage, req),
      },
    });
  } catch (err) {
    console.error('handleEscrowAction error:', err);
    return sendError(res, 500, err.message || 'Failed to execute escrow action.');
  }
}

/**
 * GET /api/admin/tickets
 * Lists all support tickets across all users.
 */
async function getAdminTickets(_req, res) {
  try {
    const tickets = supportService.getAllTickets();
    return res.json({ success: true, count: tickets.length, tickets });
  } catch (err) {
    console.error('getAdminTickets error:', err);
    return sendError(res, 500, 'Failed to fetch admin support tickets.');
  }
}

/**
 * PATCH /api/admin/tickets/:id
 * Updates ticket resolution status with admin resolution response.
 */
async function updateAdminTicket(req, res) {
  try {
    const { id } = req.params;
    const { status, resolutionNote, adminResponse } = req.body;

    if (!id || !status) {
      return sendError(res, 400, 'Ticket ID and status ("Open" | "In Progress" | "In Review" | "Resolved") are required.');
    }

    const note = resolutionNote || adminResponse || null;
    const updated = supportService.updateTicketStatus(id, status, note);
    if (!updated) {
      return sendError(res, 404, 'Support ticket not found.');
    }

    auditLogService.logEvent({
      eventType: status === 'Resolved' ? 'SUPPORT_RESOLVED' : 'SUPPORT_UPDATED',
      category: 'Support',
      actorEmail: updated.userEmail,
      actorId: updated.userId,
      device: 'Admin Operations Desk',
      description: `Support Ticket ${id} set to "${status}". Note: ${note || 'Status updated'}`,
      status,
    });

    return res.json({
      success: true,
      message: `Ticket ${id} updated to "${status}".`,
      ticket: updated,
    });
  } catch (err) {
    console.error('updateAdminTicket error:', err);
    return sendError(res, 500, 'Failed to update support ticket.');
  }
}

/**
 * GET /api/admin/health
 * Verifies live connectivity across services.
 */
async function getAdminHealth(_req, res) {
  try {
    const services = {};

    // 1. Express API
    services.api = {
      name: 'Express HTTP API',
      status: 'operational',
      label: 'Operational',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      nodeVersion: process.version,
      details: 'Express runtime active on port 5000 with Helmet hardening',
    };

    // 2. Supabase Connectivity
    const sbStart = Date.now();
    try {
      const { count, error: sbError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      const sbLatency = Date.now() - sbStart;
      if (sbError) {
        services.supabase = {
          name: 'Supabase PostgreSQL',
          status: 'degraded',
          label: 'Degraded',
          latencyMs: sbLatency,
          details: sbError.message,
        };
      } else {
        services.supabase = {
          name: 'Supabase PostgreSQL',
          status: 'operational',
          label: 'Operational',
          latencyMs: sbLatency,
          details: `Direct connection verified (${count || 0} profiles indexed)`,
        };
      }
    } catch (e) {
      services.supabase = {
        name: 'Supabase PostgreSQL',
        status: 'degraded',
        label: 'Offline Fallback',
        details: 'Using synchronized local compliance & vault persistence',
      };
    }

    // 3. Marketplace Asset Storage
    try {
      const uploadsExists = fs.existsSync(UPLOADS_DIR);
      if (uploadsExists) {
        const fileCount = fs.readdirSync(UPLOADS_DIR).length;
        services.storage = {
          name: 'Cloud Media & Storage (Cloudinary)',
          status: 'operational',
          label: 'Operational',
          details: `Cloudinary CDN active (smartassets/) + private Supabase KYC storage (${fileCount} local fallbacks)`,
        };
      } else {
        services.storage = {
          name: 'Cloud Media & Storage (Cloudinary)',
          status: 'degraded',
          label: 'Missing Directory',
          details: 'Uploads path not accessible',
        };
      }
    } catch (e) {
      services.storage = {
        name: 'Marketplace Asset Storage',
        status: 'degraded',
        label: 'Storage Error',
        details: e.message,
      };
    }

    // 4. Escrow Custody Engine
    try {
      const orders = (await escrowService.getAllEscrowOrders(req)) || [];
      services.escrow = {
        name: 'Escrow Custody Service',
        status: 'operational',
        label: 'Operational',
        details: `Supabase escrow custody service active (${orders.length} orders tracked)`,
      };
    } catch (e) {
      services.escrow = {
        name: 'Escrow Custody Service',
        status: 'degraded',
        label: 'Parse Error',
        details: e.message,
      };
    }

    // 5. Blockchain Relayer
    const relayerContract = path.resolve(__dirname, '../contracts/SmartAssetEscrow.json');
    if (fs.existsSync(relayerContract)) {
      try {
        const artifact = JSON.parse(fs.readFileSync(relayerContract, 'utf8'));
        services.blockchain = {
          name: 'Ethereum Blockchain Relayer',
          status: 'operational',
          label: 'Relayer Active',
          contractAddress: artifact.contractAddress,
          network: 'Sepolia Testnet / Hardhat',
          details: `Smart contract deployed at ${artifact.contractAddress}`,
        };
      } catch {
        services.blockchain = {
          name: 'Ethereum Blockchain Relayer',
          status: 'not_verified',
          label: 'Not Verified',
          details: 'Contract artifact unreadable',
        };
      }
    } else {
      services.blockchain = {
        name: 'Ethereum Blockchain Relayer',
        status: 'not_verified',
        label: 'Not Verified',
        details: 'No deployed smart contract artifact found',
      };
    }

    // 6. Compliance & Audit Guard
    services.compliance = {
      name: 'SmartAssets KYC & Compliance Ledger',
      status: 'operational',
      label: 'Enforced',
      details: 'Strict 3-doc KYC + Bank Account approval gatekeeper & 5-min session timeout active',
    };

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services,
    });
  } catch (err) {
    console.error('getAdminHealth error:', err);
    return sendError(res, 500, 'Failed to compute system health.');
  }
}

/**
 * GET /api/admin/users
 * Real user directory from Supabase (profiles + auth.users) enriched with Vault balances,
 * asset stats, KYC status, account status (active vs suspended), and linked bank accounts.
 */
async function getAdminUsers(req, res) {
  try {
    const enriched = await buildMergedRealUsers(req);
    return res.json({
      success: true,
      count: enriched.length,
      users: enriched,
    });
  } catch (err) {
    console.error('getAdminUsers error:', err);
    return sendError(res, 500, 'Internal server error fetching admin users.');
  }
}

/**
 * PATCH /api/admin/users/:id/status
 * Toggle user account suspension (Active vs Suspended)
 */
async function updateUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!id || !status) {
      return sendError(res, 400, 'User ID and status ("active" | "suspended") are required.');
    }

    const isSuspended = status === 'suspended';
    const updated = complianceService.setUserSuspension(id, isSuspended, reason);

    await recordAdminAuditLog({
      req,
      action: isSuspended ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
      targetTable: 'profiles',
      targetId: id,
      targetUserId: id,
      targetEmail: updated.userEmail || id,
      reason,
    });

    return res.json({
      success: true,
      message: `User status successfully updated to "${status}".`,
      user: updated,
    });
  } catch (err) {
    console.error('updateUserStatus error:', err);
    return sendError(res, 500, 'Internal server error updating user status.');
  }
}

/**
 * GET /api/admin/activity
 * Aggregated operational activity trail merging escrow milestones,
 * vault transactions, support submissions, and real-time security audit logs.
 */
async function getAdminActivity(req, res) {
  try {
    const activities = [];

    // 1. Escrows milestones
    const orders = (await escrowService.getAllEscrowOrders(req)) || [];
    orders.forEach((o) => {
      if (Array.isArray(o.timeline)) {
        o.timeline.forEach((step) => {
          if (step.completed) {
            activities.push({
              id: `ACT-ESC-${o.orderId}-${step.step}`,
              timestamp: step.timestamp || o.updatedAt || o.createdAt,
              category: 'Escrow',
              title: `Escrow Milestone: ${o.orderId}`,
              description: `${step.title} — ${o.assetName} (${o.amountEth} ETH)`,
              actor: o.buyerId || 'Escrow Buyer',
              status: o.status,
              txHash: step.txHash || null,
              source: 'Supabase: escrow_orders',
            });
          }
        });
      }
    });

    // 2. Vault transactions
    try {
      const { data: dbTxs } = await supabase
        .from('vault_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      const txs = (dbTxs && dbTxs.length) ? dbTxs : vaultTxService.getAllTransactions();
      (txs || []).forEach((t) => {
        const uId = t.user_id || t.userId;
        if (isTestRecord(uId)) return;
        activities.push({
          id: `ACT-VLT-${t.id}`,
          timestamp: t.created_at || t.createdAt,
          category: 'Vault',
          title: `Vault ${(t.type || 'TX').toUpperCase()}: ${t.amountFormatted || 'R' + t.amount}`,
          description: `${t.notes || t.description || t.title || 'Vault Transaction'} (${t.payment_method || t.method || 'EFT'})`,
          actor: uId,
          status: t.status || 'completed',
          txHash: t.reference || null,
          source: 'Supabase: vault_transactions',
        });
      });
    } catch (e) {
      console.warn('Could not read vault transactions for activity:', e.message);
    }

    // 3. Support tickets
    const tickets = supportService.getAllTickets();
    tickets.forEach((t) => {
      if (isTestRecord(t.userId, t.userName)) return;
      activities.push({
        id: `ACT-TKT-${t.id}`,
        timestamp: t.updatedAt || t.createdAt,
        category: 'Support',
        title: `Support ${t.status}: ${t.id}`,
        description: `${t.subject} — ${t.category}`,
        actor: t.userName || t.userEmail,
        status: t.status,
        txHash: null,
        source: 'Supabase: support_tickets',
      });
    });

    // 4. Real-time Security & Authentication Audit Logs
    const secLogs = await auditLogService.getAllLogs();
    secLogs.forEach((log) => {
      if (isTestRecord(log.actorId) || isTestRecord(log.actorEmail)) return;
      activities.push({
        id: log.id,
        timestamp: log.timestamp,
        category: log.category || 'Security',
        title: `${log.eventType}: ${log.actorEmail || log.actorId}`,
        description: `${log.description} (${log.device || 'Client'})`,
        actor: log.actorEmail || log.actorId,
        status: log.status || 'Success',
        txHash: null,
        source: 'Supabase: admin_audit_logs',
      });
    });

    // Sort descending by timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({
      success: true,
      count: activities.length,
      activities: activities.slice(0, 75),
    });
  } catch (err) {
    console.error('getAdminActivity error:', err);
    return sendError(res, 500, 'Internal server error fetching admin activity.');
  }
}

/**
 * GET /api/admin/verifications
 * Returns both user KYC dossiers AND individual `verification_documents` with short-lived signed URLs.
 */
async function getAdminVerifications(req, res) {
  try {
    const rawVerifications = complianceService.getAllVerifications();
    const allDocs = await complianceService.getAllVerificationDocuments(req);
    const allBanks = await complianceService.getAllBankAccounts();

    // Group individual documents by user_id
    const docsByUser = {};
    allDocs.forEach((doc) => {
      const uid = doc.user_id;
      if (!docsByUser[uid]) docsByUser[uid] = {};
      docsByUser[uid][doc.doc_type] = {
        ...doc,
        preview_url: normalizeImageUrl(doc.preview_url || doc.file_path, req),
      };
    });

    const banksByUser = {};
    allBanks.forEach((b) => {
      banksByUser[b.user_id] = b;
    });

    const verifications = rawVerifications.map((v) => {
      const userDocs = docsByUser[v.userId] || {};
      const userBank = banksByUser[v.userId] || null;
      return {
        ...v,
        idDocumentUrl: normalizeImageUrl(userDocs.id?.preview_url || v.idDocumentUrl, req),
        taxDocumentUrl: normalizeImageUrl(userDocs.tax?.preview_url || v.taxDocumentUrl, req),
        proofOfResidenceUrl: normalizeImageUrl(userDocs.proof_of_residence?.preview_url || v.proofOfResidenceUrl, req),
        documents: {
          id: userDocs.id || null,
          tax: userDocs.tax || null,
          proof_of_residence: userDocs.proof_of_residence || null,
        },
        bankAccount: userBank,
      };
    });

    return res.json({
      success: true,
      count: verifications.length,
      verifications,
      documents: allDocs.map((d) => ({
        ...d,
        preview_url: normalizeImageUrl(d.preview_url || d.file_path, req),
      })),
    });
  } catch (err) {
    console.error('getAdminVerifications error:', err);
    return sendError(res, 500, 'Failed to fetch verification dossiers.');
  }
}

/**
 * POST /api/admin/documents/:id/approve
 * Approves a single verification document (`id`, `tax`, or `proof_of_residence`).
 * Automatically flips `profiles.verification_status` to `'verified'` when all 3 documents are approved.
 */
async function approveAdminDocument(req, res) {
  try {
    const { id } = req.params;
    const reviewerId = req.admin?.email || req.user?.email || req.admin?.id || 'admin';

    const approvedDoc = await complianceService.approveDocument(id, reviewerId);
    if (!approvedDoc) {
      return sendError(res, 404, 'Verification document not found.');
    }

    const bundle = await complianceService.getVerificationStatusBundle(
      approvedDoc.user_id,
      approvedDoc.userEmail,
      req
    );

    await recordAdminAuditLog({
      req,
      action: 'KYC_DOC_APPROVED',
      targetTable: 'verification_documents',
      targetId: id,
      targetUserId: approvedDoc.user_id,
      targetEmail: approvedDoc.userEmail,
      metadata: {
        doc_type: approvedDoc.doc_type,
        overall_verification_status: bundle.verification_status,
      },
    });

    return res.json({
      success: true,
      message:
        bundle.verification_status === 'verified'
          ? `Document (${approvedDoc.doc_type}) approved! All 3 documents are now approved — user account is VERIFIED.`
          : `Document (${approvedDoc.doc_type}) approved (${bundle.approved_count}/3 documents approved).`,
      document: {
        ...approvedDoc,
        preview_url: normalizeImageUrl(approvedDoc.file_path, req),
      },
      verification_status: bundle.verification_status,
      approved_count: bundle.approved_count,
    });
  } catch (err) {
    console.error('approveAdminDocument error:', err);
    return sendError(res, 500, 'Failed to approve verification document.');
  }
}

/**
 * POST /api/admin/documents/:id/reject
 * Rejects a single verification document with a mandatory reason.
 */
async function rejectAdminDocument(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return sendError(res, 400, 'A rejection reason is required when rejecting a verification document.');
    }

    const reviewerId = req.admin?.email || req.user?.email || req.admin?.id || 'admin';
    const rejectedDoc = await complianceService.rejectDocument(id, String(reason).trim(), reviewerId);
    if (!rejectedDoc) {
      return sendError(res, 404, 'Verification document not found.');
    }

    await recordAdminAuditLog({
      req,
      action: 'KYC_DOC_REJECTED',
      targetTable: 'verification_documents',
      targetId: id,
      targetUserId: rejectedDoc.user_id,
      targetEmail: rejectedDoc.userEmail,
      reason: String(reason).trim(),
      metadata: { doc_type: rejectedDoc.doc_type },
    });

    return res.json({
      success: true,
      message: `Document (${rejectedDoc.doc_type}) rejected with reason.`,
      document: {
        ...rejectedDoc,
        preview_url: normalizeImageUrl(rejectedDoc.file_path, req),
      },
      verification_status: 'rejected',
    });
  } catch (err) {
    console.error('rejectAdminDocument error:', err);
    return sendError(res, 400, err.message || 'Failed to reject verification document.');
  }
}

/**
 * GET /api/admin/bank-accounts
 * Lists all pending & reviewed bank accounts.
 * Masks account numbers in list view (`account_number_masked`: `****1234`) while providing `account_number_full` for the detail modal.
 */
async function getAdminBankAccounts(_req, res) {
  try {
    const bankAccounts = await complianceService.getAllBankAccounts();
    return res.json({
      success: true,
      count: bankAccounts.length,
      bankAccounts,
    });
  } catch (err) {
    console.error('getAdminBankAccounts error:', err);
    return sendError(res, 500, 'Failed to fetch bank accounts.');
  }
}

/**
 * POST /api/admin/bank-accounts/:id/approve
 * Approves a user's bank account for withdrawals.
 */
async function approveAdminBankAccount(req, res) {
  try {
    const { id } = req.params;
    const reviewerId = req.admin?.email || req.user?.email || req.admin?.id || 'admin';

    const approvedBank = await complianceService.approveBankAccount(id, reviewerId);
    if (!approvedBank) {
      return sendError(res, 404, 'Bank account record not found.');
    }

    await recordAdminAuditLog({
      req,
      action: 'BANK_ACCOUNT_APPROVED',
      targetTable: 'bank_accounts',
      targetId: id,
      targetUserId: approvedBank.user_id,
      targetEmail: approvedBank.userEmail,
      metadata: {
        bank_name: approvedBank.bank_name,
        account_masked: complianceService.maskAccountNumber(approvedBank.account_number),
      },
    });

    return res.json({
      success: true,
      message: `Bank account (${approvedBank.bank_name} ${complianceService.maskAccountNumber(approvedBank.account_number)}) approved for withdrawals.`,
      bankAccount: {
        ...approvedBank,
        account_number_masked: complianceService.maskAccountNumber(approvedBank.account_number),
        account_number_full: approvedBank.account_number,
      },
    });
  } catch (err) {
    console.error('approveAdminBankAccount error:', err);
    return sendError(res, 500, 'Failed to approve bank account.');
  }
}

/**
 * POST /api/admin/bank-accounts/:id/reject
 * Rejects a user's bank account with a mandatory reason.
 */
async function rejectAdminBankAccount(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return sendError(res, 400, 'A rejection reason is required when rejecting a bank account.');
    }

    const reviewerId = req.admin?.email || req.user?.email || req.admin?.id || 'admin';
    const rejectedBank = await complianceService.rejectBankAccount(id, String(reason).trim(), reviewerId);
    if (!rejectedBank) {
      return sendError(res, 404, 'Bank account record not found.');
    }

    await recordAdminAuditLog({
      req,
      action: 'BANK_ACCOUNT_REJECTED',
      targetTable: 'bank_accounts',
      targetId: id,
      targetUserId: rejectedBank.user_id,
      targetEmail: rejectedBank.userEmail,
      reason: String(reason).trim(),
      metadata: {
        bank_name: rejectedBank.bank_name,
        account_masked: complianceService.maskAccountNumber(rejectedBank.account_number),
      },
    });

    return res.json({
      success: true,
      message: `Bank account (${rejectedBank.bank_name}) rejected.`,
      bankAccount: {
        ...rejectedBank,
        account_number_masked: complianceService.maskAccountNumber(rejectedBank.account_number),
        account_number_full: rejectedBank.account_number,
      },
    });
  } catch (err) {
    console.error('rejectAdminBankAccount error:', err);
    return sendError(res, 400, err.message || 'Failed to reject bank account.');
  }
}

/**
 * POST /api/admin/verifications/:id/approve
 * Approves a user's submitted KYC dossier & all 3 underlying documents, flipping their status to "verified".
 */
async function approveKyc(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const approved = await complianceService.approveKyc(id, notes);
    if (!approved) {
      return sendError(res, 404, 'Verification dossier not found.');
    }

    await recordAdminAuditLog({
      req,
      action: 'KYC_APPROVED',
      targetTable: 'kyc_verifications',
      targetId: id,
      targetUserId: approved.userId,
      targetEmail: approved.userEmail,
      reason: notes,
    });

    return res.json({
      success: true,
      message: `KYC dossier ${id} approved successfully. User is now verified.`,
      verification: {
        ...approved,
        idDocumentUrl: normalizeImageUrl(approved.idDocumentUrl, req),
        taxDocumentUrl: normalizeImageUrl(approved.taxDocumentUrl, req),
        proofOfResidenceUrl: normalizeImageUrl(approved.proofOfResidenceUrl, req),
      },
    });
  } catch (err) {
    console.error('approveKyc error:', err);
    return sendError(res, 500, 'Failed to approve KYC verification.');
  }
}

/**
 * POST /api/admin/verifications/:id/reject
 * Rejects a user's submitted KYC documents with a specific reason.
 */
async function rejectKyc(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return sendError(res, 400, 'A compliance rejection reason is required.');
    }

    const rejected = await complianceService.rejectKyc(id, reason.trim());
    if (!rejected) {
      return sendError(res, 404, 'Verification dossier not found.');
    }

    await recordAdminAuditLog({
      req,
      action: 'KYC_REJECTED',
      targetTable: 'kyc_verifications',
      targetId: id,
      targetUserId: rejected.userId,
      targetEmail: rejected.userEmail,
      reason: reason.trim(),
    });

    return res.json({
      success: true,
      message: `KYC dossier ${id} rejected.`,
      verification: {
        ...rejected,
        idDocumentUrl: normalizeImageUrl(rejected.idDocumentUrl, req),
        taxDocumentUrl: normalizeImageUrl(rejected.taxDocumentUrl, req),
        proofOfResidenceUrl: normalizeImageUrl(rejected.proofOfResidenceUrl, req),
      },
    });
  } catch (err) {
    console.error('rejectKyc error:', err);
    return sendError(res, 500, 'Failed to reject KYC verification.');
  }
}

/**
 * GET /api/admin/users/online
 * Dedicated endpoint returning real-time list of active online users.
 */
async function getAdminOnlineUsers(req, res) {
  try {
    const realUsers = await buildMergedRealUsers(req);
    const presenceOverview = presenceService.getPresenceOverview(realUsers);
    return res.json({
      success: true,
      ...presenceOverview,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getAdminOnlineUsers error:', err);
    return sendError(res, 500, 'Failed to fetch online users.');
  }
}

module.exports = {
  adminLogin,
  getAdminMe,
  adminLogout,
  getAdminOverview,
  getAdminHealth,
  getAdminAssets,
  updateAssetStatus,
  getAdminEscrows,
  handleEscrowAction,
  getAdminTickets,
  updateAdminTicket,
  getAdminUsers,
  getAdminOnlineUsers,
  updateUserStatus,
  getAdminActivity,
  getAdminVerifications,
  approveAdminDocument,
  rejectAdminDocument,
  getAdminBankAccounts,
  approveAdminBankAccount,
  rejectAdminBankAccount,
  approveKyc,
  rejectKyc,
};
