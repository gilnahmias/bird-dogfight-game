import test from 'node:test'
import assert from 'node:assert/strict'
import { Quaternion, Vector3 } from 'three'
import { createBird, liftCoefficient, resolveGround, step, type Input } from './physics.ts'
import { T } from '../game/constants.ts'

const CALM = { wind: new Vector3(0, 0, 0) }
const NEUTRAL: Input = { roll: 0, pitch: 0, flap: false }

function fly(state = createBird(new Vector3(0, 500, 0)), input: Input = NEUTRAL, seconds = 5, air = CALM) {
  const dt = 1 / 60
  for (let i = 0; i < Math.round(seconds / dt); i++) step(state, input, air, dt)
  return state
}

test('a gliding bird sinks but never gains total energy', () => {
  const b = createBird(new Vector3(0, 500, 0))
  const energy = (s: typeof b) => s.pos.y * T.gravity + 0.5 * s.vel.lengthSq()
  const before = energy(b)
  fly(b, NEUTRAL, 6)
  assert.ok(b.pos.y < 500, `should lose altitude, got y=${b.pos.y.toFixed(1)}`)
  assert.ok(energy(b) < before, 'drag must remove energy from an unpowered glide')
})

test('a hands-off glide settles near cruise speed instead of diverging', () => {
  const b = fly(createBird(new Vector3(0, 2000, 0)), NEUTRAL, 20)
  assert.ok(b.airspeed > 12 && b.airspeed < 40, `airspeed ran away: ${b.airspeed.toFixed(1)}`)
  assert.ok(!b.stalled, 'a trimmed glide should not stall')
})

test('holding the nose up at low speed stalls, then auto-recovers when let go', () => {
  const b = createBird(new Vector3(0, 900, 0))
  b.vel.set(0, 0, -8) // slow, below stall speed
  fly(b, { roll: 0, pitch: 1, flap: false }, 1.5)
  assert.ok(b.stalled, `expected a stall, aoa=${b.aoa.toFixed(2)}`)
  assert.ok(b.stallWarn > 0.9, 'the stall warning must be lit before we ask the player to react')

  fly(b, NEUTRAL, 3) // let go
  assert.ok(!b.stalled, `should recover unattended, aoa=${b.aoa.toFixed(2)}`)
})

test('fighting the stall delays recovery but cannot prevent it', () => {
  const make = () => {
    const s = createBird(new Vector3(0, 1500, 0))
    s.vel.set(0, 0, -8)
    fly(s, { roll: 0, pitch: 1, flap: false }, 1.5)
    return s
  }
  const letGo = fly(make(), NEUTRAL, 1.2)
  const fighting = fly(make(), { roll: 0, pitch: 1, flap: false }, 1.2)
  assert.ok(Math.abs(letGo.aoa) < Math.abs(fighting.aoa), 'letting go must recover faster')
  assert.ok(!fly(fighting, { roll: 0, pitch: 1, flap: false }, 6).stalled, 'must recover even while fought')
})

test('flapping climbs, and a full talon load measurably costs climb rate', () => {
  const climb = (load: number) => {
    const s = createBird(new Vector3(0, 400, 0))
    s.load = load
    const start = s.pos.y
    fly(s, { roll: 0, pitch: 0.28, flap: true }, 4)
    return s.pos.y - start
  }
  const empty = climb(0)
  const loaded = climb(T.maxLoad)
  assert.ok(empty > 0, `flapping should gain altitude, got ${empty.toFixed(1)}m`)
  assert.ok(loaded < empty * 0.8, `load must cost climb: empty ${empty.toFixed(1)}m vs loaded ${loaded.toFixed(1)}m`)
})

test('stamina drains to zero under sustained flapping and then stops producing thrust', () => {
  const b = createBird(new Vector3(0, 400, 0))
  fly(b, { roll: 0, pitch: 0.2, flap: true }, 30)
  assert.equal(b.stamina, 0, 'sustained flapping must exhaust the bird')
  const y = b.pos.y
  const vy = b.vel.y
  fly(b, { roll: 0, pitch: 0.2, flap: true }, 2)
  assert.ok(b.vel.y < vy || b.pos.y < y + 2, 'an exhausted bird cannot keep climbing')
})

test('stamina regenerates while gliding', () => {
  const b = createBird(new Vector3(0, 900, 0))
  b.stamina = 0
  fly(b, NEUTRAL, 3)
  assert.ok(b.stamina > 10, `gliding should restore stamina, got ${b.stamina.toFixed(1)}`)
})

test('a banked turn stays coordinated, with no sideslip and no rudder key', () => {
  const b = createBird(new Vector3(0, 3000, 0))
  fly(b, { roll: 0.7, pitch: 0.3, flap: false }, 6)
  const right = new Vector3(1, 0, 0).applyQuaternion(b.quat)
  const flow = b.vel.clone().normalize()
  const sideslip = Math.abs(flow.dot(right))
  // Not perfectly coordinated - there is no rudder - but nowhere near the
  // crabbing you would get with a pure roll-and-hope turn.
  assert.ok(sideslip < 0.2, `the weathervane should mostly kill sideslip, got ${sideslip.toFixed(3)}`)
})

test('left banks and turns left, right banks and turns right', () => {
  // Heading the way the world sees it: facing -Z is 0, +X is to the right.
  const heading = (s: ReturnType<typeof createBird>) => Math.atan2(s.vel.x, -s.vel.z)
  const turn = (roll: number) => {
    const b = createBird(new Vector3(0, 1500, 0))
    fly(b, { roll, pitch: 0, flap: false }, 0.6) // roll in and settle at the commanded bank
    const before = heading(b)
    fly(b, { roll, pitch: 0.25, flap: false }, 1.5)
    return heading(b) - before
  }
  const right = turn(1)
  const left = turn(-1)
  assert.ok(right > 0.4, `pressing right must turn right, turned ${right.toFixed(2)} rad`)
  assert.ok(left < -0.4, `pressing left must turn left, turned ${left.toFixed(2)} rad`)
})

test('the right wing drops when banking right', () => {
  const b = createBird(new Vector3(0, 1500, 0))
  fly(b, { roll: 1, pitch: 0, flap: false }, 0.4)
  const rightWing = new Vector3(1, 0, 0).applyQuaternion(b.quat)
  assert.ok(rightWing.y < -0.1, `banking right must drop the right wing, got y=${rightWing.y.toFixed(2)}`)
})

test('holding roll settles at a bank instead of rolling over', () => {
  const bankDegrees = (s: ReturnType<typeof createBird>) =>
    (Math.asin(Math.max(-1, Math.min(1, new Vector3(1, 0, 0).applyQuaternion(s.quat).y))) * -180) /
    Math.PI
  const b = createBird(new Vector3(0, 3000, 0))
  fly(b, { roll: 1, pitch: 0.2, flap: false }, 8) // long enough to barrel-roll many times
  const bank = bankDegrees(b)
  assert.ok(bank > 35 && bank < 80, `full roll should hold a steady bank, got ${bank.toFixed(0)} deg`)

  const gentle = createBird(new Vector3(0, 3000, 0))
  fly(gentle, { roll: 0.4, pitch: 0.15, flap: false }, 6)
  const gentleBank = bankDegrees(gentle)
  assert.ok(gentleBank > 8 && gentleBank < bank - 5, `partial input should hold a shallower bank, got ${gentleBank.toFixed(0)} deg vs ${bank.toFixed(0)} deg`)
})

test('holding a turn does not roll the bird inverted', () => {
  // ponytail: the bank reference is the body right axis against world up, which
  // degenerates when the nose is pointed near-vertically down. Holding full roll
  // with no pitch for ten seconds does eventually tip past it. Every flyable
  // attitude is covered; if that ever matters, measure bank about the velocity
  // vector instead.
  for (const pitch of [0.15, 0.3, 0.5]) {
    const b = createBird(new Vector3(0, 5000, 0))
    fly(b, { roll: 1, pitch, flap: false }, 10)
    const up = new Vector3(0, 1, 0).applyQuaternion(b.quat)
    assert.ok(up.y > 0, `held turn at pitch ${pitch} went inverted (up.y = ${up.y.toFixed(2)})`)
  }
})

test('hands off the roll axis, the wings return to level', () => {
  const b = createBird(new Vector3(0, 1200, 0))
  b.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), -0.9))
  const bank = (s: typeof b) => Math.abs(new Vector3(1, 0, 0).applyQuaternion(s.quat).y)
  const banked = bank(b)
  fly(b, NEUTRAL, 4)
  assert.ok(bank(b) < banked * 0.3, `wings should level themselves, bank went ${banked.toFixed(2)} -> ${bank(b).toFixed(2)}`)
})

test('lift coefficient peaks at the stall angle and falls off past it', () => {
  const peak = liftCoefficient(T.stallAngle)
  assert.ok(liftCoefficient(T.stallAngle * 0.5) < peak)
  assert.ok(liftCoefficient(T.stallAngle * 2) < peak, 'lift must drop past the stall')
  assert.ok(liftCoefficient(-T.stallAngle) < 0, 'negative angle of attack gives negative lift')
})

test('a thermal lets the bird climb with no flapping at all', () => {
  const still = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 6)
  const lifted = fly(createBird(new Vector3(0, 900, 0)), NEUTRAL, 6, { wind: new Vector3(0, 6, 0) })
  assert.ok(lifted.pos.y > still.pos.y, 'rising air must beat still air')
  assert.ok(lifted.pos.y > 900, `a strong thermal should net a climb, got ${lifted.pos.y.toFixed(1)}`)
})

test('any contact with solid ground ends the run', () => {
  for (const speed of [30, 2]) {
    const b = createBird(new Vector3(0, 10, 0))
    b.vel.set(0, -speed, 0)
    assert.equal(resolveGround(b, 10, false, 1 / 60), 'crash')
    assert.ok(b.dead, `hitting the ground at ${speed} m/s must end the run - a landed bird cannot take off again`)
  }

  const clear = createBird(new Vector3(0, 100, 0))
  assert.equal(resolveGround(clear, 10, false, 1 / 60), 'clear')
  assert.ok(!clear.dead)
})

test('water can be skimmed at speed but drowns a bird that settles onto it', () => {
  const fast = createBird(new Vector3(0, 0.5, 0))
  fast.vel.set(20, -2, 0)
  fast.airspeed = 20
  assert.equal(resolveGround(fast, 0, true, 1 / 60), 'splash')
  assert.ok(!fast.dead, 'a fast skim is survivable - the hunting loop depends on it')
  assert.ok(fast.vel.x < 20, 'but water costs speed')

  const slow = createBird(new Vector3(0, 0.5, 0))
  slow.vel.set(3, -1, 0)
  slow.airspeed = 3
  assert.equal(resolveGround(slow, 0, true, 1 / 60), 'drown')
  assert.ok(slow.dead)
})
