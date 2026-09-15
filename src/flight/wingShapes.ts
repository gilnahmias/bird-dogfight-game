/**
 * The shapes a raptor's wing is built from.
 *
 * Separate from the component that renders them so the layout can be CHECKED:
 * every feather has to be rooted in the part of the wing it grows out of, or it
 * hangs in the air alongside the bird.
 *
 * Feathers are FLAT - single-sided polygons with no thickness - because an
 * extruded slab reads as carved wood however well it is shaped. Real plumage is
 * thin and layered, each feather lying over the next, and the silhouette of the
 * wing is the trailing edge of the feathers rather than the edge of a panel.
 *
 * So the solid part only covers the arm and the leading edge, and the shape you
 * see is made of:
 *   coverts     small feathers sheathing the leading edge, in two rows
 *   secondaries the long row along the trailing edge of the arm
 *   primaries   the hand: long, separated, emarginated "fingers"
 *   alula       the thumb tuft at the wrist
 *
 * Each row is one geometry built from an array of shapes, so a row costs one
 * draw call, not one per feather.
 */
import { Shape } from 'three'

/** Where the elbow sits along the wing. The hand runs outward from there. */
export const ELBOW_X = 2.0

/**
 * The leading edge of the hand, in the hand's own chord coordinate.
 *
 * The hand twists about this line rather than about its middle. A manus that
 * feathers about mid-chord tears BOTH its edges away from the arm it hangs off;
 * pivoting on the leading edge leaves that edge welded to the arm and lifts only
 * the trailing edge, which is also what a real wing does.
 */
export const HAND_LEADING = -0.74

/** A single feather outline, pointing along +y, tapering to a point. */
export function featherOutline(length: number, width: number, sweep: number): Shape {
  const s = new Shape()
  const half = width / 2
  s.moveTo(0, 0)
  // Leading vane: widest a third of the way out, then tapering to the tip.
  s.quadraticCurveTo(half, length * 0.3, half * 0.62 + sweep * 0.3, length * 0.82)
  s.lineTo(sweep, length) // the point
  // Trailing vane, slightly fuller, which is what gives a feather its asymmetry.
  s.quadraticCurveTo(-half * 0.78 + sweep * 0.3, length * 0.8, -half, length * 0.28)
  s.closePath()
  return s
}

/** Place a feather outline at a position and angle in the wing plane. */
export function placeFeather(
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  sweep = 0,
): Shape {
  const base = featherOutline(length, width, sweep)
  const points = base.getPoints(14)
  const shape = new Shape()
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  points.forEach((p, i) => {
    const x = cx + p.x * cos - p.y * sin
    const y = cy + p.x * sin + p.y * cos
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()
  return shape
}

export type RowSpec = {
  count: number
  spanFrom: number
  spanTo: number
  chordFrom: number
  chordTo: number
  lengthFrom: number
  lengthTo: number
  width: number
  angleFrom: number
  angleTo: number
  sweep?: number
}

export function row(spec: RowSpec): Shape[] {
  const { count } = spec
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    const lerp = (a: number, b: number) => a + (b - a) * t
    return placeFeather(
      lerp(spec.spanFrom, spec.spanTo),
      lerp(spec.chordFrom, spec.chordTo),
      lerp(spec.lengthFrom, spec.lengthTo),
      spec.width,
      lerp(spec.angleFrom, spec.angleTo),
      spec.sweep ?? 0,
    )
  })
}

/** The arm: leading edge and shoulder only. The trailing edge is feathers. */
export function armShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.62)
  s.quadraticCurveTo(1.0, -0.82, 2.0, -0.74)
  s.lineTo(2.0, 0.12)
  s.quadraticCurveTo(1.0, 0.2, 0, 0.22)
  s.closePath()
  return s
}

/** The hand: a narrow spar the primaries grow from. */
export function handShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.74)
  s.quadraticCurveTo(1.0, -0.62, 1.9, -0.12)
  s.lineTo(1.85, 0.16)
  s.quadraticCurveTo(1.0, 0.16, 0, 0.18)
  s.closePath()
  return s
}

/** Secondaries: the long row forming the trailing edge of the arm. */
export const secondaries = (): Shape[] =>
  row({
    count: 11,
    spanFrom: 0.1,
    spanTo: 1.98,
    chordFrom: 0.1,
    chordTo: 0.06,
    lengthFrom: 1.02,
    lengthTo: 0.86,
    width: 0.3,
    angleFrom: 0.2,
    angleTo: -0.16,
    sweep: 0.05,
  })

/** Greater coverts: over the base of the secondaries. */
export const greaterCoverts = (): Shape[] =>
  row({
    count: 9,
    spanFrom: 0.16,
    spanTo: 1.9,
    chordFrom: -0.04,
    chordTo: -0.06,
    lengthFrom: 0.5,
    lengthTo: 0.42,
    width: 0.26,
    angleFrom: 0.2,
    angleTo: -0.12,
  })

/** Lesser coverts: the small feathers sheathing the leading edge itself. */
export const lesserCoverts = (): Shape[] =>
  row({
    count: 8,
    spanFrom: 0.2,
    spanTo: 1.85,
    chordFrom: -0.44,
    chordTo: -0.5,
    lengthFrom: 0.38,
    lengthTo: 0.3,
    width: 0.22,
    angleFrom: 0.35,
    angleTo: 0.05,
  })

/**
 * Primaries: the hand feathers. Long, well separated, and swept progressively
 * further back so the tip splays into the slotted "fingers" that soaring
 * raptors fly on.
 */
export const primaries = (): Shape[] =>
  row({
    count: 7,
    // In the HAND's own frame, spread along its outer half. The whole manus -
    // spar and feathers together - is one rigid piece, so no joint can pivot
    // between a quill and the bone it grows out of.
    spanFrom: 1.28,
    spanTo: 1.88,
    chordFrom: -0.1,
    chordTo: 0.12,
    lengthFrom: 1.62,
    lengthTo: 1.05,
    width: 0.26,
    angleFrom: 1.14,
    angleTo: 2.12,
    sweep: 0.16,
  })

/** The alula, the small thumb tuft on the leading edge of the wrist. */
export const alula = (): Shape[] =>
  row({
    count: 3,
    spanFrom: 1.36,
    spanTo: 1.64,
    chordFrom: -0.5,
    chordTo: -0.46,
    lengthFrom: 0.42,
    lengthTo: 0.32,
    width: 0.16,
    angleFrom: 1.5,
    angleTo: 1.9,
  })

/** Tail: twelve rectrices fanned, the way a buzzard spreads them to soar. */
export const tailFeathers = (): Shape[] =>
  row({
    count: 11,
    spanFrom: -0.5,
    spanTo: 0.5,
    chordFrom: 0,
    chordTo: 0,
    lengthFrom: 1.35,
    lengthTo: 1.35,
    width: 0.32,
    angleFrom: -0.5,
    angleTo: 0.5,
  })


/**
 * The rows as data, paired with the wing part each is rooted in, so the join can
 * be tested rather than eyeballed.
 */
export const WING_ROWS = [
  { name: 'secondaries', shapes: secondaries, parent: 'arm' },
  { name: 'greaterCoverts', shapes: greaterCoverts, parent: 'arm' },
  { name: 'lesserCoverts', shapes: lesserCoverts, parent: 'arm' },
  { name: 'primaries', shapes: primaries, parent: 'hand' },
  { name: 'alula', shapes: alula, parent: 'hand' },
] as const
