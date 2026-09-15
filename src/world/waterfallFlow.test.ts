import test from 'node:test'
import assert from 'node:assert/strict'
import { streakFall, TIME_OPERATOR, TIME_SIGN } from './waterfallFlow.ts'

test('water falls downward: a streak moves toward the foot as time passes', () => {
  // The bug this exists for: the sheet animated upward, so every waterfall in
  // the world ran up the cliff.
  let previous = streakFall(0.5, 0)
  for (let t = 0.1; t <= 2; t += 0.1) {
    const now = streakFall(0.5, t)
    assert.ok(now > previous, `the streak moved up the sheet between t=${(t - 0.1).toFixed(1)} and t=${t.toFixed(1)}`)
    previous = now
  }
})

test('every streak lane travels the same way, whatever its speed or phase', () => {
  for (const speed of [0.85, 1.4, 2.35]) {
    for (const phase of [0, 3.1, 7.7]) {
      for (const k of [3.2, 4.8, 8.0]) {
        const early = streakFall(0.5, 0, k, speed, phase)
        const later = streakFall(0.5, 1, k, speed, phase)
        assert.ok(later > early, `lane at speed ${speed}, k ${k} flows the wrong way`)
      }
    }
  }
})

test('the shader is generated from the same sign, so the two cannot drift apart', () => {
  assert.equal(TIME_SIGN, -1)
  assert.equal(TIME_OPERATOR, '-')
})
