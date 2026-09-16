import test from 'node:test'
import assert from 'node:assert/strict'
import { findTarns, outletDrop } from './tarns.ts'
import { findNestSite } from './nest.ts'
import { heightAt, TARN_RADIUS } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEEDS = ['pine-ridge', 'alpine', 'coastal', 'basin']

const tarnsFor = (seed: string) => findTarns(seed, findNestSite(seed).pos)

test('every seed has tarns, up in the hills and above the sea', () => {
  for (const seed of SEEDS) {
    const tarns = tarnsFor(seed)
    // Not "at least one": the player could not FIND a mountain lake when there
    // were four in a seven kilometre square. Supply is the whole point.
    assert.ok(tarns.length >= 6, `${seed}: only ${tarns.length} mountain tarns in range`)
    const nearest = Math.min(...tarns.map((t) => t.centre.distanceTo(findNestSite(seed).pos)))
    // Close enough to reach on the first flight, not just present somewhere.
    assert.ok(nearest < 800, `${seed}: the nearest tarn is ${(nearest / 1000).toFixed(1)}km from the nest`)
    for (const t of tarns) {
      assert.ok(t.level > WORLD.waterLevel + 20, `${seed}: tarn at ${t.level.toFixed(0)}m is basically the sea`)
      assert.ok(t.radius > 5, `${seed}: tarn is a puddle`)
    }
  }
})

test('a tarn sits in a hollow - its floor is below the rim all the way round', () => {
  for (const seed of SEEDS) {
    for (const t of tarnsFor(seed)) {
      const floor = heightAt(t.centre.x, t.centre.z, seed)
      assert.ok(floor < t.level, `${seed}: the tarn floor is above its own water line`)
      let above = 0
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const h = heightAt(t.centre.x + Math.cos(a) * TARN_RADIUS, t.centre.z + Math.sin(a) * TARN_RADIUS, seed)
        if (h > floor) above++
      }
      assert.ok(above >= 9, `${seed}: only ${above}/12 of the rim is above the floor - not a hollow`)
    }
  }
})

test('the outlet is the low point of the rim, so water leaves where it would really leave', () => {
  // Sampled at the same angles the siting uses; a finer sweep would find dips
  // between them and prove nothing about the choice actually made.
  for (const seed of SEEDS) {
    for (const t of tarnsFor(seed)) {
      const outletGround = heightAt(t.outlet.x, t.outlet.z, seed)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const h = heightAt(
          t.centre.x + Math.cos(a) * TARN_RADIUS,
          t.centre.z + Math.sin(a) * TARN_RADIUS,
          seed,
        )
        assert.ok(
          h >= outletGround - 0.01,
          `${seed}: a lower way out of the tarn exists than the outlet (${h.toFixed(1)} < ${outletGround.toFixed(1)})`,
        )
      }
    }
  }
})

test('enough tarns actually drain to be worth calling sources', () => {
  // Measured along the outflow rather than at the lip: the ground rises for the
  // first ten to twenty metres outside nearly every rim before it falls away, so
  // a sample taken at the outlet says nothing about where the water goes.
  //
  // And not EVERY tarn: measured, a third to a half sit in saddles high on a
  // broad ridge with no way down within a couple of hundred metres. Those are
  // lakes without a stream, which is a real thing. What must not happen is ALL
  // of them being like that, because then no waterfall has a source.
  for (const seed of SEEDS) {
    const tarns = tarnsFor(seed)
    const draining = tarns.filter((t) => outletDrop(t, seed) > 6)
    assert.ok(
      draining.length >= Math.max(3, tarns.length * 0.35),
      `${seed}: only ${draining.length} of ${tarns.length} tarns have anywhere to spill to`,
    )
    for (const t of tarns) assert.ok(Math.abs(t.outflow.length() - 1) < 1e-6)
  }
})

test('at least one tarn has a real drop below it, or no waterfall could come from one', () => {
  for (const seed of SEEDS) {
    const best = Math.max(...tarnsFor(seed).map((t) => outletDrop(t, seed)))
    assert.ok(best > 12, `${seed}: the biggest drop below any tarn is only ${best.toFixed(0)}m`)
  }
})

test('tarns are spread out and deterministic', () => {
  const a = tarnsFor('pine-ridge')
  const b = tarnsFor('pine-ridge')
  assert.deepEqual(a.map((t) => t.centre.toArray()), b.map((t) => t.centre.toArray()))
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      assert.ok(a[i].centre.distanceTo(a[j].centre) >= 150, 'two tarns are on top of each other')
    }
  }
})
