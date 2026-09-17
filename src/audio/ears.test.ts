import test from 'node:test'
import assert from 'node:assert/strict'
import { CALL_EVERY, CLOSE_RANGE, FORGET_RANGE, NOTICE_RANGE, newEar, rivalCall, windLevel } from './ears.ts'

const patrol = { mode: 'patrol' as const, dead: false }

test('a rival calls once as it comes into the picture, not every frame', () => {
  const ear = newEar('patrol')
  assert.equal(rivalCall(ear, patrol, NOTICE_RANGE + 50, 0), 'none')
  assert.equal(rivalCall(ear, patrol, NOTICE_RANGE - 10, 1), 'call')
  assert.equal(rivalCall(ear, patrol, NOTICE_RANGE - 20, 1.1), 'none')
  assert.equal(rivalCall(ear, patrol, NOTICE_RANGE - 30, 20), 'none', 'far rival repeated itself')
})

test('a close rival keeps calling, but not faster than the repeat interval', () => {
  const ear = newEar('patrol')
  assert.equal(rivalCall(ear, patrol, CLOSE_RANGE - 10, 0), 'call')
  assert.equal(rivalCall(ear, patrol, CLOSE_RANGE - 10, CALL_EVERY - 1), 'none')
  assert.equal(rivalCall(ear, patrol, CLOSE_RANGE - 10, CALL_EVERY + 0.1), 'call')
})

test('committing to a dive screams straight away, even right after a call', () => {
  const ear = newEar('climb')
  assert.equal(rivalCall(ear, { mode: 'climb', dead: false }, 200, 0), 'call')
  assert.equal(rivalCall(ear, { mode: 'commit', dead: false }, 200, 0.2), 'dive')
  assert.equal(rivalCall(ear, { mode: 'commit', dead: false }, 150, 0.4), 'none', 'screamed twice for one dive')
})

test('a rival that left and came back announces itself again', () => {
  const ear = newEar('patrol')
  assert.equal(rivalCall(ear, patrol, 500, 0), 'call')
  assert.equal(rivalCall(ear, patrol, FORGET_RANGE + 1, 5), 'none')
  assert.equal(rivalCall(ear, patrol, 500, 10), 'call')
})

test('dead rivals are silent', () => {
  assert.equal(rivalCall(newEar('commit'), { mode: 'commit', dead: true }, 50, 0), 'none')
})

test('wind is silent in the nest and grows with speed', () => {
  assert.equal(windLevel(40, true), 0)
  assert.equal(windLevel(5, false), 0)
  assert.ok(windLevel(25, false) < windLevel(50, false))
  assert.ok(windLevel(90, false) <= 1)
})
