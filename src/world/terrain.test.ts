import test from 'node:test'
import assert from 'node:assert/strict'
import { biomeAt, heightAt, hashSeed, normalAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEED = 'pine-ridge'

test('heightAt is deterministic for a seed and differs between seeds', () => {
  assert.equal(heightAt(123.5, -880.25, SEED), heightAt(123.5, -880.25, SEED))
  let differs = 0
  for (let i = 0; i < 50; i++) {
    if (heightAt(i * 97, i * 131, SEED) !== heightAt(i * 97, i * 131, 'alpine')) differs++
  }
  assert.ok(differs > 45, 'different seeds must produce different worlds')
})

test('hashSeed is stable and spreads', () => {
  assert.equal(hashSeed('a'), hashSeed('a'))
  assert.notEqual(hashSeed('a'), hashSeed('b'))
})

test('normalAt matches a finite difference of heightAt', () => {
  for (const [x, z] of [[0, 0], [412, -1200], [-3300, 950]]) {
    const n = normalAt(x, z, SEED)
    const eps = 1.0
    const dhdx = (heightAt(x + eps, z, SEED) - heightAt(x - eps, z, SEED)) / (2 * eps)
    const dhdz = (heightAt(x, z + eps, SEED) - heightAt(x, z - eps, SEED)) / (2 * eps)
    // The gradient must be perpendicular to the reported normal.
    const dot = n[0] * 1 + n[1] * dhdx + 0
    assert.ok(Math.abs(dot) < 1e-6, `normal disagrees with dh/dx at ${x},${z}: ${dot}`)
    const dotZ = n[2] * 1 + n[1] * dhdz
    assert.ok(Math.abs(dotZ) < 1e-6, `normal disagrees with dh/dz at ${x},${z}: ${dotZ}`)
    assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9, 'normal must be unit length')
    assert.ok(n[1] > 0, 'terrain normals always point up')
  }
})

test('slope is 0 on the flat and rises on a cliff', () => {
  let flattest = 1
  let steepest = 0
  for (let i = 0; i < 400; i++) {
    const s = slopeAt(i * 53.7, i * -31.3, SEED)
    flattest = Math.min(flattest, s)
    steepest = Math.max(steepest, s)
    assert.ok(s >= 0 && s <= 1, `slope out of range: ${s}`)
  }
  assert.ok(flattest < 0.02, 'somewhere should be nearly flat')
  assert.ok(steepest > 0.2, 'somewhere should be properly steep')
})

test('the water biome appears only below the water level, and every biome exists', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 3000; i++) {
    const x = (i % 60) * 180 - 5000
    const z = Math.floor(i / 60) * 180 - 4000
    const b = biomeAt(x, z, SEED)
    seen.add(b)
    const h = heightAt(x, z, SEED)
    if (b === 'water') assert.ok(h < WORLD.waterLevel, `water above the water level at ${x},${z}`)
    else assert.ok(h >= WORLD.waterLevel, `dry biome ${b} below the water level at ${x},${z}`)
  }
  for (const b of ['water', 'rock', 'forest', 'grass']) {
    assert.ok(seen.has(b), `a 10km sample produced no ${b} - the world would be monotonous`)
  }
})

test('the world has both real mountains and real lowland', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 4000; i++) {
    const h = heightAt((i % 80) * 160 - 6000, Math.floor(i / 80) * 160 - 4000, SEED)
    lo = Math.min(lo, h)
    hi = Math.max(hi, h)
  }
  assert.ok(hi > 180, `mountains are too low to fly around: peak ${hi.toFixed(0)}m`)
  assert.ok(lo < 0, `nowhere floods, so there would be no lakes: lowest ${lo.toFixed(0)}m`)
})
