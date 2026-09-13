/**
 * Seeded noise, shared by everything that samples the world.
 *
 * The terrain and the air both need their own fields off the same seed, so the
 * generators live here rather than being private to whichever module needed them
 * first.
 */
import { createNoise2D } from 'simplex-noise'

export type Noise2D = (x: number, y: number) => number

/** Tiny seeded PRNG, so a seed string always yields the same world. */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A named set of noise fields for a seed, cached so repeated lookups are free.
 * The salt keeps independent field sets (terrain, air) from being identical.
 */
const cache = new Map<string, Noise2D[]>()

export function fieldsFor(seed: string, salt: string, count: number): Noise2D[] {
  const key = `${seed}:${salt}`
  let fields = cache.get(key)
  if (!fields || fields.length < count) {
    const rng = mulberry32(hashSeed(`${seed}:${salt}`))
    fields = Array.from({ length: count }, () => createNoise2D(rng))
    cache.set(key, fields)
  }
  return fields
}

export function fbm(noise: Noise2D, x: number, z: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, z * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

/** Ridged noise: sharp crests, the shape mountains actually have. */
export function ridged(noise: Noise2D, x: number, z: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let freq = 1
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, z * freq))
    sum += n * n * amp
    norm += amp
    amp *= 0.5
    freq *= 2.07
  }
  return sum / norm
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
