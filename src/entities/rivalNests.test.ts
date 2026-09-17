import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOOD_PER_NEST,
  markRaided,
  MIN_FROM_HOME,
  nestFood,
  resetRaids,
  RESTOCK_SECONDS,
  rivalNestsNear,
} from './rivalNests.ts'
import { findNestSite, nestPoint } from '../world/nest.ts'
import { meshHeightAt, slopeAt, tarnPoolAt } from '../world/terrain.ts'
import { stepPrey } from '../world/prey.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

test('every world has rival nests within reach of home, and none on the doorstep', () => {
  for (const seed of SEEDS) {
    const home = nestPoint(findNestSite(seed))
    const nests = rivalNestsNear(home.x, home.z, 2200, seed, home)
    assert.ok(nests.length >= 2, `${seed}: only ${nests.length} rival nests within 2.2km of home`)
    for (const n of nests) {
      const away = Math.hypot(n.bowl.x - home.x, n.bowl.z - home.z)
      assert.ok(away >= MIN_FROM_HOME, `${seed}: a rival built ${away.toFixed(0)}m from the player's nest`)
    }
  }
})

test('rival nests stand on ground a tree can stand on, not floating', () => {
  for (const seed of SEEDS) {
    const home = nestPoint(findNestSite(seed))
    for (const n of rivalNestsNear(home.x, home.z, 2500, seed, home)) {
      const { x, z } = n.site.pos
      assert.ok(slopeAt(x, z, seed) <= 0.22, `${seed}: a rival nest on a cliff`)
      assert.equal(tarnPoolAt(x, z, seed), null, `${seed}: a rival nest in a lake`)
      const ground = meshHeightAt(x, z, seed, WORLD.lodSegments[0])
      assert.ok(n.site.pos.y <= ground, `${seed}: the tree's foot is above the drawn ground`)
    }
  }
})

test('the same nests are found from anywhere, so streaming cannot move them', () => {
  const seed = 'pine-ridge'
  const home = nestPoint(findNestSite(seed))
  const a = rivalNestsNear(home.x, home.z, 3000, seed, home).map((n) => n.id).sort()
  const b = rivalNestsNear(home.x + 900, home.z - 700, 3900, seed, home)
    .filter((n) => Math.hypot(n.bowl.x - home.x, n.bowl.z - home.z) <= 3000)
    .map((n) => n.id)
    .sort()
  assert.deepEqual(a, b)
})

test('a nest holds food, raided slots empty, and they restock', () => {
  resetRaids()
  const seed = 'pine-ridge'
  const home = nestPoint(findNestSite(seed))
  const nest = rivalNestsNear(home.x, home.z, 2500, seed, home)[0]
  const full = nestFood(nest, 0)
  assert.equal(full.length, FOOD_PER_NEST)
  for (const food of full) {
    assert.ok(food.still, 'nest food must not wander off')
    assert.equal(food.nest, nest.id)
    assert.ok(food.pos.distanceTo(nest.bowl) < 2, 'the food is not in the bowl')
  }

  // Stable identity, so re-stocking the field never piles duplicates.
  assert.deepEqual(nestFood(nest, 5).map((f) => f.id), full.map((f) => f.id))

  markRaided(full[0].id, 100)
  assert.equal(nestFood(nest, 120).length, FOOD_PER_NEST - 1, 'a raided slot came straight back')
  assert.equal(nestFood(nest, 100 + RESTOCK_SECONDS + 1).length, FOOD_PER_NEST, 'it never restocked')
  resetRaids()
})

test('food in a nest stays put', () => {
  const seed = 'pine-ridge'
  const home = nestPoint(findNestSite(seed))
  const food = nestFood(rivalNestsNear(home.x, home.z, 2500, seed, home)[0], 0)[0]
  const at = food.pos.clone()
  for (let i = 0; i < 300; i++) stepPrey(food, 1 / 60, i / 60, seed)
  assert.ok(food.pos.equals(at), 'a dead rabbit hopped out of the nest')
})
