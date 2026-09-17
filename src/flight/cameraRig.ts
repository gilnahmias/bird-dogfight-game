/**
 * Keeping the chase camera out of the ground.
 *
 * The camera trails the bird by eleven metres on a lag, and nothing stopped it
 * going where the bird had just been. Contouring along a hillside and turning,
 * measured, swung it to nought metres of clearance and then inside the slope -
 * and the terrain is a single-sided surface, so from inside a mountain you see
 * straight through it to whatever is on the far side. That is the "hollow
 * mountain": not missing geometry, a camera standing inside a shell.
 *
 * Two rules, applied in this order:
 *
 *   line of sight   if the hill comes between the bird and the camera, the
 *                   camera swings round toward lower ground, rises a little
 *                   if that is not enough, and only pulls in as a last resort
 *   floor           the camera never sits closer to the ground than CLEARANCE,
 *                   judged over a small footprint rather than a single point,
 *                   because the near plane has width and its lower corners dip
 *                   into a slope before its centre does
 *
 * Pure: the ground comes in as a function, so the rules can be tested without a
 * world.
 */
export type Point = { x: number; y: number; z: number }

/** How far above the ground the camera is kept, in metres. */
export const CLEARANCE = 2.2
/** Radius of the footprint the floor is judged over. */
const FOOTPRINT = 2.5

/** Highest ground under a small footprint around a point. */
function highestNear(x: number, z: number, groundAt: (x: number, z: number) => number): number {
  let top = groundAt(x, z)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    top = Math.max(top, groundAt(x + Math.cos(a) * FOOTPRINT, z + Math.sin(a) * FOOTPRINT))
  }
  return top
}

/**
 * Whether the bird can be seen from `from`: nothing solid on the line between.
 *
 * Samples single points rather than footprints. It runs for every candidate the
 * camera considers, and the footprint check is what the floor is for - every
 * candidate is lifted over its footprint before this is asked.
 */
function canSee(bird: Point, from: Point, groundAt: (x: number, z: number) => number): boolean {
  for (let i = 1; i < SIGHT_STEPS; i++) {
    const t = i / SIGHT_STEPS
    const x = bird.x + (from.x - bird.x) * t
    const y = bird.y + (from.y - bird.y) * t
    const z = bird.z + (from.z - bird.z) * t
    // Near the bird, the bird's own height above the ground is what counts.
    const margin = t < 0.25 ? 0 : SIGHT_MARGIN
    if (y < groundAt(x, z) + margin) return false
  }
  return true
}

/**
 * Where the camera may go instead, in order of preference: [swing, rise].
 * Swing is radians round the bird, rise is metres up.
 *
 * Swinging sideways comes first because it keeps the camera low and behind the
 * bird. The first version only ever rose, and near a hillside - which is where a
 * hunting bird spends its time - it climbed up to eighteen metres and looked
 * down on the bird at eighty degrees, against twenty-three in open air.
 */
const CANDIDATES: [number, number][] = [
  [0, 0],
  [0.35, 0],
  [0, 4],
  [0.35, 4],
  [0.7, 0],
  [0.7, 4],
  [0, 8],
  [1.05, 4],
  [0.7, 8],
]

const SIGHT_STEPS = 12
/** How far clear of the ground the line to the bird has to pass. */
const SIGHT_MARGIN = 0.8

const candidate = { x: 0, y: 0, z: 0 }

/**
 * Move `camera` so it can see `bird` and is not inside or grazing the ground.
 * Writes the result into `out`, which may be `camera` itself.
 */
export function keepCameraClear(
  bird: Point,
  camera: Point,
  groundAt: (x: number, z: number) => number,
  out: Point,
): Point {
  const ox = camera.x - bird.x
  const oy = camera.y - bird.y
  const oz = camera.z - bird.z

  // Swing toward the LOWER side. Decided from the ground itself rather than
  // tried both ways, so the choice is the same frame after frame and the camera
  // does not flick from one side of the bird to the other.
  const probe = 0.6
  const sideA = groundAt(bird.x + ox * Math.cos(probe) - oz * Math.sin(probe), bird.z + ox * Math.sin(probe) + oz * Math.cos(probe))
  const sideB = groundAt(bird.x + ox * Math.cos(-probe) - oz * Math.sin(-probe), bird.z + ox * Math.sin(-probe) + oz * Math.cos(-probe))
  const side = sideA <= sideB ? 1 : -1

  /*
    The cheapest correction wins, measured by how far the camera actually moves.

    Not simply the first candidate that works: the floor lifts every candidate
    over the ground before it is judged, so "stay where you are" could pass by
    being hoisted seven metres up a slope - a rise in disguise, and exactly the
    steep look-down this is trying to avoid. Distance moved counts the lift.
  */
  let bestX = 0
  let bestY = 0
  let bestZ = 0
  let bestCost = Infinity
  for (const [swing, rise] of CANDIDATES) {
    const a = swing * side
    candidate.x = bird.x + ox * Math.cos(a) - oz * Math.sin(a)
    candidate.y = bird.y + oy + rise
    candidate.z = bird.z + ox * Math.sin(a) + oz * Math.cos(a)
    keepAboveGround(candidate, groundAt)
    const cost = Math.hypot(candidate.x - camera.x, candidate.y - camera.y, candidate.z - camera.z)
    // Nothing to fix: take it without looking further. The common case, and the
    // cheap one.
    if (cost < 1e-6 && canSee(bird, candidate, groundAt)) {
      out.x = candidate.x
      out.y = candidate.y
      out.z = candidate.z
      return out
    }
    if (cost < bestCost && canSee(bird, candidate, groundAt)) {
      bestCost = cost
      bestX = candidate.x
      bestY = candidate.y
      bestZ = candidate.z
    }
  }
  if (bestCost < Infinity) {
    out.x = bestX
    out.y = bestY
    out.z = bestZ
    return out
  }

  // Nowhere nearby can see the bird: come in along the original line until
  // something can. Close is better than blind.
  for (let i = SIGHT_STEPS - 1; i >= 1; i--) {
    const t = i / SIGHT_STEPS
    candidate.x = bird.x + ox * t
    candidate.y = bird.y + oy * t
    candidate.z = bird.z + oz * t
    keepAboveGround(candidate, groundAt)
    if (canSee(bird, candidate, groundAt)) break
  }
  out.x = candidate.x
  out.y = candidate.y
  out.z = candidate.z
  return out
}

/**
 * The floor alone: lift a point clear of the ground and do nothing else.
 *
 * For state the camera keeps between frames. Running the full rule on it - rise
 * over whatever is in the way - fed each frame's rise into the next frame's
 * starting point, and the camera ratcheted upward until it hung high above the
 * bird looking straight down. The floor cannot do that: it only ever lifts to
 * where the ground already is.
 */
export function keepAboveGround(
  point: Point,
  groundAt: (x: number, z: number) => number,
): Point {
  const floor = highestNear(point.x, point.z, groundAt) + CLEARANCE
  if (point.y < floor) point.y = floor
  return point
}

/**
 * The lens for a tall screen.
 *
 * The field of view is vertical, so a phone held upright keeps the height and
 * loses most of the width: the world shrinks to a slot you cannot steer by.
 * Below this aspect the vertical angle opens up to keep the sideways view - not
 * all of a landscape screen's, which would need a fisheye, but enough to steer by.
 */
const NARROWEST_ASPECT = 0.9

export function portraitFov(fov: number, aspect: number): number {
  if (aspect >= NARROWEST_ASPECT) return fov
  const half = Math.atan((Math.tan((fov * Math.PI) / 360) * NARROWEST_ASPECT) / aspect)
  // Capped, because past this a phone held upright looks through a fisheye.
  return Math.min(100, (half * 360) / Math.PI)
}
