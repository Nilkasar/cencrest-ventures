/* Kept for backwards-compat import path.
   New code should import from `@/lib/motion`. */

const springEase = [0.16, 1, 0.3, 1] as [number, number, number, number]
const softEase = [0.4, 0, 0.2, 1] as [number, number, number, number]

export const spring = {
  type: 'tween' as const,
  ease: springEase,
  duration: 0.25,
}

export const softTransition = {
  type: 'tween' as const,
  ease: softEase,
  duration: 0.25,
}

export const fastTransition = {
  type: 'tween' as const,
  ease: springEase,
  duration: 0.15,
}

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

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: spring,
}

export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: {
    type: 'tween' as const,
    ease: springEase,
    duration: 0.45,
  },
}

export const gsapEase = {
  spring: 'power3.out',
  soft: 'power2.inOut',
  bounce: 'back.out(1.5)',
  sharp: 'power4.out',
}

export const counterConfig = {
  duration: 0.9,
  ease: 'power2.out',
}
