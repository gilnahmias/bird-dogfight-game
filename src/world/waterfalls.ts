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
const STEP_OUT = 5
/** Most steps the fall line is followed for. */
const MAX_STEPS = 46
/** How far out from the outlet to look for the brink the water goes over. */
const BRINK_SEARCH = 70
/** A spill shorter than this is a trickle, not a waterfall. */
export const MIN_DROP = 9

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
/** Height of the drawn surface, never below the waterline. */
function ground(x: number, z: number, seed: string): number {
  return Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)
}

function fallFromTarn(tarn: Tarn, seed: string): Waterfall | null {
  // The crest of the rim, not the pool surface: water goes OVER the lip, and a
  // sheet starting at the surface begins buried under the rim in front of it.
  const lip = tarn.outletGround

  const heading = Math.atan2(tarn.outflow.z, tarn.outflow.x)

  /*
    Start where the ground actually gives way, not at the pool edge.

    Water leaves a tarn over a lip that is nearly level for a few metres before
    it drops, and a march that insists on descending every step died on that flat
    stretch - every tarn in the world was rejected. Walking out to the brink
    first is also where a real fall visibly begins.
  */
  /*
    Find the brink: the point where the water genuinely starts to fall.

    It is NOT the pool's edge. Measured on every tarn in the world, the ground
    rises for the first ten to twenty metres past the outlet - the outflow runs
    over the rim, which is a hump - before dropping away. Starting the sheet at
    the outlet buries it in that hump, and giving up the moment the ground climbs
    rejects every tarn there is. So walk out across the hump and begin where the
    ground is back below the rim and still going down.
  */
  const rim = tarn.outletGround
  let startX = tarn.outlet.x
  let startZ = tarn.outlet.z
  let startY = rim
  let foundBrink = false
  for (let d = 0; d <= BRINK_SEARCH && !foundBrink; d += STEP_OUT) {
    const x = tarn.outlet.x + tarn.outflow.x * d
    const z = tarn.outlet.z + tarn.outflow.z * d
    const here = ground(x, z, seed)
    if (here > rim + 0.2) continue // still climbing the rim
    const ahead = ground(x + tarn.outflow.x * STEP_OUT, z + tarn.outflow.z * STEP_OUT, seed)
    if (ahead >= here - 0.4) continue // not falling away yet
    startX = x
    startZ = z
    startY = here
    foundBrink = true
  }
  if (!foundBrink) return null

  const traced = traceFallLine(startX, startZ, startY, heading, seed)
  if (!traced) return null

  const drop = startY - traced.base.y
  if (drop < MIN_DROP) return null

  return {
    top: new Vector3(tarn.outlet.x, lip, tarn.outlet.z),
    base: traced.base,
    dir: traced.dir,
    // A bigger pool spills a wider fall.
    // Wide enough to see from a distance. A fifteen metre ribbon on a green
    // hillside a kilometre away is a thread; the player could not find the falls
    // at all, and the first thing that has to be true is that they read as
    // water from the air.
    width: 12 + tarn.radius * 0.34,
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
