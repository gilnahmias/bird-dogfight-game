/**
 * Where the nest goes, and therefore where every run starts and restarts.
 *
 * A raptor nests on a crag with a view, and a player should not open the game
 * pointed at a wall of rock. So a site has to be a local high point AND have a
 * departure line with open air along it for the better part of a kilometre.
 */
import { Quaternion, Vector3 } from 'three'
import { heightAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type NestSite = {
  /** Where the nest sits, on the ground. */
  pos: Vector3
  /** The direction the bird launches in - the one with open air. */
  heading: number
  /** Metres of clearance along that departure line, for diagnostics. */
  clearance: number
}

const SEARCH_RADIUS = 2200
const SEARCH_STEP = 100
const PROMINENCE_RADIUS = 240
/** How far along the departure line the air has to stay open. */
const DEPARTURE_SAMPLES = [120, 250, 400, 600, 800, 1000]
/** How high above the nest the bird launches. */
export const LAUNCH_HEIGHT = 26

function prominence(x: number, z: number, h: number, seed: string): number {
  let sum = 0
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    sum += heightAt(x + Math.cos(a) * PROMINENCE_RADIUS, z + Math.sin(a) * PROMINENCE_RADIUS, seed)
  }
  return h - sum / 8
}

/**
 * Lowest clearance between the launch altitude and the ground along a heading.
 * Negative means there is a mountain in the way.
 */
function departureClearance(x: number, z: number, launchY: number, heading: number, seed: string) {
  const { x: dx, z: dz } = departureDirection(heading)
  let worst = Infinity
  for (const d of DEPARTURE_SAMPLES) {
    const ground = heightAt(x + dx * d, z + dz * d, seed)
    // Allow for the sink of a glide on the way out rather than assuming level flight.
    worst = Math.min(worst, launchY - d * 0.14 - ground)
  }
  return worst
}

export function findNestSite(seed: string): NestSite {
  // Pass one: cheap filter down to plausible crags.
  const candidates: { x: number; z: number; h: number; prom: number }[] = []
  for (let z = -SEARCH_RADIUS; z <= SEARCH_RADIUS; z += SEARCH_STEP) {
    for (let x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x += SEARCH_STEP) {
      const h = heightAt(x, z, seed)
      // Above the waterline, below the snow, and not on a cliff face.
      if (h < 35 || h > 215) continue
      if (slopeAt(x, z, seed) > 0.42) continue
      const prom = prominence(x, z, h, seed)
      if (prom < 18) continue
      candidates.push({ x, z, h, prom })
    }
  }

  candidates.sort((a, b) => b.prom - a.prom)

  // Pass two: only the best crags pay for the departure-line test.
  let best: NestSite | null = null
  for (const c of candidates.slice(0, 40)) {
    const launchY = c.h + LAUNCH_HEIGHT
    for (let i = 0; i < 16; i++) {
      const heading = (i / 16) * Math.PI * 2
      const clearance = departureClearance(c.x, c.z, launchY, heading, seed)
      if (!best || clearance > best.clearance) {
        best = { pos: new Vector3(c.x, c.h, c.z), heading, clearance }
      }
    }
    // Good enough: open air the whole way out. No need to keep searching.
    if (best && best.clearance > 70) break
  }

  if (best) return best

  // Nothing qualified, so put the nest on the highest ground at the origin and
  // launch away from whatever is tallest nearby. The game still starts.
  const h = heightAt(0, 0, seed)
  return { pos: new Vector3(0, Math.max(h, WORLD.waterLevel + 5), 0), heading: 0, clearance: 0 }
}

/**
 * The heading convention has to match createBird, which builds the bird's
 * rotation by turning it about the world up axis - so heading 0 faces -Z and a
 * positive heading swings the nose toward -X. Getting this wrong points the
 * departure test at one direction and launches the bird in another.
 */
export function departureDirection(heading: number): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading),
  )
}

/** Where the bird is at the start of a run: airborne, just off the nest. */
export function launchPoint(site: NestSite): Vector3 {
  return new Vector3(site.pos.x, site.pos.y + LAUNCH_HEIGHT, site.pos.z)
}
