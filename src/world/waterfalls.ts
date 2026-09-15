/**
 * Finding waterfalls.
 *
 * A waterfall is a river channel that runs over a steep drop and lands in water.
 * All three of those already exist in the terrain - rivers are carved along a
 * noise crossing, and lakes are wherever the ground falls below the waterline -
 * so this looks for the places they coincide rather than inventing anything.
 */
import { Vector3 } from 'three'
import { heightAt, meshHeightAt, riverAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type Waterfall = {
  /** The lip, where the water leaves the rock. */
  top: Vector3
  /**
   * Where it lands. Not simply the waterline below the lip: cliffs lean, so a
   * vertical sheet hung off the lip spends most of its length buried inside the
   * rock. The sheet is drawn along the line from the lip to here.
   */
  base: Vector3
  /** Horizontal direction the water falls away toward. */
  dir: Vector3
  width: number
  /**
   * The line the water actually takes, lip to foot. Cliffs are not flat, so a
   * straight sheet between the two ends cuts through any bulge in between. This
   * follows the rock, and never flows uphill.
   */
  path: Vector3[]
}

const SEARCH_RADIUS = 2600
const STEP = 56
/** Look this far downhill for the landing. */
const RUNOUT = 190
/** Step size when walking the fall line out from the lip. */
const STEP_OUT = 8
/** Falls closer together than this are the same fall. */
const MIN_SEPARATION = 170
export const MIN_DROP = 14
const MIN_RIVER = 0.28

/** How many segments the sheet is built from. */
const PATH_STEPS = 10

/**
 * The line the water takes down the face: hugging the rock, never climbing, and
 * standing just clear of the surface so it does not z-fight with it.
 */
function fallPath(
  top: Vector3,
  base: Vector3,
  dirX: number,
  dirZ: number,
  run: number,
  seed: string,
): Vector3[] {
  /** Stand off the rock face by this much, so the sheet does not z-fight it. */
  const CLEARANCE = 0.6

  const path: Vector3[] = []
  let y = top.y
  for (let i = 0; i <= PATH_STEPS; i++) {
    const t = i / PATH_STEPS
    const x = top.x + dirX * run * t
    const z = top.z + dirZ * run * t
    // Against the surface that is DRAWN, since that is what the water is seen
    // to run over. The height field sits above it on sharp crests.
    const ground = Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), base.y)
    // Follow the rock where it falls away, but never flow back uphill. The
    // clearance is applied to every point including the lip, so that adding it
    // cannot itself make one point higher than the one before.
    y = Math.min(y, ground)
    path.push(new Vector3(x, y + CLEARANCE, z))
  }
  return path
}

/** Steepest downhill direction at a point, and how far the ground falls. */
function downhill(x: number, z: number, h: number, seed: string) {
  let best = 0
  let angle = 0
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const drop = h - heightAt(x + Math.cos(a) * 30, z + Math.sin(a) * 30, seed)
    if (drop > best) {
      best = drop
      angle = a
    }
  }
  return { drop: best, angle }
}

/**
 * Cost of a waterfall from the player's point of view, given where they start
 * and which way they leave.
 *
 * Ranking purely on distance from the nest put every fall behind the bird or
 * hundreds of metres off to one side, so the player flew the departure line and
 * never saw one. What matters is not how close a fall is, but whether it is
 * somewhere you will actually look.
 */
function viewingCost(w: Waterfall, from: Vector3, heading: Vector3 | null): number {
  const rx = w.top.x - from.x
  const rz = w.top.z - from.z
  if (!heading) return Math.hypot(rx, rz)

  const along = rx * heading.x + rz * heading.z
  const off = Math.abs(rx * -heading.z + rz * heading.x)

  // Off to the side is the worst thing to be, behind is nearly as bad, and
  // distance straight ahead barely counts against a fall at all.
  return off * 2.2 + (along < 0 ? -along * 3 : along * 0.25)
}

export function findWaterfalls(
  seed: string,
  centre: Vector3,
  heading: Vector3 | null = null,
  max = 11,
): Waterfall[] {
  const candidates: Waterfall[] = []

  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz += STEP) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += STEP) {
      const x = centre.x + dx
      const z = centre.z + dz

      // Cheapest test first: is there a river here at all?
      if (riverAt(x, z, seed) < MIN_RIVER) continue

      const h = heightAt(x, z, seed)
      if (h < WORLD.waterLevel + 12 || h > 210) continue

      const { drop, angle } = downhill(x, z, h, seed)
      if (drop < 9) continue // needs to be a real edge, not a slope

      // Walk the fall line out from the lip until the ground stops dropping -
      // that is the foot of the cliff, and where the water lands.
      const dirX = Math.cos(angle)
      const dirZ = Math.sin(angle)
      const lip = meshHeightAt(x, z, seed, WORLD.lodSegments[0])
      let run = 0
      let landingY = lip
      let previous = lip
      for (let d = STEP_OUT; d <= RUNOUT; d += STEP_OUT) {
        const g = heightAt(x + dirX * d, z + dirZ * d, seed)
        if (g < WORLD.waterLevel) {
          // Reached open water: the fall ends at the surface.
          run = d
          landingY = WORLD.waterLevel
          break
        }
        // The cliff has bottomed out and the ground is running level or rising.
        if (previous - g < 1.2) break
        previous = g
        run = d
        landingY = g
      }
      if (run === 0) continue

      const top = new Vector3(x, lip, z)
      const bx = x + dirX * run
      const bz = z + dirZ * run
      // The foot sits on the drawn surface too, or the last segment of the sheet
      // disappears into the bank.
      const footY =
        landingY <= WORLD.waterLevel
          ? WORLD.waterLevel
          : Math.max(WORLD.waterLevel, meshHeightAt(bx, bz, seed, WORLD.lodSegments[0]))
      const base = new Vector3(bx, footY, bz)
      // Judge the drop against the foot that actually gets drawn, not against an
      // intermediate sample, or short falls slip through.
      if (lip - footY < MIN_DROP) continue
      candidates.push({
        top,
        base,
        dir: new Vector3(dirX, 0, dirZ).normalize(),
        // Bigger rivers make wider falls.
        width: 7 + riverAt(x, z, seed) * 13,
        path: fallPath(top, base, dirX, dirZ, run, seed),
      })
    }
  }

  // Best-placed first, so the falls that get kept are the ones the player will
  // actually fly past rather than whichever the scan happened to reach first.
  candidates.sort((a, b) => viewingCost(a, centre, heading) - viewingCost(b, centre, heading))

  // One fall per river, not twenty down the same one.
  const found: Waterfall[] = []
  for (const w of candidates) {
    if (found.length >= max) break
    if (found.some((k) => Math.hypot(k.top.x - w.top.x, k.top.z - w.top.z) < MIN_SEPARATION)) continue
    found.push(w)
  }
  return found
}
