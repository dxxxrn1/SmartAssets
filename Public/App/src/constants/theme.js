// ─── SmartAssets Design Tokens ───────────────────────────────────────────────
// Ported from the Figma prototype — sky/ice blue palette, light + dark modes

export const FONTS = {
  display: 'Georgia', // Playfair Display fallback (native)
  body: 'System',     // Outfit / Plus Jakarta Sans (load via expo-font)
  mono: 'Courier',    // DM Mono fallback
};

const light = {
  // Primary – Sky blue
  primary: '#0284C7',
  primaryLight: '#38BDF8',
  primaryDim: '#0369A1',
  primaryBg: '#E0F2FE',
  primarySubtle: '#F0F9FF',
  accentGlow: 'rgba(56,189,248,0.25)',

  // Surfaces
  canvas: '#EBF2F8',
  obsidian: '#F4F8FC',
  vault: '#FFFFFF',
  card: '#FFFFFF',
  cardLight: '#F0F6FC',
  border: '#D3E2F0',
  borderSubtle: '#E4EFF8',

  // Typography
  warm: '#0F172A',
  muted: '#64748B',
  subtle: '#94A3B8',

  // Status
  green: '#10B981',
  greenBg: 'rgba(16,185,129,0.12)',
  red: '#EF4444',
  redBg: 'rgba(239,68,68,0.12)',
  blue: '#0284C7',
  blueBg: 'rgba(2,132,199,0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245,158,11,0.15)',
};

const dark = {
  // Primary – Glowing ice sky blue
  primary: '#38BDF8',
  primaryLight: '#7DD3FC',
  primaryDim: '#0284C7',
  primaryBg: 'rgba(56,189,248,0.15)',
  primarySubtle: 'rgba(56,189,248,0.08)',
  accentGlow: 'rgba(56,189,248,0.35)',

  // Surfaces
  canvas: '#051121',
  obsidian: '#0A1628',
  vault: '#0F1E38',
  card: '#162847',
  cardLight: '#1C3154',
  border: '#243A60',
  borderSubtle: '#1C2F4F',

  // Typography
  warm: '#F8FAFC',
  muted: '#94A3B8',
  subtle: '#64748B',

  // Status
  green: '#34D399',
  greenBg: 'rgba(52,211,153,0.15)',
  red: '#F87171',
  redBg: 'rgba(248,113,113,0.15)',
  blue: '#38BDF8',
  blueBg: 'rgba(56,189,248,0.18)',
  amber: '#FBBF24',
  amberBg: 'rgba(251,191,36,0.15)',
};

export const Colors = { light, dark };

// Helper – call with isDark boolean
export function useColors(isDark) {
  return isDark ? Colors.dark : Colors.light;
}
