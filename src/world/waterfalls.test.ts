import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { findWaterfalls, MIN_DROP } from './waterfalls.ts'
import { meshHeightAt } from './terrain.ts'
import { departureDirection, findNestSite } from './nest.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

function fallsFor(seed: string) {
  const site = findNestSite(seed)
  return findWaterfalls(seed, site.pos, departureDirection(site.heading))
}

test('every seed produces waterfalls near the nest', () => {
  for (const seed of SEEDS) {
    assert.ok(fallsFor(seed).length > 0, `${seed}: no waterfalls found anywhere near the nest`)
  }
})

test('each waterfall starts above the water and falls a real distance', () => {
  for (const seed of SEEDS) {
    for (const w of fallsFor(seed)) {
      assert.ok(w.top.y > WORLD.waterLevel, `${seed}: fall starts underwater`)
      assert.ok(w.base.y >= WORLD.waterLevel, `${seed}: fall lands below the waterline`)
      assert.ok(
        w.top.y - w.base.y >= MIN_DROP - 0.01,
        `${seed}: drop of only ${(w.top.y - w.base.y).toFixed(1)}m`,
      )
      assert.ok(w.width > 0 && w.width < 30, `${seed}: implausible width ${w.width}`)
    }
  }
})

test('the sheet follows the cliff instead of hanging in the rock', () => {
  for (const seed of SEEDS) {
    for (const w of fallsFor(seed)) {
      const run = Math.hypot(w.base.x - w.top.x, w.base.z - w.top.z)
      assert.ok(run > 0, `${seed}: fall has no horizontal run, it would be buried in the cliff`)
      // Walk the drawn sheet and check it stays at or above the ground under it.
      w.path.forEach((p, i) => {
        const ground = meshHeightAt(p.x, p.z, seed, WORLD.lodSegments[0])
        assert.ok(
          p.y >= ground - 1.5,
          `${seed}: the sheet is ${(ground - p.y).toFixed(1)}m inside the hillside at point ${i}`,
        )
      })
      assert.ok(w.path.length >= 3, `${seed}: fall path is not a path`)
      for (let i = 1; i < w.path.length; i++) {
        assert.ok(w.path[i].y <= w.path[i - 1].y + 0.01, `${seed}: water flows uphill at point ${i}`)
      }
    }
  }
})

test('the water falls downhill, not up a cliff', () => {
  for (const seed of SEEDS) {
    for (const w of fallsFor(seed)) {
      // The claim is about the fall itself, not about any one probe point: a
      // gentle lip can rise slightly before the ground gives way.
      assert.ok(w.base.y < w.top.y, `${seed}: the foot of the fall is above its lip`)
      assert.ok(Math.abs(w.dir.length() - 1) < 1e-6, 'direction must be a unit vector')
      assert.equal(w.dir.y, 0, 'direction is horizontal')
    }
  }
})

test('waterfalls are spread out, not stacked along one river', () => {
  for (const seed of SEEDS) {
    const falls = fallsFor(seed)
    for (let i = 0; i < falls.length; i++) {
      for (let j = i + 1; j < falls.length; j++) {
        const d = Math.hypot(falls[i].top.x - falls[j].top.x, falls[i].top.z - falls[j].top.z)
        assert.ok(d >= 100, `${seed}: two falls only ${d.toFixed(0)}m apart`)
      }
    }
  }
})

test('a waterfall is near enough to the nest to be found', () => {
  // Falls now come from tarns, which are real features of the terrain rather
  // than anywhere a rule allowed one - so their exact placement cannot be
  // dictated. What can be required is that one is close enough to fly to.
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const nearest = Math.min(
      ...fallsFor(seed).map((w) => Math.hypot(w.top.x - site.pos.x, w.top.z - site.pos.z)),
    )
    // Bounded by the area tarns are searched in. Falls come from real features
    // of the terrain, so which seed gets a close one is not something siting can
    // dictate - only that there is one within reach.
    assert.ok(
      nearest < 3500,
      `${seed}: nearest waterfall is ${(nearest / 1000).toFixed(1)}km from the nest`,
    )
  }
})

test('the search is deterministic for a seed', () => {
  const a = fallsFor('pine-ridge')
  const b = fallsFor('pine-ridge')
  assert.deepEqual(
    a.map((w) => w.top.toArray()),
    b.map((w) => w.top.toArray()),
  )
})

test('the search is bounded in cost', () => {
  const t0 = performance.now()
  findWaterfalls('pine-ridge', new Vector3(0, 0, 0))
  const ms = performance.now() - t0
  assert.ok(ms < 400, `waterfall search took ${ms.toFixed(0)}ms - it runs at startup`)
})
