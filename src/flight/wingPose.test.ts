import test from 'node:test'
import assert from 'node:assert/strict'
import { stroke, wingPose } from './wingPose.ts'

const SAMPLES = 240

test('the stroke is a smooth closed loop with no snap at the wrap', () => {
  let previous = stroke(0)
  let biggestStep = 0
  for (let i = 1; i <= SAMPLES; i++) {
    const value = stroke(i / SAMPLES)
    biggestStep = Math.max(biggestStep, Math.abs(value - previous))
    previous = value
    assert.ok(value >= -1.001 && value <= 1.001, `stroke left its range: ${value}`)
  }
  assert.ok(biggestStep < 0.12, `the stroke jumps by ${biggestStep.toFixed(3)} - that reads as a snap`)
  assert.ok(Math.abs(stroke(0) - stroke(1)) < 1e-9, 'the beat must loop seamlessly')
})

test('the downstroke is faster than the recovery, the way a real wingbeat is', () => {
  // Measure how much of the cycle is spent going down versus coming back up.
  let falling = 0
  for (let i = 0; i < SAMPLES; i++) {
    if (stroke((i + 1) / SAMPLES) < stroke(i / SAMPLES)) falling++
  }
  const share = falling / SAMPLES
  assert.ok(share > 0.2 && share < 0.45, `downstroke takes ${(share * 100).toFixed(0)}% of the beat`)
})

test('the stroke travels outward - elbow trails shoulder, hand trails elbow', () => {
  // The joints must not move as one piece; that is what made it look like wood.
  let shoulderLeadsElbow = 0
  let elbowLeadsWrist = 0
  for (let i = 0; i < SAMPLES; i++) {
    const p = i / SAMPLES
    const now = wingPose(p, true, 20)
    const soon = wingPose(p + 0.06, true, 20)
    if (Math.sign(soon.shoulder - now.shoulder) !== Math.sign(soon.elbow - now.elbow)) {
      shoulderLeadsElbow++
    }
    if (Math.sign(soon.elbow - now.elbow) !== Math.sign(soon.wrist - now.wrist)) elbowLeadsWrist++
  }
  assert.ok(shoulderLeadsElbow > 0, 'the elbow never lags the shoulder - the wing is rigid')
  assert.ok(elbowLeadsWrist > 0, 'the hand never lags the elbow - the wing is rigid')
})

test('the wingtip sweeps further than the shoulder', () => {
  const range = (pick: (p: ReturnType<typeof wingPose>) => number) => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < SAMPLES; i++) {
      const v = pick(wingPose(i / SAMPLES, true, 20))
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    return hi - lo
  }
  // Total travel at the tip is the three joints stacked up.
  const tip = range((p) => p.shoulder + p.elbow + p.wrist)
  const root = range((p) => p.shoulder)
  assert.ok(tip > root * 1.8, `tip travels ${tip.toFixed(2)} vs root ${root.toFixed(2)}`)
})

test('a gliding wing is held out and nearly still, but never frozen', () => {
  const glide = wingPose(0.3, false, 20)
  const flap = wingPose(0.3, true, 20)
  assert.ok(Math.abs(glide.shoulder) < Math.abs(flap.shoulder) || Math.abs(glide.elbow) < Math.abs(flap.elbow))

  let movement = 0
  for (let i = 0; i < SAMPLES; i++) {
    movement = Math.max(movement, Math.abs(wingPose(i / SAMPLES, false, 20).elbow))
  }
  assert.ok(movement > 0.005, 'a gliding wing that never moves at all looks dead')
  assert.ok(movement < 0.2, 'a gliding wing should not be flapping')
})

test('the wing tucks as the bird accelerates, and is fully swept in a dive', () => {
  assert.equal(wingPose(0, false, 15).tuck, 0, 'a slow bird flies with wings spread')
  assert.equal(wingPose(0, false, 60).tuck, 1, 'a fast dive fully tucks the wings')
  const mid = wingPose(0, false, 35).tuck
  assert.ok(mid > 0 && mid < 1, `tuck should ease in, got ${mid}`)
})

// --- The wings as they are actually assembled ------------------------------
// These build the real scene graph, mirror and all, because the bug they guard
// against lives in how the pieces compose, not in the maths above. The wings
// once beat in opposite directions and every pure test still passed.

import { Group, Vector3 } from 'three'
import { applyWingPose } from './wingPose.ts'

/** Mirrors the hierarchy in Bird.tsx: shoulder -> elbow -> wrist, right side mirrored. */
function buildWings() {
  const root = new Group()
  const make = (mirrored: boolean) => {
    const mount = new Group()
    mount.position.set(mirrored ? -0.35 : 0.35, 0.12, 0)
    if (mirrored) mount.scale.set(-1, 1, 1)
    const shoulder = new Group()
    const elbow = new Group()
    elbow.position.set(2.0, 0, 0)
    const wrist = new Group()
    wrist.position.set(1.95, 0, 0)
    const tip = new Group()
    tip.position.set(1.3, 0, 0)
    wrist.add(tip)
    elbow.add(wrist)
    shoulder.add(elbow)
    mount.add(shoulder)
    root.add(mount)
    return { shoulder, elbow, wrist, tip }
  }
  const left = make(false)
  const right = make(true)
  return { root, left, right }
}

function tipHeights(phase: number, flapping = true) {
  const { root, left, right } = buildWings()
  const pose = wingPose(phase, flapping, 20)
  applyWingPose(left, pose)
  applyWingPose(right, pose)
  root.updateMatrixWorld(true)
  const l = new Vector3()
  const r = new Vector3()
  left.tip.getWorldPosition(l)
  right.tip.getWorldPosition(r)
  return { left: l, right: r }
}

test('both wingtips rise and fall together, as a bird flaps and a butterfly does not', () => {
  for (let i = 0; i < 40; i++) {
    const phase = i / 40
    const now = tipHeights(phase)
    const soon = tipHeights(phase + 0.02)
    const leftMoves = soon.left.y - now.left.y
    const rightMoves = soon.right.y - now.right.y
    if (Math.abs(leftMoves) < 1e-6) continue
    assert.ok(
      Math.sign(leftMoves) === Math.sign(rightMoves),
      `at phase ${phase.toFixed(2)} the wings move apart: left ${leftMoves.toFixed(4)}, right ${rightMoves.toFixed(4)}`,
    )
    assert.ok(
      Math.abs(now.left.y - now.right.y) < 1e-6,
      `the wings are at different heights at phase ${phase.toFixed(2)}`,
    )
  }
})

test('the wings stay mirrored across the body, not stacked on one side', () => {
  const { left, right } = tipHeights(0.3)
  assert.ok(left.x > 0.5, `left wingtip is at x=${left.x.toFixed(2)}, not out to the left`)
  assert.ok(right.x < -0.5, `right wingtip is at x=${right.x.toFixed(2)}, not out to the right`)
  assert.ok(Math.abs(left.x + right.x) < 1e-6, 'the wingspan is lopsided')
})

test('both wings sweep the same way when the bird tucks into a dive', () => {
  const { root, left, right } = buildWings()
  const pose = wingPose(0.25, false, 60) // fully tucked
  applyWingPose(left, pose)
  applyWingPose(right, pose)
  root.updateMatrixWorld(true)
  const l = new Vector3()
  const r = new Vector3()
  left.tip.getWorldPosition(l)
  right.tip.getWorldPosition(r)
  assert.ok(pose.tuck === 1, 'expected a full tuck for this test')
  assert.ok(l.z > 0.2, `left wingtip should sweep back, z=${l.z.toFixed(2)}`)
  assert.ok(Math.abs(l.z - r.z) < 1e-6, `wings sweep differently: ${l.z.toFixed(2)} vs ${r.z.toFixed(2)}`)
})

// --- Rhythm ----------------------------------------------------------------

import { createRhythm, stepRhythm, type RhythmInput } from './wingPose.ts'

const CRUISE = 26
const cruising: RhythmInput = { airspeed: CRUISE, climbRate: 0, cruiseSpeed: CRUISE, perched: false }

function run(input: RhythmInput, seconds: number) {
  const rhythm = createRhythm()
  const dt = 1 / 60
  let beatingFrames = 0
  let switches = 0
  let previous = rhythm.beating
  for (let i = 0; i < seconds / dt; i++) {
    stepRhythm(rhythm, input, dt)
    if (rhythm.beating) beatingFrames++
    if (rhythm.beating !== previous) switches++
    previous = rhythm.beating
  }
  return { beatingShare: beatingFrames / (seconds / dt), switches }
}

test('a bird at cruise beats in bursts and glides between them', () => {
  const { beatingShare, switches } = run(cruising, 40)
  assert.ok(switches > 4, `the wings never settled into a rhythm (${switches} changes in 40s)`)
  assert.ok(
    beatingShare > 0.2 && beatingShare < 0.8,
    `beating ${(beatingShare * 100).toFixed(0)}% of the time is not a rhythm, it is a setting`,
  )
})

test('a bird that is sinking keeps working', () => {
  const { beatingShare } = run({ ...cruising, climbRate: -6 }, 20)
  assert.ok(beatingShare > 0.95, `only beating ${(beatingShare * 100).toFixed(0)}% of the time while dropping`)
})

test('a slow bird keeps working', () => {
  const { beatingShare } = run({ ...cruising, airspeed: CRUISE * 0.5 }, 20)
  assert.ok(beatingShare > 0.95, 'a slow bird must not coast')
})

test('a bird in lift is allowed to hold its wings out', () => {
  const { beatingShare } = run({ ...cruising, climbRate: 2.5 }, 40)
  assert.ok(beatingShare < 0.6, `still beating ${(beatingShare * 100).toFixed(0)}% of the time in lift`)
})

test('a perched bird holds its wings ready, not folded mid-glide', () => {
  const rhythm = createRhythm()
  stepRhythm(rhythm, { ...cruising, perched: true, airspeed: 0 }, 1 / 60)
  assert.ok(rhythm.beating)
})

test('the rhythm does not flicker frame to frame', () => {
  const { switches } = run(cruising, 40)
  // Roughly one change every few seconds, not several a second.
  assert.ok(switches < 30, `${switches} changes in 40 seconds is a flicker, not a wingbeat`)
})
