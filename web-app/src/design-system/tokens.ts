export const tokens = {
  colors: {
    paper: '#F7F3EC',
    ink: '#16140F',
    ember: '#C2410C',
    emberLight: '#EA580C',
    emberDark: '#9A3412',
    dim: '#6B6760',
    slate: '#3D3B36',
    surface: '#EFEBE3',
    surfaceRaised: '#F3EFE8',
    border: '#DDD9D1',
    borderStrong: '#C4BFB6',
    success: '#16A34A',
    successMuted: '#DCFCE7',
    warning: '#D97706',
    warningMuted: '#FEF3C7',
    danger: '#DC2626',
    dangerMuted: '#FEE2E2',
    info: '#2563EB',
    infoMuted: '#DBEAFE',
  },

  fonts: {
    display: 'var(--font-fraunces), Georgia, serif',
    sans: 'var(--font-inter), system-ui, sans-serif',
    serif: 'var(--font-spectral), Georgia, serif',
    mono: 'var(--font-jetbrains), "Courier New", monospace',
  },

  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '9999px',
  },

  animation: {
    easing: {
      spring: [0.16, 1, 0.3, 1] as [number, number, number, number],
      soft: [0.4, 0, 0.2, 1] as [number, number, number, number],
      bounce: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
      sharp: [0.4, 0, 1, 1] as [number, number, number, number],
    },
    duration: {
      instant: 100,
      fast: 150,
      normal: 250,
      slow: 450,
      crawl: 900,
    },
    stagger: 40,
  },

  shadows: {
    sm: '0 1px 3px rgba(22,20,15,0.08), 0 1px 2px rgba(22,20,15,0.04)',
    md: '0 4px 16px rgba(22,20,15,0.10), 0 2px 4px rgba(22,20,15,0.06)',
    lg: '0 16px 48px rgba(22,20,15,0.14), 0 4px 12px rgba(22,20,15,0.08)',
    xl: '0 32px 80px rgba(22,20,15,0.18), 0 8px 24px rgba(22,20,15,0.10)',
    ember: '0 8px 32px rgba(194,65,12,0.24)',
  },

  zIndex: {
    base: 0,
    raised: 10,
    dropdown: 100,
    sticky: 200,
    modal: 300,
    toast: 400,
    tooltip: 500,
  },
} as const

export type Tokens = typeof tokens
export type Color = keyof typeof tokens.colors
export type Font = keyof typeof tokens.fonts
