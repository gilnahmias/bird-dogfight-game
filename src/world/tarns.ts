/**
 * Mountain tarns: the small lakes that sit in hollows high on the hills.
 *
 * They exist so that waterfalls have somewhere to come FROM. A fall that starts
 * halfway down a bare slope has no reason to be there; one that spills over the
 * lip of a tarn does. The tarn's outlet - the lowest point on its rim - is
 * exactly where the water would leave, so that is where the fall begins.
 *
 * The main water plane is a single sheet at sea level and cannot represent a
 * lake at 180m, so each tarn carries its own small surface.
 */
import { Vector3 } from 'three'
import { heightAt, meshHeightAt, tarnFieldAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type Tarn = {
  /** Centre of the pool, at the water surface. */
  centre: Vector3
  /** Surface height, which is the height of the lowest point on the rim. */
  level: number
  radius: number
  /** Where the water spills out, on the rim. */
  outlet: Vector3
  /** Height of the rim crest at the outlet - the level water actually goes over. */
  outletGround: number
  /** Horizontal direction the outflow runs. */
  outflow: Vector3
}

const SEARCH_RADIUS = 3400
const STEP = 64
/** Tarns belong in the hills, not on the coastal flats. */
const MIN_HEIGHT = 42
const MAX_HEIGHT = 245
/** The rim is sampled at this radius from the centre. */
export const RIM_SAMPLES = 16
/** Radius the rim is measured at, and so the scale of a tarn. */
export const RIM_RADIUS = 52
const MIN_RIM_RISE = 2.2
const MIN_SEPARATION = 240

/**
 * Steepest way down from the outlet, looking only outward.
 *
 * The pool floor is lower than its own rim, so an unconstrained search at the
 * outlet points straight back into the tarn - and the outflow would run into the
 * lake it just left. Only directions leading away from the centre count.
 */
function outwardDescent(x: number, z: number, away: Vector3, seed: string) {
  const here = heightAt(x, z, seed)
  let drop = -Infinity
  let angle = 0
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    if (dx * away.x + dz * away.z < 0.25) continue // heading back into the pool
    const d = here - heightAt(x + dx * 40, z + dz * 40, seed)
    if (d > drop) {
      drop = d
      angle = a
    }
  }
  return { drop, dir: new Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize() }
}

/**
 * Describe the rim around a candidate hollow: how much it rises, and where its
 * lowest point is - the point water would escape through.
 */
function rim(x: number, z: number, radius: number, seed: string) {
  let lowest = Infinity
  let lowestAngle = 0
  let total = 0
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const a = (i / RIM_SAMPLES) * Math.PI * 2
    const h = heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius, seed)
    total += h
    if (h < lowest) {
      lowest = h
      lowestAngle = a
    }
  }
  return { lowest, mean: total / RIM_SAMPLES, angle: lowestAngle }
}

export function findTarns(seed: string, centre: Vector3, max = 20): Tarn[] {
  const candidates: (Tarn & { score: number })[] = []

  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz += STEP) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += STEP) {
      const x = centre.x + dx
      const z = centre.z + dz
      // Look where the terrain deliberately carved a basin, rather than hunting
      // for an accidental hollow.
      const strength = tarnFieldAt(x, z, seed)
      if (strength < 0.28) continue

      const floor = heightAt(x, z, seed)
      if (floor < MIN_HEIGHT || floor > MAX_HEIGHT) continue

      // Must be near the middle of the basin, not out on its flank.
      let isCentre = true
      for (let i = 0; i < 8 && isCentre; i++) {
        const a = (i / 8) * Math.PI * 2
        if (tarnFieldAt(x + Math.cos(a) * STEP, z + Math.sin(a) * STEP, seed) > strength + 0.002) {
          isCentre = false
        }
      }
      if (!isCentre) continue

      // A hollow: the ground must rise on nearly every side.
      const radius = RIM_RADIUS
      const { lowest, mean, angle } = rim(x, z, radius, seed)
      const rise = mean - floor
      if (rise < MIN_RIM_RISE) continue
      // The outlet must still be above the floor, or this is a slope, not a bowl.
      if (lowest - floor < 1.2) continue

      const level = lowest - 0.4
      const toRim = new Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize()
      const outlet = new Vector3(x + toRim.x * radius, level, z + toRim.z * radius)

      // The stream leaves down the steepest line from the outlet, not straight
      // out from the middle of the pool - past the rim the ground often rises
      // again, and a radial outflow would run uphill.
      const descent = outwardDescent(outlet.x, outlet.z, toRim, seed)
      if (descent.drop < 3) continue
      const outflow = descent.dir

      candidates.push({
        centre: new Vector3(x, level, z),
        level,
        radius: radius * 0.62,
        outlet,
        outletGround: lowest,
        outflow,
        score: rise * 2 + strength * 14 + descent.drop * 0.5 - Math.hypot(dx, dz) * 0.004,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  const kept: Tarn[] = []
  for (const t of candidates) {
    if (kept.length >= max) break
    if (kept.some((k) => k.centre.distanceTo(t.centre) < MIN_SEPARATION)) continue
    kept.push(t)
  }
  return kept
}

/**
 * How far the ground falls away below a tarn's outlet, following the outflow.
 * This is what decides whether the spill is a waterfall or just a stream.
 */
export function outletDrop(tarn: Tarn, seed: string, runout = 200): number {
  let lowest = tarn.level
  for (let d = 10; d <= runout; d += 10) {
    const h = meshHeightAt(
      tarn.outlet.x + tarn.outflow.x * d,
      tarn.outlet.z + tarn.outflow.z * d,
      seed,
      WORLD.lodSegments[0],
    )
    lowest = Math.min(lowest, Math.max(h, WORLD.waterLevel))
  }
  return tarn.level - lowest
}
