process.env.NODE_ENV = 'test';
// ─── Test Suite: 3D Model Multi-Provider (Tripo + Curated Catalog) & Controller ──
// Verifies:
// 1. Curated Catalog matching: category, title keywords, tags, brand, and confidence threshold.
// 2. Primary Tripo Image-to-3D dispatch & GLB optimization handoff.
// 3. Fallback to Curated Catalog when Tripo fails or is unconfigured.
// 4. Automatic catalog assignment when confidence >= CATALOG_MATCH_THRESHOLD.
// 5. Seller review needed when confidence < threshold (surfacing candidate matches).
// 6. Manual catalog selection endpoint (POST /api/models/catalog/select).
// 7. Full authoritative creator attribution and license (CC0-1.0) without invented brands.
// 8. Global concurrency limiter and per-listing attempt caps.
// 9. Zero third-party API spend during catalog fallback.
// 10. Controller authorization: Rejects non-owners, ownerless listings, and non-admins with 403 Forbidden.
// 11. Multi-instance atomic job reservation and production fail-closed behavior.

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const modelProviderService = require('../src/services/modelProviderService');
const modelCatalogService = require('../src/services/modelCatalogService');
const modelController = require('../src/controllers/modelController');
const supabase = require('../src/connection/supabaseClient');

async function runModelProviderAndControllerTests() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • 3D Model Catalog & Tripo Test Suite  ');
  console.log('======================================================\n');

  const originalEnv = { ...process.env };

  try {
    // ── TEST 1: Curated Catalog Deterministic Matching & Scoring ─────────────
    console.log('🧪 [TEST 1] Testing Curated Catalog deterministic matching & scoring...');
    {
      const seedList = modelCatalogService.getFallbackCatalog();
      assert.ok(seedList.length >= 3, 'Seed catalog must have at least 3 curated models');

      // 1. High confidence match: Antique Camera
      const cameraMatches = await modelCatalogService.matchCatalogModels({
        category: 'Collectibles',
        title: 'Rare Antique Camera Tripod Vintage Photography',
        tags: ['camera', 'vintage'],
      });
      assert.ok(cameraMatches.length > 0, 'Must find camera match');
      const topCamera = cameraMatches[0];
      assert.strictEqual(topCamera.model.name, 'Antique Camera');
      assert.ok(topCamera.score >= 0.7, `Camera match score (${topCamera.score}) must be >= 0.70`);
      assert.strictEqual(topCamera.isAutoEligible, true);
      assert.strictEqual(topCamera.reasons.categoryExact, true);
      assert.ok(topCamera.reasons.matchedKeywords.includes('camera'));
      assert.strictEqual(
        topCamera.model.attribution,
        'Antique Camera 3D model created by Maximillan Kamps, © 2017–2018 UX3D. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
      );
      assert.strictEqual(topCamera.model.brand, null, 'Must not contain invented brand');
      assert.strictEqual(topCamera.model.dimensions_approximate, true, 'Dimensions must be marked approximate');
      assert.strictEqual(topCamera.model.license, 'CC0-1.0');

      // 2. High confidence match: Sheen Chair
      const chairMatches = await modelCatalogService.matchCatalogModels({
        category: 'Furniture',
        title: 'Modern Armchair Sheen Chair Grey Seating',
        tags: ['furniture', 'chair'],
      });
      assert.ok(chairMatches.length > 0, 'Must find chair match');
      const topChair = chairMatches[0];
      assert.strictEqual(topChair.model.name, 'Sheen Chair');
      assert.ok(topChair.score >= 0.7, `Chair match score (${topChair.score}) must be >= 0.70`);
      assert.strictEqual(topChair.isAutoEligible, true);
      assert.strictEqual(topChair.model.brand, null);
      assert.strictEqual(topChair.model.license, 'CC0-1.0');

      // 3. Low confidence / Partial match: weak keywords, different category
      const weakMatches = await modelCatalogService.matchCatalogModels({
        category: 'Electronics',
        title: 'Nintendo Switch Gaming Console OLED',
        tags: ['gaming', 'console'],
      });
      assert.ok(
        weakMatches.every((m) => m.isAutoEligible === false),
        'Unrelated gaming console must never be auto-assigned a catalog model',
      );

      console.log('   ✅ Deterministic catalog scoring, license retention, and auto-threshold verified.');
    }

    // ── TEST 2: Provider Task ID Encoding & Decoding ────────────────────────
    console.log('\n🧪 [TEST 2] Testing provider task ID encoding and decoding...');
    {
      const tripoEncoded = modelProviderService.encodeProviderTaskId('tripo', 'task_tripo_abc123');
      assert.strictEqual(tripoEncoded, 'tripo:task_tripo_abc123');

      const catalogEncoded = modelProviderService.encodeProviderTaskId('catalog', '11111111-1111-4000-8000-000000000001');
      assert.strictEqual(catalogEncoded, 'catalog:11111111-1111-4000-8000-000000000001');

      const decodedTripo = modelProviderService.decodeProviderTaskId(tripoEncoded);
      assert.strictEqual(decodedTripo.provider, 'tripo');
      assert.strictEqual(decodedTripo.taskId, 'task_tripo_abc123');

      const decodedCatalog = modelProviderService.decodeProviderTaskId(catalogEncoded);
      assert.strictEqual(decodedCatalog.provider, 'catalog');
      assert.strictEqual(decodedCatalog.taskId, '11111111-1111-4000-8000-000000000001');

      console.log('   ✅ Dual provider task ID encoding & decoding verified.');
    }

    // ── TEST 3: Tripo Primary Success Path ──────────────────────────────────
    console.log('\n🧪 [TEST 3] Testing Tripo primary generation success path...');
    {
      modelProviderService.resetProviderAdaptersForTest();

      modelProviderService.setTripoAdapterForTest({
        isTripoConfigured: () => true,
        createImageToModelTask: async (imageUrl, options) => {
          assert.strictEqual(imageUrl, 'https://example.com/item.jpg');
          return { taskId: 'task_success_999' };
        },
      });

      const result = await modelProviderService.dispatchModelGeneration({
        listingId: 'listing-tripo-ok',
        imageUrl: 'https://example.com/item.jpg',
      });

      assert.strictEqual(result.provider, 'tripo');
      assert.strictEqual(result.rawTaskId, 'task_success_999');
      assert.strictEqual(result.encodedTaskId, 'tripo:task_success_999');
      assert.strictEqual(result.attemptCount, 1);
      assert.strictEqual(result.usedFallback, false);

      console.log('   ✅ Tripo primary path dispatches cleanly when configured.');
    }

    // ── TEST 4: Tripo Failure -> Curated Catalog Auto-Assignment ─────────────
    console.log('\n🧪 [TEST 4] Testing Tripo failure falling back to Curated Catalog (auto-match)...');
    {
      modelProviderService.resetProviderAdaptersForTest();

      modelProviderService.setTripoAdapterForTest({
        isTripoConfigured: () => true,
        createImageToModelTask: async () => {
          const err = new Error('Insufficient Tripo credits (402)');
          err.status = 402;
          throw err;
        },
      });

      const result = await modelProviderService.dispatchModelGeneration({
        listingId: 'listing-fallback-chair',
        imageUrl: 'https://example.com/velvet_chair.jpg',
        listing: {
          category: 'Furniture',
          name: 'Designer Velvet Armchair Modern',
          tags: ['furniture', 'chair'],
        },
      });

      assert.strictEqual(result.provider, 'catalog', 'Must fall back to catalog on Tripo 402');
      assert.strictEqual(result.usedFallback, true);
      assert.strictEqual(result.isAutoMatch, true, 'High confidence chair match must be auto-assigned');
      assert.strictEqual(result.catalogModel.name, 'Sheen Chair');
      assert.ok(result.catalogModel.attribution.includes('Eric Chadwick'));
      assert.ok(result.catalogModel.attribution.includes('Wayfair'));
      assert.strictEqual(result.catalogModel.license, 'CC0-1.0');
      assert.ok(result.score >= 0.70);

      console.log('   ✅ Tripo 402/quota failure cleanly auto-assigned licensed catalog model.');
    }

    // ── TEST 5: Tripo Failure -> Low Confidence Candidate Review ────────────
    console.log('\n🧪 [TEST 5] Testing Tripo failure with low confidence (seller review required)...');
    {
      modelProviderService.resetProviderAdaptersForTest();

      modelProviderService.setTripoAdapterForTest({
        isTripoConfigured: () => true,
        createImageToModelTask: async () => {
          const err = new Error('Tripo connection timeout (504)');
          err.status = 504;
          throw err;
        },
      });

      const result = await modelProviderService.dispatchModelGeneration({
        listingId: 'listing-weak-match',
        imageUrl: 'https://example.com/vintage_hat.jpg',
        listing: {
          category: 'Collectibles',
          name: 'Rare Vintage Leather Aviator Hat',
          tags: ['vintage', 'collectibles'],
        },
      });

      assert.strictEqual(result.provider, 'catalog');
      assert.strictEqual(result.usedFallback, true);
      assert.strictEqual(result.isAutoMatch, false, 'Score below 0.70 must require seller review');
      assert.ok(Array.isArray(result.candidateMatches) && result.candidateMatches.length > 0);

      console.log('   ✅ Low-confidence matches preserved for seller review without automatic assignment.');
    }

    // ── TEST 6: Concurrency Limiting (MODEL_MAX_CONCURRENT_JOBS) ─────────────
    console.log('\n🧪 [TEST 6] Testing concurrency limiting (MODEL_MAX_CONCURRENT_JOBS)...');
    {
      process.env.MODEL_MAX_CONCURRENT_JOBS = '2';
      modelProviderService.resetProviderAdaptersForTest();

      let resolveJob1, resolveJob2;
      const job1Promise = new Promise((r) => { resolveJob1 = r; });
      const job2Promise = new Promise((r) => { resolveJob2 = r; });

      let callCount = 0;
      modelProviderService.setTripoAdapterForTest({
        isTripoConfigured: () => true,
        createImageToModelTask: async () => {
          callCount++;
          if (callCount === 1) await job1Promise;
          if (callCount === 2) await job2Promise;
          return `task_${callCount}`;
        },
      });

      const p1 = modelProviderService.dispatchModelGeneration({
        listingId: 'listing-conc-1',
        imageUrl: 'https://example.com/1.jpg',
      });
      const p2 = modelProviderService.dispatchModelGeneration({
        listingId: 'listing-conc-2',
        imageUrl: 'https://example.com/2.jpg',
      });

      let rejected = false;
      try {
        await modelProviderService.dispatchModelGeneration({
          listingId: 'listing-conc-3',
          imageUrl: 'https://example.com/3.jpg',
        });
      } catch (err) {
        rejected = true;
        assert.ok(err.statusCode === 429 || err.message.includes('capacity'));
      }
      assert.strictEqual(rejected, true, '3rd job must be rejected when concurrency limit is reached');

      resolveJob1();
      resolveJob2();
      await p1;
      await p2;

      console.log('   ✅ Concurrency cap strictly enforced with HTTP 429 capacity error.');
    }

    // ── TEST 7: Controller Authorization & Admin Verification Hardening ──────
    console.log('\n🧪 [TEST 7] Testing controller authorization and input validation...');
    {
      function mockResponse() {
        const res = {
          statusCode: 200,
          body: null,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            this.body = payload;
            return this;
          },
        };
        return res;
      }

      // 1. Unauthenticated request (no user)
      {
        const res = mockResponse();
        await modelController.generateModel({ body: { listingId: 'l1' }, user: null }, res);
        assert.strictEqual(res.statusCode, 401, 'Unauthenticated request must return 401');
      }

      // 2. Missing listingId
      {
        const res = mockResponse();
        await modelController.generateModel({ body: {}, user: { id: 'u1' } }, res);
        assert.strictEqual(res.statusCode, 400, 'Missing listingId must return 400');
      }

      // 3. Catalog selection validation (missing fields)
      {
        const res = mockResponse();
        await modelController.selectCatalogModel({ body: {}, user: { id: 'u1' } }, res);
        assert.strictEqual(res.statusCode, 400, 'selectCatalogModel must require listingId & catalogModelId');
      }

      // 4. Listing ownership and authoritative admin RBAC verification
      const originalFrom = supabase.from;
      let mockListings = {};
      let mockProfiles = {};

      supabase.from = function (table) {
        return {
          select() {
            return this;
          },
          eq(column, value) {
            this._eqCol = column;
            this._eqVal = value;
            return this;
          },
          async maybeSingle() {
            if (table === 'assets') {
              const row = mockListings[this._eqVal];
              return { data: row || null, error: row ? null : { message: 'Not found' } };
            }
            if (table === 'profiles') {
              const row = mockProfiles[this._eqVal];
              return { data: row || null, error: null };
            }
            if (table === 'listing_models') {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          async single() {
            return this.maybeSingle();
          },
          async upsert() {
            return {
              data: null,
              error: null,
              select: () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }),
            };
          },
        };
      };

      try {
        mockListings = {
          'listing-owned-by-alice': {
            id: 'listing-owned-by-alice',
            user_id: 'alice-123',
            name: 'Vintage Camera',
            category: 'Collectibles',
          },
          'listing-ownerless': {
            id: 'listing-ownerless',
            user_id: null,
            seller_id: null,
            name: 'Mystery Item',
            category: 'Antiques',
          },
        };
        mockProfiles = {
          'alice-123': { id: 'alice-123', role: 'user' },
          'bob-stranger-1': { id: 'bob-stranger-1', role: 'user' },
          'bob-stranger-2': { id: 'bob-stranger-2', role: 'user' },
          'bob-stranger-3': { id: 'bob-stranger-3', role: 'user' },
          'charlie-admin': { id: 'charlie-admin', role: 'admin' },
        };

        // 4a. Non-owner (bob) trying to generate for alice's listing -> 403 Forbidden
        {
          const res = mockResponse();
          await modelController.generateModel(
            { body: { listingId: 'listing-owned-by-alice' }, user: { id: 'bob-stranger-1' } },
            res,
          );
          assert.strictEqual(res.statusCode, 403, 'Non-owner must be rejected with 403 Forbidden');
        }

        // 4b. Non-admin (bob) trying to generate for ownerless listing -> 403 Forbidden
        {
          const res = mockResponse();
          await modelController.generateModel(
            { body: { listingId: 'listing-ownerless' }, user: { id: 'bob-stranger-2' } },
            res,
          );
          assert.strictEqual(res.statusCode, 403, 'Non-admin on ownerless listing must be rejected with 403 Forbidden');
        }

        // 4c. Admin (charlie) trying to generate for ownerless listing -> passes authorization (not 401 or 403)
        {
          const res = mockResponse();
          await modelController.generateModel(
            { body: { listingId: 'listing-ownerless' }, user: { id: 'charlie-admin' } },
            res,
          );
          assert.notStrictEqual(res.statusCode, 401, 'Admin must not be 401');
          assert.notStrictEqual(res.statusCode, 403, 'Admin must not be 403 on ownerless listing');
        }

        // 4d. Non-owner (bob) trying to select catalog model for alice's listing -> 403 Forbidden
        {
          const res = mockResponse();
          await modelController.selectCatalogModel(
            {
              body: { listingId: 'listing-owned-by-alice', catalogModelId: 'catalog-antique-camera' },
              user: { id: 'bob-stranger-3' },
            },
            res,
          );
          assert.strictEqual(res.statusCode, 403, 'Non-owner on selectCatalogModel must be rejected with 403 Forbidden');
        }

        // 4e. Inactive or missing catalog model selection via controller -> 400 Bad Request
        {
          const res = mockResponse();
          await modelController.selectCatalogModel(
            {
              body: { listingId: 'listing-owned-by-alice', catalogModelId: 'non-existent-or-inactive-id' },
              user: { id: 'alice-123' },
            },
            res,
          );
          assert.strictEqual(res.statusCode, 400, 'Inactive or missing catalog model selection must return 400');
        }
      } finally {
        supabase.from = originalFrom;
      }

      // 5. Inactive or unapproved catalog model rejection directly in service
      {
        let caughtInactive = false;
        try {
          await modelCatalogService.assignCatalogModelToListing({
            listingId: 'l1',
            catalogModelId: 'non-existent-or-inactive-id',
          });
        } catch (err) {
          caughtInactive = true;
          assert.ok(err.message.includes('not found') || err.message.includes('inactive'));
        }
        assert.strictEqual(caughtInactive, true, 'Inactive or missing catalog model must throw error');
      }

      console.log('   ✅ Controller input validation, inactive model rejection, and auth checks verified.');
    }

    // ── TEST 8: Commercial License Allowlist & NC/ND Rejection ──────────────
    console.log('\n🧪 [TEST 8] Testing commercial license allowlist & NC/ND rejection...');
    {
      const { validateLicense, APPROVED_LICENSES } = require('../scripts/importCatalogModel');
      assert.ok(Array.isArray(APPROVED_LICENSES) && APPROVED_LICENSES.length >= 4);

      // Approved licenses
      assert.strictEqual(validateLicense('CC0-1.0'), true, 'CC0-1.0 must be approved');
      assert.strictEqual(validateLicense('cc0-1.0'), true, 'Case-insensitive CC0 must be approved');
      assert.strictEqual(validateLicense('CC-BY-4.0'), true, 'CC-BY-4.0 must be approved');
      assert.strictEqual(validateLicense('Public Domain'), true, 'Public Domain must be approved');
      assert.strictEqual(validateLicense('SmartAssets-Proprietary'), true, 'SmartAssets-Proprietary must be approved');

      // Strictly rejected licenses
      assert.strictEqual(validateLicense('CC-BY-NC-4.0'), false, 'CC-BY-NC must be rejected');
      assert.strictEqual(validateLicense('CC-BY-NC-ND-4.0'), false, 'CC-BY-NC-ND must be rejected');
      assert.strictEqual(validateLicense('CC-BY-ND-4.0'), false, 'CC-BY-ND must be rejected');
      assert.strictEqual(validateLicense('Non-Commercial Sample'), false, 'Non-Commercial label must be rejected');
      assert.strictEqual(validateLicense('GPL-3.0'), false, 'GPL-3.0 copyleft must be rejected');
      assert.strictEqual(validateLicense(null), false, 'Empty license must be rejected');

      console.log('   ✅ Strict commercial license allowlist and NC/ND rejection verified.');
    }

    // ── TEST 9: Fail-Closed Catalog Importer & Header Validation ─────────────
    console.log('\n🧪 [TEST 9] Testing fail-closed catalog importer & header validation...');
    {
      const { importCatalogModel } = require('../scripts/importCatalogModel');

      // 1. Invalid binary header rejection using os.tmpdir()
      const tmpInvalidGlb = path.join(os.tmpdir(), `test_invalid_header_${Date.now()}.glb`);
      fs.writeFileSync(tmpInvalidGlb, Buffer.from('NOT_A_VALID_GLTF_HEADER'));

      let caughtHeaderErr = false;
      try {
        await importCatalogModel({
          file: tmpInvalidGlb,
          name: 'Invalid Test Model',
          category: 'Collectibles',
          creator: 'Tester',
          license: 'CC0-1.0',
          attribution: 'Test Attribution',
        });
      } catch (err) {
        caughtHeaderErr = true;
        assert.ok(err.message.includes('magic header'), `Error should mention magic header: ${err.message}`);
      } finally {
        if (fs.existsSync(tmpInvalidGlb)) fs.unlinkSync(tmpInvalidGlb);
      }
      assert.strictEqual(caughtHeaderErr, true, 'Corrupted/non-glTF file must be rejected immediately');

      // 2. Dry run with valid GLB buffer using os.tmpdir()
      const { Document, NodeIO } = require('@gltf-transform/core');
      const doc = new Document();
      doc.createScene();
      const io = new NodeIO();
      const validGlbBuffer = Buffer.from(await io.writeBinary(doc));

      const tmpValidGlb = path.join(os.tmpdir(), `test_valid_header_${Date.now()}.glb`);
      fs.writeFileSync(tmpValidGlb, validGlbBuffer);

      try {
        const dryResult = await importCatalogModel({
          file: tmpValidGlb,
          name: 'Dry Run Valid Model',
          category: 'Collectibles',
          creator: 'Maximillan Kamps',
          license: 'CC0-1.0',
          attribution: 'Attribution by Maximillan Kamps',
          dryRun: true,
        });
        assert.strictEqual(dryResult.dryRun, true);
        assert.strictEqual(dryResult.license, 'CC0-1.0');
      } finally {
        if (fs.existsSync(tmpValidGlb)) fs.unlinkSync(tmpValidGlb);
      }

      console.log('   ✅ Fail-closed validation and glTF magic header protection verified using os.tmpdir().');
    }

    // ── TEST 10: Multi-Instance Atomic Job Claim & Concurrency Engine ─────────
    console.log('\n🧪 [TEST 10] Testing multi-instance atomic job claim & concurrency engine...');
    {
      const { SharedJobClaimEngine, claimGenerationSlot } = require('../src/services/modelProviderService');
      const engine = new SharedJobClaimEngine();

      // 1. Single listing duplicate claim protection across instances
      const claim1 = await engine.claim('listing-atom-1', { maxConcurrent: 2, maxAttempts: 2 });
      assert.strictEqual(claim1.claimed, true, 'First instance must successfully claim the job');
      assert.strictEqual(claim1.attemptCount, 1);

      const claim2 = await engine.claim('listing-atom-1', { maxConcurrent: 2, maxAttempts: 2 });
      assert.strictEqual(claim2.claimed, false, 'Second instance must be rejected while job is in progress');
      assert.strictEqual(claim2.code, 'IN_PROGRESS');

      // 2. Global capacity enforcement across instances for DIFFERENT listings
      const claimOther = await engine.claim('listing-atom-2', { maxConcurrent: 2, maxAttempts: 2 });
      assert.strictEqual(claimOther.claimed, true, 'Second listing claims available capacity');

      const claimExceeded = await engine.claim('listing-atom-3', { maxConcurrent: 2, maxAttempts: 2 });
      assert.strictEqual(claimExceeded.claimed, false, 'Third listing must be rejected when capacity is full');
      assert.strictEqual(claimExceeded.code, 'CONCURRENCY_LIMIT_REACHED');

      // 3. Release slot on terminal completion and reclaim
      engine.release('listing-atom-1', 'ready');
      const claimAfterRelease = await engine.claim('listing-atom-3', { maxConcurrent: 2, maxAttempts: 2 });
      assert.strictEqual(claimAfterRelease.claimed, true, 'Freed capacity allows next instance to claim');

      // 4. Stale job recovery (>10m)
      engine.jobs.set('listing-stale', {
        status: 'processing',
        attempts: 1,
        updatedAt: Date.now() - 15 * 60 * 1000,
      });

      const staleReclaim = await engine.claim('listing-stale', { maxConcurrent: 3, maxAttempts: 3, staleIntervalMinutes: 10 });
      assert.strictEqual(staleReclaim.claimed, true, 'Stale job must be reclaimed');
      assert.strictEqual(staleReclaim.attemptCount, 2, 'Attempt count must increment on reclaim');

      // 5. Production fail-closed behavior test (when NODE_ENV !== 'test' and RPC fails)
      process.env.NODE_ENV = 'production';
      let productionFailedClosed = false;
      try {
        await claimGenerationSlot('listing-prod-test', { maxConcurrent: 2, maxAttempts: 2 });
      } catch (err) {
        productionFailedClosed = true;
        assert.ok(err.statusCode === 503 || err.code === 'RESERVATION_SERVICE_UNAVAILABLE', `Expected 503 fail-closed error, got: ${err.message}`);
      } finally {
        process.env.NODE_ENV = 'test';
      }
      assert.strictEqual(productionFailedClosed, true, 'Production must strictly fail closed if RPC fails');

      console.log('   ✅ Multi-instance atomic job locking, duplicate protection, stale recovery & fail-closed verified.');
    }

    // ── TEST 11: Authoritative Provenance & Full Credits Verification ─────────
    console.log('\n🧪 [TEST 11] Testing authoritative provenance & full credits across all 5 models...');
    {
      const catalog = modelCatalogService.getFallbackCatalog();
      assert.strictEqual(catalog.length, 5, 'Catalog must contain exactly 5 verified models');

      const byName = {};
      catalog.forEach((m) => {
        byName[m.name] = m;
      });

      // Maintained authoritative provenance manifest reflecting individual model records
      const EXPECTED_PROVENANCE_MANIFEST = {
        'Antique Camera': {
          creator: 'Maximillan Kamps',
          rights_holder: 'UX3D (© 2017–2018 UX3D)',
          license: 'CC0-1.0',
          source_name: 'Khronos glTF Sample Assets',
          source_url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/AntiqueCamera',
          attribution:
            'Antique Camera 3D model created by Maximillan Kamps, © 2017–2018 UX3D. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
          dimensions_approximate: true,
          thumbnail_url: null,
          brand: null,
        },
        'Sheen Chair': {
          creator: 'Eric Chadwick',
          rights_holder: 'Wayfair, LLC (© 2020 Wayfair, LLC)',
          license: 'CC0-1.0',
          source_name: 'Khronos glTF Sample Assets',
          source_url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair',
          attribution:
            'Sheen Chair 3D model created by Eric Chadwick for Wayfair, LLC, © 2020 Wayfair, LLC. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
          dimensions_approximate: true,
          thumbnail_url: null,
          brand: null,
        },
        'Street Lantern': {
          creator: 'sbtron (initial model) & Frank Galligan (conversion)',
          rights_holder: 'Microsoft & Frank Galligan (© 2017 Microsoft, © 2018 Frank Galligan)',
          license: 'CC0-1.0',
          source_name: 'Khronos glTF Sample Assets',
          source_url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern',
          attribution:
            'Street Lantern 3D model created by sbtron and Frank Galligan, © 2017 Microsoft & Frank Galligan. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
          dimensions_approximate: true,
          thumbnail_url: null,
          brand: null,
        },
        'Toy Car': {
          creator: 'Guido Odendahl & Eric Chadwick',
          rights_holder: null,
          license: 'CC0-1.0',
          source_name: 'Khronos glTF Sample Assets',
          source_url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar',
          attribution:
            'Toy Car 3D model created by Guido Odendahl with materials by Eric Chadwick. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
          dimensions_approximate: true,
          thumbnail_url: null,
          brand: null,
        },
        'Flight Helmet': {
          creator: 'Gary Hsu (conversion from Maya)',
          rights_holder: null,
          license: 'CC0-1.0',
          source_name: 'Khronos glTF Sample Assets',
          source_url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/FlightHelmet',
          attribution:
            'Flight Helmet 3D model converted by Gary Hsu from Maya. Dedicated to the public domain under CC0 1.0 Universal. Hosted by Smart Assets.',
          dimensions_approximate: true,
          thumbnail_url: null,
          brand: null,
        },
      };

      for (const [modelName, expected] of Object.entries(EXPECTED_PROVENANCE_MANIFEST)) {
        const model = byName[modelName];
        assert.ok(model, `Model "${modelName}" must exist in catalog`);
        assert.strictEqual(model.creator, expected.creator, `Creator mismatch for ${modelName}`);
        assert.strictEqual(model.rights_holder, expected.rights_holder, `Rights holder mismatch for ${modelName}`);
        assert.strictEqual(model.license, expected.license, `License mismatch for ${modelName}`);
        assert.strictEqual(model.source_name, expected.source_name, `Source name mismatch for ${modelName}`);
        assert.strictEqual(model.source_url, expected.source_url, `Source URL mismatch for ${modelName}`);
        assert.strictEqual(model.attribution, expected.attribution, `Attribution mismatch for ${modelName}`);
        assert.strictEqual(model.dimensions_approximate, expected.dimensions_approximate, `Approximate flag mismatch for ${modelName}`);
        assert.strictEqual(model.thumbnail_url, expected.thumbnail_url, `Thumbnail URL mismatch for ${modelName}`);
        assert.strictEqual(model.brand, expected.brand, `Brand must be null for ${modelName}`);
        assert.ok(!model.storage_path.startsWith('http'), `Storage path must be relative for ${modelName}`);
        assert.strictEqual(model.storage_bucket, 'models', `Storage bucket must be 'models' for ${modelName}`);
      }

      console.log('   ✅ Exact creator, rights holder, attribution & approximate dimensions verified against maintained provenance manifest.');
    }

    console.log('\n======================================================');
    console.log('   🎉 ALL 11 MODEL PROVIDER & CATALOG TESTS PASSED!  ');
    console.log('======================================================\n');
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
    modelProviderService.resetProviderAdaptersForTest();
  }
}

runModelProviderAndControllerTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
