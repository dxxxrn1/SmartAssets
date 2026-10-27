// ─── SmartAssets AR Showcase Catalog ─────────────────────────────────────────
// Curated high-fidelity showcase items calibrated for 1:1 true-scale AR room preview.
// Supports both vertical (wall) and horizontal (floor/pedestal) surface detection.

export const AR_SURFACE_TYPES = {
  VERTICAL: 'vertical',     // Walls (e.g. paintings, framed fine art, wall clocks)
  HORIZONTAL: 'horizontal', // Floors & tables (e.g. furniture, sculptures, display stands)
  BOTH: 'both',             // Flexible (calibration targets, portable items)
};

export const AR_SHOWCASE_ITEMS = [
  {
    id: 'showcase-painting-venice',
    name: 'The Grand Canal: Venice Sunset',
    artist: 'Claude Monet (Studio Edition)',
    category: 'Fine Art',
    surface: AR_SURFACE_TYPES.VERTICAL,
    dimensions: {
      widthCm: 90,
      heightCm: 65,
      depthCm: 4,
      displayString: '90 × 65 cm (1:1 Wall Scale)',
    },
    // True metric meters [width, height, depth] for Viro AR
    trueScale: [0.90, 0.65, 0.04],
    initialPosition: [0, 0, -1.2],
    price: 48500,
    priceFormatted: '£48,500',
    sharePrice: 485,
    sharePriceFormatted: '£485 / share',
    sharesTotal: 100,
    sharesAvailable: 34,
    condition: 'Museum Archival A+',
    year: '1908 (Catalogued)',
    image: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1200&q=80',
    highResTexture: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1600&q=85',
    modelType: 'procedural_framed_canvas',
    frameColor: '#D4AF37', // Ornate Antique Gold Leaf
    frameThicknessMeters: 0.04,
    description: 'Archival oil on Belgian linen canvas mounted in handcrafted gilded gold frame. Detects your wall and locks flush against the vertical surface at exact physical dimensions.',
    tag: 'WALL SHOWCASE',
    badgeColor: '#F59E0B',
  },
  {
    id: 'showcase-lounge-chair',
    name: 'Eames Lounge Chair & Ottoman',
    artist: 'Charles & Ray Eames',
    category: 'Designer Furniture',
    surface: AR_SURFACE_TYPES.HORIZONTAL,
    dimensions: {
      widthCm: 84,
      depthCm: 85,
      heightCm: 84,
      displayString: '84 × 85 × 84 cm (1:1 Floor Scale)',
    },
    trueScale: [0.84, 0.84, 0.85],
    initialPosition: [0, -0.5, -1.5],
    price: 7800,
    priceFormatted: '£7,800',
    sharePrice: 78,
    sharePriceFormatted: '£78 / share',
    sharesTotal: 100,
    sharesAvailable: 52,
    condition: 'Pristine Collector Condition',
    year: '1956 Heritage',
    image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1200&q=80',
    // High-fidelity Sheen Chair GLB model (Official Khronos sample)
    glbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/SheenChair/glTF-Binary/SheenChair.glb',
    modelType: 'glb',
    hasGroundShadow: true,
    shadowRadiusMeters: 0.55,
    description: 'Molded Brazilian rosewood plywood shell with premium obsidian aniline leather. Anchors to detected hardwood or carpet floors with real-time room lighting and soft ground shadow.',
    tag: 'FLOOR SHOWCASE',
    badgeColor: '#10B981',
  },
  {
    id: 'showcase-sculpture-hermes',
    name: 'Classical Carrara Marble Bust: Apollo',
    artist: 'Neoclassical Atelier',
    category: 'Sculpture & Antiquities',
    surface: AR_SURFACE_TYPES.HORIZONTAL,
    dimensions: {
      widthCm: 45,
      depthCm: 32,
      heightCm: 72,
      displayString: '45 × 32 × 72 cm (1:1 Pedestal Scale)',
    },
    trueScale: [0.45, 0.72, 0.32],
    initialPosition: [0, -0.4, -1.3],
    price: 125000,
    priceFormatted: '£125,000',
    sharePrice: 1250,
    sharePriceFormatted: '£1,250 / share',
    sharesTotal: 100,
    sharesAvailable: 18,
    condition: 'Archival Preservation Grade',
    year: 'c. 1820',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1200&q=80',
    glbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
    modelType: 'glb',
    hasGroundShadow: true,
    shadowRadiusMeters: 0.35,
    description: 'Carved from monolithic statuario Carrara marble. Sub-millimeter photogrammetry scan reacting dynamically to your room’s natural ambient and directional light.',
    tag: 'PEDESTAL SHOWCASE',
    badgeColor: '#6366F1',
  },
  {
    id: 'showcase-rolex-vitrine',
    name: 'Rolex Daytona 116500LN Exhibition Plinth',
    artist: 'Rolex Geneva Custodian',
    category: 'Collector Watch',
    surface: AR_SURFACE_TYPES.HORIZONTAL,
    dimensions: {
      widthCm: 30,
      depthCm: 30,
      heightCm: 45,
      displayString: '30 × 30 × 45 cm (1:1 Tabletop Plinth)',
    },
    trueScale: [0.30, 0.45, 0.30],
    initialPosition: [0, -0.2, -1.0],
    price: 34500,
    priceFormatted: '£34,500',
    sharePrice: 345,
    sharePriceFormatted: '£345 / share',
    sharesTotal: 100,
    sharesAvailable: 41,
    condition: 'Mint / Full Set',
    year: '2019',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200&q=80',
    modelType: 'pedestal_vitrine',
    hasGroundShadow: true,
    shadowRadiusMeters: 0.28,
    description: 'Museum-grade acrylic vitrine display stand featuring the ceramic-bezel Daytona. Perfect for previewing on a desk, console table, or display plinth.',
    tag: 'HOROLOGY SHOWCASE',
    badgeColor: '#00C2FF',
  },
  {
    id: 'showcase-calibration-cube',
    name: 'AR Spatial Calibration Target (Day 1)',
    artist: 'SmartAssets Engineering Lab',
    category: 'Spatial Calibration',
    surface: AR_SURFACE_TYPES.BOTH,
    dimensions: {
      widthCm: 20,
      depthCm: 20,
      heightCm: 20,
      displayString: '20 × 20 × 20 cm (Calibration Target)',
    },
    trueScale: [0.20, 0.20, 0.20],
    initialPosition: [0, 0, -1.0],
    price: 1000,
    priceFormatted: '£1,000 (Test Token)',
    sharePrice: 10,
    sharePriceFormatted: '£10 / share',
    sharesTotal: 100,
    sharesAvailable: 100,
    condition: 'Millimeter Calibrated',
    year: '2026',
    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80',
    modelType: 'test_cube',
    hasGroundShadow: true,
    shadowRadiusMeters: 0.20,
    description: 'The Day 1 testing target. Tests wall and floor plane detection, 6DoF tracking lock, and coordinate retention as you walk around the physical room.',
    tag: 'CALIBRATION TARGET',
    badgeColor: '#EC4899',
  },
];

// Helper to look up showcase item by id or fallback to matching asset
export function getShowcaseItemById(id) {
  if (!id) return AR_SHOWCASE_ITEMS[0];
  const found = AR_SHOWCASE_ITEMS.find((item) => item.id === id);
  return found || AR_SHOWCASE_ITEMS[0];
}

// Map any marketplace asset to an AR showcase item configuration
export function matchAssetToARShowcase(asset) {
  if (!asset) return AR_SHOWCASE_ITEMS[0];
  
  // If asset has a specific showcaseId attached
  if (asset.showcaseId) {
    const direct = AR_SHOWCASE_ITEMS.find((s) => s.id === asset.showcaseId);
    if (direct) return direct;
  }

  const name = (asset.name || '').toLowerCase();
  const cat = (asset.category || '').toLowerCase();

  if (cat.includes('art') || cat.includes('painting') || name.includes('painting') || name.includes('monet')) {
    return {
      ...AR_SHOWCASE_ITEMS[0],
      name: asset.name || AR_SHOWCASE_ITEMS[0].name,
      price: asset.price || AR_SHOWCASE_ITEMS[0].price,
      priceFormatted: typeof asset.price === 'number' ? `£${asset.price.toLocaleString('en-GB')}` : String(asset.price || '£48,500'),
      image: asset.image || AR_SHOWCASE_ITEMS[0].image,
      highResTexture: asset.image || AR_SHOWCASE_ITEMS[0].highResTexture,
    };
  }

  if (cat.includes('furniture') || name.includes('chair') || name.includes('lounge') || name.includes('table')) {
    return {
      ...AR_SHOWCASE_ITEMS[1],
      name: asset.name || AR_SHOWCASE_ITEMS[1].name,
      price: asset.price || AR_SHOWCASE_ITEMS[1].price,
      priceFormatted: typeof asset.price === 'number' ? `£${asset.price.toLocaleString('en-GB')}` : String(asset.price || '£7,800'),
      image: asset.image || AR_SHOWCASE_ITEMS[1].image,
    };
  }

  if (cat.includes('sculpture') || cat.includes('antiquity') || name.includes('bust') || name.includes('statue')) {
    return {
      ...AR_SHOWCASE_ITEMS[2],
      name: asset.name || AR_SHOWCASE_ITEMS[2].name,
      price: asset.price || AR_SHOWCASE_ITEMS[2].price,
      priceFormatted: typeof asset.price === 'number' ? `£${asset.price.toLocaleString('en-GB')}` : String(asset.price || '£125,000'),
      image: asset.image || AR_SHOWCASE_ITEMS[2].image,
    };
  }

  if (cat.includes('watch') || name.includes('rolex') || name.includes('daytona') || name.includes('patek')) {
    return {
      ...AR_SHOWCASE_ITEMS[3],
      name: asset.name || AR_SHOWCASE_ITEMS[3].name,
      price: asset.price || AR_SHOWCASE_ITEMS[3].price,
      priceFormatted: typeof asset.price === 'number' ? `£${asset.price.toLocaleString('en-GB')}` : String(asset.price || '£34,500'),
      image: asset.image || AR_SHOWCASE_ITEMS[3].image,
    };
  }

  // Fallback default
  return {
    ...AR_SHOWCASE_ITEMS[0],
    name: asset.name || AR_SHOWCASE_ITEMS[0].name,
    price: asset.price || AR_SHOWCASE_ITEMS[0].price,
    image: asset.image || AR_SHOWCASE_ITEMS[0].image,
  };
}
