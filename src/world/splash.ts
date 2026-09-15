/**
 * Spray thrown up where the bird touches water.
 *
 * Water is never fatal, so a touch has to be *legible* instead: the splash is
 * the whole feedback that says "you hit the surface, and it cost you". It also
 * marks where a fishing pass actually went in, which is the difference between
 * missing by a metre and missing by ten.
 *
 * Live splashes sit in a module-level pool rather than in React state. They are
 * spawned from the fixed-step physics loop and read by the frame loop; routing
 * that through props or a store would mean a render per splash, sixty times a
 * second in the worst case. The pool is tiny and fixed, so nothing grows.
 */

/** Seconds a splash lives for. */
export const SPLASH_LIFETIME = 0.85
/** Droplets thrown by each one. */
export const DROPLETS = 16
/** How many can be in the air at once. The oldest is recycled beyond this. */
export const MAX_SPLASHES = 4

export type Splash = {
  x: number
  y: number
  z: number
  /** Roughly how hard the bird arrived, 0.35 (a brush) to 1.4 (a real hit). */
  strength: number
  age: number
}

const live: Splash[] = []

/** Deterministic pseudo-random in [0,1) from a droplet index. */
function scatter(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/**
 * Record a touch.
 *
 * Skimming reports contact on every physics step, so near-identical hits are
 * folded into the one splash already there - otherwise a single pass across a
 * lake would spend the whole pool in a tenth of a second and strobe.
 */
export function addSplash(x: number, y: number, z: number, speed: number): void {
  for (const s of live) {
    if (s.age < 0.14 && Math.hypot(s.x - x, s.z - z) < 7) return
  }
  if (live.length >= MAX_SPLASHES) live.shift()
  live.push({ x, y, z, strength: Math.min(1.4, Math.max(0.35, speed / 18)), age: 0 })
}

/** Age the pool and hand back what is still alive. */
export function stepSplashes(dt: number): Splash[] {
  for (let i = live.length - 1; i >= 0; i--) {
    live[i].age += dt
    if (live[i].age > SPLASH_LIFETIME) live.splice(i, 1)
  }
  return live
}

export function clearSplashes(): void {
  live.length = 0
}

/** The ring spreading out across the surface. */
export function ringOf(s: Splash): { radius: number; opacity: number } {
  const t = Math.min(1, s.age / SPLASH_LIFETIME)
  return {
    // Fast at first and then easing out, the way a real ring spreads. Sized off
    // the bird, not off the lake: measured against the chase camera, a ring
    // seven metres wide read as a crater.
    radius: (0.8 + 3.4 * Math.sqrt(t)) * s.strength,
    opacity: 0.55 * (1 - t) * (1 - t),
  }
}

const GRAVITY = 9.81

/**
 * Where one droplet is, relative to the point of impact.
 *
 * Thrown outward and up, then ballistic. Returns null once it has fallen back
 * through the surface, because a droplet that keeps going is a bug you see.
 */
export function dropletAt(
  s: Splash,
  i: number,
  out: { x: number; y: number; z: number },
): boolean {
  const a = (i / DROPLETS) * Math.PI * 2 + scatter(i, 1) * 0.9
  const out0 = (2.2 + scatter(i, 2) * 5.5) * s.strength
  const up = (3.4 + scatter(i, 3) * 4.6) * s.strength
  const t = s.age
  const y = up * t - 0.5 * GRAVITY * t * t
  if (y < 0) return false
  out.x = Math.cos(a) * out0 * t
  out.y = y
  out.z = Math.sin(a) * out0 * t
  return true
}

/** Droplet size, which shrinks as the drop breaks up. */
export function dropletScale(s: Splash): number {
  const t = Math.min(1, s.age / SPLASH_LIFETIME)
  // Small. At half a metre across they read as floating boulders from the chase
  // camera, which sits close to the water on a fishing pass.
  return (0.07 + 0.09 * s.strength) * (1 - t * 0.55)
}
