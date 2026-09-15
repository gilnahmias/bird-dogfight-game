/**
 * Which way the water goes.
 *
 * The streaks on a waterfall sheet are drawn by a repeating pattern whose phase
 * mixes position down the sheet with time:
 *
 *     v = fract(fall * k + TIME_SIGN * t * speed + phase)
 *
 * where `fall` is 0 at the lip and 1 at the foot. A given streak is a fixed `v`,
 * so rearranging gives where that streak sits at time t. With the time term
 * ADDED, `fall` decreases as time passes and the water climbs the cliff - which
 * is exactly what it did.
 *
 * The sign lives here, shared with the shader that is built from it, so the two
 * cannot drift apart and the direction is covered by a test rather than by eye.
 */
export const TIME_SIGN = -1

/** The GLSL operator for the time term, so the shader is generated from the sign above. */
export const TIME_OPERATOR = TIME_SIGN < 0 ? '-' : '+'

/**
 * How far down the sheet a given streak sits at time `t`.
 * 0 is the lip, 1 is the foot.
 */
export function streakFall(v: number, t: number, k = 3.2, speed = 1, phase = 0): number {
  return (v - phase - TIME_SIGN * t * speed) / k
}
