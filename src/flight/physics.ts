/**
 * Flight model. No React, no scene objects, no globals - just state in, state
 * out, so it can be stepped in a test at a fixed dt and reasoned about.
 *
 * `step` mutates and returns the state it is given. That is deliberate: it runs
 * every frame and allocating a fresh state (and six Vector3s) per call showed up
 * in the frame budget. Determinism, which is what makes it testable, is intact.
 *
 * This is a POWERED bird, not a glider. It beats its wings constantly and holds
 * a cruising speed on its own, so there is no stall to fall out of and no
 * stamina to run dry - two ways to lose that punished the player for looking at
 * the scenery. What is left is the part worth flying: trading height for speed,
 * reading the air, and choosing when to give speed away.
 *
 * Speed is given away with the brake, which is also what puts the talons out.
 * One key, two meanings, and they are the same idea: a raptor slows by throwing
 * its feet forward, whether it is landing or taking something.
 */
import { Quaternion, Vector3 } from 'three'
import { T } from '../game/constants.ts'

export type Input = {
  /** -1 left, +1 right. */
  roll: number
  /** -1 nose down, +1 nose up. */
  pitch: number
  /** Brake and put the talons out. */
  brake: boolean
}

export type AirSample = {
  /** World-space wind, including thermal/ridge lift as a vertical component. */
  wind: Vector3
}

export type BirdState = {
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  /** Talon load in weight units. */
  load: number
  /** 0 tucked, 1 thrown fully forward. Follows the brake, with some travel time. */
  talons: number
  // Read-only outputs, refreshed each step for the HUD, camera and audio.
  airspeed: number
  aoa: number
  /** Advances continuously; the wings never stop beating. */
  flapPhase: number
  climbRate: number
  /** True once the bird has settled on the ground under its own control. */
  perched: boolean
  /** Seconds left of the leap that gets a landed bird back into the air. */
  launchTimer: number
  dead: boolean
}

export const FWD = new Vector3(0, 0, -1)
export const UP = new Vector3(0, 1, 0)
export const RIGHT = new Vector3(1, 0, 0)

export function createBird(pos: Vector3, heading = 0): BirdState {
  const quat = new Quaternion().setFromAxisAngle(UP, heading)
  return {
    pos: pos.clone(),
    vel: FWD.clone().applyQuaternion(quat).multiplyScalar(T.cruiseSpeed),
    quat,
    load: 0,
    talons: 0,
    airspeed: T.cruiseSpeed,
    aoa: 0,
    flapPhase: 0,
    climbRate: 0,
    perched: false,
    launchTimer: 0,
    dead: false,
  }
}

/**
 * Lift coefficient.
 *
 * Rises with angle of attack and then flattens off. It never falls: this bird
 * does not stall, so hauling the nose up costs speed and climb but can never
 * drop the wing out from under the player.
 */
export function liftCoefficient(aoa: number): number {
  const peak = T.clSlope * T.aoaSoftLimit
  // A smooth saturating curve - linear near zero, flattening toward the peak.
  return peak * Math.tanh((T.clSlope * aoa) / peak)
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

  // The talons take a moment to swing forward and to tuck away again, so the
  // gesture reads on screen instead of snapping.
  const talonTarget = input.brake ? 1 : 0
  const talonRate = talonTarget > s.talons ? T.talonOutRate : T.talonInRate
  s.talons += Math.sign(talonTarget - s.talons) * Math.min(Math.abs(talonTarget - s.talons), talonRate * dt)

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
  // Spreading the feet and fanning the tail is enormously draggy, which is
  // exactly how a bird sheds speed.
  const brakeDrag = 1 + s.talons * T.brakeDrag
  const cd = (T.cd0 + T.inducedK * cl * cl) * brakeDrag
  const q = 0.5 * T.airDensity * airspeed * airspeed * T.wingArea

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

  // --- Power --------------------------------------------------------------
  // The wings beat all the time, and the thrust they make is governed toward a
  // cruising speed: short of it the bird works harder, past it - in a dive - it
  // coasts and lets gravity do the work.
  s.flapPhase += dt / T.flapInterval
  const braking = s.talons > 0.01
  const deficit = T.cruiseSpeed - airspeed
  const governed = Math.max(0, Math.min(1, deficit / T.cruiseSpeed + 0.12))
  // Standing on the ground the bird LEAPS rather than taxis, so the launch shove
  // goes up and forward rather than straight ahead. Pushed along the nose alone
  // it was worth less than the bird's own weight unless the player happened to
  // be pitched steeply up, and a landed bird could not reliably get airborne.
  if (s.perched && !braking && s.launchTimer <= 0) s.launchTimer = T.launchDuration
  if (braking) s.launchTimer = 0
  s.launchTimer = Math.max(0, s.launchTimer - dt)

  if (!braking) {
    if (s.launchTimer > 0) {
      tmp.copy(up).multiplyScalar(0.78).addScaledVector(fwd, 0.63).normalize()
      force.addScaledVector(tmp, T.launchThrust)
    } else {
      force.addScaledVector(fwd, governed * T.maxThrust)
    }
  }

  // Flaring: braking hard, the bird beats against its own descent and settles
  // rather than dropping. Without this, slowing down over open ground is the
  // same as falling out of the sky, and landing would be impossible.
  if (braking) {
    const slowness = Math.max(0, 1 - airspeed / T.cruiseSpeed)
    tmp.set(0, mass * T.gravity * T.flareSupport * slowness * s.talons, 0)
    force.add(tmp)
  }

  // --- Rotation -----------------------------------------------------------
  // Control authority follows airspeed, and a heavy load blunts it. It never
  // reaches zero: a braking bird still needs to be able to point itself.
  const authority =
    Math.max(T.minAuthority, Math.min(1, airspeed / T.refSpeed)) *
    (1 - T.loadAuthorityPenalty * (s.load / T.maxLoad))

  let pitchRate = input.pitch * T.pitchRate * authority
  let rollRate = input.roll * T.rollRate * authority

  // Passive pitch stability: the nose is pulled toward the trim angle of attack.
  // With no stall to recover from this is purely what keeps the bird pointing
  // where it is going when the player lets go.
  pitchRate -= (aoa - T.trimAoa) * T.pitchStability * authority

  // Roll stability acts at all times, which turns the axis into a bank command:
  // the input rolls, the stability levels, and the wings settle where the two
  // balance. Releasing the key rolls back to level.
  rollRate += right.y * T.rollStability * authority

  // Weathervane: yaw out of a sideslip. This is what turns a bank into a
  // coordinated turn without the player ever touching a rudder.
  const sideslip = flow.dot(right)
  const yawRate = -sideslip * T.weathervane * authority

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
 * Resolve contact with the ground.
 *
 * Coming down slowly and under control is a landing, not a crash: the bird can
 * brake to a standstill, so it can also put itself on the ground and sit there.
 * Arriving fast is still fatal, which is what keeps a low pass over rocks a real
 * decision.
 *
 * Water is the exception either way - a raptor can skim it, but it cannot perch
 * on it, so settling onto water drowns.
 */
export function resolveGround(
  s: BirdState,
  groundHeight: number,
  isWater: boolean,
  dt: number,
): 'clear' | 'splash' | 'land' | 'scrape' | 'drown' | 'crash' {
  const floor = groundHeight + T.groundClearance
  if (s.pos.y > floor) {
    s.perched = false
    return 'clear'
  }

  s.pos.y = floor
  const impact = -s.vel.y

  if (isWater) {
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

  // Solid ground. How hard the bird ARRIVES decides whether it survives - not
  // how fast it happens to be travelling. Brushing the grass on the way out of a
  // takeoff is survivable; flying into a hillside is not.
  if (impact > T.crashSink) {
    s.dead = true
    s.vel.set(0, 0, 0)
    return 'crash'
  }

  // Slow enough over the ground, and settling rather than arriving, is a
  // landing. Judged on ground speed rather than airspeed: a bird standing still
  // in a stiff wind still has airspeed, and that must not decide whether it may
  // put its feet down.
  const groundSpeed = Math.hypot(s.vel.x, s.vel.z)
  if (groundSpeed < T.landingSpeed && impact < T.landingSink) {
    s.perched = true
    // Rest on the ground without being pinned to it. Zeroing the velocity every
    // frame - which is what this did first - meant thrust could never build and
    // the bird could land but never leave.
    if (s.vel.y < 0) s.vel.y = 0
    const keep = Math.pow(T.groundFriction, dt)
    s.vel.x *= keep
    s.vel.z *= keep
    return 'land'
  }

  // Travelling too fast to perch but arriving gently: a scrape. It costs speed
  // and keeps the bird on the deck, which is a bad place to be, but is not death.
  if (s.vel.y < 0) s.vel.y = 0
  const keep = Math.pow(T.scrapeFriction, dt)
  s.vel.x *= keep
  s.vel.z *= keep
  return 'scrape'
}
