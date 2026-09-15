/**
 * Where the nest goes, and therefore where every run starts and restarts.
 *
 * A raptor nests on a crag with a view, and a player should not open the game
 * pointed at a wall of rock. So a site has to be a local high point AND have a
 * departure line with open air along it for the better part of a kilometre.
 */
import { Quaternion, Vector3 } from 'three'
import { heightAt, meshGapAt, meshHeightAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type NestSite = {
  /** Where the nest sits, on the ground. */
  pos: Vector3
  /** The direction the bird launches in - the one with open air. */
  heading: number
  /** Metres of clearance along that departure line, for diagnostics. */
  clearance: number
  /** How far the ground falls away over the lip, and which way the lip faces. */
  edgeDrop: number
  edgeAngle: number
  /** Height of the tree the nest is built in. The nest sits in its crown. */
  treeHeight: number
}

/** Where the nest itself is: up in the crown, not on the ground. */
export function nestPoint(site: NestSite, out = new Vector3()): Vector3 {
  return out.set(site.pos.x, site.pos.y + site.treeHeight, site.pos.z)
}

const SEARCH_RADIUS = 2200
const SEARCH_STEP = 100
const PROMINENCE_RADIUS = 240
/** How far out to look for the lip of the crag. */
const EDGE_RADIUS = 34
/** How far along the departure line the air has to stay open. */
const DEPARTURE_SAMPLES = [120, 250, 400, 600, 800, 1000]
/**
 * Height of the tree the nest is built in.
 *
 * Tall enough to be a landmark from the air and to clear the trees around it,
 * short enough that the nest is not simply floating with a trunk drawn under it.
 */
export const NEST_TREE_HEIGHT = 26

/**
 * The lip: how far the ground falls away close by, and in which direction.
 * A nest belongs on an edge with a drop off the front, not in the middle of a
 * rounded hilltop.
 */
function cragEdge(x: number, z: number, h: number, seed: string) {
  let drop = -Infinity
  let angle = 0
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const d = h - heightAt(x + Math.cos(a) * EDGE_RADIUS, z + Math.sin(a) * EDGE_RADIUS, seed)
    if (d > drop) {
      drop = d
      angle = a
    }
  }
  return { drop, angle }
}

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
  const candidates: {
    x: number
    z: number
    h: number
    prom: number
    edgeDrop: number
    edgeAngle: number
  }[] = []
  for (let z = -SEARCH_RADIUS; z <= SEARCH_RADIUS; z += SEARCH_STEP) {
    for (let x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x += SEARCH_STEP) {
      const h = heightAt(x, z, seed)
      // Above the waterline, below the snow, and not on a cliff face.
      if (h < 35 || h > 215) continue
      if (slopeAt(x, z, seed) > 0.42) continue
      const prom = prominence(x, z, h, seed)
      if (prom < 18) continue
      // A tree has to be able to stand here, so nothing too steep.
      if (slopeAt(x, z, seed) > 0.26) continue
      // Still wants a view: ground that falls away in front of it.
      const edge = cragEdge(x, z, h, seed)
      if (edge.drop < 5) continue
      // The drawn mesh has to agree with the height field here, or the nest sits
      // on ground the player cannot see and the bird crashes into air near home.
      if (Math.abs(meshGapAt(x, z, seed)) > 4) continue
      candidates.push({ x, z, h, prom, edgeDrop: edge.drop, edgeAngle: edge.angle })
    }
  }

  // Rank on both: a commanding position and a real drop off the front.
  candidates.sort((a, b) => b.prom + b.edgeDrop * 2 - (a.prom + a.edgeDrop * 2))

  // Pass two: only the best crags pay for the departure-line test.
  let best: NestSite | null = null
  for (const c of candidates.slice(0, 40)) {
    const launchY = c.h + NEST_TREE_HEIGHT
    for (let i = 0; i < 16; i++) {
      const heading = (i / 16) * Math.PI * 2
      const clearance = departureClearance(c.x, c.z, launchY, heading, seed)
      if (!best || clearance > best.clearance) {
        best = {
          // The FOOT of the tree, sat on the drawn surface so nothing floats.
          pos: new Vector3(
            c.x,
            Math.min(c.h, meshHeightAt(c.x, c.z, seed, WORLD.lodSegments[0])) - 0.4,
            c.z,
          ),
          heading,
          clearance,
          edgeDrop: c.edgeDrop,
          edgeAngle: c.edgeAngle,
          treeHeight: NEST_TREE_HEIGHT,
        }
      }
    }
    // Good enough: open air the whole way out. No need to keep searching.
    if (best && best.clearance > 70) break
  }

  if (best) return best

  // Nothing qualified, so put the nest on the highest ground at the origin and
  // launch away from whatever is tallest nearby. The game still starts.
  const h = heightAt(0, 0, seed)
  const edge = cragEdge(0, 0, h, seed)
  return {
    pos: new Vector3(0, Math.max(h, WORLD.waterLevel + 5), 0),
    heading: 0,
    clearance: 0,
    edgeDrop: edge.drop,
    edgeAngle: edge.angle,
    treeHeight: NEST_TREE_HEIGHT,
  }
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

/**
 * Where the bird starts a run: standing in the nest, up in the crown.
 *
 * It begins perched rather than already flying, so the first thing the player
 * does is decide to go.
 */
export function launchPoint(site: NestSite): Vector3 {
  return nestPoint(site).setY(site.pos.y + site.treeHeight + 1.2)
}
