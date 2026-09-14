import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HEIGHT, shadowFor } from './shadow.ts'

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
  assert.ok(high.size > low.size * 2, `size barely changes: ${low.size.toFixed(1)} to ${high.size.toFixed(1)}`)
  assert.ok(low.opacity > high.opacity * 4, 'opacity barely changes across the range')
})

test('the shadow is roughly a wingspan across when the bird is low', () => {
  // The bird is about 10m from tip to tip; a shadow far off that reads as wrong.
  const size = shadowFor(0).size
  assert.ok(size > 3 && size < 8, `shadow half-width of ${size.toFixed(1)}m does not match the bird`)
})

test('the shadow never becomes fully invisible while it is still being drawn', () => {
  for (let h = 0; h < MAX_HEIGHT - 20; h += 10) {
    const s = shadowFor(h)
    assert.ok(s.opacity > 0.001, `shadow is invisible at ${h}m but still drawn`)
  }
})
