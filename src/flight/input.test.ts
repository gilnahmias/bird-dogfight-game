import test from 'node:test'
import assert from 'node:assert/strict'
import { STICK_RADIUS, stickAxis } from './input.ts'

test('the stick ignores a resting thumb and reaches full authority at the rim', () => {
  assert.equal(stickAxis(STICK_RADIUS * 0.05), 0)
  assert.equal(stickAxis(STICK_RADIUS), 1)
  assert.equal(stickAxis(-STICK_RADIUS * 3), -1, 'past the rim must clamp, not overshoot')
  const half = stickAxis(STICK_RADIUS / 2)
  assert.ok(half > 0 && half < 0.5, `half a push should be a gentle input, got ${half}`)
  assert.equal(stickAxis(-STICK_RADIUS / 2), -half)
})
