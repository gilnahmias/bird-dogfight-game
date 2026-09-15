/**
 * Finding waterfalls.
 *
 * A waterfall is a river channel that runs over a steep drop and lands in water.
 * All three of those already exist in the terrain - rivers are carved along a
 * noise crossing, and lakes are wherever the ground falls below the waterline -
 * so this looks for the places they coincide rather than inventing anything.
 */
import { Vector3 } from 'three'
import { meshHeightAt } from './terrain.ts'
import { findTarns, type Tarn } from './tarns.ts'
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

/** Step size when walking the fall line out from the lip. */
const STEP_OUT = 8
/** Most steps the fall line is followed for. */
const MAX_STEPS = 28
/** A spill shorter than this is a trickle, not a waterfall. */
export const MIN_DROP = 11

/**
 * The line the water takes down the face: hugging the rock, never climbing, and
 * standing just clear of the surface so it does not z-fight with it.
 */
/**
 * Trace the line the water takes from a lip, marching downhill.
 *
 * At each step it looks around the current heading and takes the steepest way
 * down, rather than running along a fixed bearing. A straight bearing is what an
 * earlier version used, and it buried the sheet inside the hill wherever the
 * ground rose again along it - water cannot flow uphill, so the sheet would hold
 * its height while the terrain climbed over it.
 */
function traceFallLine(
  startX: number,
  startZ: number,
  lipY: number,
  initialHeading: number,
  seed: string,
): { path: Vector3[]; base: Vector3; dir: Vector3 } | null {
  /** Stand off the rock face by this much, so the sheet does not z-fight it. */
  const CLEARANCE = 0.6

  const ground = (x: number, z: number) =>
    Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)

  const path: Vector3[] = [new Vector3(startX, lipY + CLEARANCE, startZ)]
  let x = startX
  let z = startZ
  let y = lipY
  // Always starts pointing away from the pool. An unconstrained first step finds
  // the tarn floor - lower than its own rim - and the fall runs back into the
  // lake it just left.
  let heading = initialHeading
  let firstStep: Vector3 | null = null

  for (let i = 0; i < MAX_STEPS; i++) {
    // Search a fan around the current heading, so the line curves with the gully
    // instead of doubling back.
    let bestDrop = -Infinity
    let bestAngle = heading
    const span = Math.PI * 0.42
    const from = heading - span
    const to = heading + span
    for (let k = 0; k <= 12; k++) {
      const a = from + ((to - from) * k) / 12
      const nx = x + Math.cos(a) * STEP_OUT
      const nz = z + Math.sin(a) * STEP_OUT
      const drop = y - ground(nx, nz)
      if (drop > bestDrop) {
        bestDrop = drop
        bestAngle = a
      }
    }

    // Only ever take a step that goes down. Taking a flat or rising step and
    // then clamping the height is what left the sheet buried inside the hill:
    // the water held its level while the ground climbed over it.
    if (bestDrop <= 0.05) break

    x += Math.cos(bestAngle) * STEP_OUT
    z += Math.sin(bestAngle) * STEP_OUT
    heading = bestAngle
    y = ground(x, z)
    path.push(new Vector3(x, y + CLEARANCE, z))

    if (!firstStep) firstStep = new Vector3(Math.cos(bestAngle), 0, Math.sin(bestAngle))
    if (y <= WORLD.waterLevel + 0.01) break
  }

  if (path.length < 3 || !firstStep) return null
  return { path, base: path[path.length - 1].clone(), dir: firstStep }
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

/**
 * Build the fall that spills out of a tarn, or null if the ground below its
 * outlet does not drop far enough to make one.
 */
function fallFromTarn(tarn: Tarn, seed: string): Waterfall | null {
  // The crest of the rim, not the pool surface: water goes OVER the lip, and a
  // sheet starting at the surface begins buried under the rim in front of it.
  const lip = tarn.outletGround

  const traced = traceFallLine(
    tarn.outlet.x,
    tarn.outlet.z,
    lip,
    Math.atan2(tarn.outflow.z, tarn.outflow.x),
    seed,
  )
  if (!traced) return null

  const drop = lip - traced.base.y
  if (drop < MIN_DROP) return null

  return {
    top: new Vector3(tarn.outlet.x, lip, tarn.outlet.z),
    base: traced.base,
    dir: traced.dir,
    // A bigger pool spills a wider fall.
    width: 6 + tarn.radius * 0.28,
    path: traced.path,
  }
}

/**
 * Waterfalls, each one the outflow of a mountain tarn.
 *
 * They used to be sited wherever a river channel happened to cross a steep
 * slope, which put them halfway down bare hillsides with nothing above them -
 * water appearing out of the rock for no reason. A fall now begins where water
 * visibly is: at the lip of a pool that the player can fly up to and look into.
 */
export function findWaterfalls(
  seed: string,
  centre: Vector3,
  heading: Vector3 | null = null,
  max = 8,
): Waterfall[] {
  const candidates = findTarns(seed, centre, 22)
    .map((tarn) => fallFromTarn(tarn, seed))
    .filter((w): w is Waterfall => w !== null)

  candidates.sort((a, b) => viewingCost(a, centre, heading) - viewingCost(b, centre, heading))
  return candidates.slice(0, max)
}
