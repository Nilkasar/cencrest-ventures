import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F7F3EC',
        ink: '#16140F',
        ember: { DEFAULT: '#C2410C', light: '#EA580C', dark: '#9A3412' },
        dim: '#6B6760',
        slate: '#3D3B36',
        surface: { DEFAULT: '#EFEBE3', raised: '#F3EFE8' },
        border: { DEFAULT: '#DDD9D1', strong: '#C4BFB6' },
        success: { DEFAULT: '#16A34A', muted: '#DCFCE7' },
        warning: { DEFAULT: '#D97706', muted: '#FEF3C7' },
        danger: { DEFAULT: '#DC2626', muted: '#FEE2E2' },
        info: { DEFAULT: '#2563EB', muted: '#DBEAFE' },
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-spectral)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains)', '"Courier New"', 'monospace'],
      },
      borderRadius: {
        sm: '4px', md: '8px', lg: '12px', xl: '16px', '2xl': '24px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(22,20,15,0.08)',
        md: '0 4px 16px rgba(22,20,15,0.10)',
        lg: '0 16px 48px rgba(22,20,15,0.14)',
        xl: '0 32px 80px rgba(22,20,15,0.18)',
        ember: '0 8px 32px rgba(194,65,12,0.24)',
      },
      animation: {
        'fade-up': 'fadeUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
        'fade-in': 'fadeIn 0.25s ease forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'counter': 'counter 0.9s ease-out forwards',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16,1,0.3,1)',
        soft: 'cubic-bezier(0.4,0,0.2,1)',
        bounce: 'cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
  plugins: [],
}

export default config
