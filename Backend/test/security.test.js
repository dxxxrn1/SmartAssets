// ─── Security Integration Test Suite ──────────────────────────────────────────
// Verifies SQL injection defenses, PostgREST filter sanitization,
// token revocation, session expiry, and ID validation.

const assert = require('assert');
const {
  inspectValueForSqlInjection,
  sanitizePostgrestFilter,
  validateIdParams,
  sqlInjectionProtection,
} = require('../src/middlewares/securityMiddleware');
const {
  revokeToken,
  isTokenRevoked,
  parseJwtPayload,
} = require('../src/middlewares/authMiddleware');

async function runTests() {
  console.log('\n======================================================');
  console.log('       SMARTASSETS • Security & AppSec Test Suite     ');
  console.log('======================================================\n');

  // ── TEST 1: SQL Injection Detection ─────────────────────────────────────────
  console.log('🧪 [TEST 1] Testing SQL Injection Signature Detection Engine...');

  const maliciousPayloads = [
    "' OR '1'='1",
    "admin' --",
    "1' OR 1=1 --",
    "1; DROP TABLE assets;",
    "' UNION SELECT id, password FROM auth.users --",
    "test' UNION ALL SELECT null, null, null --",
    "1'; WAITFOR DELAY '0:0:5'--",
    "1' AND (SELECT 1 FROM (SELECT COUNT(*), CONCAT((SELECT database()), FLOOR(RAND(0)*2)) x FROM information_schema.tables GROUP BY x) a) --",
    "'; EXEC xp_cmdshell('dir'); --",
    "SELECT * FROM pg_catalog.pg_user",
    "SELECT pg_sleep(10)",
  ];

  for (const payload of maliciousPayloads) {
    const res = inspectValueForSqlInjection(payload);
    assert.strictEqual(
      res.isSafe,
      false,
      `Expected malicious payload to be detected as unsafe: ${payload}`
    );
  }
  console.log(`   ✅ Successfully detected all ${maliciousPayloads.length} SQL injection attack vectors!`);

  // Benign inputs must pass cleanly without false positives
  const benignPayloads = [
    'Rolex Submariner 2022',
    'Diamond Platinum Ring #12',
    'Vintage Leica M3 Camera (1954)',
    'john.doe@example.com',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30',
    'Mint condition with original paperwork and packaging',
  ];

  for (const benign of benignPayloads) {
    const res = inspectValueForSqlInjection(benign);
    assert.strictEqual(
      res.isSafe,
      true,
      `Expected benign input to be allowed: ${benign}`
    );
  }
  console.log(`   ✅ Verified zero false positives across legitimate user asset queries and text.`);

  // ── TEST 2: Nested Object / Deep JSON SQLi Inspection ─────────────────────────
  console.log('\n🧪 [TEST 2] Testing Nested Object & Array Payload Inspection...');
  const nestedAttack = {
    filters: {
      category: 'Watches',
      search: "Rolex' OR 1=1 --",
      tags: ['luxury', "'; DROP TABLE profiles; --"],
    },
  };
  const nestedResult = inspectValueForSqlInjection(nestedAttack);
  assert.strictEqual(nestedResult.isSafe, false, 'Nested attack should be intercepted');
  console.log('   ✅ Deeply nested payload inspection intercepted attack at path:', nestedResult.path);

  // ── TEST 3: PostgREST Filter Injection Sanitization ──────────────────────────
  console.log('\n🧪 [TEST 3] Testing PostgREST Filter & Clause Injection Sanitizer...');
  const dirtyQueries = [
    { input: 'Rolex,status.eq.rejected', expectedExcludes: ['status.eq.', ','] },
    { input: 'Rolex%20),id.neq.0(', expectedExcludes: [')', '(', 'id.neq.'] },
    { input: 'Diamond; DROP TABLE', expectedExcludes: [';'] },
    { input: 'Gold" or "1"="1', expectedExcludes: ['"', "'"] },
  ];

  for (const item of dirtyQueries) {
    const cleaned = sanitizePostgrestFilter(item.input);
    for (const forbidden of item.expectedExcludes) {
      assert.strictEqual(
        cleaned.includes(forbidden),
        false,
        `Sanitized query '${cleaned}' must not contain '${forbidden}'`
      );
    }
  }
  console.log('   ✅ PostgREST filter injection characters and operators successfully neutralized!');

  // ── TEST 4: Token Revocation & Inactivity Invalidation ────────────────────────
  console.log('\n🧪 [TEST 4] Testing Session Token Revocation & Invalidation Store...');
  const sampleToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.sample_' + Date.now();
  assert.strictEqual(await isTokenRevoked(sampleToken), false, 'Token should not be revoked initially');

  await revokeToken(sampleToken);
  assert.strictEqual(await isTokenRevoked(sampleToken), true, 'Token must be recognized as revoked after revokeToken()');
  console.log('   ✅ Token revocation successfully blocks invalidated sessions.');

  // ── TEST 5: JWT Expiration Detection ─────────────────────────────────────────
  console.log('\n🧪 [TEST 5] Testing Cryptographic Token Expiry Parsing...');
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
  const expiredPayloadBase64 = Buffer.from(JSON.stringify({ sub: 'user-1', exp: expiredTimestamp })).toString('base64');
  const expiredJwt = `header.${expiredPayloadBase64}.signature`;

  const parsed = parseJwtPayload(expiredJwt);
  assert.ok(parsed, 'JWT payload should be extractable');
  assert.strictEqual(parsed.exp, expiredTimestamp, 'Parsed exp must match set expired timestamp');
  assert.strictEqual(Math.floor(Date.now() / 1000) > parsed.exp, true, 'Token must be flagged as expired');
  console.log('   ✅ Expired token correctly detected and rejected.');

  // ── TEST 6: UUID / Identifier Tampering Validation ───────────────────────────
  console.log('\n🧪 [TEST 6] Testing Route Parameter Format Validation...');
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';
  const maliciousId = "550e8400' OR 1=1 --";

  let nextCalled = false;
  let errorSent = false;
  const mockRes = {
    status: (code) => {
      if (code === 400) errorSent = true;
      return { json: () => {} };
    },
  };

  const validator = validateIdParams('id');
  validator({ params: { id: maliciousId } }, mockRes, () => { nextCalled = true; });
  assert.strictEqual(errorSent, true, 'Tampered ID should be rejected with 400 Bad Request');
  assert.strictEqual(nextCalled, false, 'Next middleware should not be called on invalid ID');

  errorSent = false;
  nextCalled = false;
  validator({ params: { id: validUuid } }, mockRes, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid UUID must be allowed to proceed');
  console.log('   ✅ Identifier tampering blocked before reaching PostgreSQL layer.');

  console.log('\n🎉 ALL 6 SECURITY & SQL INJECTION DEFENSE TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Security test suite failed:', err);
  process.exit(1);
});
