// ─── SmartAssets Design Tokens ───────────────────────────────────────────────
// Unified SmartAssets Luminous Lavender & Violet-Cyan Glassmorphism Theme
// Matches HomeScreen, VaultScreen, InvestScreen, and SearchScreen across the entire app.

export const FONTS = {
  display: 'Georgia',
  body: 'System',
  mono: 'Courier',
};

export const ROYAL = {
  // Deep Royal Violet-Indigo signature (Header & primary brand surfaces)
  indigo: '#5B36F5',
  indigoDark: '#4C1D95',
  indigoLight: '#7C3AED',
  indigoGradient: ['#7C3AED', '#5B36F5', '#2563EB'],
  indigoBg: 'rgba(124, 58, 237, 0.12)',
  indigoGlow: 'rgba(124, 58, 237, 0.35)',

  // Primary Action Button (Luminous Violet-Blue)
  blue: '#7C3AED',
  blueGradient: ['#7C3AED', '#5B36F5', '#2563EB'],
  blueLight: '#976af0',

  // Feature Card Gradients
  cardBlue: '#5B36F5',
  cardBlueGradient: ['#7C3AED', '#5B36F5', '#2563EB'],
  cardOrange: '#F05F3C',
  cardOrangeGradient: ['#FB923C', '#F05F3C', '#EA580C'],
  cardTeal: '#4BB7A9',
  cardTealGradient: ['#2DD4BF', '#4BB7A9', '#0D9488'],

  // Header & dark surfaces
  darkHeader: '#2E1065',
  darkHeaderGradient: ['#4C1D95', '#5B36F5', '#2563EB'],
  darkCard: '#151D42',

  // Canvas & cards (Crisp pure white & subtle lavender neutrals)
  canvas: '#F5F3FF',
  canvasSubtle: '#F8FAFC',
  cardWhite: '#FFFFFF',
  cardBorder: '#E2E8F0',
  cardBorderSubtle: '#F1F5F9',

  // Gain & Success
  green: '#10B981',
  greenGain: '#34D399',
  greenBg: 'rgba(16, 185, 129, 0.12)',

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

// ─── Purple/Violet Glassmorphism Theme (Mockups 2025/2026) ───────────────────
export const PURPLE_THEME = {
  heroGradient: ['#7C3AED', '#5B36F5', '#2563EB', '#00C2FF'],
  walletGradient: ['#976af0', '#00fbff'],
  canvasMesh: [
    '#e4e0ffff', // Soft luminous lavender
    '#e0daffff', // Soft purple aura
    '#f5dfefff', // Soft lilac-pink
    '#fff5efff', // Soft peach aura
    '#ffffffff', // Ambient cream
  ],
  primary: '#976af0',
  primaryViolet: '#7C3AED',
  primaryElectric: '#5B36F5',
  primaryCyan: '#00fbff',
  primaryLight: '#F5F3FF',
  primarySubtle: 'rgba(151, 106, 240, 0.08)',
  textDark: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  cardWhite: '#FFFFFF',
  cardBorder: 'rgba(226, 232, 240, 0.8)',
  cardBorderSubtle: 'rgba(241, 245, 249, 0.9)',
  badgeVerifiedBg: 'rgba(15, 23, 42, 0.65)',
  badgeGainBg: 'rgba(255, 255, 255, 0.92)',
  badgeGainGreen: '#10B981',
};

// Aliased as ALIM for seamless backward-compatibility across all screens
export const ALIM = {
  ...ROYAL,
  mint: ROYAL.blue,
  mintGradient: ROYAL.blueGradient,
  mintText: '#FFFFFF',
  mintGlow: 'rgba(124, 58, 237, 0.4)',
  emerald: ROYAL.indigo,
  emeraldGradient: ROYAL.indigoGradient,
  emeraldLight: ROYAL.blue,
  emeraldDark: ROYAL.indigoDark,
};

const light = {
  // Primary – SmartAssets Violet & Electric Indigo
  primary: '#7C3AED',
  primaryLight: '#976af0',
  primaryDim: '#5B36F5',
  primaryText: '#FFFFFF',
  primaryBg: 'rgba(124, 58, 237, 0.12)',
  primarySubtle: 'rgba(124, 58, 237, 0.08)',
  accentGlow: 'rgba(124, 58, 237, 0.25)',

  // Surfaces (Soft Lavender Canvas & Frosted White Cards — never dark blue behind dark text)
  canvas: '#F5F3FF',
  obsidian: '#F5F3FF',
  vault: '#FFFFFF',
  card: '#FFFFFF',
  cardLight: '#F8FAFC',
  border: '#E2E8F0',
  borderSubtle: '#F1F5F9',

  // Typography
  warm: '#0F172A',
  muted: '#64748B',
  subtle: '#94A3B8',

  // Status
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
  blue: '#5B36F5',
  blueBg: 'rgba(91, 54, 245, 0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.15)',
};

const dark = {
  // Primary – Glowing SmartAssets Violet
  primary: '#976af0',
  primaryLight: '#A855F7',
  primaryDim: '#7C3AED',
  primaryText: '#FFFFFF',
  primaryBg: 'rgba(151, 106, 240, 0.18)',
  primarySubtle: 'rgba(151, 106, 240, 0.08)',
  accentGlow: 'rgba(151, 106, 240, 0.35)',

  // Surfaces
  canvas: '#0F172A',
  obsidian: '#0A0E1A',
  vault: '#131A2F',
  card: '#182138',
  cardLight: '#1E294B',
  border: 'rgba(255, 255, 255, 0.1)',
  borderSubtle: 'rgba(255, 255, 255, 0.05)',

  // Typography
  warm: '#F8FAFC',
  muted: '#94A3B8',
  subtle: '#64748B',

  // Status
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.2)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.2)',
  blue: '#976af0',
  blueBg: 'rgba(151, 106, 240, 0.2)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.2)',
};

export const useColors = (isDark = false) => {
  return isDark ? dark : light;
};
