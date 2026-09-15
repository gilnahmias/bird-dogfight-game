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
  /**
   * Where the wings are in the beat, radians, positive up. Written by the view
   * after it poses the wing, and read by the shadow so the mark on the ground
   * flaps with the bird instead of sliding along as a blob.
   */
  wingAngle: number
  climbRate: number
  /** True once the bird has settled on the ground under its own control. */
  perched: boolean
  /** Seconds left of the leap that gets a landed bird back into the air. */
  launchTimer: number
  /** Seconds left of hauling off the water after touching it. */
  wetTimer: number
  dead: boolean
}

export const FWD = new Vector3(0, 0, -1)
export const UP = new Vector3(0, 1, 0)
export const RIGHT = new Vector3(1, 0, 0)

export function createBird(pos: Vector3, heading = 0, perched = false): BirdState {
  const quat = new Quaternion().setFromAxisAngle(UP, heading)
  return {
    pos: pos.clone(),
    vel: perched
      ? new Vector3()
      : FWD.clone().applyQuaternion(quat).multiplyScalar(T.cruiseSpeed),
    quat,
    load: 0,
    talons: 0,
    airspeed: perched ? 0 : T.cruiseSpeed,
    aoa: 0,
    flapPhase: 0,
    wingAngle: 0,
    climbRate: 0,
    perched,
    launchTimer: 0,
    wetTimer: 0,
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
  // Perched or mid-leap the feet stay down where they belong.
  const talonTarget = input.brake && !s.perched && s.launchTimer <= 0 ? 1 : 0
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

  // A bird gripping a branch is not flying. Without this the wind works on the
  // wing while the feet are planted, and at a standstill the air meets the wing
  // from behind - which is nonsense aerodynamically and, measured, was strong
  // enough to hold the bird on its perch through the entire launch.
  const gripping = s.perched && s.launchTimer <= 0

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
  if (!gripping) {
    force.addScaledVector(liftDir, q * cl)
    force.addScaledVector(flow, -q * cd)
  }
  force.y -= mass * T.gravity

  // --- Power --------------------------------------------------------------
  // The wings beat all the time, and the thrust they make is governed toward a
  // cruising speed: short of it the bird works harder, past it - in a dive - it
  // coasts and lets gravity do the work.
  s.flapPhase += dt / T.flapInterval
  const braking = s.talons > 0.01
  const deficit = T.cruiseSpeed - airspeed
  // Proportional, with a standing bias that roughly cancels cruise drag. Scaling
  // the deficit against the full cruise speed made the governor far too soft:
  // the bird settled five metres a second short of the speed it was aiming for.
  const governed = Math.max(0, Math.min(1, deficit / (T.cruiseSpeed * T.thrustGain) + T.thrustBias))
  // Standing on the ground the bird LEAPS rather than taxis, so the launch shove
  // goes up and forward rather than straight ahead. Pushed along the nose alone
  // it was worth less than the bird's own weight unless the player happened to
  // be pitched steeply up, and a landed bird could not reliably get airborne.
  // On the ground, the brake key is the launch key. It is the same gesture - the
  // feet drive against the ground instead of against the air - and it means a
  // perched bird waits for the player rather than leaping the instant it lands.
  if (s.perched && input.brake && s.launchTimer <= 0) {
    s.launchTimer = T.launchDuration
    // The leap is an impulse: the legs drive against the branch and the bird is
    // simply moving, up and forward, before the wings take over.
    tmp.copy(up).multiplyScalar(0.55).addScaledVector(fwd, 0.84).normalize()
    s.vel.copy(tmp).multiplyScalar(T.launchSpeed)
  }
  s.launchTimer = Math.max(0, s.launchTimer - dt)
  // Mid-leap the brake is ignored, or holding the key would stop the takeoff it
  // just started.
  const launching = s.launchTimer > 0

  // Just off the water: the bird hauls itself clear with a few heavy beats. This
  // is what makes a water touch survivable without also making it free - it
  // costs the speed the water already took, and it happens without a key, so
  // there is no way to end up stuck skidding across a lake.
  s.wetTimer = Math.max(0, s.wetTimer - dt)
  if (s.wetTimer > 0) {
    tmp.copy(up).multiplyScalar(0.86).addScaledVector(fwd, 0.5).normalize()
    force.addScaledVector(tmp, T.waterEscapeThrust)
  }

  if (launching) {
    tmp.copy(up).multiplyScalar(0.78).addScaledVector(fwd, 0.63).normalize()
    force.addScaledVector(tmp, T.launchThrust)
  } else if (!braking && !s.perched) {
    // A perched bird makes no thrust at all. Left on, cruise thrust simply drove
    // it off its own perch a second after the game started - it never got to be
    // standing anywhere.
    force.addScaledVector(fwd, governed * T.maxThrust)
  }

  // Flaring: braking hard, the bird beats against its own descent and settles
  // rather than dropping. Without this, slowing down over open ground is the
  // same as falling out of the sky, and landing would be impossible.
  if (braking) {
    // Only once the wing has genuinely lost its lift. Scaled off cruise speed it
    // was still worth nearly half the bird's weight at a hunting pass of 12 m/s,
    // on top of the lift the wing was already making - so braking to take
    // something ballooned the bird up and over the top of it every time.
    const slowness = Math.max(0, 1 - airspeed / (T.cruiseSpeed * T.flareOnset))
    tmp.set(0, mass * T.gravity * T.flareSupport * slowness * slowness * s.talons, 0)
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
 * Water is the exception either way: it is never fatal and never a perch. A
 * touch costs speed and throws spray, and the bird hauls itself off the surface
 * again.
 */
export function resolveGround(
  s: BirdState,
  groundHeight: number,
  isWater: boolean,
  dt: number,
): 'clear' | 'splash' | 'land' | 'scrape' | 'crash' {
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
    // Water is never fatal. It takes speed, throws spray, and the bird beats its
    // way out - see `wetTimer`. Drowning used to punish exactly the manoeuvre
    // fishing is made of: feet down, slow, right at the surface.
    s.wetTimer = T.waterEscape
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
    if (s.vel.y < 0) s.vel.y = 0
    if (s.launchTimer > 0) {
      // Mid-leap: let the push build. Damping here meant the bird could land but
      // never leave.
      const keep = Math.pow(T.groundFriction, dt)
      s.vel.x *= keep
      s.vel.z *= keep
    } else {
      // Standing: a bird gripping a branch does not slide. Light damping was not
      // enough against a seven metre a second wind, which pushed the bird out of
      // its own nest within a couple of seconds of the game starting.
      s.vel.x = 0
      s.vel.z = 0
    }
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
