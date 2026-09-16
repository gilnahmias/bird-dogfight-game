import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import {
  BANK_CEILING,
  BANK_RADIUS,
  canBank,
  canCatch,
  loadOf,
  PREY,
  type Prey,
  spawnPreyAround,
  surfaceFor,
  talonPoint,
  valueOf,
  stockedFish,
} from './prey.ts'
import { heightAt, slopeAt, TARN_RADIUS, tarnPoolAt, tarnSitesNear } from './terrain.ts'
import { findNestSite } from './nest.ts'
import { T, WORLD } from '../game/constants.ts'

const SEED = 'pine-ridge'
const near = findNestSite(SEED).pos

const animal = (kind: keyof typeof PREY, pos = new Vector3()): Prey => ({
  id: 1,
  kind,
  pos,
  heading: 0,
  phase: 0,
  caught: false,
})

test('prey lives on the ground and in the water, never in the air', () => {
  const field = spawnPreyAround(near, SEED, 60, 700)
  assert.ok(field.length > 10, `only ${field.length} animals in a 700m radius`)
  for (const p of field) {
    const surface = surfaceFor(p.kind, p.pos.x, p.pos.z, SEED)
    assert.ok(
      Math.abs(p.pos.y - surface) < 0.01,
      `a ${p.kind} is floating ${(p.pos.y - surface).toFixed(1)}m off its surface`,
    )
  }
})

test('fish are on water, land animals are on land they could stand on', () => {
  for (const p of spawnPreyAround(near, SEED, 80, 900)) {
    const ground = heightAt(p.pos.x, p.pos.z, SEED)
    if (p.kind === 'fish') {
      // The sea, or a mountain tarn - a fish belongs under a water surface,
      // whichever surface that is.
      const pool = tarnPoolAt(p.pos.x, p.pos.z, SEED)
      const surface = pool ?? WORLD.waterLevel
      assert.ok(ground < surface, `a fish is on dry land at ${ground.toFixed(0)}m`)
      assert.equal(p.pos.y, surface, 'fish sit at the surface')
    } else {
      assert.ok(ground > WORLD.waterLevel, `a ${p.kind} is underwater`)
      assert.ok(slopeAt(p.pos.x, p.pos.z, SEED) <= 0.34, `a ${p.kind} is on a cliff face`)
    }
  }
})

test('the ladder of prey trades value against talon weight', () => {
  assert.ok(PREY.rabbit.value > PREY.fish.value && PREY.fish.value > PREY.mouse.value)
  assert.ok(PREY.rabbit.weight > PREY.fish.weight && PREY.fish.weight > PREY.mouse.weight)
  // The best prize must not fit alongside a full load of anything else.
  assert.ok(PREY.rabbit.weight > T.maxLoad / 2, 'a rabbit should dominate the talon budget')
  // And the budget has to hold at least one of everything, or a kind is dead weight.
  for (const kind of Object.keys(PREY) as (keyof typeof PREY)[]) {
    assert.ok(PREY[kind].weight <= T.maxLoad, `a ${kind} can never be carried at all`)
  }
})

test('nothing can be caught with the talons tucked', () => {
  const prey = animal('mouse', new Vector3(0, 0, 0))
  const attempt = { talonPoint: new Vector3(0, 0, 0), talons: 0, load: 0, maxLoad: T.maxLoad }
  assert.ok(!canCatch(attempt, prey), 'a bird at cruise must not hoover up prey')
  assert.ok(canCatch({ ...attempt, talons: 1 }, prey), 'with the feet out it should take it')
})

test('prey out of reach of the talons is not caught', () => {
  const prey = animal('rabbit', new Vector3(0, 0, 0))
  const at = (d: number) => ({
    talonPoint: new Vector3(d, 0, 0),
    talons: 1,
    load: 0,
    maxLoad: T.maxLoad,
  })
  assert.ok(canCatch(at(PREY.rabbit.grabRadius - 0.1), prey))
  assert.ok(!canCatch(at(PREY.rabbit.grabRadius + 0.5), prey))
})

test('the catch is forgiving enough to be hit while actually flying', () => {
  // Measured on a real approach, the talons came no closer than 4.7m to a
  // lined-up target - the bird is descending fast, the camera is behind it, and
  // the animal is hopping. A tighter radius than this turns the catch into luck.
  for (const kind of Object.keys(PREY) as (keyof typeof PREY)[]) {
    assert.ok(
      PREY[kind].grabRadius >= 4,
      `${kind} has a ${PREY[kind].grabRadius}m grab radius - too tight to hit from a moving bird`,
    )
    assert.ok(PREY[kind].grabRadius < 8, `${kind} would be caught without aiming at all`)
  }
})

test('the talon budget is what stops the bird taking everything', () => {
  const prey = animal('rabbit', new Vector3(0, 0, 0))
  const attempt = { talonPoint: new Vector3(0, 0, 0), talons: 1, load: 0, maxLoad: T.maxLoad }
  assert.ok(canCatch(attempt, prey), 'an empty-footed bird can take a rabbit')
  assert.ok(
    !canCatch({ ...attempt, load: T.maxLoad - PREY.rabbit.weight + 1 }, prey),
    'a nearly full bird must leave it',
  )
})

test('an animal already taken cannot be taken again', () => {
  const prey = animal('fish', new Vector3(0, 0, 0))
  prey.caught = true
  assert.ok(!canCatch({ talonPoint: new Vector3(), talons: 1, load: 0, maxLoad: T.maxLoad }, prey))
})

test('the talons reach below and ahead of the bird, not from its centre', () => {
  const pos = new Vector3(0, 100, 0)
  const forward = new Vector3(0, 0, -1)
  const down = new Vector3(0, -1, 0)
  const tucked = talonPoint(pos, forward, down, 0)
  const out = talonPoint(pos, forward, down, 1)
  assert.ok(tucked.y < pos.y, 'the feet are under the bird even when tucked')
  assert.ok(out.y < tucked.y, 'throwing them forward reaches further down')
  assert.ok(out.z < tucked.z, 'and further ahead')
})

test('load and value add up over what is being carried', () => {
  const carried = [animal('mouse'), animal('fish'), animal('mouse')]
  assert.equal(loadOf(carried), PREY.mouse.weight * 2 + PREY.fish.weight)
  assert.equal(valueOf(carried), PREY.mouse.value * 2 + PREY.fish.value)
  assert.equal(loadOf([]), 0)
})

test('the nest banks a catch on a pass, without demanding a landing', () => {
  const nest = new Vector3(100, 50, 100)
  assert.ok(canBank(new Vector3(100, 50, 100), nest))
  assert.ok(canBank(new Vector3(100 + BANK_RADIUS - 2, 50, 100), nest))
  assert.ok(!canBank(new Vector3(100 + BANK_RADIUS + 6, 50, 100), nest))
})

test('flying over the top of the nest banks, because that is how you arrive at a crag', () => {
  // A plain 3D distance check failed exactly this: the nest sits on a cliff
  // edge, so the bird comes in above it, and a pass twenty metres overhead was
  // being treated as a miss.
  const nest = new Vector3(0, 100, 0)
  assert.ok(canBank(new Vector3(0, 122, 0), nest), 'passing overhead is a delivery')
  assert.ok(canBank(new Vector3(8, 135, 8), nest), 'and so is a high pass slightly off to one side')
  assert.ok(!canBank(new Vector3(0, 100 + BANK_CEILING + 20, 0), nest), 'but not from the stratosphere')
  assert.ok(!canBank(new Vector3(0, 40, 0), nest), 'nor from far below the crag')
})

test('a full load of the heaviest prey is a real decision, not an impossible one', () => {
  // The bird must be able to fill its feet, but only just.
  const rabbits = Math.floor(T.maxLoad / PREY.rabbit.weight)
  assert.equal(rabbits, 1, 'exactly one rabbit should fit, so taking it is a commitment')
  const mice = Math.floor(T.maxLoad / PREY.mouse.weight)
  assert.ok(mice >= 5, 'small prey should be worth stacking up')
})

test('every mountain lake holds fish, and they are in the water', () => {
  // The bug: prey was scattered over a six hundred metre circle and a tarn is a
  // hundred metres across, so the pool filled with rabbits and the player flew
  // to a lake to find it empty. A lake has fish in it because it is a lake.
  for (const seed of ['pine-ridge', 'alpine', 'coastal', 'basin']) {
    const site = findNestSite(seed)
    const lakes = tarnSitesNear(site.pos.x, site.pos.z, 900, seed)
    assert.ok(lakes.length > 0, `${seed}: no lakes near the nest to stock`)
    const fish = stockedFish(site.pos, seed)
    for (const lake of lakes) {
      const mine = fish.filter((f) => Math.hypot(f.pos.x - lake.x, f.pos.z - lake.z) < TARN_RADIUS)
      assert.ok(mine.length > 0, `${seed}: a lake at ${lake.x.toFixed(0)},${lake.z.toFixed(0)} has no fish`)
      for (const f of mine) {
        assert.equal(f.kind, 'fish')
        assert.ok(
          heightAt(f.pos.x, f.pos.z, seed) < f.pos.y,
          `${seed}: a fish is sitting on the bed rather than in the water`,
        )
      }
    }
  }
})

test('stocked fish keep their identity, so topping up cannot pile shoals', () => {
  const site = findNestSite('pine-ridge')
  const first = stockedFish(site.pos, 'pine-ridge')
  const again = stockedFish(site.pos, 'pine-ridge')
  assert.deepEqual(
    first.map((f) => f.id),
    again.map((f) => f.id),
    'the same lake produced different fish the second time it was asked',
  )
  assert.equal(new Set(first.map((f) => f.id)).size, first.length, 'two fish share an id')
})
