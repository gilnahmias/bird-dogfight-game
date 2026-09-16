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
  /**
   * 0 flying, 1 folded away against the body.
   *
   * A perched bird is not a flying bird with its wings held still: it puts them
   * AWAY. Without this the raptor stood in its nest beating the air like a
   * wind-up toy, which is the opposite of resting.
   */
  fold: number
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
  options: { tuckStart?: number; tuckFull?: number; perched?: boolean } = {},
): WingPose {
  const { tuckStart = 26, tuckFull = 44, perched = false } = options

  if (perched) {
    // Folded, still, and settled. The tiny drift keeps it from looking stuffed.
    const breathe = Math.sin(phase * 0.6) * 0.02
    return { shoulder: -0.12 + breathe, elbow: 0.1, wrist: 0.06, twist: 0, tuck: 1, fold: 1 }
  }

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

  return { shoulder, elbow, wrist, twist, tuck, fold: 0 }
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
  // Sweeping back at speed is most of what makes a dive read as a dive, and
  // folding is the same movement taken all the way: swept back and shortened
  // until the wing is lying along the bird instead of standing out from it.
  wing.shoulder.rotation.y = pose.tuck * -0.55 - pose.fold * 0.5
  wing.shoulder.scale.x = 1 - pose.tuck * 0.3 - pose.fold * 0.22

  wing.elbow.rotation.z = pose.elbow
  wing.elbow.rotation.y = pose.tuck * -0.5 - pose.fold * 1.15

  wing.wrist.rotation.z = pose.wrist
  // Feathering: the hand twists to bite on the way down and spill on the way
  // back up. Small, but it is what stops the tip looking like a paddle.
  wing.wrist.rotation.x = pose.twist
}

// --- Rhythm ----------------------------------------------------------------

/**
 * When the wings beat and when they are held out.
 *
 * A raptor does not flap continuously - it beats in short bursts and then holds
 * the wings out, and the bursts come when it needs power: climbing, slow, or
 * sinking. Constant beating reads as a wind-up toy, and it hides the thing the
 * player most wants to see, which is that the air is doing the work.
 *
 * Purely cosmetic. Thrust is governed elsewhere and does not care whether the
 * wings happen to be down at that instant.
 */
export type Rhythm = {
  beating: boolean
  /** Seconds left in the current burst or glide. */
  timer: number
}

export function createRhythm(): Rhythm {
  return { beating: true, timer: 0 }
}

export type RhythmInput = {
  airspeed: number
  climbRate: number
  cruiseSpeed: number
  perched: boolean
}

/** Length of a burst of beats, and of the glide between bursts. */
const BURST_SECONDS = 2.4
const GLIDE_SECONDS = 2.8

export function stepRhythm(rhythm: Rhythm, input: RhythmInput, dt: number): Rhythm {
  rhythm.timer -= dt

  // Power is needed: slow, sinking, or standing about to leap. These override
  // the cycle, because a bird that is dropping does not coast.
  const needsPower =
    input.perched || input.airspeed < input.cruiseSpeed * 0.72 || input.climbRate < -3.5

  // Rising air or plenty of speed: hold them out and enjoy it.
  const canCoast = !needsPower && (input.climbRate > -0.6 || input.airspeed > input.cruiseSpeed)

  if (needsPower) {
    rhythm.beating = true
    rhythm.timer = Math.max(rhythm.timer, 0.4)
    return rhythm
  }

  if (rhythm.timer > 0) return rhythm

  if (rhythm.beating && canCoast) {
    rhythm.beating = false
    rhythm.timer = GLIDE_SECONDS
  } else {
    rhythm.beating = true
    rhythm.timer = BURST_SECONDS
  }
  return rhythm
}
