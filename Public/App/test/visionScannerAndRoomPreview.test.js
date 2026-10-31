// ─── Vision Scanner & Room Preview Verification Test Suite ──────────────────
// Verifies:
// 1. Standalone Android APK & EAS build API URL resolution (`eas.json` + `api.js`).
// 2. Native Android image capture / gallery base64 conversion (`toDataUri`).
// 3. HomeScreen routing separation (`Scan & Know` -> SCAN_AND_KNOW, separate Demo Room Preview).
// 4. Removal of all silent generic 3D chair substitutions (`SheenChair.glb`) for marketplace listings.
// 5. Reconciled `ARScreen` and `LiveRoomPreview` routing with honest Android overlay descriptions.
// 6. Accessible room-preview control hierarchy, 44–48px touch targets, and non-gesture button controls.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const readAppFile = (relPath) =>
  fs.readFileSync(path.join(appRoot, relPath), 'utf8');

async function runVisionScannerAndRoomPreviewTests() {
  console.log('\n==============================================================');
  console.log('   SMARTASSETS • Vision Scanner & Room Preview Test Suite     ');
  console.log('==============================================================');

  // ── TEST 1: EAS Build Config & Standalone APK API URL Selection ─────────
  console.log('\n🧪 [TEST 1] Verifying EAS build profiles & standalone APK API URL resolution...');
  {
    const easJson = JSON.parse(readAppFile('eas.json'));
    for (const profileName of ['development', 'preview', 'production']) {
      const profile = easJson.build?.[profileName];
      assert.ok(profile, `eas.json must define build.${profileName}`);
      assert.strictEqual(
        profile.env?.EXPO_PUBLIC_API_BASE_URL,
        'https://smartassets.onrender.com/api',
        `eas.json build.${profileName} must set EXPO_PUBLIC_API_BASE_URL to live Render API`,
      );
      assert.strictEqual(
        profile.env?.PUBLIC_WEB_BASE_URL,
        'https://smartassets.onrender.com',
        `eas.json build.${profileName} must set PUBLIC_WEB_BASE_URL to live Render host`,
      );
    }

    const apiSource = readAppFile('src/services/api.js');
    assert.ok(
      apiSource.includes('export const DEPLOYED_RENDER_API = "https://smartassets.onrender.com/api"'),
      'api.js must define DEPLOYED_RENDER_API pointing to https://smartassets.onrender.com/api',
    );
    assert.ok(
      apiSource.includes('export function normalizeApiBaseUrl'),
      'api.js must normalize EXPO_PUBLIC_API_BASE_URL so /api is always present',
    );
    // Verify getBaseUrl() never falls back to 10.0.2.2 as the default primary URL on Android
    const getBaseUrlBlock = apiSource.slice(
      apiSource.indexOf('export const getBaseUrl'),
      apiSource.indexOf('export let API_BASE_URL'),
    );
    assert.ok(
      !getBaseUrlBlock.includes('http://10.0.2.2:5000/api'),
      'getBaseUrl() must not default physical/standalone Android devices to http://10.0.2.2:5000/api',
    );
    assert.ok(
      apiSource.includes('Math.min(timeoutMs, 3500)'),
      'apiRequest() must cap local/LAN candidate probe timeouts so dev fallback to Render is fast',
    );
    assert.ok(
      apiSource.includes('timeoutMs: 90000'),
      'scanAndKnowApi must allow 90s timeout for Render cold start + Gemini Vision + SerpApi',
    );

    console.log('   ✅ EAS profiles and api.js cleanly target https://smartassets.onrender.com/api.');
  }

  // ── TEST 2: Image Capture / Gallery Base64 Conversion (`ScanAndKnowScreen`) ─
  console.log('\n🧪 [TEST 2] Verifying ScanAndKnowScreen base64 conversion & Android camera config...');
  {
    const scannerSource = readAppFile('src/screens/ScanAndKnowScreen.js');
    assert.ok(
      scannerSource.includes('export async function toDataUri(asset)'),
      'ScanAndKnowScreen must export toDataUri(asset)',
    );
    assert.ok(
      scannerSource.includes('FileSystem.readAsStringAsync'),
      'toDataUri must read file:// or content:// URIs as base64 on native Android/iOS when asset.base64 is absent',
    );
    assert.ok(
      scannerSource.includes('allowsEditing: Platform.OS === "ios"'),
      'ScanAndKnowScreen must avoid forcing Android OEM crop intents that strip base64',
    );
    assert.ok(
      scannerSource.includes('Could not encode the selected photo into a base64 image payload'),
      'toDataUri must fail closed instead of sending raw local file:// paths to the remote server',
    );
    assert.ok(
      scannerSource.includes('accessibilityLabel="Capture photo with camera"') &&
        scannerSource.includes('accessibilityLabel="Pick photo from gallery"') &&
        scannerSource.includes('accessibilityLabel="Close Vision Scanner"'),
      'ScanAndKnowScreen controls must include accessibility labels',
    );

    console.log('   ✅ ScanAndKnowScreen reliably encodes photos to base64 and exposes accessible controls.');
  }

  // ── TEST 3: HomeScreen Shortcut Routing & Demo Showcase Separation ──────
  console.log('\n🧪 [TEST 3] Verifying HomeScreen routes Vision Scanner to SCAN_AND_KNOW and separates Demo Showcase...');
  {
    const homeSource = readAppFile('src/screens/HomeScreen.js');
    assert.ok(
      homeSource.includes('navigation.navigate(SCREENS.SCAN_AND_KNOW)'),
      'HomeScreen Vision Scanner shortcut must navigate to SCREENS.SCAN_AND_KNOW',
    );
    assert.ok(
      homeSource.includes('Vision Scanner (Scan & Know)'),
      'HomeScreen must clearly label the AI Vision Scanner shortcut',
    );
    assert.ok(
      homeSource.includes('Demo Room Preview') &&
        homeSource.includes('isDemoShowcase: true') &&
        homeSource.includes('showcaseId: "showcase-lounge-chair"'),
      'HomeScreen must provide a separate, clearly labeled Demo Room Preview entry with isDemoShowcase: true',
    );
    assert.ok(
      !homeSource.includes('SheenChair.glb'),
      'HomeScreen must not hardcode SheenChair.glb directly in its navigation call',
    );

    console.log('   ✅ HomeScreen routes Vision Scanner to SCAN_AND_KNOW and separates Demo Room Preview.');
  }

  // ── TEST 4: No Silent Generic 3D Chair Substitution for Marketplace Listings ─
  console.log('\n🧪 [TEST 4] Verifying marketplace listings never silently substitute SheenChair.glb...');
  {
    const assetDetailSource = readAppFile('src/screens/AssetDetailScreen.js');
    const livePreviewSource = readAppFile('src/components/liveRoomPreview/LiveRoomPreview.js');
    const arShowcaseSource = readAppFile('src/constants/arShowcase.js');

    assert.ok(
      !assetDetailSource.includes('SheenChair') &&
        !assetDetailSource.includes('Velvet Lounge Chair'),
      'AssetDetailScreen must never fallback to SheenChair.glb or Velvet Lounge Chair',
    );
    assert.ok(
      !livePreviewSource.includes('SheenChair') &&
        !livePreviewSource.includes('Velvet Lounge Chair'),
      'LiveRoomPreview must never hardcode SheenChair.glb or Velvet Lounge Chair as a default fallback',
    );

    // Evaluate matchAssetToARShowcase & resolveRoomPreviewConfig logic on an Xbox Controller listing
    const vm = require('vm');
    const showcaseSandbox = { exports: {} };
    vm.runInNewContext(
      arShowcaseSource
        .replace(/export const /g, 'exports.')
        .replace(/export function matchAssetToARShowcase/g, 'exports.matchAssetToARShowcase = function matchAssetToARShowcase'),
      showcaseSandbox,
    );
    const { AR_SHOWCASE_ITEMS, matchAssetToARShowcase } = showcaseSandbox.exports;

    // Also extract and evaluate resolveRoomPreviewConfig from LiveRoomPreview.js
    const resolveFnStart = livePreviewSource.indexOf('export function resolveRoomPreviewConfig');
    const resolveFnEnd = livePreviewSource.indexOf('export default function LiveRoomPreview');
    const resolveFnCode = livePreviewSource
      .slice(resolveFnStart, resolveFnEnd)
      .replace('export function resolveRoomPreviewConfig', 'exports.resolveRoomPreviewConfig = function resolveRoomPreviewConfig');
    const previewSandbox = {
      exports: {},
      AR_SHOWCASE_ITEMS,
      DEFAULT_DEPTH_CM: 25,
      resolveImageUrl: (u, fb = null) => (u && String(u).trim() ? u : fb),
    };
    vm.runInNewContext(resolveFnCode, previewSandbox);
    const { resolveRoomPreviewConfig } = previewSandbox.exports;

    const xboxListing = {
      id: 'listing-xbox-controller-99',
      name: 'Xbox Wireless Controller – Carbon Black',
      category: 'Gaming & Electronics',
      image: 'https://res.cloudinary.com/demo/image/upload/xbox-controller.jpg',
      price: 'R1 499',
    };

    const matched = matchAssetToARShowcase(xboxListing);
    assert.strictEqual(
      matched.glbUrl,
      null,
      'matchAssetToARShowcase must return glbUrl: null for an Xbox controller without a 3D model',
    );
    assert.strictEqual(
      matched.isDemoShowcase,
      false,
      'Marketplace listing must not be marked as a demo showcase',
    );
    assert.strictEqual(
      matched.poster,
      xboxListing.image,
      'Marketplace listing must preserve its real listing image',
    );

    const xboxPreviewConfig = resolveRoomPreviewConfig({
      asset: xboxListing,
      imageUri: xboxListing.image,
      title: xboxListing.name,
      listingId: xboxListing.id,
      isDemoShowcase: false,
    });
    assert.strictEqual(xboxPreviewConfig.mode, 'listing_2d');
    assert.strictEqual(xboxPreviewConfig.hasExplicit3dModel, false);
    assert.strictEqual(xboxPreviewConfig.glbUrl, null);
    assert.strictEqual(xboxPreviewConfig.imageUri, xboxListing.image);
    assert.strictEqual(xboxPreviewConfig.title, xboxListing.name);
    assert.strictEqual(xboxPreviewConfig.statusBadge, '2D PHOTO OVERLAY');
    assert.ok(
      xboxPreviewConfig.statusBanner.includes('No 3D model attached to this listing'),
      'Xbox controller listing without a 3D model must show the clear no-3D-model status banner',
    );

    // Also verify explicit 3D model on a listing IS preserved
    const custom3dListing = {
      id: 'listing-watch-3d',
      name: 'Audemars Piguet Royal Oak',
      category: 'Luxury Watches',
      image: 'https://res.cloudinary.com/demo/image/upload/royal-oak.jpg',
      glbUrl: 'https://res.cloudinary.com/demo/image/upload/royal-oak.glb',
    };
    const matched3d = matchAssetToARShowcase(custom3dListing);
    assert.strictEqual(
      matched3d.glbUrl,
      'https://res.cloudinary.com/demo/image/upload/royal-oak.glb',
      'Explicit glbUrl on a marketplace listing must be preserved',
    );
    const watch3dConfig = resolveRoomPreviewConfig({
      asset: custom3dListing,
      isDemoShowcase: false,
    });
    assert.strictEqual(watch3dConfig.mode, 'listing_3d');
    assert.strictEqual(watch3dConfig.hasExplicit3dModel, true);
    assert.strictEqual(watch3dConfig.glbUrl, custom3dListing.glbUrl);
    assert.strictEqual(watch3dConfig.statusBadge, '3D MODEL OVERLAY');

    // Verify Demo Showcase mode is explicitly labeled
    const demoConfig = resolveRoomPreviewConfig({
      isDemoShowcase: true,
      showcaseId: 'showcase-lounge-chair',
    });
    assert.strictEqual(demoConfig.mode, 'demo_3d');
    assert.strictEqual(demoConfig.isDemoShowcase, true);
    assert.strictEqual(demoConfig.statusBadge, 'DEMO 3D SHOWCASE');

    // Verify Demo Showcase items are explicitly flagged isDemoShowcase: true
    assert.ok(
      AR_SHOWCASE_ITEMS.every((item) => item.isDemoShowcase === true),
      'All sample showcase items must have isDemoShowcase: true',
    );

    console.log('   ✅ Xbox controller and other listings without a 3D model never show a lounge chair.');
  }

  // ── TEST 5: Reconciled ARScreen / LiveRoomPreview & Honest Android Copy ─
  console.log('\n🧪 [TEST 5] Verifying reconciled ARScreen / LiveRoomPreview routing and honest copy...');
  {
    const navigatorSource = readAppFile('src/navigation/AppNavigator.js');
    const arScreenSource = readAppFile('src/screens/ARScreen.js');
    const livePreviewSource = readAppFile('src/components/liveRoomPreview/LiveRoomPreview.js');

    assert.ok(
      !navigatorSource.includes("import ARScreen"),
      'AppNavigator.js must not contain a dead ARScreen import',
    );
    assert.ok(
      arScreenSource.includes("export { default } from '../components/liveRoomPreview/LiveRoomPreview'"),
      'ARScreen.js must reconcile directly to LiveRoomPreview',
    );
    assert.ok(
      livePreviewSource.includes('2D Photo Overlay • No 3D model attached to this listing'),
      'LiveRoomPreview must clearly state when a listing uses a 2D photo overlay with no 3D model attached',
    );
    assert.ok(
      livePreviewSource.includes('Camera overlay ·'),
      'LiveRoomPreview must accurately describe the experience as a camera overlay rather than claiming native plane detection',
    );

    console.log('   ✅ ARScreen and LiveRoomPreview are reconciled into one honest room-preview experience.');
  }

  // ── TEST 6: Accessible Room-Preview Controls & Non-Gesture Alternatives ─
  console.log('\n🧪 [TEST 6] Verifying accessible room-preview controls, touch targets, and non-gesture buttons...');
  {
    const livePreviewSource = readAppFile('src/components/liveRoomPreview/LiveRoomPreview.js');
    const scaleLockSource = readAppFile('src/components/liveRoomPreview/ScaleLock.js');
    const draggableSource = readAppFile('src/components/liveRoomPreview/DraggableItem.js');
    const modelRendererSource = readAppFile('src/components/liveRoomPreview/ModelRenderer.js');

    const requiredLabels = [
      'accessibilityLabel="Go back"',
      'accessibilityLabel="Calibrate A4 scale"',
      'accessibilityLabel="Rotate left 45 degrees"',
      'accessibilityLabel="Rotate right 45 degrees"',
      'accessibilityLabel="Scale item smaller"',
      'accessibilityLabel="Scale item larger"',
      'accessibilityLabel="Reset position and scale"',
    ];
    for (const label of requiredLabels) {
      assert.ok(
        livePreviewSource.includes(label),
        `LiveRoomPreview must include ${label}`,
      );
    }

    assert.ok(
      livePreviewSource.includes('minWidth: 48') &&
        livePreviewSource.includes('minHeight: 50') &&
        livePreviewSource.includes('maxFontSizeMultiplier'),
      'LiveRoomPreview controls must enforce >=48px touch targets and font scaling caps',
    );

    assert.ok(
      scaleLockSource.includes('accessibilityLabel="Shrink A4 calibration guide"') &&
        scaleLockSource.includes('accessibilityLabel="Enlarge A4 calibration guide"') &&
        scaleLockSource.includes('accessibilityLabel="Lock calibrated scale"') &&
        scaleLockSource.includes('accessibilityLabel="Skip scale calibration and use approximate scale"'),
      'ScaleLock must provide non-gesture Smaller/Larger calibration buttons alongside pinch',
    );

    assert.ok(
      draggableSource.includes('rotateBy') &&
        draggableSource.includes('scaleBy') &&
        draggableSource.includes('resetTransform'),
      'DraggableItem must support imperative rotateBy, scaleBy, and resetTransform controls',
    );

    assert.ok(
      modelRendererSource.includes("type: 'ROTATE_BY'") &&
        modelRendererSource.includes("type: 'SCALE_BY'") &&
        modelRendererSource.includes("type: 'RECENTER'"),
      'ModelRenderer must support imperative ROTATE_BY, SCALE_BY, and RECENTER controls',
    );

    console.log('   ✅ Room preview hierarchy, >=48px touch targets, and non-gesture controls verified.');
  }

  console.log('\n==============================================================');
  console.log('   ✅ ALL 6 VISION SCANNER & ROOM PREVIEW TESTS PASSED!       ');
  console.log('==============================================================\n');
}

runVisionScannerAndRoomPreviewTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
