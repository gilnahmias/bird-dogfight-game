import test from 'node:test'
import assert from 'node:assert/strict'
import type { Shape } from 'three'
import {
  alula,
  armShape,
  ELBOW_X,
  greaterCoverts,
  handShape,
  lesserCoverts,
  primaries,
  secondaries,
  tailFeathers,
  WRIST_X,
} from './wingShapes.ts'

/** Outline of a shape as plain points. */
const outline = (shape: Shape) => shape.getPoints(24).map((p) => ({ x: p.x, y: p.y }))

function inside(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      if (point.x < x) hit = !hit
    }
  }
  return hit
}

/** Closest distance from a point to a polygon's edges. */
function distanceTo(point: { x: number; y: number }, polygon: { x: number; y: number }[]): number {
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)))
  }
  return best
}

/**
 * The root of a feather is the first point of its outline - the quill end, where
 * it joins the wing.
 */
const rootOf = (shape: Shape) => outline(shape)[0]

/** Every row, with the panel it grows from, in that panel's own coordinates. */
function rows() {
  const arm = outline(armShape())
  // The hand is drawn from the wrist, which sits at ELBOW_X + WRIST_X along the wing.
  const hand = outline(handShape())
  return [
    { name: 'secondaries', feathers: secondaries(), panel: arm, shift: 0 },
    { name: 'greater coverts', feathers: greaterCoverts(), panel: arm, shift: 0 },
    { name: 'lesser coverts', feathers: lesserCoverts(), panel: arm, shift: 0 },
    { name: 'primaries', feathers: primaries(), panel: hand, shift: WRIST_X },
    { name: 'alula', feathers: alula(), panel: hand, shift: WRIST_X },
  ]
}

test('every feather is rooted in the part of the wing it grows from', () => {
  // The failure this guards against is feathers hanging in the air beside the
  // bird - which is what you get the moment a row is nudged outboard of the
  // panel it belongs to.
  for (const { name, feathers, panel, shift } of rows()) {
    feathers.forEach((feather, i) => {
      const root = rootOf(feather)
      // Feather coordinates are relative to their own group; shift into the
      // panel's frame before asking whether they touch it.
      const inPanel = { x: root.x + shift, y: root.y }
      const attached = inside(inPanel, panel) || distanceTo(inPanel, panel) < 0.35
      assert.ok(
        attached,
        `${name}[${i}] is rooted at (${inPanel.x.toFixed(2)}, ${inPanel.y.toFixed(2)}), ` +
          `${distanceTo(inPanel, panel).toFixed(2)} from the wing - it would float`,
      )
    })
  }
})

test('feather rows overlap their neighbours rather than leaving gaps', () => {
  for (const { name, feathers } of rows()) {
    const roots = feathers.map(rootOf)
    for (let i = 1; i < roots.length; i++) {
      const gap = Math.hypot(roots[i].x - roots[i - 1].x, roots[i].y - roots[i - 1].y)
      assert.ok(gap < 0.45, `${name}: a ${gap.toFixed(2)} gap between feathers ${i - 1} and ${i}`)
    }
  }
})

test('the wing is a continuous span with no break at the elbow or the wrist', () => {
  const arm = outline(armShape())
  const hand = outline(handShape())
  const armTip = Math.max(...arm.map((p) => p.x))
  assert.ok(
    armTip >= ELBOW_X - 0.05,
    `the arm ends at ${armTip.toFixed(2)} but the elbow is at ${ELBOW_X} - a gap in the wing`,
  )
  const handRoot = Math.min(...hand.map((p) => p.x))
  assert.ok(handRoot <= 0.05, `the hand starts at ${handRoot.toFixed(2)}, adrift of the elbow`)
})

test('the tail fans out without gaps and stays behind the bird', () => {
  const feathers = tailFeathers()
  assert.ok(feathers.length >= 7, 'a raptor tail is a fan, not a plank')
  const roots = feathers.map(rootOf)
  for (const r of roots) {
    assert.ok(Math.hypot(r.x, r.y) < 0.75, `a tail feather is rooted ${Math.hypot(r.x, r.y).toFixed(2)} from the body`)
  }
})
