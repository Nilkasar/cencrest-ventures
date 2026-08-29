import { tokens } from './tokens'

const { animation } = tokens

// Framer Motion transition presets
export const spring = {
  type: 'tween' as const,
  ease: animation.easing.spring,
  duration: animation.duration.normal / 1000,
}

export const softTransition = {
  type: 'tween' as const,
  ease: animation.easing.soft,
  duration: animation.duration.normal / 1000,
}

export const fastTransition = {
  type: 'tween' as const,
  ease: animation.easing.spring,
  duration: animation.duration.fast / 1000,
}

// Variant presets
export const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: spring,
}

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: softTransition,
}

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: spring,
}

export const slideInRight = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24 },
  transition: spring,
}

export const slideInLeft = {
  initial: { opacity: 0, x: -24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: spring,
}

// Stagger helpers
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: animation.stagger / 1000,
      delayChildren: 0.05,
    },
  },
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: spring,
}

// Page transition (full page)
export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: {
    type: 'tween' as const,
    ease: animation.easing.spring,
    duration: animation.duration.slow / 1000,
  },
}

// GSAP easing strings (for GSAP usage)
export const gsapEase = {
  spring: 'power3.out',
  soft: 'power2.inOut',
  bounce: 'back.out(1.5)',
  sharp: 'power4.out',
}

// Counter animation settings
export const counterConfig = {
  duration: animation.duration.crawl / 1000,
  ease: 'power2.out',
}
