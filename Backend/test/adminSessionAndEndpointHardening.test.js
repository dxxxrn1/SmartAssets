// ─── SmartAssets Admin Sessions & Endpoint Hardening Test Suite ──────────────
// Tests:
// 1. Authoritative DB Role Recheck: Denies admin request if DB role is revoked (e.g. demoted to 'user')
//    even when signed token is unexpired.
// 2. Suspended / Disabled Admin Check: Denies request if DB profile has is_suspended=true or status='suspended'.
// 3. Fail-Closed on DB Outages: DB role lookup errors immediately fail closed with HTTP 500.
// 4. Durable Revocation Across Restarts: Revocation remains effective after simulated restart (clearing memory cache).
// 5. Raw Token Never Persisted: Verifies only SHA-256 cryptographic hash is stored in durable revocation ledger.
// 6. Fail-Closed on Revocation Outage: Outage of revocation store denies protected requests with HTTP 503.
// 7. Rate Limiter Dual-Key Defense: Admin login rate limiter activates on repeated attempts with standard headers.
// 8. Legitimate Traffic Within Limits: Unthrottled traffic succeeds; /api/health is never blocked.
// 9. HTTP Security Headers: Verified on API responses, /admin, and /verify/:id.
// 10. Strict CORS Policy: Permits configured production origins; strictly rejects unconfigured origins without wildcard credentials.
// 11. Helmet CSP Compatibility: Directives permit Google Fonts, inline scripts/styles for Admin & Verify pages.

const assert = require('assert');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Ensure test environment
process.env.NODE_ENV = 'test';
if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32) {
  process.env.ADMIN_JWT_SECRET = 'smartassets-test-admin-secret-256bits-long-key-for-unit-testing';
}
process.env.CORS_ALLOWED_ORIGINS = 'https://app.smartassets.io,https://admin.smartassets.io';

const app = require('../src/main');
const {
  createAdminToken,
  verifyAdminToken,
  requireAdmin,
  revokeToken,
  isTokenRevoked,
  _setTestProfileResolver,
} = require('../src/middlewares/authMiddleware');

const tokenRevocationService = require('../src/services/tokenRevocationService');

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
    setHeader(name, val) {
      this.headers[name.toLowerCase()] = val;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  return res;
}

// Helper to make real HTTP requests against Express app
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBody: data,
          body: json,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Admin Session & Endpoint Hardening   ');
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

  // Start test server on random port
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    // ── TEST 1: Mid-Session Demotion / Revocation of Admin Role in DB ─────────
    await test('1. Admin request denied when database role is demoted, even with valid token', async () => {
      const validToken = createAdminToken({
        id: 'user-demoted-uuid-1234',
        email: 'demoted.admin@smartassets.io',
        fullName: 'Former Admin',
      });

      // Token itself is cryptographically valid
      assert.ok(verifyAdminToken(validToken), 'Token signature must be valid');

      // But authoritative database role has been changed to 'user'
      _setTestProfileResolver(async (userId) => {
        if (userId === 'user-demoted-uuid-1234') {
          return {
            id: 'user-demoted-uuid-1234',
            email: 'demoted.admin@smartassets.io',
            role: 'user', // Demoted!
            is_suspended: false,
            status: 'active',
          };
        }
        return null;
      });

      const req = {
        headers: { authorization: `Bearer ${validToken}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;

      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, 'Demoted admin must NOT reach next handler');
      assert.strictEqual(res.statusCode, 403, 'Must return HTTP 403 Forbidden');
      assert.strictEqual(res.body?.code, 'ADMIN_ACCESS_DENIED');
      _setTestProfileResolver(null);
    });

    // ── TEST 2: Suspended Admin Account Fails Closed ─────────────────────────
    await test('2. Admin request denied when admin account is suspended or disabled in database', async () => {
      const validToken = createAdminToken({
        id: 'user-suspended-uuid-5678',
        email: 'suspended.admin@smartassets.io',
        fullName: 'Suspended Admin',
      });

      _setTestProfileResolver(async (userId) => {
        if (userId === 'user-suspended-uuid-5678') {
          return {
            id: 'user-suspended-uuid-5678',
            email: 'suspended.admin@smartassets.io',
            role: 'admin',
            is_suspended: true, // Suspended by compliance!
            status: 'suspended',
          };
        }
        return null;
      });

      const req = {
        headers: { authorization: `Bearer ${validToken}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;

      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, 'Suspended admin must NOT reach next handler');
      assert.strictEqual(res.statusCode, 403, 'Must return HTTP 403 Forbidden');
      assert.strictEqual(res.body?.code, 'ADMIN_ACCOUNT_SUSPENDED');
      _setTestProfileResolver(null);
    });

    // ── TEST 3: Database Role Lookup Errors Fail Closed ───────────────────────
    await test('3. Database role lookup error immediately fails closed (500)', async () => {
      const validToken = createAdminToken({
        id: 'user-db-error-uuid-9999',
        email: 'error.admin@smartassets.io',
      });

      _setTestProfileResolver(async () => {
        throw new Error('PostgreSQL connection timeout: connection terminated unexpectedly');
      });

      const req = {
        headers: { authorization: `Bearer ${validToken}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;

      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, 'DB error must NOT reach next handler');
      assert.strictEqual(res.statusCode, 500, 'Must return HTTP 500 on database error');
      assert.strictEqual(res.body?.code, 'ADMIN_AUTH_CHECK_FAILED');
      _setTestProfileResolver(null);
    });

    // ── TEST 4: Durable Revocation Survives Process Restart ──────────────────
    await test('4. Revocation remains effective after simulated restart (in-memory cache cleared)', async () => {
      const token = createAdminToken({
        id: 'user-restart-test-uuid',
        email: 'restart.admin@smartassets.io',
      });

      // Revoke the token
      const revokeResult = await revokeToken(token, {
        userId: 'user-restart-test-uuid',
        reason: 'test_logout',
      });
      assert.strictEqual(revokeResult.success, true, 'Revocation write must succeed');

      // Clear in-memory hot cache to simulate server restart or lookup from another cluster instance
      tokenRevocationService._clearLocalCache();
      assert.strictEqual(tokenRevocationService._getLocalCacheSize(), 0, 'Cache must be empty');

      // Query revocation: must retrieve from durable store
      const isRev = await isTokenRevoked(token);
      assert.strictEqual(isRev, true, 'Token must be recognized as revoked from durable store');

      // Protected admin middleware must block the request
      const req = {
        headers: { authorization: `Bearer ${token}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;

      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, 'Revoked token must be blocked');
      assert.strictEqual(res.statusCode, 401, 'Must return 401');
      assert.strictEqual(res.body?.code, 'ADMIN_SESSION_INVALID');
    });

    // ── TEST 5: Raw Token Is Never Persisted ─────────────────────────────────
    await test('5. Raw bearer token is never persisted in revocation store (only SHA-256 hash)', async () => {
      const sensitiveToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload_string.secret_sig';
      const expectedHash = tokenRevocationService.hashToken(sensitiveToken);

      const capturedEntries = [];
      tokenRevocationService._setCustomStore({
        insert: async (entry) => {
          capturedEntries.push(entry);
        },
        isRevoked: async () => false,
      });

      await revokeToken(sensitiveToken, { reason: 'audit_test' });

      tokenRevocationService._setCustomStore(null);

      assert.strictEqual(capturedEntries.length, 1);
      const entry = capturedEntries[0];

      // Must store hash
      assert.strictEqual(entry.token_hash, expectedHash, 'token_hash must match SHA-256');
      // Must NOT contain raw token anywhere in record
      const serialized = JSON.stringify(entry);
      assert.strictEqual(serialized.includes(sensitiveToken), false, 'Raw token must NEVER appear in record');
    });

    // ── TEST 6: Revocation Store Outage Fails Closed (503) ───────────────────
    await test('6. Revocation store outage fails closed and denies protected requests (503)', async () => {
      const token = createAdminToken({
        id: 'user-outage-uuid',
        email: 'outage.admin@smartassets.io',
      });

      tokenRevocationService._clearLocalCache();
      tokenRevocationService._setCustomStore({
        isRevoked: async () => {
          throw new Error('Database cluster network partition');
        },
      });

      const req = {
        headers: { authorization: `Bearer ${token}` },
        originalUrl: '/api/admin/overview',
      };
      const res = mockRes();
      let nextCalled = false;

      await requireAdmin(req, res, () => {
        nextCalled = true;
      });

      tokenRevocationService._setCustomStore(null);

      assert.strictEqual(nextCalled, false, 'Outage must not allow request');
      assert.strictEqual(res.statusCode, 503, 'Must return HTTP 503 Service Unavailable');
      assert.strictEqual(res.body?.code, 'REVOCATION_STORE_UNAVAILABLE');
    });

    // ── TEST 7: Rate Limiting Activates on Sensitive Endpoints ───────────────
    await test('7. Rate limit activates for repeated login attempts and returns standard headers', async () => {
      const email = `brute.force.${Date.now()}@smartassets.io`;
      let lastRes = null;

      // Exhaust login attempts
      for (let i = 0; i < 11; i++) {
        lastRes = await makeRequest(
          server,
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/admin/auth/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': '198.51.100.42', // Isolated test IP
            },
          },
          { email, password: 'wrong-password' }
        );
      }

      assert.strictEqual(lastRes.statusCode, 429, '11th attempt must trigger HTTP 429');
      assert.strictEqual(lastRes.body?.code, 'RATE_LIMIT_EXCEEDED');
      // Verify rate-limit headers (Draft-7)
      assert.ok(
        lastRes.headers['ratelimit-limit'] || lastRes.headers['retry-after'],
        'Standard RateLimit headers must be present'
      );
    });

    // ── TEST 8: Legitimate Traffic Usable & Health Checks Unthrottled ─────────
    await test('8. Legitimate traffic succeeds within limits and health checks are unthrottled', async () => {
      // Health check endpoint /api/health
      for (let i = 0; i < 5; i++) {
        const res = await makeRequest(server, {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          method: 'GET',
        });
        assert.strictEqual(res.statusCode, 200, '/api/health must return 200');
        assert.strictEqual(res.body?.status, 'ok');
      }
    });

    // ── TEST 9: HTTP Security Headers Present on API, /admin, and /verify ──────
    await test('9. Security headers present on API, /admin, and /verify/:id', async () => {
      // 1. API route
      const apiRes = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
      });
      assert.strictEqual(apiRes.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(apiRes.headers['x-frame-options'], 'DENY');
      assert.ok(apiRes.headers['referrer-policy'], 'Referrer policy must be set');
      assert.ok(apiRes.headers['content-security-policy'], 'CSP must be present on API');

      // 2. /admin static console
      const adminRes = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/admin/login.html',
        method: 'GET',
      });
      assert.strictEqual(adminRes.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(adminRes.headers['x-frame-options'], 'DENY');
      assert.ok(adminRes.headers['content-security-policy'], 'CSP must be present on /admin');

      // 3. /verify/:id public portal
      const verifyRes = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/verify/asset-sample-123',
        method: 'GET',
      });
      assert.strictEqual(verifyRes.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(verifyRes.headers['x-frame-options'], 'DENY');
      assert.ok(verifyRes.headers['content-security-policy'], 'CSP must be present on /verify');
    });

    // ── TEST 10: CORS Enforces Configured Origins & Blocks Unconfigured ─────
    await test('10. CORS allows configured production origins and rejects unconfigured origins', async () => {
      // Configured origin in CORS_ALLOWED_ORIGINS
      const allowedRes = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'https://app.smartassets.io' },
      });
      assert.strictEqual(
        allowedRes.headers['access-control-allow-origin'],
        'https://app.smartassets.io',
        'Configured origin must be reflected'
      );
      assert.strictEqual(
        allowedRes.headers['access-control-allow-credentials'],
        'true',
        'Credentials must be allowed for configured origin'
      );

      // Unconfigured malicious origin
      const deniedRes = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'https://malicious-phishing-site.com' },
      });
      assert.strictEqual(
        deniedRes.headers['access-control-allow-origin'],
        undefined,
        'Unconfigured origin must NOT receive access-control-allow-origin header'
      );
    });

    // ── TEST 11: Helmet CSP Compatible with Admin & Verify Assets ───────────
    await test('11. Helmet CSP policy directives allow Google Fonts, inline scripts/styles', async () => {
      const res = await makeRequest(server, {
        hostname: '127.0.0.1',
        port,
        path: '/admin/login.html',
        method: 'GET',
      });

      const csp = res.headers['content-security-policy'] || '';
      assert.ok(csp.includes("'unsafe-inline'"), "CSP must permit 'unsafe-inline' for admin UI script/style blocks");
      assert.ok(csp.includes('fonts.googleapis.com'), 'CSP must permit fonts.googleapis.com');
      assert.ok(csp.includes('fonts.gstatic.com'), 'CSP must permit fonts.gstatic.com');
      assert.ok(csp.includes("frame-ancestors 'none'"), "CSP must enforce frame-ancestors 'none'");
    });

  } finally {
    server.close();
  }

  console.log('\n======================================================');
  if (passed === total) {
    console.log(`🎉 ALL ${passed}/${total} ADMIN SESSION & ENDPOINT HARDENING TESTS PASSED!`);
  } else {
    console.error(`❌ ${total - passed} OF ${total} TESTS FAILED`);
  }
  console.log('======================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
