import test from 'node:test'
import assert from 'node:assert/strict'
import { departureDirection, findNestSite, launchPoint, LAUNCH_HEIGHT } from './nest.ts'
import { heightAt, meshGapAt, meshHeightAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

test('every seed gets a nest on dry, walkable, elevated ground', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const h = heightAt(site.pos.x, site.pos.z, seed)
    assert.ok(h > WORLD.waterLevel, `${seed}: nest is underwater at ${h.toFixed(0)}m`)
    // The nest must sit on the ground the player can SEE, not on the height
    // field. The drawn mesh chords across ridge crests and sits metres below the
    // field exactly where nests are sited, which is what made the nest hover.
    const drawn = meshHeightAt(site.pos.x, site.pos.z, seed, WORLD.lodSegments[0])
    const above = site.pos.y - drawn
    assert.ok(above <= 0.01, `${seed}: nest floats ${above.toFixed(2)}m above the drawn ground`)
    assert.ok(above > -2, `${seed}: nest is buried ${(-above).toFixed(2)}m below the ground`)
    assert.ok(slopeAt(site.pos.x, site.pos.z, seed) < 0.45, `${seed}: nest is on a cliff face`)
  }
})

test('the departure line has open air, so a run never starts facing a mountain', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const launchY = site.pos.y + LAUNCH_HEIGHT
    const dir = departureDirection(site.heading)
    for (const d of [120, 250, 400, 600, 800, 1000]) {
      const ground = heightAt(site.pos.x + dir.x * d, site.pos.z + dir.z * d, seed)
      const clearance = launchY - d * 0.14 - ground
      assert.ok(clearance > 0, `${seed}: terrain blocks the departure at ${d}m (clearance ${clearance.toFixed(0)}m)`)
    }
    assert.ok(site.clearance > 40, `${seed}: departure clearance only ${site.clearance.toFixed(0)}m`)
  }
})

test('the nest is on a lip with a drop, not on top of a dome', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    assert.ok(site.edgeDrop > 8, `${seed}: only ${site.edgeDrop.toFixed(1)}m of drop off the edge`)
  }
})

test('the drawn ground and the height field agree at the nest', () => {
  // Otherwise the bird crashes into invisible ground, or flies through visible
  // rock, in the one place it returns to most.
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const gap = meshGapAt(site.pos.x, site.pos.z, seed)
    assert.ok(Math.abs(gap) <= 4, `${seed}: mesh and height field disagree by ${gap.toFixed(1)}m at the nest`)
  }
})

test('the nest site is stable for a seed and differs between seeds', () => {
  const a = findNestSite('pine-ridge')
  const b = findNestSite('pine-ridge')
  assert.deepEqual(a.pos.toArray(), b.pos.toArray())
  assert.equal(a.heading, b.heading)
  assert.notDeepEqual(a.pos.toArray(), findNestSite('alpine').pos.toArray())
})

test('the bird launches above the nest, not inside it', () => {
  const site = findNestSite('pine-ridge')
  const launch = launchPoint(site)
  assert.equal(launch.y - site.pos.y, LAUNCH_HEIGHT)
  assert.ok(launch.y > heightAt(launch.x, launch.z, 'pine-ridge') + 10)
})
