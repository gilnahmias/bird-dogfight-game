/**
 * Where the nest goes, and therefore where every run starts and restarts.
 *
 * A raptor nests on a crag with a view, and a player should not open the game
 * pointed at a wall of rock. So a site has to be a local high point AND have a
 * departure line with open air along it for the better part of a kilometre.
 */
import { Quaternion, Vector3 } from 'three'
import { heightAt, meshGapAt, meshHeightAt, slopeAt, tarnSitesNear } from './terrain.ts'
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

/** How far out a lake still counts as part of the view from the nest. */
const VIEW_RANGE = 1500
/** Clearance past which more open air stops being worth anything. */
const CLEARANCE_ENOUGH = 90
/**
 * Clearance below which a site is not considered at all.
 *
 * Measured on the basin seed: a site with 32m of clearance put the bird within
 * one metre of the hillside on the way out.
 */
const CLEARANCE_FLOOR = 60
/** What a lake in view is worth, in the same units as departure clearance. */
const VIEW_WORTH = 70
/**
 * How near dead ahead a lake has to be to count as "in view on launch".
 *
 * A lake forty degrees off the nose is technically on screen and, tried, no help
 * at all: it sat at the edge of the frame behind the shoulder of a hill. This is
 * about twenty degrees.
 */
const VIEW_CONE = 0.88

/** Nothing in the way between the perch and something out in the world. */
function lineOfSight(
  x: number,
  z: number,
  eyeY: number,
  target: { x: number; z: number; level: number },
  seed: string,
): boolean {
  const distance = Math.hypot(target.x - x, target.z - z)
  if (distance < 1) return true
  for (let i = 1; i < 10; i++) {
    const t = i / 10
    const ground = heightAt(x + (target.x - x) * t, z + (target.z - z) * t, seed)
    // The sightline from the perch down to the water surface.
    if (ground > eyeY + (target.level - eyeY) * t + 2) return false
  }
  return true
}

/**
 * Whether a mountain lake lies ahead of the perch, 0 to 1.
 *
 * The player could not find the tarns or the waterfalls. They were there - a
 * dozen of them within a few kilometres - but the nest faced away from the
 * nearest, and the one four hundred metres off was BEHIND the launch. Nothing
 * about the world tells you to turn round and look. So the nest is chosen to
 * look out over water: whatever else the game fails to explain, the first thing
 * you see from the perch is a lake, and lakes are where the waterfalls are.
 */
function inView(
  x: number,
  z: number,
  heading: number,
  lakes: { x: number; z: number; level: number }[],
): number {
  const { x: dx, z: dz } = departureDirection(heading)
  let best = 0
  for (const lake of lakes) {
    const ox = lake.x - x
    const oz = lake.z - z
    const distance = Math.hypot(ox, oz)
    if (distance < 1) continue
    const ahead = (ox * dx + oz * dz) / distance
    if (ahead < VIEW_CONE) continue
    // Nearer is better, but not so near that it is under the tree.
    const range = distance < 220 ? distance / 220 : 1 - (distance - 220) / (VIEW_RANGE - 220)
    best = Math.max(best, ahead * range)
  }
  return best
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

/**
 * The best (crag, launch heading) pair in a pool, or null if none of them offers
 * a safe way out.
 */
function chooseSite(
  pool: { x: number; z: number; h: number; edgeDrop: number; edgeAngle: number }[],
  seed: string,
  requireView = false,
): NestSite | null {
  let best: NestSite | null = null
  let bestScore = -Infinity
  for (const c of pool.slice(0, 200)) {
    const launchY = c.h + NEST_TREE_HEIGHT
    // Every mountain lake this crag can actually SEE, worked out once per crag
    // rather than once per heading. Occlusion matters: the nearest lake to the
    // first site chosen this way sat behind the shoulder of a hill.
    const lakes = tarnSitesNear(c.x, c.z, VIEW_RANGE, seed).filter((lake) =>
      lineOfSight(c.x, c.z, launchY, lake, seed),
    )
    for (let i = 0; i < 16; i++) {
      const heading = (i / 16) * Math.PI * 2
      const clearance = departureClearance(c.x, c.z, launchY, heading, seed)
      // Flying into a mountain on launch is fatal, so a tight departure line
      // disqualifies a site outright. Measured, 32m of clearance put the bird
      // within a metre of the hillside on the way out.
      if (clearance < CLEARANCE_FLOOR) continue
      /*
        Past that, more open air is worth very little and what the player can SEE
        from the perch is worth a great deal. Ranking on clearance alone is how
        the nest ended up facing the empty sea.
      */
      const view = inView(c.x, c.z, heading, lakes)
      // Being ABLE to see a lake is not the same as facing one: a crag with
      // water off to the side scored exactly as well as one with water dead
      // ahead, so the search kept choosing headings that pointed at nothing.
      if (requireView && view <= 0) continue
      const score = view * VIEW_WORTH + Math.min(clearance, CLEARANCE_ENOUGH) * 0.2
      if (score > bestScore) {
        bestScore = score
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
  }
  return best
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
      // Low bar, and the ranking below does the real work. Held at 18 this
      // filter left 64 crags on the pine-ridge seed and only six of them could
      // see a mountain lake, so the eyrie had nowhere good to look.
      if (prom < 10) continue
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

  /*
    Then try the lakeside crags FIRST, on their own.

    Scoring a view as a bonus was not enough: on some seeds only a handful of
    crags have water in front of them, and they lose to a commanding sea-facing
    cliff every time - which is how the nest came to look out over open ocean
    with two mountain lakes behind its own shoulder. So the lakeside crags get
    their own search, and the sea-facing ones are the fallback rather than the
    default. If none of them offers a safe way out, the fallback takes over.
  */
  const lakeside = candidates.filter((c) =>
    tarnSitesNear(c.x, c.z, VIEW_RANGE, seed).some((lake) =>
      lineOfSight(c.x, c.z, c.h + NEST_TREE_HEIGHT, lake, seed),
    ),
  )

  const withAView = chooseSite(lakeside, seed, true)
  const best = withAView ?? chooseSite(candidates, seed)

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
