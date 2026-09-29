// ─── SmartAssets Design Tokens ───────────────────────────────────────────────
// Inspired by the Royal Indigo & Crisp Modern Fintech style:
// Deep Royal Indigo Header (#1E2768 / #333D9B / #3C48AA),
// Pure White Cards & Canvas, Electric Blue (#3666DD), Coral (#F05F3C), & Teal (#4BB7A9) Accents

export const FONTS = {
  display: 'Georgia',
  body: 'System',
  mono: 'Courier',
};

export const ROYAL = {
  // Deep Royal Indigo signature (Header & primary brand surfaces)
  indigo: '#1E2768',
  indigoDark: '#1E2768',
  indigoLight: '#3C48AA',
  indigoGradient: ['#1E2768', '#2B3B95', '#3C48AA'],
  indigoBg: 'rgba(51, 61, 155, 0.12)',
  indigoGlow: 'rgba(51, 61, 155, 0.35)',

  // Primary Action Button (Luminous Royal Blue)
  blue: '#3666DD',
  blueGradient: ['#3B82F6', '#3666DD', '#2563EB'],
  blueLight: '#60A5FA',

  // Feature Card Gradients (from reference mockup)
  cardBlue: '#3666DD',
  cardBlueGradient: ['#3B82F6', '#3666DD', '#1D4ED8'],
  cardOrange: '#F05F3C',
  cardOrangeGradient: ['#FB923C', '#F05F3C', '#EA580C'],
  cardTeal: '#4BB7A9',
  cardTealGradient: ['#2DD4BF', '#4BB7A9', '#0D9488'],

  // Header & dark surfaces
  darkHeader: '#1E2768',
  darkHeaderGradient: ['#1E2768', '#2B3B95', '#3C48AA'],
  darkCard: '#151D42',

  // Canvas & cards (Crisp pure white & subtle neutrals)
  canvas: '#FFFFFF',
  canvasSubtle: '#F8FAFC',
  cardWhite: '#FFFFFF',
  cardBorder: '#E2E8F0',
  cardBorderSubtle: '#F1F5F9',

  // Gain & Success (Luminous green from balance card)
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

// Aliased as ALIM for seamless backward-compatibility across all screens
export const ALIM = {
  ...ROYAL,
  // Mapping button tokens to Royal Blue
  mint: ROYAL.blue,
  mintGradient: ROYAL.blueGradient,
  mintText: '#FFFFFF',
  mintGlow: 'rgba(54, 102, 221, 0.4)',
  emerald: ROYAL.indigo,
  emeraldGradient: ROYAL.indigoGradient,
  emeraldLight: ROYAL.blue,
  emeraldDark: ROYAL.indigoDark,
};

const light = {
  // Primary – Royal Indigo & Blue
  primary: '#3666DD',
  primaryLight: '#60A5FA',
  primaryDim: '#2563EB',
  primaryText: '#FFFFFF',
  primaryBg: 'rgba(54, 102, 221, 0.15)',
  primarySubtle: 'rgba(54, 102, 221, 0.08)',
  accentGlow: 'rgba(54, 102, 221, 0.25)',

  // Surfaces
  canvas: '#FFFFFF',
  obsidian: '#1E2768',
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
  blue: '#3666DD',
  blueBg: 'rgba(54, 102, 221, 0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.15)',
};

const dark = {
  // Primary – Glowing Royal Indigo
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  primaryDim: '#2563EB',
  primaryText: '#FFFFFF',
  primaryBg: 'rgba(59, 130, 246, 0.18)',
  primarySubtle: 'rgba(59, 130, 246, 0.08)',
  accentGlow: 'rgba(59, 130, 246, 0.35)',

  // Surfaces
  canvas: '#0F172A',
  obsidian: '#0A0E1A',
  vault: '#131A2F',
  card: '#182138',
  cardLight: '#1E294B',
  border: 'rgba(255, 255, 255, 0.08)',
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
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.2)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.2)',
};

export const useColors = (isDark = false) => {
  return isDark ? dark : light;
};

