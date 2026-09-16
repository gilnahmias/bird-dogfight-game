/**
 * The other raptors in the valley.
 *
 * Three of them, and they are different BIRDS rather than three colours of the
 * same one: a small quick falcon, a buzzard about the player's size, and a big
 * slow eagle. What they share is the flight model and the rule, so a bigger bird
 * is not a harder bird - it is a bird that is easier to see coming.
 *
 * Pure data, keyed off the rival's id, so the same rival keeps the same feathers
 * for as long as it is in the sky.
 */
export type RivalKind = {
  name: string
  /** Multiplier on the whole bird. */
  scale: number
  palette: {
    feather: string
    featherMid: string
    featherDark: string
    featherLight: string
    belly: string
  }
}

export const RIVAL_KINDS: RivalKind[] = [
  {
    name: 'falcon',
    scale: 0.78,
    palette: {
      feather: '#4f5a6b',
      featherMid: '#3f4858',
      featherDark: '#262d3a',
      featherLight: '#7d8798',
      belly: '#d6d3c4',
    },
  },
  {
    name: 'buzzard',
    scale: 1,
    palette: {
      feather: '#6a4a33',
      featherMid: '#573b28',
      featherDark: '#35231a',
      featherLight: '#a98a5f',
      belly: '#c9b9a0',
    },
  },
  {
    name: 'eagle',
    scale: 1.28,
    palette: {
      feather: '#3f3428',
      featherMid: '#33291f',
      featherDark: '#1f1913',
      featherLight: '#6d5b42',
      belly: '#8d7a5e',
    },
  },
]

/** Which bird a rival is. Stable for a given rival. */
export function kindOf(id: number): RivalKind {
  return RIVAL_KINDS[Math.abs(id) % RIVAL_KINDS.length]
}
