/**
 * What kind of tree stands where, and what colour it is.
 *
 * A forest of one cone in one green reads as a texture rather than as trees: the
 * eye sees a field of identical marks and stops looking. Variety is what turns
 * it into somewhere. So the wood is mixed - spires and firs on the cold ground,
 * broadleaves and scrub in the warm wet hollows - with the colour drifting tree
 * by tree and the odd one turning for autumn.
 *
 * Pure, because the mix is a property of the WORLD rather than of the renderer:
 * the same ground grows the same wood every time it is visited.
 */
import { Color } from 'three'
import { jitter } from './terrain.ts'

export const TREE_KINDS = ['spire', 'fir', 'broadleaf', 'scrub'] as const
export type TreeKind = (typeof TREE_KINDS)[number]

export type TreeStyle = {
  kind: TreeKind
  /** Multiplier on the whole tree. */
  scale: number
  /** Foliage colour, already mixed. */
  color: Color
}

/**
 * Foliage palettes, from shade to sun. Each tree lands somewhere between the
 * two, so no two neighbours are quite the same green.
 */
const FOLIAGE: Record<TreeKind, [string, string]> = {
  spire: ['#1f3a20', '#2f5233'],
  fir: ['#264424', '#3d6236'],
  broadleaf: ['#3f7333', '#84ab52'],
  scrub: ['#4d6b33', '#8b9c4a'],
}

/** The turning colour, mixed into the few trees that have gone over. */
const AUTUMN = new Color('#c9a03a')

/** Height above which broadleaves give up and it is all conifer. */
const CONIFER_LINE = 118
/** Height below which the wood thins into scrub. */
const SCRUB_LINE = 14

const scratch = new Color()
const shade = new Color()

export function treeStyle(x: number, z: number, h: number, moisture: number): TreeStyle {
  const draw = jitter(x, z, 41)
  const warmth = moisture + (CONIFER_LINE - h) / 260

  let kind: TreeKind
  if (h < SCRUB_LINE) kind = draw < 0.42 ? 'scrub' : 'broadleaf'
  else if (warmth > 0.45) kind = draw < 0.62 ? 'broadleaf' : draw < 0.9 ? 'fir' : 'scrub'
  else if (warmth > 0.1) kind = draw < 0.45 ? 'fir' : draw < 0.8 ? 'broadleaf' : 'spire'
  else kind = draw < 0.55 ? 'spire' : draw < 0.95 ? 'fir' : 'scrub'

  const [dark, light] = FOLIAGE[kind]
  const mix = jitter(x, z, 42)
  const color = shade.set(dark).lerp(scratch.set(light), mix).clone()

  // A few have turned. Rare, and much likelier on the broadleaves, because a
  // whole hillside of autumn reads as dead ground rather than as a season.
  const turning = jitter(x, z, 43)
  const chance = kind === 'broadleaf' ? 0.16 : kind === 'scrub' ? 0.1 : 0.02
  if (turning < chance) color.lerp(AUTUMN, 0.35 + (turning / chance) * 0.4)

  // Scrub is small, spires are tall, and every tree is a little different again.
  // The whole range sits higher than it did: seen from a bird at cruising height
  // a tree under about eight metres is a dot, and a wood of dots is moss.
  const base = kind === 'scrub' ? 0.62 : kind === 'spire' ? 1.2 : 1.05
  return { kind, scale: base * (0.85 + jitter(x, z, 44) * 0.6), color }
}
