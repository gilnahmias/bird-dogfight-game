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
   * The line the water actually takes, lake to foot. Cliffs are not flat, so a
   * straight sheet between the two ends cuts through any bulge in between. This
   * follows the rock, and never flows uphill.
   */
  path: Vector3[]
  /**
   * How many points of the path are the stream leaving the lake, before the
   * water goes over the brink.
   *
   * The sheet used to start at the brink, which is ten to twenty metres out
   * across the rim from the pool - so the fall hung in the hillside with a gap
   * between it and the lake it supposedly came from. These points carry the
   * water over the rim, and they are drawn narrower, because that stretch is a
   * stream and not yet a fall.
   */
  lead: number
}

/** Step size when walking the fall line out from the lip. */
const STEP_OUT = 5
/** Most steps the fall line is followed for. */
const MAX_STEPS = 46
/** How far out from the outlet to look for the brink the water goes over. */
const BRINK_SEARCH = 70
/** How far back into the lake the stream is drawn, so the two are joined. */
const LEAD_INTO_POOL = 14
/** A fall of more than this over one step means the water has left the ground. */
const BRINK_DROP = 2.5
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
  const heading = Math.atan2(tarn.outflow.z, tarn.outflow.x)

  /*
    First the stream: from the waterline, out through the notch the outflow has
    cut in the rim, to the brink where the ground gives way.

    Starting at the WATERLINE and not at a fixed distance back matters, because
    the basin shelves: a point ten metres inside the rim can still be five metres
    of dry ground above the pool, and the stream would begin buried in the shore.
  */
  let leadStart = 0
  for (let d = -2; d > -LEAD_INTO_POOL; d -= 2) {
    const x = tarn.outlet.x + tarn.outflow.x * d
    const z = tarn.outlet.z + tarn.outflow.z * d
    if (ground(x, z, seed) < tarn.level - 0.3) leadStart = d
  }

  const lead: Vector3[] = []
  let surface = tarn.level
  let brinkX = tarn.outlet.x
  let brinkZ = tarn.outlet.z
  for (let d = leadStart; d <= BRINK_SEARCH; d += STEP_OUT) {
    const x = tarn.outlet.x + tarn.outflow.x * d
    const z = tarn.outlet.z + tarn.outflow.z * d
    const here = ground(x, z, seed)
    // Inside the pool the water is at the waterline, whatever the bed does.
    if (d >= 0) surface = Math.min(surface, here + 0.3)
    lead.push(new Vector3(x, surface, z))
    brinkX = x
    brinkZ = z
    // The brink: the ground has started to fall away faster than a stream bed.
    const ahead = ground(x + tarn.outflow.x * STEP_OUT, z + tarn.outflow.z * STEP_OUT, seed)
    if (d >= 0 && here - ahead > BRINK_DROP) break
  }
  if (lead.length === 0) return null

  const lip = lead[lead.length - 1].y
  const traced = traceFallLine(brinkX, brinkZ, lip, heading, seed)
  if (!traced) return null

  const drop = lip - traced.base.y
  if (drop < MIN_DROP) return null

  const path = [...lead, ...traced.path]
  // One pass to make the whole line monotone. The stream and the fall are traced
  // separately and meet at the brink, and that join is the one place where the
  // second could start higher than the first left off - which draws water
  // climbing back up over the lip.
  for (let i = 1; i < path.length; i++) path[i].y = Math.min(path[i].y, path[i - 1].y)

  return {
    top: path[0].clone(),
    base: traced.base,
    dir: traced.dir,
    /*
      A bigger pool spills a wider fall, and all of them are wide: a fifteen
      metre ribbon on a green hillside a kilometre away is a thread, and the
      player could not find the falls at all.
    */
    width: 12 + tarn.radius * 0.34,
    path,
    lead: lead.length,
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
