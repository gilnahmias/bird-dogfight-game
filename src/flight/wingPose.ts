/**
 * Wing pose: what each joint is doing at a given moment in the wingbeat.
 *
 * A bird's wing is not a board on a hinge. The stroke starts at the shoulder and
 * travels outward, so the elbow is still finishing the last beat while the
 * shoulder starts the next, and the hand trails further again. That lag is the
 * whole difference between a flapping wing and a flapping plank - it is what
 * makes the wing look soft.
 *
 * Pure so the motion can be checked without a browser: a wave really does travel
 * outward, the tip really does move further than the root, and nothing snaps.
 */

/** Fraction of a beat that the elbow trails the shoulder by. */
const ELBOW_LAG = 0.12
/** And the hand behind the elbow again. */
const WRIST_LAG = 0.24

export type WingPose = {
  /** Flap angles, radians, positive is up. */
  shoulder: number
  elbow: number
  wrist: number
  /** Leading-edge twist of the outer wing, radians. Feathering, not flapping. */
  twist: number
  /** 0 spread, 1 fully swept back and folded in for a dive. */
  tuck: number
}

/**
 * The stroke itself. Not a sine: a bird pulls down hard and fast, then recovers
 * more gently, so the curve is skewed rather than symmetric.
 */
export function stroke(phase: number): number {
  const p = phase - Math.floor(phase)
  // Warp time so the downstroke occupies less of the cycle than the recovery.
  const warped = p < 0.4 ? (p / 0.4) * 0.5 : 0.5 + ((p - 0.4) / 0.6) * 0.5
  return Math.cos(warped * Math.PI * 2)
}

export function wingPose(
  phase: number,
  flapping: boolean,
  airspeed: number,
  options: { tuckStart?: number; tuckFull?: number } = {},
): WingPose {
  const { tuckStart = 26, tuckFull = 44 } = options

  // Even a gliding bird is never rigid: it trims constantly in moving air.
  const amplitude = flapping ? 0.92 : 0.07
  const dihedral = flapping ? 0.05 : 0.15

  const tuck = Math.min(1, Math.max(0, (airspeed - tuckStart) / (tuckFull - tuckStart)))

  // The outer wing swings through more than the inner one, which is why a
  // wingtip traces a long arc while the shoulder barely moves.
  const shoulder = dihedral + stroke(phase) * amplitude * 0.62
  const elbow = stroke(phase - ELBOW_LAG) * amplitude * 0.5
  const wrist = stroke(phase - WRIST_LAG) * amplitude * 0.42

  // The hand feathers as it travels, twisting to bite on the downstroke and
  // spill air on the way back up.
  const twist = stroke(phase - WRIST_LAG - 0.08) * (flapping ? 0.34 : 0.06)

  return { shoulder, elbow, wrist, twist, tuck }
}

/** Just enough of a three.js Object3D to be posed, so this stays testable. */
export type Joint = {
  rotation: { x: number; y: number; z: number }
  scale: { x: number }
}

export type WingJointSet = { shoulder: Joint; elbow: Joint; wrist: Joint }

/**
 * Pose one wing.
 *
 * Both wings take the SAME angles, with no per-side sign flip. The right wing
 * hangs under a group scaled [-1, 1, 1], and a mirror already reverses a
 * rotation about Z or Y: M * Rz(a) * M = Rz(-a). Negating the angle per side as
 * well cancels the mirror out and drives the wings in opposite directions - one
 * tip rising as the other falls. Twist is about the span axis, which a mirror
 * leaves alone, so it is shared unchanged and both wings hold the same angle of
 * attack.
 */
export function applyWingPose(wing: WingJointSet, pose: WingPose): void {
  wing.shoulder.rotation.z = pose.shoulder
  // Sweeping back at speed is most of what makes a dive read as a dive.
  wing.shoulder.rotation.y = pose.tuck * -0.55
  wing.shoulder.scale.x = 1 - pose.tuck * 0.3

  wing.elbow.rotation.z = pose.elbow
  wing.elbow.rotation.y = pose.tuck * -0.5

  wing.wrist.rotation.z = pose.wrist
  // Feathering: the hand twists to bite on the way down and spill on the way
  // back up. Small, but it is what stops the tip looking like a paddle.
  wing.wrist.rotation.x = pose.twist
}
