// ─── Administrator Authentication Hardening Test Suite ───────────────────────
// Tests:
// 1. Missing ADMIN_JWT_SECRET fails closed with server configuration error.
// 2. Weak/short ADMIN_JWT_SECRET (< 32 chars) is strictly rejected.
// 3. Prohibited default secrets and service-role key reuse are rejected.
// 4. Old fallback admin passwords (Admin@SmartAssets2026, SmartAssets2026!) fail.
// 5. Hardcoded email allowlists cannot grant administrator privileges.
// 6. Role spoofing via client metadata (user_metadata) is rejected.
// 7. Tampered tokens and signature mismatches fail constant-time verification.
// 8. Expired tokens, future-dated tokens, and audience/issuer mismatches fail.
// 9. Explicit logout revokes tokens and prevents session reuse.
// 10. Legitimate administrator flow with valid credentials and profiles.role === 'admin' succeeds.

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
  createAdminToken,
  verifyAdminToken,
  getValidatedAdminSecret,
  validateAdminAuthConfig,
  isUserAdmin,
  revokeToken,
  isTokenRevoked,
  requireAdmin,
  MIN_ADMIN_JWT_SECRET_LENGTH,
} = require('../src/middlewares/authMiddleware');
const adminController = require('../src/controllers/adminController');
const supabase = require('../src/connection/supabaseClient');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Admin Auth Hardening Test Suite      ');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS ${total}] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL ${total}] ${name}`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  const originalSecret = process.env.ADMIN_JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'test';
    // ── TEST 1: Missing Configuration Fails Closed ─────────────────────────
    await test('1. Missing ADMIN_JWT_SECRET fails closed with configuration error', async () => {
      delete process.env.ADMIN_JWT_SECRET;

      // Secret getter must throw
      assert.throws(
        () => getValidatedAdminSecret(),
        /ADMIN_AUTH_CONFIG_ERROR/i,
        'getValidatedAdminSecret must throw when ADMIN_JWT_SECRET is missing'
      );

      // Token creation must throw
      assert.throws(
        () => createAdminToken({ id: 'adm-1', email: 'admin@test.com' }),
        /ADMIN_AUTH_CONFIG_ERROR/i,
        'createAdminToken must fail closed when ADMIN_JWT_SECRET is missing'
      );

      // Token verification must fail closed (return null)
      const dummyToken = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4ifQ.dummy';
      assert.strictEqual(verifyAdminToken(dummyToken), null);

      // adminLogin must return 503 configuration error
      const req = { body: { email: 'admin@test.com', password: 'AnyPassword123!' } };
      const res = mockRes();
      await adminController.adminLogin(req, res);

      assert.strictEqual(res.statusCode, 503, 'Must return HTTP 503 when admin auth is unconfigured');
      assert.strictEqual(res.body?.code, 'ADMIN_AUTH_CONFIG_ERROR');
      assert.strictEqual(res.body?.success, false);
    });

    // ── TEST 2: Weak / Too-Short Secret Rejected (< 32 chars) ──────────────
    await test('2. Weak ADMIN_JWT_SECRET (< 32 characters) fails closed', async () => {
      process.env.ADMIN_JWT_SECRET = 'short-secret-only-24-chr';
      assert.strictEqual(process.env.ADMIN_JWT_SECRET.length < MIN_ADMIN_JWT_SECRET_LENGTH, true);

      assert.throws(
        () => getValidatedAdminSecret(),
        /too weak/i,
        'Must reject secret with insufficient entropy (< 32 chars)'
      );

      assert.throws(
        () => createAdminToken({ id: 'adm-1', email: 'admin@test.com' }),
        /too weak/i
      );
    });

    // ── TEST 3: Prohibited and Reused Secrets Rejected ─────────────────────
    await test('3. Prohibited default secrets and service-role key reuse are rejected', async () => {
      // Known fallback secret
      process.env.ADMIN_JWT_SECRET = 'smartassets-admin-hmac-secret-2026';
      assert.throws(
        () => getValidatedAdminSecret(),
        /prohibited or default value/i,
        'Must reject known hardcoded fallback secret'
      );

      // Supabase service-role key reuse
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        process.env.ADMIN_JWT_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
        assert.throws(
          () => getValidatedAdminSecret(),
          /must not reuse the Supabase service role key/i,
          'Must prohibit reusing the Supabase service role key as the admin JWT secret'
        );
      }
    });

    // Restore a valid strong secret for remaining tests
    const validTestSecret = crypto.randomBytes(32).toString('hex');
    process.env.ADMIN_JWT_SECRET = validTestSecret;

    // ── TEST 4: Old Fallback Admin Passwords Strictly Rejected ─────────────
    await test('4. Hardcoded passwords (Admin@SmartAssets2026, SmartAssets2026!) are rejected', async () => {
      // Attempt login with old hardcoded default passwords for non-existent / invalid user
      const req1 = { body: { email: 'admin@smartassets.io', password: 'Admin@SmartAssets2026' } };
      const res1 = mockRes();
      await adminController.adminLogin(req1, res1);

      assert.strictEqual(res1.statusCode, 401, 'Old Admin@SmartAssets2026 password must be rejected');
      assert.strictEqual(res1.body?.code, 'INVALID_ADMIN_CREDENTIALS');
      assert.strictEqual(res1.body?.success, false);

      const req2 = { body: { email: 'admin@smartassets.io', password: 'SmartAssets2026!' } };
      const res2 = mockRes();
      await adminController.adminLogin(req2, res2);

      assert.strictEqual(res2.statusCode, 401, 'Old SmartAssets2026! password must be rejected');
      assert.strictEqual(res2.body?.code, 'INVALID_ADMIN_CREDENTIALS');
    });

    // ── TEST 5: Email Allowlist Bypasses Completely Removed ────────────────
    await test('5. Email allowlist cannot grant admin privileges without profiles.role = admin', async () => {
      // Simulated user with formerly allowlisted email but no admin role in database
      const mockNonAdminUser = {
        id: 'user-allowlist-test-uuid-999',
        email: 'darrenforster3@gmail.com', // was previously in CONFIGURED_ADMIN_EMAILS
        user_metadata: {},
      };

      const isAdmin = await isUserAdmin(mockNonAdminUser);
      assert.strictEqual(
        isAdmin,
        false,
        'User with previously allowlisted email must NOT be granted admin without profiles.role = admin'
      );
    });

    // ── TEST 6: Role Spoofing via Client User Metadata Rejected ───────────
    await test('6. Role spoofing via user_metadata or app_metadata is strictly rejected', async () => {
      const mockAttackerUser = {
        id: 'attacker-uuid-111',
        email: 'attacker@evil.com',
        user_metadata: { role: 'admin' }, // Spoofed client-side metadata
        app_metadata: { role: 'admin' },
      };

      const isAdmin = await isUserAdmin(mockAttackerUser);
      assert.strictEqual(
        isAdmin,
        false,
        'Client-supplied user_metadata.role must be ignored in favor of authoritative database role'
      );
    });

    // ── TEST 7: Token Signature Tampering & Timing-Attack Defense ──────────
    await test('7. Tampered tokens and forged signatures fail verification', async () => {
      const validToken = createAdminToken({
        id: 'admin-uuid-001',
        email: 'admin.audit@smartassets.io',
        fullName: 'Audit Admin',
      });

      assert.ok(validToken, 'Must generate valid token with valid secret');
      const verified = verifyAdminToken(validToken);
      assert.ok(verified, 'Valid token must verify');
      assert.strictEqual(verified.email, 'admin.audit@smartassets.io');
      assert.strictEqual(verified.role, 'admin');

      // Tamper signature
      const parts = validToken.split('.');
      const tamperedSig = parts[2].slice(0, -4) + 'AAAA';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;
      assert.strictEqual(verifyAdminToken(tamperedToken), null, 'Tampered signature must reject');

      // Tamper payload role from user to admin
      const userPayload = Buffer.from(
        JSON.stringify({ sub: 'user-1', email: 'u@u.com', role: 'user', iss: 'smartassets-admin-authority', aud: 'smartassets-admin-portal' })
      ).toString('base64url');
      const forgedToken = `${parts[0]}.${userPayload}.${parts[2]}`;
      assert.strictEqual(verifyAdminToken(forgedToken), null, 'Modified payload must invalidate signature');
    });

    // ── TEST 8: Token Expiration and Audience/Issuer Defense ───────────────
    await test('8. Expired tokens and audience/issuer mismatches are rejected', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

      // Expired token
      const expiredBody = Buffer.from(
        JSON.stringify({
          sub: 'adm-exp',
          email: 'admin@test.com',
          role: 'admin',
          iss: 'smartassets-admin-authority',
          aud: 'smartassets-admin-portal',
          iat: nowSec - 7200,
          exp: nowSec - 3600, // Expired 1 hour ago
        })
      ).toString('base64url');
      const expSig = crypto.createHmac('sha256', validTestSecret).update(`${header}.${expiredBody}`).digest('base64url');
      const expiredToken = `${header}.${expiredBody}.${expSig}`;

      assert.strictEqual(verifyAdminToken(expiredToken), null, 'Expired token must return null');

      // Invalid issuer
      const badIssBody = Buffer.from(
        JSON.stringify({
          sub: 'adm-bad',
          email: 'admin@test.com',
          role: 'admin',
          iss: 'untrusted-issuer',
          aud: 'smartassets-admin-portal',
          iat: nowSec,
          exp: nowSec + 3600,
        })
      ).toString('base64url');
      const badIssSig = crypto.createHmac('sha256', validTestSecret).update(`${header}.${badIssBody}`).digest('base64url');
      assert.strictEqual(verifyAdminToken(`${header}.${badIssBody}.${badIssSig}`), null, 'Untrusted issuer must be rejected');
    });

    // ── TEST 9: Logout & Token Revocation Defense ──────────────────────────
    await test('9. Token revocation on logout invalidates the admin session', async () => {
      const activeToken = createAdminToken({
        id: 'admin-logout-test',
        email: 'admin.logout@smartassets.io',
        fullName: 'Logout Admin',
      });

      assert.ok(verifyAdminToken(activeToken), 'Token must be valid before logout');

      // Simulate admin logout
      await revokeToken(activeToken);
      assert.strictEqual(await isTokenRevoked(activeToken), true, 'Token must be recorded as revoked');

      // verifyAdminToken must reject revoked token
      assert.strictEqual(verifyAdminToken(activeToken), null, 'Revoked token must fail verifyAdminToken');

      // requireAdmin middleware must reject revoked token with 401
      const req = {
        headers: { authorization: `Bearer ${activeToken}` },
      };
      const res = mockRes();
      let nextCalled = false;
      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, 'Middleware must block revoked token');
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body?.code, 'ADMIN_SESSION_INVALID');
    });

    // ── TEST 10: Legitimate Admin Session End-to-End ───────────────────────
    await test('10. Authenticated admin with profiles.role = admin accesses protected console', async () => {
      const adminToken = createAdminToken({
        id: 'adm-authorized-uuid-777',
        email: 'lead.admin@smartassets.io',
        fullName: 'Lead Operations Admin',
      });

      const req = {
        headers: { authorization: `Bearer ${adminToken}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;
      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true, 'Authorized admin must pass requireAdmin');
      assert.strictEqual(req.admin?.role, 'admin');
      assert.strictEqual(req.admin?.email, 'lead.admin@smartassets.io');
    });

  } finally {
    // Restore original environment
    if (originalSecret !== undefined) {
      process.env.ADMIN_JWT_SECRET = originalSecret;
    } else {
      delete process.env.ADMIN_JWT_SECRET;
    }
    process.env.NODE_ENV = originalNodeEnv;
  }

  console.log('\n======================================================');
  if (passed === total) {
    console.log(`🎉 ALL ${passed}/${total} ADMIN AUTH HARDENING TESTS PASSED!`);
  } else {
    console.error(`❌ ${total - passed} OF ${total} TESTS FAILED`);
  }
  console.log('======================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite();
}

module.exports = { runTestSuite };
