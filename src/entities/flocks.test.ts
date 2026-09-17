import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { flocksNear, memberAt, MOB, type Mobber, stepMobber, swatsCrow } from './flocks.ts'
import { findNestSite, nestPoint } from '../world/nest.ts'
import { heightAt } from '../world/terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

test('there are birds around home, and they suit the ground under them', () => {
  for (const seed of SEEDS) {
    const home = nestPoint(findNestSite(seed))
    const flocks = flocksNear(home.x, home.z, 1500, seed)
    assert.ok(flocks.length >= 3, `${seed}: only ${flocks.length} flocks within 1.5km of home`)
    for (const f of flocks) {
      const ground = heightAt(f.centre.x, f.centre.z, seed)
      if (f.kind === 'gull') assert.ok(ground < WORLD.waterLevel + 4, `${seed}: gulls over dry hills`)
      else assert.ok(ground >= WORLD.waterLevel + 4, `${seed}: ${f.kind}s out over the sea`)
    }
  }
})

test('a flock mills about its centre, clear of the ground, and moves', () => {
  const seed = 'pine-ridge'
  const home = nestPoint(findNestSite(seed))
  const out = { pos: new Vector3(), heading: 0, flap: 0 }
  for (const flock of flocksNear(home.x, home.z, 1500, seed)) {
    for (let i = 0; i < flock.size; i++) {
      memberAt(flock, i, 3, out, seed)
      const first = out.pos.clone()
      assert.ok(out.pos.distanceTo(flock.centre) < 140, 'a bird has strayed far from its flock')
      assert.ok(
        out.pos.y > Math.max(heightAt(out.pos.x, out.pos.z, seed), WORLD.waterLevel),
        'a flock bird is underground',
      )
      memberAt(flock, i, 4, out, seed)
      assert.ok(out.pos.distanceTo(first) > 3, 'a flock bird is hanging still')
    }
  }
})

const crowAt = (x: number, y: number, z: number): Mobber => ({
  pos: new Vector3(x, y, z),
  vel: new Vector3(),
  timer: MOB.seconds,
  cooldown: 0,
  done: false,
})

test('a crow catches a cruising raptor and pecks, but not every frame', () => {
  // Forty metres behind: where a crow ends up after an intercept that missed.
  const crow = crowAt(0, 100, 40)
  const player = { pos: new Vector3(0, 100, 0), vel: new Vector3(0, 0, -26) }
  let pecks = 0
  for (let i = 0; i < 60 * 8; i++) {
    player.pos.addScaledVector(player.vel, 1 / 60)
    if (stepMobber(crow, player, 1 / 60) === 'peck') pecks++
  }
  assert.ok(pecks >= 1, 'the crow never reached a cruising raptor')
  assert.ok(pecks <= 8 / MOB.peckEvery + 1, `${pecks} pecks in eight seconds is a mauling, not mobbing`)
})

test('diving away shakes the crows off', () => {
  // What the player feels is pecks, so compare pecks: the same mob, flown
  // straight through versus dived away from.
  const pecksWhen = (vel: Vector3) => {
    const crow = crowAt(0, 100, 30)
    const player = { pos: new Vector3(0, 100, 0), vel }
    let pecks = 0
    for (let i = 0; i < 60 * MOB.seconds; i++) {
      player.pos.addScaledVector(player.vel, 1 / 60)
      if (stepMobber(crow, player, 1 / 60) === 'peck') pecks++
    }
    return pecks
  }
  const straight = pecksWhen(new Vector3(0, 0, -26))
  // Nose well down: about what the envelope measures for a committed dive.
  const dived = pecksWhen(new Vector3(0, -14, -36))
  assert.ok(straight >= 1, 'flying straight should get you pecked')
  assert.equal(dived, 0, `a raptor diving hard was still pecked ${dived} times`)
})

test('the crows lose interest on their own', () => {
  const crow = crowAt(0, 100, 3)
  const player = { pos: new Vector3(0, 100, 0), vel: new Vector3(0, 0, -20) }
  for (let i = 0; i < 60 * (MOB.seconds + 1); i++) {
    player.pos.addScaledVector(player.vel, 1 / 60)
    stepMobber(crow, player, 1 / 60)
  }
  assert.ok(crow.done, 'the mob never ended')
})

test('a crow can be knocked out of the air, easily', () => {
  const crow = crowAt(0, 100, 0)
  assert.ok(swatsCrow({ pos: new Vector3(0, 103, 4), vel: new Vector3(), talons: 0 }, crow), 'from above')
  assert.ok(swatsCrow({ pos: new Vector3(0, 99, 4), vel: new Vector3(), talons: 1 }, crow), 'talons out')
  assert.ok(!swatsCrow({ pos: new Vector3(0, 99, 4), vel: new Vector3(), talons: 0 }, crow), 'from below, tucked')
  assert.ok(!swatsCrow({ pos: new Vector3(0, 110, 30), vel: new Vector3(), talons: 1 }, crow), 'out of reach')
})

test('a mob started at the edge of its range does not give up on the spot', () => {
  // The bug: crows noticed you at 170m and gave up beyond 140m, so every mob
  // that started at range quit on its very first frame.
  const crow = crowAt(0, 100, MOB.range)
  const player = { pos: new Vector3(0, 100, 0), vel: new Vector3(0, 0, 0) }
  assert.notEqual(stepMobber(crow, player, 1 / 60), 'gave-up')
  assert.ok(MOB.loseRange > MOB.range, 'the crows give up closer in than they notice you')
})
