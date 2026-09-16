import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import {
  closingSpeed,
  hasAdvantage,
  nextMode,
  resolveStrike,
  RIVAL,
  type Combatant,
  type Quarry,
  type Rival,
  stepRival,
} from './rivals.ts'

const at = (x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Combatant => ({
  pos: new Vector3(x, y, z),
  vel: new Vector3(vx, vy, vz),
  forward: new Vector3(vx, vy, vz).normalize(),
})

test('a strike lands from above, at speed, and not otherwise', () => {
  // Diving on something from directly above: the whole rule in one case.
  const diving = at(0, 30, 6, 0, -25, -18)
  const cruising = at(0, 0, 0, 0, 0, -20)
  assert.equal(resolveStrike(diving, cruising), 'none', 'thirty metres apart is not a pass')

  const close = at(0, 8, 3, 0, -25, -18)
  assert.equal(resolveStrike(close, cruising), 'attacker', 'a fast pass from above must land')

  // Same geometry, no speed: two birds drifting past each other.
  const slow = at(0, 8, 3, 0, -0.4, -20.2)
  assert.equal(resolveStrike(slow, cruising), 'none', 'drifting past is not a strike')
})

test('coming up from below loses to the bird above', () => {
  const below = at(0, -8, 3, 0, 25, -18)
  const above = at(0, 0, 0, 0, 0, -20)
  assert.equal(resolveStrike(below, above), 'target', 'the bird above should win')
})

test('the rule is symmetric - it does not matter which bird is asked first', () => {
  const diving = at(0, 8, 3, 0, -25, -18)
  const cruising = at(0, 0, 0, 0, 0, -20)
  assert.equal(resolveStrike(diving, cruising), 'attacker')
  assert.equal(resolveStrike(cruising, diving), 'target')
})

test('a head-on pass with equal claim is a near miss, not a double kill', () => {
  const north = at(0, 0, 4, 0, 0, -22)
  const south = at(0, 0, -4, 0, 0, 22)
  assert.equal(resolveStrike(north, south), 'none')
})

test('closing speed is about the gap, not about who is fast', () => {
  const chaser = at(0, 0, 10, 0, 0, -30)
  const fleeing = at(0, 0, 0, 0, 0, -28)
  assert.ok(Math.abs(closingSpeed(chaser, fleeing) - 2) < 1e-6, 'a stern chase closes slowly')
  const parallel = at(20, 0, 0, 0, 0, -30)
  assert.ok(Math.abs(closingSpeed(parallel, fleeing)) < 3, 'flying alongside is not closing')
})

test('being on the tail counts, even at the same height', () => {
  const tail = at(0, 0, 8, 0, 0, -30)
  const front = at(0, 0, 0, 0, 0, -25)
  assert.ok(hasAdvantage(tail, front), 'a bird on your tail has the advantage')
  assert.ok(!hasAdvantage(front, tail), 'and the one in front does not')
})

// --- The AI ---------------------------------------------------------------

const rivalAt = (y: number, mode: Rival['mode'] = 'patrol', timer = 0): Rival => ({
  id: 1,
  pos: new Vector3(0, y, 0),
  vel: new Vector3(0, 0, -RIVAL.cruise),
  mode,
  timer,
  home: new Vector3(0, y, 0),
  spin: 1,
  dead: false,
  dying: 0,
})

const flying: Quarry = {
  pos: new Vector3(0, 100, -60),
  vel: new Vector3(0, 0, -26),
  perched: false,
  dead: false,
}

test('a rival climbs before it dives, so the player is warned', () => {
  const rival = rivalAt(100)
  assert.equal(nextMode(rival, flying, 1 / 60).mode, 'climb', 'it should start by getting height')

  // Level with the player, it must NOT commit however long it waits.
  const level = rivalAt(100, 'climb', RIVAL.climbPatience)
  assert.equal(nextMode(level, flying, 1 / 60).mode, 'climb', 'committed without the height')

  const high = rivalAt(100 + RIVAL.advantage + 5, 'climb', 3)
  assert.equal(nextMode(high, flying, 1 / 60).mode, 'commit', 'it had the height and did not use it')
})

test('a dive that has gone past its target breaks off instead of scrapping', () => {
  const past = rivalAt(100 - RIVAL.fromAbove - 5, 'commit', 3)
  assert.equal(nextMode(past, flying, 1 / 60).mode, 'overshoot')

  const spent = rivalAt(200, 'commit', 0)
  assert.equal(nextMode(spent, flying, 1 / 60).mode, 'overshoot', 'a dive must not last forever')
})

test('a rival leaves a perched or dead bird alone', () => {
  const rival = rivalAt(160, 'climb', 4)
  const resting: Quarry = { ...flying, perched: true }
  assert.equal(nextMode(rival, resting, 1 / 60).mode, 'patrol', 'it attacked a bird in its nest')
  const gone: Quarry = { ...flying, dead: true }
  assert.equal(nextMode(rival, gone, 1 / 60).mode, 'patrol')
  const faraway: Quarry = { ...flying, pos: new Vector3(0, 100, -RIVAL.seeRange - 200) }
  assert.equal(nextMode(rival, faraway, 1 / 60).mode, 'patrol', 'it saw a bird it cannot see')
})

test('a climbing rival actually gains height, and a committed one comes down', () => {
  const climber = rivalAt(100, 'climb', 5)
  const startY = climber.pos.y
  for (let i = 0; i < 120; i++) stepRival(climber, flying, 1 / 60, i / 60)
  // Only a few metres: the climb is deliberately slower than the player's, or
  // the rival owns the height for ever and the fight cannot be won.
  assert.ok(climber.pos.y > startY + 5, `climbed only ${(climber.pos.y - startY).toFixed(1)}m in two seconds`)
  assert.ok(
    climber.pos.y < startY + 14,
    `climbed ${(climber.pos.y - startY).toFixed(1)}m in two seconds - faster than the player can`,
  )

  const diver = rivalAt(200, 'commit', 5)
  const before = diver.pos.distanceTo(flying.pos)
  for (let i = 0; i < 60; i++) stepRival(diver, flying, 1 / 60, i / 60)
  assert.ok(diver.pos.distanceTo(flying.pos) < before - 20, 'a committed dive must close on its target')
})

test('a killed rival falls out of the sky', () => {
  const dead = rivalAt(200)
  dead.dead = true
  for (let i = 0; i < 120; i++) stepRival(dead, flying, 1 / 60, i / 60)
  assert.ok(dead.pos.y < 185, `a dead bird only fell ${(200 - dead.pos.y).toFixed(1)}m in two seconds`)
  assert.ok(dead.dying > 1.9, 'the fall is not being timed')
})

test('talons out reach further, which is what makes them the weapon', () => {
  // Just outside the normal reach, with the player above and coming down.
  const rival = at(0, 0, 0, 0, 0, -22)
  const player = at(0, 18, 4, 0, -20, -26)
  assert.equal(resolveStrike(rival, player), 'none', 'this should be out of reach')
  assert.equal(
    resolveStrike(rival, player, RIVAL.reach + RIVAL.talonBonus),
    'target',
    'with the talons out the same pass should land',
  )
})

test('the extra reach cannot be used to hit the player', () => {
  // Same geometry the other way up: a rival diving on the player from outside
  // normal reach must still miss, whatever the player is doing with its feet.
  const rival = at(0, 18, 4, 0, -20, -26)
  const player = at(0, 0, 0, 0, 0, -22)
  assert.equal(resolveStrike(rival, player), 'none')
  // The caller only ever accepts 'target' from the extended check; this test
  // pins the thing that makes that safe - the extended call still names the
  // rival as the winner, so accepting only 'target' throws it away.
  assert.equal(resolveStrike(rival, player, RIVAL.reach + RIVAL.talonBonus), 'attacker')
})
