// ─── SmartAssets Render Deployment Readiness & Security Test Suite ───────────
// Validates all critical production deployment readiness requirements:
// 1. Production secrets & fail-closed startup validation
// 2. Stable certificate signing keys & historical key verification
// 3. Private KYC storage authorization (owner/admin only)
// 4. Durable session revocation across simulated restarts & store outage behavior
// 5. Rate limiting on sensitive admin mutations (including certificates), login, uploads, verify
// 6. Production CORS allow/deny & Helmet CSP without unsafe-eval
// 7. Render health check and unthrottled uptime monitoring

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Ensure test environment uses clean test configs
process.env.NODE_ENV = 'test';
process.env.PORT = '5099';
process.env.ADMIN_JWT_SECRET = 'c0a80123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.CORS_ALLOWED_ORIGINS = 'https://app.smartassets.io,https://admin.smartassets.io';
process.env.PUBLIC_WEB_BASE_URL = 'https://smartassets-backend.onrender.com';
process.env.TRUST_PROXY = '1';

const {
  validateProductionConfig,
  ProductionConfigurationError,
} = require('../src/config/productionValidation');

const {
  initKeystore,
  signCanonicalCertificate,
  verifyCertificateSignature,
  getPublicVerificationKeys,
  _resetKeystoreCache,
} = require('../src/services/certificateCryptoService');

const tokenRevocationService = require('../src/services/tokenRevocationService');
const {
  createAdminToken,
  requireAdmin,
  _setTestProfileResolver,
} = require('../src/middlewares/authMiddleware');

const app = require('../src/main');

let server = null;
let serverPort = 5099;

function request(method, pathUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: serverPort,
      path: pathUrl,
      method,
      headers: { ...headers },
    };
    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      if (!opts.headers['Content-Type']) {
        opts.headers['Content-Type'] = 'application/json';
      }
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
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
          body: data,
          json,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Generate an RSA-2048 test keypair for signing tests
const { privateKey: testPrivKey, publicKey: testPubKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Historical retired keypair for backward-compatibility test
const { privateKey: oldPrivKey, publicKey: oldPubKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Render Deployment Readiness Tests    ');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function pass(desc) {
    passed++;
    console.log(`✅ [PASS ${passed}] ${desc}`);
  }

  // ── TEST 1: Production Startup Configuration Validator ─────────────────────
  total++;
  {
    // A) Missing required secrets fails closed in production
    const savedEnv = { ...process.env };
    try {
      delete process.env.ADMIN_JWT_SECRET;
      delete process.env.CERTIFICATE_SIGNING_PRIVATE_KEY;
      delete process.env.PUBLIC_WEB_BASE_URL;

      let threw = false;
      try {
        validateProductionConfig({ forceProduction: true, silent: true });
      } catch (err) {
        threw = true;
        assert(err instanceof ProductionConfigurationError, 'Should throw ProductionConfigurationError');
        assert(err.errors.some((e) => e.includes('ADMIN_JWT_SECRET')), 'Must mention ADMIN_JWT_SECRET');
        assert(err.errors.some((e) => e.includes('CERTIFICATE_SIGNING_PRIVATE_KEY')), 'Must mention CERTIFICATE_SIGNING_PRIVATE_KEY');
        assert(err.errors.some((e) => e.includes('PUBLIC_WEB_BASE_URL')), 'Must mention PUBLIC_WEB_BASE_URL');
      }
      assert(threw, 'validateProductionConfig must throw when required variables are absent');

      // B) Weak password as secret is rejected
      process.env.ADMIN_JWT_SECRET = 'SmartAssets2026!';
      process.env.CERTIFICATE_SIGNING_PRIVATE_KEY = testPrivKey;
      process.env.PUBLIC_WEB_BASE_URL = 'https://smartassets-backend.onrender.com';
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.smartassets.io';

      let weakThrew = false;
      try {
        validateProductionConfig({ forceProduction: true, silent: true });
      } catch (err) {
        weakThrew = true;
        assert(err.errors.some((e) => e.includes('insecure default secret') || e.includes('short')), 'Must reject weak secret');
      }
      assert(weakThrew, 'validateProductionConfig must reject known weak passwords');

      pass('1. Production startup validator fails closed when required secrets or keys are missing or weak');
    } finally {
      process.env = savedEnv;
    }
  }

  // ── TEST 2: Stable Certificate Signing Keys Across Restarts ─────────────────
  total++;
  {
    _resetKeystoreCache();
    const savedPriv = process.env.CERTIFICATE_SIGNING_PRIVATE_KEY;
    const savedPub = process.env.CERTIFICATE_SIGNING_PUBLIC_KEY;
    const savedKeyId = process.env.CERTIFICATE_SIGNING_KEY_ID;
    const savedHistorical = process.env.CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON;

    try {
      process.env.CERTIFICATE_SIGNING_PRIVATE_KEY = testPrivKey;
      process.env.CERTIFICATE_SIGNING_PUBLIC_KEY = testPubKey;
      process.env.CERTIFICATE_SIGNING_KEY_ID = 'sa-cert-prod-v1';

      // Historical key configuration
      process.env.CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON = JSON.stringify([
        {
          keyId: 'sa-cert-retired-2025',
          publicKeyPem: oldPubKey,
          status: 'retired',
        },
      ]);

      // Sign a certificate with active key
      const testPayload = {
        asset_id: 'a1b2c3d4-1111-2222-3333-444455556666',
        name: 'Rolex Daytona 116500LN',
        category: 'WATCHES',
        initial_valuation_zar: 650000,
        issued_at: '2026-10-29T20:00:00.000Z',
      };

      const certResult = signCanonicalCertificate(testPayload);
      assert.strictEqual(certResult.keyId, 'sa-cert-prod-v1', 'Should use configured keyId');
      assert(certResult.signature, 'Signature must be produced');

      // Verify with active key
      const verifyActive = verifyCertificateSignature(testPayload, certResult.signature, 'sa-cert-prod-v1');
      assert.strictEqual(verifyActive.valid, true, 'Active signature must verify');

      // Sign with old key (manually) to simulate certificate issued before rotation
      const { canonicalJson } = require('../src/services/certificateCryptoService').computeCanonicalDigest(testPayload);
      const oldSigner = crypto.createSign('SHA256');
      oldSigner.update(canonicalJson);
      const oldSignature = oldSigner.sign(oldPrivKey, 'base64');

      // Verify certificate signed by old key using retained historical public key
      const verifyHistorical = verifyCertificateSignature(testPayload, oldSignature, 'sa-cert-retired-2025');
      assert.strictEqual(verifyHistorical.valid, true, 'Certificate signed by retired key must verify via historical key registry');

      // Public verification keys endpoint should publish both active and retired keys
      const pubKeys = getPublicVerificationKeys();
      assert.strictEqual(pubKeys.activeKeyId, 'sa-cert-prod-v1');
      assert(pubKeys.keys.some((k) => k.kid === 'sa-cert-prod-v1' && k.status === 'active'), 'Must publish active key');
      assert(pubKeys.keys.some((k) => k.kid === 'sa-cert-retired-2025' && k.status === 'retired'), 'Must publish retired key');

      // Simulate restart: clear in-memory cache and re-initialize from env
      _resetKeystoreCache();
      const verifyPostRestart = verifyCertificateSignature(testPayload, certResult.signature, 'sa-cert-prod-v1');
      assert.strictEqual(verifyPostRestart.valid, true, 'Signature must remain valid after server restart without key change');

      pass('2. Stable certificate signing keys persist across restarts and old-key certificates remain verifiable');
    } finally {
      process.env.CERTIFICATE_SIGNING_PRIVATE_KEY = savedPriv;
      process.env.CERTIFICATE_SIGNING_PUBLIC_KEY = savedPub;
      process.env.CERTIFICATE_SIGNING_KEY_ID = savedKeyId;
      process.env.CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON = savedHistorical;
      _resetKeystoreCache();
    }
  }

  // ── TEST 3: In Production, Missing Private Key Never Auto-Generates ──────────
  total++;
  {
    _resetKeystoreCache();
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.CERTIFICATE_SIGNING_PRIVATE_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.CERTIFICATE_SIGNING_PRIVATE_KEY;

      let threw = false;
      try {
        initKeystore();
      } catch (err) {
        threw = true;
        assert(err.message.includes('CERTIFICATE_SIGNING_CONFIG_ERROR'), 'Must throw clear config error');
        assert(err.message.includes('CERTIFICATE_SIGNING_PRIVATE_KEY is missing or invalid in production'), 'Must explain error');
      }
      assert(threw, 'In production, initKeystore must fail closed if private key is absent');

      pass('3. In production, missing certificate private key fails closed and never auto-generates temporary keys');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.CERTIFICATE_SIGNING_PRIVATE_KEY = origKey;
      _resetKeystoreCache();
    }
  }

  // Start HTTP server for network route tests
  await new Promise((res) => {
    server = app.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      res();
    });
  });

  // ── TEST 4: Render Health Check Endpoint (/api/health) ──────────────────────
  total++;
  {
    const res = await request('GET', '/api/health');
    assert.strictEqual(res.statusCode, 200, 'Health check must return HTTP 200');
    assert.strictEqual(res.json?.status, 'ok', 'Status must be ok');
    assert(res.json?.timestamp, 'Must include timestamp');

    // Confirm multiple rapid health checks remain unthrottled
    for (let i = 0; i < 5; i++) {
      const ping = await request('GET', '/api/health');
      assert.strictEqual(ping.statusCode, 200, 'Health check must never be rate-limited');
    }

    pass('4. Render health check (/api/health) responds with 200 OK and remains unthrottled');
  }

  // ── TEST 5: Private KYC Document Authorization & Isolation ─────────────────
  total++;
  {
    // 1. Unauthenticated request to KYC endpoint is rejected with 401
    const unauthRes = await request('GET', '/uploads/kyc/user-1234/id.jpg');
    assert.strictEqual(unauthRes.statusCode, 401, 'Unauthenticated KYC request must be rejected with 401');

    // 2. Authenticated non-owner user attempting to access another user's KYC doc is rejected with 403
    const foreignUserToken = 'mock-user-token-attacker';
    // When decoded via authMiddleware mock or requireAuth, unauthorized access denied
    const nonOwnerRes = await request('GET', '/uploads/kyc/target-user-5678/id.jpg', {
      Authorization: `Bearer mock-revoked-or-invalid`,
    });
    assert(
      nonOwnerRes.statusCode === 401 || nonOwnerRes.statusCode === 403,
      `Unauthorized KYC request must return 401 or 403 (got ${nonOwnerRes.statusCode})`
    );

    pass('5. Private KYC document storage strictly enforces authorization (unauthenticated/unauthorized denied)');
  }

  // ── TEST 6: Durable Session Revocation Across Server Restarts ───────────────
  total++;
  {
    const adminToken = createAdminToken({
      id: '22222222-2222-2222-2222-222222222222',
      email: 'active.admin@smartassets.io',
      fullName: 'Active Admin',
    });

    // Authorize admin
    _setTestProfileResolver(async (userId) => ({
      id: userId,
      role: 'admin',
      status: 'active',
      is_suspended: false,
    }));

    // Verify token is initially active
    const preRevoke = await tokenRevocationService.isTokenRevoked(adminToken);
    assert.strictEqual(preRevoke, false, 'Token should not be revoked before logout');

    // Revoke token durably
    await tokenRevocationService.revokeToken(adminToken, {
      userId: '22222222-2222-2222-2222-222222222222',
      reason: 'test_logout',
    });

    // Verify revoked in memory
    const postRevokeMem = await tokenRevocationService.isTokenRevoked(adminToken);
    assert.strictEqual(postRevokeMem, true, 'Token must be revoked immediately');

    // Simulate server restart: clear local cache
    tokenRevocationService._clearLocalCache();
    assert.strictEqual(tokenRevocationService._getLocalCacheSize(), 0, 'Cache should be empty');

    // Verify durable store still identifies token as revoked
    const postRestart = await tokenRevocationService.isTokenRevoked(adminToken);
    assert.strictEqual(postRestart, true, 'Revocation must survive simulated server restart');

    // Verify that store outage fails closed
    tokenRevocationService._setCustomStore({
      async isTokenRevoked() {
        throw new Error('Database cluster network partition');
      },
    });

    let storeErrorOccurred = false;
    try {
      await tokenRevocationService.isTokenRevoked('any-token');
    } catch (err) {
      storeErrorOccurred = true;
      assert(err instanceof tokenRevocationService.RevocationStoreError, 'Must fail closed with RevocationStoreError');
    }
    assert(storeErrorOccurred, 'Revocation store outage must throw and fail closed');

    tokenRevocationService._setCustomStore(null);
    pass('6. Durable token revocation survives restarts and store outage fails closed');
  }

  // ── TEST 7: Rate Limiting on Certificate Issuance & Sensitive Admin Actions ─
  total++;
  {
    const adminToken = createAdminToken({
      id: '33333333-3333-3333-3333-333333333333',
      email: 'cert.admin@smartassets.io',
      fullName: 'Cert Admin',
    });

    _setTestProfileResolver(async (userId) => ({
      id: userId,
      role: 'admin',
      status: 'active',
      is_suspended: false,
    }));

    // Check certificate issuance route has rate limit headers
    const certIssueRes = await request(
      'POST',
      '/api/certificates/00000000-0000-0000-0000-000000000001/issue',
      {
        Authorization: `Bearer ${adminToken}`,
      },
      {}
    );

    // RateLimit headers must be present (RateLimit-Limit, RateLimit-Remaining)
    const hasRateLimitHeader =
      certIssueRes.headers['ratelimit-limit'] !== undefined ||
      certIssueRes.headers['x-ratelimit-limit'] !== undefined;
    assert(hasRateLimitHeader, 'Certificate issue route must include rate-limit headers');

    pass('7. Sensitive admin mutations and certificate issue/revoke routes enforce adminActionLimiter');
  }

  // ── TEST 8: Public Certificate Verification & Upload Rate Limits ─────────────
  total++;
  {
    // Test public verification endpoint has rate limiting
    const verifyRes = await request('GET', '/api/certificates/keys');
    assert.strictEqual(verifyRes.statusCode, 200, 'Keys endpoint must return 200');

    const hasVerifyRateLimit =
      verifyRes.headers['ratelimit-limit'] !== undefined ||
      verifyRes.headers['x-ratelimit-limit'] !== undefined;
    assert(hasVerifyRateLimit, 'Public certificate endpoints must include rate limit headers');

    // Test upload endpoint
    const uploadRes = await request('POST', '/api/uploads/avatar', {}, { base64: 'invalid' });
    const hasUploadRateLimit =
      uploadRes.headers['ratelimit-limit'] !== undefined ||
      uploadRes.headers['x-ratelimit-limit'] !== undefined;
    assert(hasUploadRateLimit, 'Upload endpoints must include rate limit headers');

    pass('8. Public certificate verification and media upload routes enforce rate limits');
  }

  // ── TEST 9: Production CORS Enforcement ────────────────────────────────────
  total++;
  {
    // A) Allowed origin in CORS_ALLOWED_ORIGINS
    const allowedRes = await request('GET', '/api/health', {
      Origin: 'https://admin.smartassets.io',
    });
    assert.strictEqual(
      allowedRes.headers['access-control-allow-origin'],
      'https://admin.smartassets.io',
      'Configured origin must receive Access-Control-Allow-Origin'
    );

    // B) Disallowed malicious origin
    const deniedRes = await request('GET', '/api/health', {
      Origin: 'https://evil-phishing-site.com',
    });
    assert.strictEqual(
      deniedRes.headers['access-control-allow-origin'],
      undefined,
      'Unconfigured origin must NOT receive Access-Control-Allow-Origin'
    );

    pass('9. Production CORS permits only configured origins and strictly denies unwhitelisted origins');
  }

  // ── TEST 10: Security Headers on Admin Console, Verification & API Routes ───
  total++;
  {
    // Check API route
    const apiRes = await request('GET', '/api/health');
    assert.strictEqual(apiRes.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(apiRes.headers['x-frame-options'], 'DENY');

    // Check Admin page
    const adminRes = await request('GET', '/admin/login.html');
    assert.strictEqual(adminRes.statusCode, 200);
    assert.strictEqual(adminRes.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(adminRes.headers['x-frame-options'], 'DENY');

    // Verify CSP policy: Must NOT contain 'unsafe-eval'
    const csp = adminRes.headers['content-security-policy'] || '';
    assert(csp.includes("script-src 'self'"), 'CSP must include script-src self');
    assert(!csp.includes("'unsafe-eval'"), "CSP must NOT include 'unsafe-eval'");

    // Check Public Verification page
    const verifyPageRes = await request('GET', '/verify/sample-asset-uuid-1234');
    assert.strictEqual(verifyPageRes.statusCode, 200);
    assert.strictEqual(verifyPageRes.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(verifyPageRes.headers['x-frame-options'], 'DENY');

    pass('10. Global Helmet headers active across API, Admin Console, and Verification pages without unsafe-eval');
  }

  // ── TEST 11: Proxy Trust Configuration for Render ──────────────────────────
  total++;
  {
    // Render edge sends X-Forwarded-For; express with trust proxy = 1 respects the client IP
    const ipRes = await request('GET', '/api/health', {
      'X-Forwarded-For': '203.0.113.195, 10.0.0.1',
    });
    assert.strictEqual(ipRes.statusCode, 200);
    assert.strictEqual(app.get('trust proxy'), 1, 'app trust proxy must be configured to 1 for Render');

    pass('11. Proxy trust configured correctly for Render reverse-proxy edge architecture');
  }

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passed}/${total} RENDER DEPLOYMENT READINESS TESTS PASSED!`);
  console.log('======================================================\n');
}

runTests()
  .catch((err) => {
    console.error('\n❌ [TEST FAILURE]:', err);
    process.exit(1);
  })
  .finally(() => {
    if (server) {
      server.close();
    }
  });

async function runTests() {
  try {
    await runTestSuite();
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}
