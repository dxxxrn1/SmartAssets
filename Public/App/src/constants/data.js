// ─── Asset Data ──────────────────────────────────────────────────────────────
// Dynamic assets are loaded from Supabase database.

export const ASSETS = [];

export const CATEGORIES = ['All', 'Watches', 'Art', 'Cars', 'Wine'];

export const VAULT_ASSETS = [];

export const ONBOARDING_SLIDES = [
  {
    title: 'Every Asset, Verified',
    sub: 'Professional appraisers review physical condition, provenance, and authenticity before listing.',
    icon: '🔍',
    image: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=600&h=420&fit=crop&auto=format',
  },
  {
    title: 'Blockchain Certificates',
    sub: 'Each verified collectible receives a permanent, tamper-proof digital certificate stored securely.',
    icon: '⛓️',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=600&h=420&fit=crop&auto=format',
  },
  {
    title: 'Invest in Fractions',
    sub: 'Co-own fine art, watches, or vintage sports cars. Start fractional ownership from £100 per share.',
    icon: '📊',
    image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=420&fit=crop&auto=format',
  },
];

export const PROVENANCE_EVENTS = [
  { date: '14 Mar 2024', title: 'Submitted to SmartAssets', detail: 'Uploaded with complete documentation', icon: '◆' },
  { date: '18 Mar 2024', title: 'Appraiser Inspection — Dr. Chen', detail: 'Physical condition confirmed: Museum Grade.', icon: '✓' },
  { date: '20 Mar 2024', title: 'Blockchain Certificate Issued', detail: 'SA-CERT-2024-0047', icon: '⛓' },
  { date: '12 Sep 2021', title: 'Purchased at Auction', detail: "Christie's London — Lot 247. Hammer price £29,800", icon: '🔨' },
  { date: '05 Jan 2019', title: 'Original Retail Purchase', detail: 'Rolex Authorised Dealer, New Bond St, London', icon: '🏪' },
  { date: 'Nov 2019', title: 'Manufactured in Switzerland', detail: 'Rolex SA, Geneva. Serial #7J42189', icon: '🏭' },
];

export const HEALTH_SCORES = [
  { label: 'Authenticity Verification', score: 98, color: '#10B981' },
  { label: 'Physical Condition Grade', score: 94, color: '#10B981' },
  { label: 'Market Demand Liquidity', score: 86, color: '#0284C7' },
  { label: 'Price Comps Alignment', score: 91, color: '#0284C7' },
  { label: 'Fraud Pattern Risk', score: 2, color: '#10B981', invert: true },
];
