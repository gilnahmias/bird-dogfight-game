import test from 'node:test'
import assert from 'node:assert/strict'
import { apparentSize, MAX_HEIGHT, shadowFor } from './shadow.ts'

test('the shadow is visible from the deck up to the fade height', () => {
  assert.ok(shadowFor(0).visible)
  assert.ok(shadowFor(MAX_HEIGHT - 1).visible)
  assert.ok(!shadowFor(MAX_HEIGHT + 1).visible, 'no shadow from the stratosphere')
  assert.ok(!shadowFor(-5).visible, 'no shadow when below the ground')
})

test('the shadow grows and fades with height, which is what makes it an altimeter', () => {
  const low = shadowFor(5)
  const mid = shadowFor(120)
  const high = shadowFor(240)

  assert.ok(mid.size > low.size && high.size > mid.size, 'the blob must spread as the bird climbs')
  assert.ok(
    mid.opacity < low.opacity && high.opacity < mid.opacity,
    'the blob must fade as the bird climbs',
  )
  // Both cues have to move enough to be read at a glance, not just technically differ.
  // Both cues have to move enough to read at a glance. The blob deliberately
  // grows less than it once did, because the fade now carries most of the signal
  // and a shadow that doubles in size reads as a different bird, not a higher one.
  assert.ok(
    high.size > low.size * 1.6,
    `size barely changes: ${low.size.toFixed(1)} to ${high.size.toFixed(1)}`,
  )
  // Deliberately a gentler fade than before. The old curve dropped fast enough
  // to satisfy a 4x ratio and was invisible by cruise altitude, which is the bug
  // this whole curve exists to avoid.
  assert.ok(
    low.opacity > high.opacity * 2,
    `opacity barely changes: ${low.opacity.toFixed(3)} to ${high.opacity.toFixed(3)}`,
  )
})

test('the shadow is roughly a wingspan across when the bird is on the deck', () => {
  // The bird is about 10m from tip to tip; a shadow far off that reads as wrong.
  const size = shadowFor(0).size
  assert.ok(size > 3 && size < 8, `shadow half-width of ${size.toFixed(1)}m does not match the bird`)
})

test('the shadow stays big enough on screen to see, at every altitude', () => {
  // The bug this guards: a fixed-size shadow thrown along a low sun lands about
  // twice its height away, so it shrank to 0.04% of the frame at cruise - drawn,
  // but invisible. Angular size is what the player actually perceives.
  const REACH = 2.0 // roughly what a 27 degree sun gives
  for (const agl of [20, 60, 120, 200, 300]) {
    const radians = apparentSize(agl, REACH)
    const degrees = (radians * 180) / Math.PI
    assert.ok(degrees > 1.6, `shadow subtends only ${degrees.toFixed(2)} degrees at ${agl}m - a speck`)
    assert.ok(degrees < 30, `shadow subtends ${degrees.toFixed(1)} degrees at ${agl}m - absurdly large`)
  }
})

test('the shadow still shrinks with height, or it carries no altitude cue at all', () => {
  const REACH = 2.0
  const low = apparentSize(25, REACH)
  const high = apparentSize(300, REACH)
  assert.ok(low > high * 2, `apparent size barely changes: ${low.toFixed(3)} to ${high.toFixed(3)}`)
})

test('the shadow stays readable across the altitudes the bird actually flies', () => {
  // This is the test that matters. A previous curve satisfied "opacity > 0" the
  // whole way up while being invisible on screen from 150m, which is roughly
  // where the bird cruises - so the instrument was dead exactly where it was
  // needed. Anything below about 0.12 does not read against terrain.
  for (const agl of [10, 40, 80, 120, 160, 200, 250]) {
    const s = shadowFor(agl)
    assert.ok(s.visible, `no shadow at ${agl}m`)
    assert.ok(
      s.opacity > 0.12,
      `shadow is only ${s.opacity.toFixed(3)} opaque at ${agl}m agl - invisible where the bird flies`,
    )
  }
})

test('the shadow fades out before it stops being drawn, with no visible pop', () => {
  const justInside = shadowFor(MAX_HEIGHT - 5)
  assert.ok(justInside.opacity < 0.05, `shadow pops out at ${justInside.opacity.toFixed(3)} opacity`)
})
