import test from 'node:test'
import assert from 'node:assert/strict'
import {
  departureDirection,
  findNestSite,
  launchPoint,
  nestPoint,
  NEST_TREE_HEIGHT,
} from './nest.ts'
import { heightAt, meshGapAt, meshHeightAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

test('every seed gets a nest on dry, walkable, elevated ground', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const h = heightAt(site.pos.x, site.pos.z, seed)
    assert.ok(h > WORLD.waterLevel, `${seed}: nest is underwater at ${h.toFixed(0)}m`)
    // The FOOT of the nest tree must not stand proud of the ground the player
    // can see - a trunk starting in mid-air is the thing that looked broken.
    // Being a little into the ground is fine and invisible; what must be clear
    // of everything is the nest itself, which is up in the crown.
    const drawn = meshHeightAt(site.pos.x, site.pos.z, seed, WORLD.lodSegments[0])
    const above = site.pos.y - drawn
    assert.ok(above <= 0.01, `${seed}: the nest tree floats ${above.toFixed(2)}m above the ground`)
    assert.ok(above > -6, `${seed}: the tree foot is buried ${(-above).toFixed(2)}m, the trunk would be stubby`)
    assert.ok(slopeAt(site.pos.x, site.pos.z, seed) < 0.45, `${seed}: nest is on a cliff face`)
  }
})

test('the departure line has open air, so a run never starts facing a mountain', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const launchY = site.pos.y + NEST_TREE_HEIGHT
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

test('the run starts standing in the nest, up in the crown of the tree', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    const nest = nestPoint(site)
    const launch = launchPoint(site)
    assert.equal(nest.y - site.pos.y, site.treeHeight, 'the nest sits at the top of its tree')
    assert.ok(launch.y > nest.y, 'the bird stands in the nest, not inside it')
    assert.ok(launch.y - nest.y < 3, 'and not hovering above it either')
    assert.ok(
      launch.y > heightAt(launch.x, launch.z, seed) + 10,
      `${seed}: the nest tree is not clear of the ground`,
    )
  }
})

test('the nest tree stands on ground gentle enough to hold a tree', () => {
  for (const seed of SEEDS) {
    const site = findNestSite(seed)
    assert.ok(
      slopeAt(site.pos.x, site.pos.z, seed) <= 0.26,
      `${seed}: the nest tree is on a slope too steep to grow on`,
    )
  }
})
