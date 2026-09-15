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

/** Opacity with the bird on the deck. */
const BASE_OPACITY = 0.46

export type ShadowLook = { visible: boolean; size: number; opacity: number }

export function shadowFor(heightAboveGround: number): ShadowLook {
  if (heightAboveGround < 0 || heightAboveGround > MAX_HEIGHT) {
    return { visible: false, size: 0, opacity: 0 }
  }
  const t = heightAboveGround / MAX_HEIGHT
  return {
    visible: true,
    size: BASE_SIZE + GROWTH * Math.pow(heightAboveGround, GROWTH_POWER),
    // Nearly linear rather than quadratic: a square law dumps almost all of the
    // contrast in the first third of the range and leaves nothing for cruise.
    opacity: BASE_OPACITY * Math.pow(1 - t, 1.15),
  }
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
