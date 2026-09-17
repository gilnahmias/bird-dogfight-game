import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { collectGifts, giveToTalons } from './talonGifts.ts'

test('food handed over is collected exactly once', () => {
  collectGifts()
  const at = new Vector3(1, 2, 3)
  giveToTalons('rabbit', at)
  giveToTalons('fish', at)
  at.set(9, 9, 9) // the giver's vector moving on must not move the gift
  const first = collectGifts()
  assert.deepEqual(first.map((g) => g.kind), ['rabbit', 'fish'])
  assert.deepEqual(first[0].at.toArray(), [1, 2, 3])
  assert.equal(collectGifts().length, 0, 'the same gift was handed over twice')
})
