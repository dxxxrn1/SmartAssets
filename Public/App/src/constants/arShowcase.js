// ─── Demo 3D Showcase Catalog ────────────────────────────────────────────────
// Sample Khronos glTF 2.0 models reserved strictly for the labeled Demo Room
// Preview Showcase (`isDemoShowcase: true`). Never silently attached to real
// marketplace listings that lack their own 3D model URL.

export const AR_SHOWCASE_ITEMS = [
  {
    id: 'showcase-lounge-chair',
    name: 'Velvet Designer Lounge Chair (Demo)',
    category: 'Demo Showcase • Furniture',
    era: 'Demo 3D Model',
    price: 'R76 000',
    sharePrice: 'R3 800',
    certified: true,
    isDemoShowcase: true,
    certId: 'DEMO-3D-CHAIR',
    placement: 'floor',
    dimensions: { widthCm: 75, heightCm: 85, depthCm: 80 },
    glbUrl: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/sheen_chair.glb',
    fallbackGlbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SheenChair/glTF-Binary/SheenChair.glb',
    usdzUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
    poster: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
    accent: '#C084FC',
    scaleHint: '75 × 85 × 80 cm (Floor overlay)',
    arNote: 'Demo sample 3D model rendered over your live camera feed. Drag to reposition, pinch or use buttons to rotate and scale.',
  },
  {
    id: 'showcase-helmet-sculpture',
    name: 'Sci-Fi Patina Bronze Helmet (Demo)',
    category: 'Demo Showcase • Sculpture',
    era: 'Demo 3D Model',
    price: 'R365 000',
    sharePrice: 'R9 125',
    certified: true,
    isDemoShowcase: true,
    certId: 'DEMO-3D-HELMET',
    placement: 'floor',
    dimensions: { widthCm: 36, heightCm: 42, depthCm: 38 },
    glbUrl: 'https://modelviewer.dev/shared-assets/models/DamagedHelmet.glb',
    usdzUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
    poster: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&q=80',
    accent: '#38BDF8',
    scaleHint: '36 × 42 × 38 cm (Pedestal overlay)',
    arNote: 'Demo sample 3D model rendered over your live camera feed with PBR metallic textures.',
  },
  {
    id: 'showcase-vintage-camera',
    name: 'Antique Brass Rangefinder Camera (Demo)',
    category: 'Demo Showcase • Collectibles',
    era: 'Demo 3D Model',
    price: 'R295 000',
    sharePrice: 'R5 900',
    certified: true,
    isDemoShowcase: true,
    certId: 'DEMO-3D-CAMERA',
    placement: 'floor',
    dimensions: { widthCm: 22, heightCm: 18, depthCm: 20 },
    glbUrl: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/antique_camera.glb',
    fallbackGlbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AntiqueCamera/glTF-Binary/AntiqueCamera.glb',
    usdzUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
    poster: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&q=80',
    accent: '#F59E0B',
    scaleHint: '22 × 18 × 20 cm (Tabletop overlay)',
    arNote: 'Demo sample 3D model with optical glass and tripod assembly over your live camera feed.',
  },
];

/**
 * Built-in fallback candidates from the Smart Assets curated catalog.
 * Surfaced whenever network or API is offline, guaranteeing immediate user access to category models.
 */
export const BUILTIN_CATALOG_FALLBACKS = [
  {
    score: 0.85,
    isAutoEligible: false,
    model: {
      id: '11111111-1111-4000-8000-000000000001',
      name: 'Antique Camera',
      category: 'Collectibles',
      placement: 'table',
      glb_url: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/antique_camera.glb',
      thumbnail_url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&q=80',
      width_cm: 22,
      height_cm: 18,
      depth_cm: 20,
      attribution: 'Antique Camera created by Maximillan Kamps, © UX3D. Dedicated to public domain under CC0 1.0.',
      license: 'CC0-1.0',
    },
  },
  {
    score: 0.85,
    isAutoEligible: false,
    model: {
      id: '11111111-1111-4000-8000-000000000002',
      name: 'Sheen Chair',
      category: 'Furniture',
      placement: 'floor',
      glb_url: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/sheen_chair.glb',
      thumbnail_url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
      width_cm: 75,
      height_cm: 85,
      depth_cm: 80,
      attribution: 'Sheen Chair created by Eric Chadwick for Wayfair, LLC. Dedicated to public domain under CC0 1.0.',
      license: 'CC0-1.0',
    },
  },
  {
    score: 0.80,
    isAutoEligible: false,
    model: {
      id: '11111111-1111-4000-8000-000000000004',
      name: 'Toy Car',
      category: 'Collectibles',
      placement: 'table',
      glb_url: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/toy_car.glb',
      thumbnail_url: 'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f?w=800&q=80',
      width_cm: 28,
      height_cm: 14,
      depth_cm: 16,
      attribution: 'Toy Car initial model by Guido Odendahl, extensions by Eric Chadwick. Dedicated to public domain under CC0 1.0.',
      license: 'CC0-1.0',
    },
  },
  {
    score: 0.75,
    isAutoEligible: false,
    model: {
      id: '11111111-1111-4000-8000-000000000003',
      name: 'Street Lantern',
      category: 'Antiques',
      placement: 'floor',
      glb_url: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/street_lantern.glb',
      thumbnail_url: 'https://images.unsplash.com/photo-1507034589631-9433cc6bc453?w=800&q=80',
      width_cm: 32,
      height_cm: 75,
      depth_cm: 32,
      attribution: 'Street Lantern model and textures by Microsoft. Dedicated to public domain under CC0 1.0.',
      license: 'CC0-1.0',
    },
  },
  {
    score: 0.70,
    isAutoEligible: false,
    model: {
      id: '11111111-1111-4000-8000-000000000005',
      name: 'Flight Helmet',
      category: 'Aviation',
      placement: 'pedestal',
      glb_url: 'https://hjgweivvetdtbfpmrcnr.supabase.co/storage/v1/object/public/models/catalog/flight_helmet.glb',
      thumbnail_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&q=80',
      width_cm: 34,
      height_cm: 38,
      depth_cm: 36,
      attribution: 'Flight Helmet asset created by Patrick Ryan & Gary Hsu, © Microsoft Corporation. Licensed under CC-BY-4.0.',
      license: 'CC-BY-4.0',
    },
  },
];

/**
 * Resolves room-preview metadata for an asset WITHOUT substituting generic
 * sample 3D models onto real marketplace listings.
 */
export function matchAssetToARShowcase(asset) {
  if (!asset) return AR_SHOWCASE_ITEMS[0];

  if (asset.isDemoShowcase) {
    const byId = AR_SHOWCASE_ITEMS.find((item) => item.id === asset.id || item.id === asset.showcaseId);
    return byId || AR_SHOWCASE_ITEMS[0];
  }

  const explicitGlbUrl =
    asset.glbUrl ||
    asset.glb_url ||
    asset.model?.glb_url ||
    asset.modelUrl ||
    null;

  return {
    id: String(asset.id || asset._id || 'listing-preview'),
    name: asset.name || asset.title || 'Marketplace Listing',
    category: asset.category || 'Marketplace Asset',
    era: asset.year || 'Verified Listing',
    price: asset.price || 'R0',
    certified: Boolean(asset.cert || asset.certId),
    isDemoShowcase: false,
    certId: asset.cert || asset.certId || null,
    glbUrl: explicitGlbUrl,
    poster: asset.image || (Array.isArray(asset.images) ? asset.images[0] : null) || null,
    accent: '#22D3EE',
    scaleHint: explicitGlbUrl ? '3D model overlay' : '2D listing photo overlay (no 3D model attached)',
    arNote: explicitGlbUrl
      ? '3D model attached to this listing rendered over your live camera background.'
      : 'No 3D model is attached to this listing. Showing its real 2D listing photo over your camera feed.',
  };
}
