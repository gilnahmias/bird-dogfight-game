import test from 'node:test'
import assert from 'node:assert/strict'
import { Quaternion, Vector3 } from 'three'
import { createBird, liftCoefficient, resolveGround, step, type Input } from './physics.ts'
import { T } from '../game/constants.ts'

const CALM = { wind: new Vector3(0, 0, 0) }
const NEUTRAL: Input = { roll: 0, pitch: 0, brake: false }
const BRAKE: Input = { roll: 0, pitch: 0, brake: true }

function fly(state = createBird(new Vector3(0, 500, 0)), input: Input = NEUTRAL, seconds = 5, air = CALM) {
  const dt = 1 / 120
  for (let i = 0; i < Math.round(seconds / dt); i++) step(state, input, air, dt)
  return state
}

// --- Powered flight --------------------------------------------------------

test('the bird holds its cruising speed on its own, from slow or from fast', () => {
  const slow = createBird(new Vector3(0, 900, 0))
  slow.vel.set(0, 0, -4)
  fly(slow, NEUTRAL, 12)
  assert.ok(
    Math.abs(slow.airspeed - T.cruiseSpeed) < 5,
    `started slow and settled at ${slow.airspeed.toFixed(1)}, not near ${T.cruiseSpeed}`,
  )

  const fast = createBird(new Vector3(0, 900, 0))
  fast.vel.set(0, 0, -45)
  fly(fast, NEUTRAL, 12)
  assert.ok(fast.airspeed < 32, `stayed too fast with no dive: ${fast.airspeed.toFixed(1)}`)
})

test('flying level costs no resource - there is nothing left to run out of', () => {
  const b = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 60)
  assert.ok(!b.dead, 'a minute of ordinary flight must not end the run')
  assert.ok(b.airspeed > 10, `the bird decayed to ${b.airspeed.toFixed(1)} m/s over a minute`)
})

test('there is no stall: hauling the nose up costs speed but never drops the wing', () => {
  // Held long enough this loops the bird, and the far side of a loop is a steep
  // descent - which is flying, not stalling. What must never happen is the bird
  // losing its wing and its controls and simply falling.
  const b = createBird(new Vector3(0, 2000, 0))
  b.vel.set(0, 0, -7) // slow, and asking for everything
  const dt = 1 / 120
  for (let i = 0; i < 6 / dt; i++) step(b, { roll: 0, pitch: 1, brake: false }, CALM, dt)
  assert.ok(!b.dead, 'the bird should still be flying')

  // Let go, and it flies out of it on its own.
  for (let i = 0; i < 6 / dt; i++) step(b, NEUTRAL, CALM, dt)
  assert.ok(b.airspeed > 12, `never recovered its speed, sitting at ${b.airspeed.toFixed(1)} m/s`)
  assert.ok(Math.abs(b.climbRate) < 12, `still out of control at ${b.climbRate.toFixed(1)} m/s`)
})

test('lift rises with angle of attack and flattens off, never falling away', () => {
  let previous = liftCoefficient(0)
  for (let aoa = 0.02; aoa < 1.2; aoa += 0.02) {
    const cl = liftCoefficient(aoa)
    assert.ok(cl >= previous - 1e-9, `lift fell away at ${aoa.toFixed(2)} rad - that is a stall`)
    previous = cl
  }
  assert.ok(liftCoefficient(1.2) < liftCoefficient(0.3) * 2.2, 'lift should saturate, not grow forever')
  assert.ok(liftCoefficient(-0.2) < 0, 'negative angle of attack gives negative lift')
})

// --- Diving and climbing ---------------------------------------------------

test('a dive still buys speed, which is the whole economy of the flight model', () => {
  const level = fly(createBird(new Vector3(0, 1500, 0)), NEUTRAL, 3)
  const diving = fly(createBird(new Vector3(0, 1500, 0)), { roll: 0, pitch: -0.8, brake: false }, 3)
  assert.ok(
    diving.airspeed > level.airspeed + 6,
    `diving reached ${diving.airspeed.toFixed(1)} against ${level.airspeed.toFixed(1)} level`,
  )
  assert.ok(diving.pos.y < level.pos.y, 'a dive must lose height')
})

test('a full talon load blunts the climb', () => {
  const climb = (load: number) => {
    const s = createBird(new Vector3(0, 400, 0))
    s.load = load
    const start = s.pos.y
    fly(s, { roll: 0, pitch: 0.3, brake: false }, 4)
    return s.pos.y - start
  }
  assert.ok(climb(T.maxLoad) < climb(0) - 2, 'carrying prey should cost climb')
})

// --- The brake and the talons ---------------------------------------------

test('the brake sheds speed hard, and lets go again', () => {
  const b = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 4)
  const cruise = b.airspeed
  fly(b, BRAKE, 3)
  assert.ok(b.airspeed < cruise * 0.55, `braking only reached ${b.airspeed.toFixed(1)} from ${cruise.toFixed(1)}`)
  assert.ok(b.talons > 0.9, 'braking must put the talons out')

  fly(b, NEUTRAL, 6)
  assert.ok(b.talons < 0.1, 'releasing must tuck the talons back up')
  assert.ok(b.airspeed > cruise * 0.8, 'and the bird should get its speed back')
})

test('the talons swing out fast and tuck away slowly, so the gesture reads', () => {
  const out = fly(createBird(new Vector3(0, 900, 0)), BRAKE, 0.25)
  assert.ok(out.talons > 0.5, `talons only reached ${out.talons.toFixed(2)} in a quarter second`)
  const start = out.talons
  fly(out, NEUTRAL, 0.12)
  assert.ok(out.talons < start, 'talons should begin tucking as soon as the key is released')
  assert.ok(out.talons > 0.1, 'but not snap shut instantly')
})

test('braking near the ground settles the bird rather than dropping it', () => {
  // Flaring is what makes landing possible at all; without it, slowing down over
  // open ground is indistinguishable from falling.
  const braking = fly(createBird(new Vector3(0, 300, 0)), BRAKE, 4)
  const stalledOut = createBird(new Vector3(0, 300, 0))
  stalledOut.vel.set(0, 0, -3)
  fly(stalledOut, NEUTRAL, 4)
  assert.ok(braking.climbRate > -12, `braking bird sank at ${braking.climbRate.toFixed(1)} m/s`)
})

test('the bird can still be steered while braked', () => {
  const b = fly(createBird(new Vector3(0, 900, 0)), BRAKE, 3)
  const before = Math.atan2(b.vel.x, -b.vel.z)
  fly(b, { roll: 1, pitch: 0.1, brake: true }, 2)
  assert.notEqual(Math.atan2(b.vel.x, -b.vel.z), before, 'a braking bird must still be able to turn')
})

// --- Turning ---------------------------------------------------------------

test('left banks and turns left, right banks and turns right', () => {
  const heading = (s: ReturnType<typeof createBird>) => Math.atan2(s.vel.x, -s.vel.z)
  const turn = (roll: number) => {
    const b = createBird(new Vector3(0, 1500, 0))
    fly(b, { roll, pitch: 0, brake: false }, 0.6)
    const before = heading(b)
    fly(b, { roll, pitch: 0.25, brake: false }, 1.5)
    return heading(b) - before
  }
  assert.ok(turn(1) > 0.4, 'pressing right must turn right')
  assert.ok(turn(-1) < -0.4, 'pressing left must turn left')
})

test('the right wing drops when banking right', () => {
  const b = fly(createBird(new Vector3(0, 1500, 0)), { roll: 1, pitch: 0, brake: false }, 0.4)
  const rightWing = new Vector3(1, 0, 0).applyQuaternion(b.quat)
  assert.ok(rightWing.y < -0.1, `banking right must drop the right wing, got ${rightWing.y.toFixed(2)}`)
})

test('holding roll settles at a bank instead of rolling over', () => {
  const bankDegrees = (s: ReturnType<typeof createBird>) =>
    (Math.asin(Math.max(-1, Math.min(1, new Vector3(1, 0, 0).applyQuaternion(s.quat).y))) * -180) / Math.PI
  const b = fly(createBird(new Vector3(0, 3000, 0)), { roll: 1, pitch: 0.2, brake: false }, 8)
  const bank = bankDegrees(b)
  assert.ok(bank > 35 && bank < 80, `full roll should hold a steady bank, got ${bank.toFixed(0)} deg`)
})

test('hands off the roll axis, the wings return to level', () => {
  const b = createBird(new Vector3(0, 1200, 0))
  b.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), -0.9))
  const bank = (s: typeof b) => Math.abs(new Vector3(1, 0, 0).applyQuaternion(s.quat).y)
  const banked = bank(b)
  fly(b, NEUTRAL, 4)
  assert.ok(bank(b) < banked * 0.3, `wings should level themselves, ${banked.toFixed(2)} -> ${bank(b).toFixed(2)}`)
})

test('a banked turn stays coordinated, with no sideslip and no rudder key', () => {
  const b = fly(createBird(new Vector3(0, 3000, 0)), { roll: 0.7, pitch: 0.3, brake: false }, 6)
  const right = new Vector3(1, 0, 0).applyQuaternion(b.quat)
  const sideslip = Math.abs(b.vel.clone().normalize().dot(right))
  assert.ok(sideslip < 0.2, `the weathervane should mostly kill sideslip, got ${sideslip.toFixed(3)}`)
})

// --- The air ---------------------------------------------------------------

test('rising air still lifts the bird, so reading the sky still pays', () => {
  const still = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 6)
  const lifted = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 6, { wind: new Vector3(0, 6, 0) })
  assert.ok(lifted.pos.y > still.pos.y + 10, 'a thermal must beat still air')
})

// --- Ground ----------------------------------------------------------------

test('a slow, gentle arrival is a landing, not a death', () => {
  const b = createBird(new Vector3(0, 10.5, 0))
  b.vel.set(0, -1.5, -4)
  b.airspeed = 4
  assert.equal(resolveGround(b, 10, false, 1 / 60), 'land')
  assert.ok(!b.dead, 'the bird can put itself on the ground and sit there')
  assert.ok(b.perched)
  assert.ok(b.vel.y >= 0, 'a landed bird should not keep sinking through the ground')
})

test('a perched bird can leap back into the air', () => {
  // Landing has to be a move, not a trap. Cruise thrust with the nose up is
  // worth less than the bird's own weight, so this needs the launch shove.
  const b = createBird(new Vector3(0, 10.5, 0))
  b.vel.set(0, -1, -3)
  b.perched = true
  const dt = 1 / 120
  for (let i = 0; i < 2 / dt; i++) {
    step(b, { roll: 0, pitch: 0.7, brake: true }, CALM, dt)
    if (resolveGround(b, 10, false, dt) === 'clear') break
  }
  assert.ok(!b.perched, 'the bird never got off the ground')
  assert.ok(b.pos.y > 11, `only reached ${b.pos.y.toFixed(1)}m`)
})

test('a perched bird stays put until the player asks it to go', () => {
  // The run opens standing in the nest. Leaping the moment it touches down - or
  // the moment the game starts - takes the decision away from the player.
  const b = createBird(new Vector3(0, 10.5, 0))
  b.vel.set(0, 0, 0)
  b.perched = true
  const dt = 1 / 120
  for (let i = 0; i < 3 / dt; i++) {
    step(b, { roll: 0, pitch: 0, brake: false }, CALM, dt)
    resolveGround(b, 10, false, dt)
  }
  assert.ok(b.perched, 'the bird took off on its own')
  assert.ok(b.pos.y < 11.5, `it drifted up to ${b.pos.y.toFixed(1)}m without being asked`)
})

test('arriving hard still kills, but brushing the ground at speed does not', () => {
  const hard = createBird(new Vector3(0, 10.5, 0))
  hard.vel.set(0, -30, 0)
  hard.airspeed = 30
  assert.equal(resolveGround(hard, 10, false, 1 / 60), 'crash')
  assert.ok(hard.dead)

  // Fast along the ground but settling gently - what every takeoff looks like a
  // second after leaving the deck. Judging this on horizontal speed killed the
  // bird every single time it took off.
  const skimming = createBird(new Vector3(0, 10.5, 0))
  skimming.vel.set(18, -1.5, 0)
  skimming.airspeed = 18
  assert.equal(resolveGround(skimming, 10, false, 1 / 60), 'scrape')
  assert.ok(!skimming.dead, 'brushing the grass on the way out must not be fatal')
  assert.ok(Math.abs(skimming.vel.x) < 18, 'but it should cost speed')
})

test('water can be skimmed at speed but drowns a bird that settles onto it', () => {
  const fast = createBird(new Vector3(0, 0.5, 0))
  fast.vel.set(20, -2, 0)
  fast.airspeed = 20
  assert.equal(resolveGround(fast, 0, true, 1 / 60), 'splash')
  assert.ok(!fast.dead, 'a fast skim is survivable - the hunting loop depends on it')

  const slow = createBird(new Vector3(0, 0.5, 0))
  slow.vel.set(3, -1, 0)
  slow.airspeed = 3
  assert.equal(resolveGround(slow, 0, true, 1 / 60), 'drown')
  assert.ok(slow.dead, 'a raptor cannot perch on water')
})

test('clear air overhead is left alone', () => {
  const b = createBird(new Vector3(0, 100, 0))
  assert.equal(resolveGround(b, 10, false, 1 / 60), 'clear')
  assert.ok(!b.dead)
})
