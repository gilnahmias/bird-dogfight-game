import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProgress, STAGES, stageFor } from './progress.ts'
import { T } from './constants.ts'

test('the valley starts peaceful and wakes up in order', () => {
  const first = stageFor(0)
  assert.equal(first.number, 1)
  assert.ok(!first.crows && first.rivals === 0 && !first.nests, 'stage one must have nothing hostile')
  assert.equal(stageFor(1).number, 2)
  assert.equal(stageFor(2).number, 2)
  assert.equal(stageFor(3).number, 3)
  assert.equal(stageFor(9).number, 4)
  assert.equal(stageFor(500).number, 5)
})

test('each stage only ever adds, never takes something back', () => {
  for (let i = 1; i < STAGES.length; i++) {
    const [was, now] = [STAGES[i - 1], STAGES[i]]
    assert.ok(now.from > was.from)
    assert.ok(now.rivals >= was.rivals)
    assert.ok(!was.crows || now.crows)
    assert.ok(!was.nests || now.nests)
    assert.ok(now.news, `stage ${now.number} opens without telling the player`)
  }
})

test('the first rival can be outrun', () => {
  const firstRival = STAGES.find((s) => s.rivals > 0)!
  assert.ok(firstRival.pace.cruise < T.cruiseSpeed, 'a first rival faster than the player cannot be escaped')
})

test('saved progress that is missing or broken is a fresh start', () => {
  assert.deepEqual(parseProgress(null), { banked: 0, bankedCount: 0 })
  assert.deepEqual(parseProgress('not json'), { banked: 0, bankedCount: 0 })
  assert.deepEqual(parseProgress('{"banked":-5,"bankedCount":2}'), { banked: 0, bankedCount: 0 })
  assert.deepEqual(parseProgress('{"banked":245,"bankedCount":4}'), { banked: 245, bankedCount: 4 })
})
