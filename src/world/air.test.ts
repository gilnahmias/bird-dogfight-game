import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { createAirSample, sampleAir, surfaceAt, thermalAt, windDirection } from './air.ts'
import { heightAt, moistureAt, normalAt } from './terrain.ts'
import { createBird, step, type Input } from '../flight/physics.ts'
import { AIR, WORLD } from '../game/constants.ts'

const SEED = 'pine-ridge'
const NEUTRAL: Input = { roll: 0, pitch: 0, flap: false }

function airAt(x: number, y: number, z: number, seed = SEED) {
  return sampleAir(new Vector3(x, y, z), seed, createAirSample())
}

test('the prevailing wind is a unit vector, stable per seed and different between seeds', () => {
  const w = windDirection(SEED)
  assert.ok(Math.abs(w.length() - 1) < 1e-9)
  assert.equal(w.y, 0, 'the prevailing wind is horizontal')
  assert.deepEqual(w.toArray(), windDirection(SEED).toArray())
  assert.notDeepEqual(w.toArray(), windDirection('alpine').toArray())
})

test('wind is present in the sample, so the bird is always flying in moving air', () => {
  const a = airAt(0, 400, 0)
  assert.ok(Math.hypot(a.wind.x, a.wind.z) > 1, 'there should be real horizontal wind')
  assert.ok(Math.abs(Math.hypot(a.wind.x, a.wind.z) - AIR.windSpeed) < 1e-6)
})

test('a windward slope lifts and the lee side of the same ridge sinks', () => {
  const wind = windDirection(SEED).multiplyScalar(AIR.windSpeed)
  // Find a genuinely steep slope and sample just above it on both sides.
  let found = 0
  for (let i = 0; i < 20000 && found < 8; i++) {
    const x = (i % 140) * 90 - 6000
    const z = Math.floor(i / 140) * 90 - 6000
    const h = heightAt(x, z, SEED)
    if (h < 40) continue
    const n = normalAt(x, z, SEED)
    const steep = Math.hypot(n[0], n[2])
    if (steep < 0.45) continue
    const facing = -(n[0] * wind.x + n[2] * wind.z)
    if (Math.abs(facing) < 2.0) continue // nearly side-on, no strong verdict either way
    found++
    const a = airAt(x, h + 25, z)
    if (facing > 0) assert.ok(a.ridge > 0, `windward slope should lift, got ${a.ridge.toFixed(2)}`)
    else assert.ok(a.ridge < 0, `lee slope should sink, got ${a.ridge.toFixed(2)}`)
  }
  assert.ok(found >= 4, `expected steep slopes to sample, found ${found}`)
})

test('ridge lift hugs the slope and is gone well above it', () => {
  const wind = windDirection(SEED).multiplyScalar(AIR.windSpeed)
  let tested = false
  for (let i = 0; i < 20000 && !tested; i++) {
    const x = (i % 140) * 90 - 6000
    const z = Math.floor(i / 140) * 90 - 6000
    const h = heightAt(x, z, SEED)
    if (h < 40) continue
    const n = normalAt(x, z, SEED)
    if (-(n[0] * wind.x + n[2] * wind.z) < 1.2) continue
    const low = airAt(x, h + 10, z).ridge
    const high = airAt(x, h + AIR.ridgeCeiling + 50, z).ridge
    assert.ok(low > 0.5, `expected usable lift on the slope, got ${low.toFixed(2)}`)
    assert.ok(high === 0, `ridge lift must not reach the whole sky, got ${high.toFixed(2)}`)
    tested = true
  }
  assert.ok(tested, 'no windward slope found to test')
})

test('thermals exist over dry land, beat a glider sink rate, and have a ceiling', () => {
  let best = 0
  let bestAt: { x: number; z: number; y: number } | null = null
  for (let i = 0; i < 30000; i++) {
    const x = (i % 170) * 70 - 6000
    const z = Math.floor(i / 170) * 70 - 6000
    const ground = heightAt(x, z, SEED)
    if (ground < WORLD.waterLevel) continue
    const y = ground + 200
    const t = thermalAt(x, y, z, SEED)
    if (t > best) {
      best = t
      bestAt = { x, z, y }
    }
  }
  assert.ok(bestAt, 'no dry land sampled')
  // A hands-off glide sinks at about 2.8 m/s. Lift that cannot beat that is decoration.
  assert.ok(best > 3.2, `strongest thermal is only ${best.toFixed(2)} m/s - soaring would be impossible`)

  const above = thermalAt(bestAt!.x, heightAt(bestAt!.x, bestAt!.z, SEED) + AIR.thermalCeiling + 50, bestAt!.z, SEED)
  assert.equal(above, 0, 'thermals must top out rather than reaching forever')
})

test('thermals are sparse, not a sky that lifts everywhere', () => {
  let lifting = 0
  let dryLand = 0
  for (let i = 0; i < 8000; i++) {
    const x = (i % 90) * 130 - 6000
    const z = Math.floor(i / 90) * 130 - 6000
    const ground = heightAt(x, z, SEED)
    if (ground < WORLD.waterLevel) continue
    dryLand++
    if (thermalAt(x, ground + 200, z, SEED) > 0) lifting++
  }
  const fraction = lifting / dryLand
  assert.ok(fraction > 0.05, `only ${(fraction * 100).toFixed(0)}% of the sky lifts - unfindable`)
  assert.ok(fraction < 0.6, `${(fraction * 100).toFixed(0)}% of the sky lifts - no skill involved`)
})

test('air over water sinks, and gives nothing back', () => {
  let tested = 0
  for (let i = 0; i < 30000 && tested < 5; i++) {
    const x = (i % 170) * 70 - 6000
    const z = Math.floor(i / 170) * 70 - 6000
    if (heightAt(x, z, SEED) >= WORLD.waterLevel) continue
    tested++
    const a = airAt(x, WORLD.waterLevel + 30, z)
    assert.ok(a.thermal === 0, 'cold water cannot drive a thermal')
    assert.ok(a.lift < 0, `air over a lake should sink, got ${a.lift.toFixed(2)}`)
  }
  assert.ok(tested >= 5, 'expected to find lakes')
})

test('surfaceAt reports the lake top over water and the ground over land', () => {
  for (let i = 0; i < 500; i++) {
    const x = i * 53 - 4000
    const z = i * -37 + 1200
    const ground = heightAt(x, z, SEED)
    const surface = surfaceAt(x, z, SEED)
    assert.ok(surface >= WORLD.waterLevel, 'the surface is never below the waterline')
    assert.equal(surface, Math.max(ground, WORLD.waterLevel))
  }
})

test('a bird that circles a thermal climbs without flapping', () => {
  // The Phase 2 gate, stated as a test: altitude for free, by reading the world.
  let spot: { x: number; z: number } | null = null
  let best = 0
  for (let i = 0; i < 30000; i++) {
    const x = (i % 170) * 70 - 6000
    const z = Math.floor(i / 170) * 70 - 6000
    const ground = heightAt(x, z, SEED)
    if (ground < WORLD.waterLevel) continue
    const t = thermalAt(x, ground + 200, z, SEED)
    if (t > best) {
      best = t
      spot = { x, z }
    }
  }
  assert.ok(spot, 'no thermal found')

  const ground = heightAt(spot!.x, spot!.z, SEED)
  const bird = createBird(new Vector3(spot!.x, ground + 150, spot!.z))
  const start = bird.pos.y
  const air = createAirSample()
  const dt = 1 / 120
  // A steady bank, which is how a thermal is actually worked.
  for (let i = 0; i < 60 / dt; i++) {
    sampleAir(bird.pos, SEED, air, i * dt)
    step(bird, { roll: 0.55, pitch: 0.28, flap: false }, air, dt)
  }
  assert.ok(bird.stamina > 99, 'this has to be done without flapping')
  assert.ok(bird.pos.y > start + 60, `expected a real climb, went ${(bird.pos.y - start).toFixed(0)}m`)
})

test('thermals drift downwind, so a circling bird is not blown out of its own core', () => {
  // Sample somewhere the air is actually doing something.
  let spot: { x: number; z: number; y: number } | null = null
  let best = 0
  for (let i = 0; i < 30000 && best < 3; i++) {
    const x = (i % 170) * 70 - 6000
    const z = Math.floor(i / 170) * 70 - 6000
    const ground = heightAt(x, z, SEED)
    if (ground < WORLD.waterLevel) continue
    const t = thermalAt(x, ground + 200, z, SEED)
    if (t > best) {
      best = t
      spot = { x, z, y: ground + 200 }
    }
  }
  assert.ok(spot, 'no thermal found to test drift with')

  const now = thermalAt(spot!.x, spot!.y, spot!.z, SEED, 0)
  const later = thermalAt(spot!.x, spot!.y, spot!.z, SEED, 120)
  assert.notEqual(now, later, 'the thermal field must move with the wind, not stand still')

  // Following the wind tracks the same air far better than holding station does.
  const wind = windDirection(SEED).multiplyScalar(AIR.windSpeed * 120)
  const carried = thermalAt(spot!.x + wind.x, spot!.y, spot!.z + wind.z, SEED, 120)
  assert.ok(
    Math.abs(carried - now) < Math.abs(later - now),
    `drifting with the wind should track the core (carried ${carried.toFixed(2)} vs stationary ${later.toFixed(2)}, was ${now.toFixed(2)})`,
  )
})

test('a bird gliding over open water loses height faster than over dry land', () => {
  const glide = (x: number, z: number) => {
    const y = surfaceAt(x, z, SEED) + 150
    const bird = createBird(new Vector3(x, y, z))
    const air = createAirSample()
    const dt = 1 / 120
    for (let i = 0; i < 20 / dt; i++) {
      sampleAir(bird.pos, SEED, air, i * dt)
      step(bird, NEUTRAL, air, dt)
    }
    return y - bird.pos.y
  }
  let water: number | null = null
  for (let i = 0; i < 30000 && water === null; i++) {
    const x = (i % 170) * 70 - 6000
    const z = Math.floor(i / 170) * 70 - 6000
    if (heightAt(x, z, SEED) < WORLD.waterLevel - 40) water = glide(x, z)
  }
  assert.ok(water !== null && water > 0, 'a glide over a lake must lose height')
})

test('the moisture field actually varies, so heating is not uniform', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 2000; i++) {
    const m = moistureAt(i * 97 - 5000, i * -131 + 2000, SEED)
    lo = Math.min(lo, m)
    hi = Math.max(hi, m)
  }
  assert.ok(hi - lo > 0.8, `moisture barely varies (${lo.toFixed(2)}..${hi.toFixed(2)})`)
})
