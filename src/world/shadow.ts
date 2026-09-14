/**
 * How the bird's shadow reads at a given height above the ground.
 *
 * Separate from the mesh that draws it because this curve IS the instrument:
 * get it wrong and the shadow stops answering "how high am I", which is the
 * only reason it exists.
 */

/** Above this the shadow has faded out entirely. */
export const MAX_HEIGHT = 260
/** Half-size of the shadow when the bird is on the deck, in metres. */
const BASE_SIZE = 5.2
/** How much the blob spreads by the time it fades out. */
const SPREAD = 3.2

export type ShadowLook = { visible: boolean; size: number; opacity: number }

export function shadowFor(heightAboveGround: number): ShadowLook {
  if (heightAboveGround < 0 || heightAboveGround > MAX_HEIGHT) {
    return { visible: false, size: 0, opacity: 0 }
  }
  const t = heightAboveGround / MAX_HEIGHT
  return {
    visible: true,
    // Spreads as the bird climbs.
    size: BASE_SIZE * (1 + t * SPREAD),
    // Fades off quadratically, so it stays sharp and readable low down, where
    // judging height actually matters.
    opacity: 0.42 * (1 - t) * (1 - t),
  }
}
