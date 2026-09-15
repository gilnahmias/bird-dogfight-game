/**
 * How the bird's shadow reads at a given height above the ground.
 *
 * Separate from the mesh that draws it because this curve IS the instrument:
 * get it wrong and the shadow stops answering "how high am I", which is the
 * only reason it exists.
 *
 * Height here is measured to the ground the shadow actually lands on, which is
 * not the ground under the bird - the shadow is thrown along the sun, so it can
 * land on a ridge far ahead or in a valley far below.
 */

/** Above this the shadow has faded out entirely. */
export const MAX_HEIGHT = 430

/**
 * Size on the ground. Grows sub-linearly with height.
 *
 * A shadow cast along a low sun lands roughly twice its height away, so its size
 * ON SCREEN is size / distance - and a fixed-size blob shrinks to a speck within
 * a hundred metres of climb. Measured, a constant-size shadow covered 0.04% of
 * the frame at 115m: present in the render, invisible to the player.
 *
 * Growing it as height^0.78 keeps it legible all the way up while still
 * shrinking in the view, which is what carries the altitude cue.
 */
const BASE_SIZE = 4.5
const GROWTH = 0.26
const GROWTH_POWER = 0.78

/**
 * Opacity with the bird on the deck. Kept clearly darker than the cloud shadows
 * it lands among, so the bird's own mark still reads when it crosses one.
 */
const BASE_OPACITY = 0.6

/**
 * How soft the edge is, 0 (hard) to 0.5 (nothing but gradient).
 *
 * The sun is a disc, not a point, so a shadow's penumbra widens with the gap
 * between caster and surface: sharp at touchdown, a soft grey smudge from
 * cruising height. It is also the second altitude cue - sharpness reads even when
 * the shadow is too small to measure.
 */
export function blurFor(heightAboveGround: number): number {
  const t = Math.min(1, Math.max(0, heightAboveGround / 240))
  return 0.04 + 0.4 * Math.sqrt(t)
}

export type ShadowLook = {
  visible: boolean
  size: number
  opacity: number
  /** Edge softness, for the material. */
  blur: number
}

export function shadowFor(heightAboveGround: number): ShadowLook {
  if (heightAboveGround < 0 || heightAboveGround > MAX_HEIGHT) {
    return { visible: false, size: 0, opacity: 0, blur: 0 }
  }
  const t = heightAboveGround / MAX_HEIGHT
  return {
    visible: true,
    size: BASE_SIZE + GROWTH * Math.pow(heightAboveGround, GROWTH_POWER),
    // Nearly linear rather than quadratic: a square law dumps almost all of the
    // contrast in the first third of the range and leaves nothing for cruise.
    opacity: BASE_OPACITY * Math.pow(1 - t, 1.15),
    blur: blurFor(heightAboveGround),
  }
}

/**
 * Project one of the bird's own axes onto the ground it is casting on.
 *
 * This is what makes a shadow smear. A flat field takes the bird's outline
 * undistorted however low the sun is - parallel light projecting a flat shape
 * onto a parallel plane changes nothing - but a mountainside is not parallel to
 * the bird, and there the same outline is stretched along the slope. Getting
 * this wrong is exactly what made the old shadow read as a decal: it stayed the
 * same shape on a cliff as on a lake.
 *
 * `v` is a vector in the bird's plane, `normal` the surface normal, `light` the
 * direction the sunlight travels (downward). The shadow of the point at `v` lands
 * at `v` minus however far along the light ray it has to travel to reach the
 * plane.
 */
/**
 * How many times its own size the outline may be stretched by a slope.
 *
 * The honest answer on a steep face under a low sun is several times over, and
 * that is what it looked like: a dark BAR laid down the hillside with no bird in
 * it. The shadow is an instrument first, so the smear is allowed to show the
 * slope and not much more.
 */
const STRETCH_LIMIT = 1.6

export function castOnto(
  v: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  light: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const alongLight = light.x * normal.x + light.y * normal.y + light.z * normal.z
  const above = v.x * normal.x + v.y * normal.y + v.z * normal.z
  // Read out of `v` before writing anything: callers pass the same vector as
  // both input and output, and a limit measured after the write is no limit at
  // all - which is exactly how a wingspan once smeared 1.5km across a hillside.
  const limit = STRETCH_LIMIT * Math.hypot(v.x, v.y, v.z)
  const vx = v.x
  const vy = v.y
  const vz = v.z
  const t = Math.abs(alongLight) < 1e-4 ? 0 : above / alongLight
  out.x = vx - t * light.x
  out.y = vy - t * light.y
  out.z = vz - t * light.z
  // Shortened rather than clipped: scaling a vector that already lies in the
  // surface keeps it in the surface, where clamping `t` would lift the smear off
  // the very slope it is supposed to be lying on.
  const length = Math.hypot(out.x, out.y, out.z)
  if (length > limit && length > 1e-6) {
    const k = limit / length
    out.x *= k
    out.y *= k
    out.z *= k
  }
  return out
}

/**
 * Roughly how wide the shadow looks from the bird, in radians.
 *
 * The real test of the instrument. `reach` is how far the shadow is thrown per
 * metre of height, which the sun elevation decides.
 */
export function apparentSize(heightAboveGround: number, reach: number): number {
  const distance = Math.hypot(heightAboveGround, heightAboveGround * reach)
  if (distance < 1) return Math.PI
  return (2 * shadowFor(heightAboveGround).size) / distance
}

/** How much a face still shows when the sun barely reaches it. */
const SHADE_FLOOR = 0.3

/**
 * How much of a shadow a surface can actually show, SHADE_FLOOR to 1.
 *
 * A slope turned edge-on to the sun is barely lit, so there is next to no light
 * for the bird to block: drawing a full-strength mark there reads as a dark
 * stripe painted on the hill. It is also the case where the projection stretches
 * furthest, so easing it off is what keeps the smear honest at its limit.
 *
 * It never reaches zero, though. In mountains under a low sun a great deal of
 * the ground is in shade, and a shadow that switched off there would take the
 * altitude read-out away exactly where flying is tightest - measured, it faded
 * to 0.03 on an ordinary pass along a hillside.
 */
export function litness(
  normal: { x: number; y: number; z: number },
  light: { x: number; y: number; z: number },
): number {
  // The light travels downward, so a lit face has a NEGATIVE dot with it.
  const facing = -(light.x * normal.x + light.y * normal.y + light.z * normal.z)
  const t = (facing - 0.06) / 0.22
  return SHADE_FLOOR + (1 - SHADE_FLOOR) * Math.min(1, Math.max(0, t))
}

/**
 * Where the sun ray from the bird meets the ground.
 *
 * Solved by iteration rather than marched: guess a landing height, walk the ray
 * that far, sample the ground there, repeat. It settles in a few rounds even
 * over a slope and costs a handful of samples instead of dozens.
 *
 * `seedGround` is last frame's answer, which is what makes it cheap - on level
 * ground the first guess is already right.
 */
export function castToGround(
  bird: { x: number; y: number; z: number },
  cast: { x: number; z: number },
  reach: number,
  seedGround: number,
  groundAt: (x: number, z: number) => number,
  steps = 3,
): { x: number; z: number; groundY: number } {
  // A remembered ground ABOVE the bird would stop the solve dead: the first step
  // sees a negative drop, gives up, and hands back the same stale answer forever
  // - so the shadow vanished for good the moment the bird dropped off a ridge
  // into a valley. Re-seed from the ground directly below instead.
  let groundY = seedGround >= bird.y || Number.isNaN(seedGround) ? groundAt(bird.x, bird.z) : seedGround
  let x = bird.x
  let z = bird.z
  for (let i = 0; i < steps; i++) {
    const drop = bird.y - groundY
    if (drop <= 0) break
    x = bird.x + cast.x * drop * reach
    z = bird.z + cast.z * drop * reach
    groundY = groundAt(x, z)
  }
  return { x, z, groundY }
}
