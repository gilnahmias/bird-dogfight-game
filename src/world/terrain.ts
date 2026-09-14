/**
 * The single source of truth for the ground.
 *
 * The terrain mesh, prey spawning, predator walking, crash detection, ridge
 * lift, tree scatter and nest placement all read from here. Nothing in the game
 * is allowed to keep its own idea of where the ground is.
 */
import { fbm, fieldsFor, hashSeed, ridged, smoothstep } from './noise.ts'
import { WORLD } from '../game/constants.ts'

export { hashSeed, smoothstep }

export type Biome = 'water' | 'rock' | 'forest' | 'grass'


const F = { base: 0, ridge: 1, river: 2, moist: 3, warp: 4 } as const

function fieldsForSeed(seed: string) {
  return fieldsFor(seed, 'terrain', 5)
}

/**
 * How strongly a river channel runs through a point, 0 to 1.
 *
 * Rivers are carved along the zero crossing of a noise field, so this is just
 * how close that crossing is. Waterfalls look for it: a channel that runs over a
 * steep drop is where falling water belongs.
 */
export function riverAt(x: number, z: number, seed: string): number {
  const riverN = fbm(fieldsForSeed(seed)[F.river], x * 0.00055, z * 0.00055, 3)
  return 1 - smoothstep(0.0, 0.075, Math.abs(riverN))
}

/** Terrain height in metres at a world position. */
export function heightAt(x: number, z: number, seed: string): number {
  const f = fieldsForSeed(seed)

  // Large-scale landmass: decides what is highland and what floods.
  const base = fbm(f[F.base], x * 0.00042, z * 0.00042, 4)

  // Mountains, masked so they only grow out of the highlands.
  const mask = smoothstep(0.02, 0.55, base)
  const mountains = ridged(f[F.ridge], x * 0.0013, z * 0.0013, 5) * mask

  // Medium detail and a little domain warp so nothing looks grid-aligned.
  const warp = fbm(f[F.warp], x * 0.0009, z * 0.0009, 2) * 60
  const detail = fbm(f[F.base], (x + warp) * 0.0055, (z + warp) * 0.0055, 3)

  let h = base * 150 + mountains * 300 + detail * 9 - 46

  // Rivers: carve a channel along the zero crossing of a noise field, which
  // gives long winding valleys for free. Below the water level they fill in.
  const channel = riverAt(x, z, seed)
  // Only carve where there is land to carve, and let the channel deepen downhill.
  h -= channel * 34 * smoothstep(-10, 40, h)

  return h
}

const NORMAL_EPS = 1.0

/** Surface normal, from a finite difference of heightAt. */
export function normalAt(x: number, z: number, seed: string, out?: [number, number, number]) {
  const hL = heightAt(x - NORMAL_EPS, z, seed)
  const hR = heightAt(x + NORMAL_EPS, z, seed)
  const hD = heightAt(x, z - NORMAL_EPS, seed)
  const hU = heightAt(x, z + NORMAL_EPS, seed)
  let nx = hL - hR
  let ny = 2 * NORMAL_EPS
  let nz = hD - hU
  const len = Math.hypot(nx, ny, nz)
  nx /= len
  ny /= len
  nz /= len
  const r = out ?? ([0, 0, 0] as [number, number, number])
  r[0] = nx
  r[1] = ny
  r[2] = nz
  return r
}

/** 0 = flat, 1 = vertical cliff. */
export function slopeAt(x: number, z: number, seed: string): number {
  const n = normalAt(x, z, seed)
  return 1 - n[1]
}

/** Moisture field. Cheap - three octaves - and it is what separates forest from grass. */
export function moistureAt(x: number, z: number, seed: string): number {
  return fbm(fieldsForSeed(seed)[F.moist], x * 0.0016, z * 0.0016, 3)
}

/**
 * Classify ground from samples the caller already has.
 *
 * The mesh builder knows the height and slope of every vertex from its own grid,
 * and re-deriving them here would mean ten heightAt calls per vertex instead of
 * one. That difference is the difference between a world that streams and a
 * browser tab that hangs.
 */
export function biomeFrom(h: number, slope: number, moisture: number): Biome {
  if (h < WORLD.waterLevel) return 'water'
  if (h > 190 || slope > 0.45) return 'rock'
  if (moisture > -0.05 && h < 175 && slope < 0.38) return 'forest'
  return 'grass'
}

/** Convenience wrapper for gameplay code, which samples a handful of points, not thousands. */
export function biomeAt(x: number, z: number, seed: string): Biome {
  const h = heightAt(x, z, seed)
  if (h < WORLD.waterLevel) return 'water'
  return biomeFrom(h, slopeAt(x, z, seed), moistureAt(x, z, seed))
}

/** Height, slope and biome in one go, with an early out for the common rejections. */
export function sampleGround(x: number, z: number, seed: string) {
  const h = heightAt(x, z, seed)
  if (h < WORLD.waterLevel) return { h, slope: 0, biome: 'water' as Biome }
  const slope = slopeAt(x, z, seed)
  return { h, slope, biome: biomeFrom(h, slope, moistureAt(x, z, seed)) }
}

/**
 * Height of the terrain as it is actually DRAWN, rather than as the noise field
 * defines it.
 *
 * The mesh samples heightAt on a grid and stretches flat triangles between those
 * samples, so on a sharp ridge crest the drawn surface sits below the true
 * height - by metres. Anything placed by heightAt on a peak therefore floats
 * above the ground the player can see. Props belong on this surface, not on the
 * mathematical one.
 *
 * `segments` must match the chunk LOD being drawn; WORLD.lodSegments[0] is the
 * resolution used everywhere near the player.
 */
export function meshHeightAt(x: number, z: number, seed: string, segments: number): number {
  const step = WORLD.chunkSize / segments
  const gx = Math.floor(x / step) * step
  const gz = Math.floor(z / step) * step
  const fx = (x - gx) / step
  const fz = (z - gz) / step
  const h00 = heightAt(gx, gz, seed)
  const h10 = heightAt(gx + step, gz, seed)
  const h01 = heightAt(gx, gz + step, seed)
  const h11 = heightAt(gx + step, gz + step, seed)
  // Matches the triangulation in TerrainChunks: (a, d, b) then (b, d, e).
  return fx + fz < 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
}

/** How far the drawn ground sits below the height field at a point. */
export function meshGapAt(x: number, z: number, seed: string): number {
  return heightAt(x, z, seed) - meshHeightAt(x, z, seed, WORLD.lodSegments[0])
}

/** Deterministic per-point random in [0,1), for scatter and spawn decisions. */
export function jitter(x: number, z: number, salt: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233 + salt * 43.7581) * 43758.5453
  return n - Math.floor(n)
}

