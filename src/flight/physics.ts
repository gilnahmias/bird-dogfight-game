/**
 * Flight model. No React, no scene objects, no globals - just state in, state
 * out, so it can be stepped in a test at a fixed dt and reasoned about.
 *
 * `step` mutates and returns the state it is given. That is deliberate: it runs
 * every frame and allocating a fresh state (and six Vector3s) per call showed up
 * in the frame budget. Determinism, which is what makes it testable, is intact.
 */
import { Quaternion, Vector3 } from 'three'
import { T } from '../game/constants.ts'

export type Input = {
  /** -1 left, +1 right. */
  roll: number
  /** -1 nose down, +1 nose up. */
  pitch: number
  flap: boolean
}

export type AirSample = {
  /** World-space wind, including thermal/ridge lift as a vertical component. */
  wind: Vector3
}

export type BirdState = {
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  stamina: number
  /** Talon load in weight units. */
  load: number
  // Read-only outputs, refreshed each step for the HUD, camera and audio.
  airspeed: number
  aoa: number
  stalled: boolean
  /** Ramps 0 -> 1 as the stall deepens; drives the warning before the stall. */
  stallWarn: number
  flapPhase: number
  flappedThisStep: boolean
  /** True while the wings are actually beating, which is what the model animates. */
  flapping: boolean
  climbRate: number
  dead: boolean
}

export const FWD = new Vector3(0, 0, -1)
export const UP = new Vector3(0, 1, 0)
export const RIGHT = new Vector3(1, 0, 0)

export function createBird(pos: Vector3, heading = 0): BirdState {
  const quat = new Quaternion().setFromAxisAngle(UP, heading)
  return {
    pos: pos.clone(),
    // Start at a healthy cruise so the first second of the game is not a stall.
    vel: FWD.clone().applyQuaternion(quat).multiplyScalar(T.refSpeed),
    quat,
    stamina: T.staminaMax,
    load: 0,
    airspeed: T.refSpeed,
    aoa: 0,
    stalled: false,
    stallWarn: 0,
    flapPhase: 0,
    flappedThisStep: false,
    flapping: false,
    climbRate: 0,
    dead: false,
  }
}

/** Lift coefficient. Linear to the stall angle, then it falls off a cliff. */
export function liftCoefficient(aoa: number): number {
  const sign = Math.sign(aoa)
  const a = Math.abs(aoa)
  const clMax = T.clSlope * T.stallAngle
  if (a <= T.stallAngle) return T.clSlope * aoa
  const excess = (a - T.stallAngle) / T.stallAngle
  const falloff = Math.max(T.stallClFloor, 1 - excess * 1.35)
  return sign * clMax * falloff
}

// Scratch vectors, reused every step so the hot path allocates nothing.
const fwd = new Vector3()
const up = new Vector3()
const right = new Vector3()
const rel = new Vector3()
const flow = new Vector3()
const liftDir = new Vector3()
const force = new Vector3()
const tmp = new Vector3()
const spin = new Quaternion()

export function step(s: BirdState, input: Input, air: AirSample, dt: number): BirdState {
  if (s.dead) return s

  const mass = T.mass + s.load * T.loadMassPerUnit

  fwd.copy(FWD).applyQuaternion(s.quat)
  up.copy(UP).applyQuaternion(s.quat)
  right.copy(RIGHT).applyQuaternion(s.quat)

  // Relative airflow. Wind (thermals, ridge lift, sink) enters the model here,
  // as real airflow, so it interacts with the wing instead of teleporting us.
  rel.copy(s.vel).sub(air.wind)
  const airspeed = rel.length()
  s.airspeed = airspeed
  if (airspeed > 0.01) flow.copy(rel).divideScalar(airspeed)
  else flow.copy(fwd)

  // Angle of attack, signed, in the body's pitch plane. Positive means the
  // airflow meets the underside of the wing.
  const fx = flow.dot(fwd)
  const fy = flow.dot(up)
  const aoa = Math.atan2(-fy, fx)
  s.aoa = aoa

  const cl = liftCoefficient(aoa)
  const cd = T.cd0 + T.inducedK * cl * cl
  const q = 0.5 * T.airDensity * airspeed * airspeed * T.wingArea

  s.stalled = Math.abs(aoa) > T.stallAngle
  // Warn from 70% of the stall angle, so the player hears it coming.
  s.stallWarn = Math.min(1, Math.max(0, (Math.abs(aoa) - T.stallAngle * 0.7) / (T.stallAngle * 0.3)))

  // Lift acts perpendicular to the airflow, in the plane spanned by the flow and
  // the wing. cross(right, flow) is body-up when the flow is along the nose.
  liftDir.copy(right).cross(flow)
  const liftLen = liftDir.length()
  if (liftLen > 1e-4) liftDir.divideScalar(liftLen)
  else liftDir.copy(up)

  force.set(0, 0, 0)
  force.addScaledVector(liftDir, q * cl)
  force.addScaledVector(flow, -q * cd)
  force.y -= mass * T.gravity

  // --- Flapping -----------------------------------------------------------
  s.flappedThisStep = false
  const wantsFlap = input.flap || (airspeed < T.autoFlapSpeed && !s.dead)
  s.flapping = wantsFlap && s.stamina > 0
  s.flapPhase += dt
  if (wantsFlap && s.stamina > 0 && s.flapPhase >= T.flapInterval) {
    s.flapPhase = 0
    s.stamina = Math.max(0, s.stamina - T.flapStaminaCost)
    s.flappedThisStep = true
    // An impulse, applied over this step, up and slightly forward.
    tmp.copy(up).multiplyScalar(0.78).addScaledVector(fwd, 0.62).normalize()
    force.addScaledVector(tmp, T.flapImpulse / dt)
  } else if (!wantsFlap) {
    s.stamina = Math.min(T.staminaMax, s.stamina + T.staminaRegen * dt)
  }

  // --- Rotation -----------------------------------------------------------
  // Control authority follows airspeed, and a heavy load blunts it.
  const authority =
    Math.min(1, airspeed / T.refSpeed) * (1 - T.loadAuthorityPenalty * (s.load / T.maxLoad))

  let pitchRate = input.pitch * T.pitchRate * authority
  let rollRate = input.roll * T.rollRate * authority

  // Sign convention: a positive roll rate drops the right wing, so pressing right
  // banks right and therefore turns right.
  //
  // Hands off the roll axis, level the wings. Banked right means the right wing
  // is below the horizon (right.y < 0), which needs a negative rate to undo.
  if (input.roll === 0) {
    rollRate += right.y * T.rollAutoLevel * authority
  }

  // Passive pitch stability: the nose is pulled toward the trim angle of attack.
  // This is most of why the aircraft recovers on its own, and trimming at a
  // positive angle (rather than zero, which is zero lift) is what makes a
  // hands-off glide a glide instead of a dive.
  pitchRate -= (aoa - T.trimAoa) * T.pitchStability * authority

  // Past the stall, add nose-down torque. Holding the stick back only cancels
  // part of it (stallFightFactor), so letting go always recovers.
  if (s.stalled) {
    const excess = Math.abs(aoa) - T.stallAngle
    const fight = input.pitch > 0 ? T.stallFightFactor : 0
    pitchRate -= Math.sign(aoa) * excess * T.stallRecovery * (1 - fight)
  }

  // Weathervane: yaw out of a sideslip. This is what turns a bank into a
  // coordinated turn without the player ever touching a rudder.
  const sideslip = flow.dot(right)
  const yawRate = -sideslip * T.weathervane * authority

  // Apply body-axis rotation rates.
  spin.setFromAxisAngle(right, pitchRate * dt)
  s.quat.premultiply(spin)
  spin.setFromAxisAngle(fwd, rollRate * dt)
  s.quat.premultiply(spin)
  spin.setFromAxisAngle(up, yawRate * dt)
  s.quat.premultiply(spin)
  s.quat.normalize()

  // --- Integrate ----------------------------------------------------------
  s.vel.addScaledVector(force, dt / mass)
  s.pos.addScaledVector(s.vel, dt)
  s.climbRate = s.vel.y

  return s
}

/**
 * Resolve contact with the ground. Kept separate from `step` so the physics has
 * no dependency on the terrain module, and so tests can fly without a world.
 *
 * Contact with solid ground is always fatal. The bird cannot take off from a
 * standstill - a wingbeat is worth far less than its weight - so any survivable
 * landing would strand the player on the floor of the world, alive, with no way
 * back into the air and no way to lose either.
 *
 * Water is the exception, because the hunting loop needs low passes over lakes:
 * skim it fast and you come away wet, settle onto it and you drown.
 */
export function resolveGround(
  s: BirdState,
  groundHeight: number,
  isWater: boolean,
  dt: number,
): 'clear' | 'splash' | 'drown' | 'crash' {
  const floor = groundHeight + T.groundClearance
  if (s.pos.y > floor) return 'clear'

  s.pos.y = floor

  if (!isWater) {
    s.dead = true
    s.vel.set(0, 0, 0)
    return 'crash'
  }

  if (s.vel.y < 0) s.vel.y = 0
  const keep = Math.pow(T.waterDragFactor, dt)
  s.vel.x *= keep
  s.vel.z *= keep

  if (s.airspeed < T.drownSpeed) {
    s.dead = true
    s.vel.set(0, 0, 0)
    return 'drown'
  }
  return 'splash'
}
