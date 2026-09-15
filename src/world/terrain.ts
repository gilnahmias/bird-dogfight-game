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


const F = { base: 0, ridge: 1, river: 2, moist: 3, warp: 4, tarn: 5 } as const

function fieldsForSeed(seed: string) {
  return fieldsFor(seed, 'terrain', 6)
}

/**
 * Mountain tarns, and the basins they sit in.
 *
 * Tarns are PLACED, not discovered. The first version carved them wherever a
 * noise field happened to be strong, then searched the result for closed
 * hollows - and measured, four fifths of those basins landed in the sea, because
 * the field knew nothing about where the high ground was. Four tarns in a seven
 * kilometre square, the nearest two kilometres from the nest, and the player
 * could not find a mountain lake or a waterfall at all.
 *
 * So the world offers one candidate site per cell, jittered inside it, and keeps
 * the ones standing on ground that can actually hold water. Supply stops being a
 * matter of luck, and a waterfall always has somewhere to come from.
 */
const TARN_CELL = 380
/** Radius of the carved basin. The pool inside it is smaller. */
export const TARN_RADIUS = 54
/**
 * How far the pool bottom sits below the lowest point of its rim.
 *
 * The basin is LEVELLED to this depth rather than dished out, because these
 * hills are steep: measured, the ground falls sixty to a hundred metres across a
 * basin's width, so a bowl scooped into them simply drains out of its low side.
 * Flattening the inside and leaving the rim alone is what a cirque looks like
 * anyway - still water with the mountain standing over it.
 */
const POOL_DEPTH = 12
/** Tarns belong in the hills: not on the coastal flats, not on the summits. */
const TARN_MIN_HEIGHT = 45
const TARN_MAX_HEIGHT = 250
/**
 * How uneven the rim may be, in metres. The flattest candidate in each cell is
 * the one that gets used, so this only rejects the truly hopeless: a site on a
 * cliff face would be a quarry cut into the hill, not a lake.
 */
const TARN_MAX_RELIEF = 62
/** Candidate positions tried per cell. The flattest wins. */
const TARN_TRIES = 5

export type TarnSite = {
  x: number
  z: number
  /** Surface height of the pool: the lowest point of the rim, less a little. */
  level: number
  /** Height the inside of the basin is levelled to. */
  floor: number
  /** Direction of the lowest point on the rim, where the water spills out. */
  outletAngle: number
}

const siteCache = new Map<string, Map<number, TarnSite | null>>()

function cacheFor(seed: string) {
  let m = siteCache.get(seed)
  if (!m) {
    m = new Map()
    siteCache.set(seed, m)
  }
  return m
}

/** Lowest and highest points of the ring the pool would be held in. */
function rimOf(x: number, z: number, seed: string) {
  let lowest = Infinity
  let highest = -Infinity
  let angle = 0
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const h = bareHeightAt(x + Math.cos(a) * TARN_RADIUS, z + Math.sin(a) * TARN_RADIUS, seed)
    if (h < lowest) {
      lowest = h
      angle = a
    }
    if (h > highest) highest = h
  }
  return { lowest, relief: highest - lowest, angle }
}

/**
 * The basin for one cell, or null if there is nowhere in it to put a lake.
 *
 * Cached, because `heightAt` asks about the neighbouring cells at every vertex
 * of the terrain mesh.
 */
export function tarnSite(cellX: number, cellZ: number, seed: string): TarnSite | null {
  const cache = cacheFor(seed)
  const key = cellX * 65536 + cellZ
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let best: TarnSite | null = null
  let bestScore = Infinity
  for (let i = 0; i < TARN_TRIES; i++) {
    const x = (cellX + 0.5 + (jitter(cellX + i * 13, cellZ, 31) - 0.5) * 0.66) * TARN_CELL
    const z = (cellZ + 0.5 + (jitter(cellZ, cellX + i * 7, 32) - 0.5) * 0.66) * TARN_CELL
    const floor = bareHeightAt(x, z, seed)
    if (floor < TARN_MIN_HEIGHT || floor > TARN_MAX_HEIGHT) continue
    const rim = rimOf(x, z, seed)
    if (rim.relief > TARN_MAX_RELIEF) continue
    // Prefer a basin with somewhere for the water to GO. A tarn in a saddle is a
    // fine lake but never a waterfall, and waterfalls are why tarns exist.
    const beyond = bareHeightAt(
      x + Math.cos(rim.angle) * (TARN_RADIUS + 150),
      z + Math.sin(rim.angle) * (TARN_RADIUS + 150),
      seed,
    )
    const score = rim.relief - Math.max(0, rim.lowest - beyond) * 0.7
    if (score >= bestScore) continue
    // The way OUT has to be up in the hills too. A site can sit at 80m with its
    // lowest rim point down at 13m - that is a shoulder above a cliff, not a
    // basin, and the "tarn" would be a pool hanging at sea level.
    if (rim.lowest < TARN_MIN_HEIGHT) continue
    // The middle may stand above its own outlet - that is a cirque, and the
    // basin is levelled to the pool floor anyway - but not by so much that the
    // carve becomes a quarry cut into a hillside.
    if (floor - rim.lowest > 38) continue
    bestScore = score
    best = {
      x,
      z,
      level: rim.lowest - 0.4,
      floor: rim.lowest - POOL_DEPTH,
      outletAngle: rim.angle,
    }
  }

  cache.set(key, best)
  return best
}

/** How much a basin lowers the ground at a point. */
function tarnCarve(x: number, z: number, h: number, seed: string): number {
  const cellX = Math.floor(x / TARN_CELL)
  const cellZ = Math.floor(z / TARN_CELL)
  let lowered = h
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = tarnSite(cellX + dx, cellZ + dz, seed)
      if (!site) continue
      const r = Math.hypot(x - site.x, z - site.z)
      if (r >= TARN_RADIUS) continue
      // Level toward the pan inside, easing back to the untouched ground at the
      // rim so the basin meets the hill instead of ending in a step.
      const w = smoothstep(TARN_RADIUS, TARN_RADIUS * 0.6, r)
      lowered = Math.min(lowered, h + (site.floor - h) * w)
    }
  }
  return h - lowered
}

/**
 * The surface of the tarn at a point, or null if there is no water there.
 *
 * Gameplay reads this: a pool high on a mountain is water to splash into, not
 * rock to die on - without it the bird flies through the visible surface and
 * hits the basin floor a dozen metres below.
 */
export function tarnPoolAt(x: number, z: number, seed: string): number | null {
  const cellX = Math.floor(x / TARN_CELL)
  const cellZ = Math.floor(z / TARN_CELL)
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = tarnSite(cellX + dx, cellZ + dz, seed)
      if (!site) continue
      if (Math.hypot(x - site.x, z - site.z) >= TARN_RADIUS) continue
      if (heightAt(x, z, seed) < site.level) return site.level
    }
  }
  return null
}

/** Every tarn whose basin lies within `radius` of a point, nearest first. */
export function tarnSitesNear(x: number, z: number, radius: number, seed: string): TarnSite[] {
  const cells = Math.ceil(radius / TARN_CELL) + 1
  const cellX = Math.floor(x / TARN_CELL)
  const cellZ = Math.floor(z / TARN_CELL)
  const found: TarnSite[] = []
  for (let dz = -cells; dz <= cells; dz++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const site = tarnSite(cellX + dx, cellZ + dz, seed)
      if (!site) continue
      if (Math.hypot(site.x - x, site.z - z) > radius) continue
      found.push(site)
    }
  }
  found.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
  return found
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

/**
 * Terrain height before any tarn basin is cut into it.
 *
 * Siting a basin has to ask how high the ground is, and the answer must not
 * already include the basin, or the question is circular.
 */
export function bareHeightAt(x: number, z: number, seed: string): number {
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

/** Terrain height in metres at a world position. */
export function heightAt(x: number, z: number, seed: string): number {
  // Scoop out the highland basins that fill to become tarns.
  const h = bareHeightAt(x, z, seed)
  return h - tarnCarve(x, z, h, seed)
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

