export const colors = {
  primary: '#CC0000',
  primaryDark: '#990000',
  primaryLight: '#FF3333',
  secondary: '#F5A800',
  secondaryDark: '#D48C00',

  background: '#F4F4F6',
  surface: '#FFFFFF',
  surface2: '#F0F0F3',
  surfaceDark: '#111111',
  surfaceDark2: '#1C1C1E',

  text: '#0F0F0F',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',

  border: '#E5E7EB',
  borderDark: '#2C2C2E',

  success: '#059669',
  successLight: '#D1FAE5',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  warning: '#D97706',
  warningLight: '#FEF3C7',

  overlay: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0,0,0,0.15)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
  },
  colored: {
    shadowColor: '#CC0000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 8,
  },
};

export const typography = {
  display: { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400', lineHeight: 20 },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
};

export const gradients = {
  primary: ['#DD0000', '#880000'],
  dark: ['#1C1C1E', '#0A0A0A'],
  gold: ['#F5A800', '#C87800'],
  success: ['#059669', '#047857'],
};
