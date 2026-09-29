const fs = require('fs');

const themeCode = `// ─── SmartAssets Design Tokens ───────────────────────────────────────────────
// Inspired by the AlimBank modern fintech style:
// Midnight Charcoal Header, Vibrant Emerald Green Card & Accents, Warm Cream Canvas

export const FONTS = {
  display: 'Georgia',
  body: 'System',
  mono: 'Courier',
};

export const ALIM = {
  // Emerald Green signature
  emerald: '#00A86B',
  emeraldGradient: ['#00B377', '#00965E', '#008552'],
  emeraldLight: '#10B981',
  emeraldDark: '#007A4D',
  emeraldBg: 'rgba(0, 168, 107, 0.12)',
  emeraldGlow: 'rgba(0, 168, 107, 0.35)',

  // Midnight Charcoal header & dark surfaces
  darkHeader: '#0E131F',
  darkHeaderGradient: ['#0E131F', '#131A29', '#1A2338'],
  darkCard: '#151C2C',

  // Warm porcelain / ivory canvas
  canvas: '#FAF8F4',
  canvasSubtle: '#F4F1EA',
  cardWhite: '#FFFFFF',
  cardBorder: '#EDE9E1',
  cardBorderSubtle: '#F0ECE4',

  // Typography
  textDark: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  textLight: '#FFFFFF',

  // Status & Accents
  gold: '#F59E0B',
  goldBg: 'rgba(245, 158, 11, 0.15)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
};

const light = {
  // Primary – Emerald Green
  primary: '#00A86B',
  primaryLight: '#10B981',
  primaryDim: '#00875A',
  primaryBg: 'rgba(0, 168, 107, 0.12)',
  primarySubtle: 'rgba(0, 168, 107, 0.06)',
  accentGlow: 'rgba(0, 168, 107, 0.25)',

  // Surfaces
  canvas: '#FAF8F4',
  obsidian: '#0E131F',
  vault: '#FFFFFF',
  card: '#FFFFFF',
  cardLight: '#F7F5EE',
  border: '#EDE9E1',
  borderSubtle: '#F0ECE4',

  // Typography
  warm: '#0F172A',
  muted: '#64748B',
  subtle: '#94A3B8',

  // Status
  green: '#00A86B',
  greenBg: 'rgba(0, 168, 107, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
  blue: '#0284C7',
  blueBg: 'rgba(2, 132, 199, 0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.15)',
};

const dark = {
  // Primary – Glowing Emerald Green
  primary: '#00A86B',
  primaryLight: '#10B981',
  primaryDim: '#00875A',
  primaryBg: 'rgba(0, 168, 107, 0.18)',
  primarySubtle: 'rgba(0, 168, 107, 0.08)',
  accentGlow: 'rgba(0, 168, 107, 0.35)',

  // Surfaces
  canvas: '#0E131F',
  obsidian: '#0A0E17',
  vault: '#131A2A',
  card: '#151D2F',
  cardLight: '#1A243A',
  border: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.05)',

  // Typography
  warm: '#F8FAFC',
  muted: '#94A3B8',
  subtle: '#64748B',

  // Status
  green: '#00A86B',
  greenBg: 'rgba(0, 168, 107, 0.18)',
  red: '#F87171',
  redBg: 'rgba(248, 113, 113, 0.15)',
  blue: '#38BDF8',
  blueBg: 'rgba(56, 189, 248, 0.18)',
  amber: '#FBBF24',
  amberBg: 'rgba(251, 191, 36, 0.15)',
};

export const Colors = { light, dark };

// Helper – call with isDark boolean
export function useColors(isDark) {
  return isDark ? Colors.dark : Colors.light;
}
`;

fs.writeFileSync('Public/App/src/constants/theme.js', themeCode, 'utf8');
console.log('Successfully wrote theme.js directly to disk');
