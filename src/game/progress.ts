/**
 * How much of the world is awake, and remembering it between visits.
 *
 * Playtested, everything hostile arriving at once after the first catch was too
 * much - even for an adult. So the valley wakes up a piece at a time, each piece
 * unlocked by food banked at the nest: first the world is peaceful, then crows,
 * then one slow rival, then the rival nests, then the full fight. Each step is
 * something the previous one has already taught the player to handle.
 */
import { RIVAL, type Pace } from '../entities/rivals.ts'

export type Stage = {
  /** 1 to 5, for the HUD. */
  number: number
  /** Animals banked to reach it. */
  from: number
  crows: boolean
  /** Most rivals in the air at once. */
  rivals: number
  pace: Pace
  /** Rival nests exist: drawn, stocked, pointed at, and defended. */
  nests: boolean
  /** Wandering rivals may turn up with food to steal. */
  carriers: boolean
  /** What to tell the player when this stage opens, if anything. */
  news: string | null
}

/** Slower than the player's cruise of 26, so running away works. */
const GENTLE: Pace = { cruise: 23, diveSpeed: 34 }

export const STAGES: readonly Stage[] = [
  { number: 1, from: 0, crows: false, rivals: 0, pace: GENTLE, nests: false, carriers: false, news: null },
  {
    number: 2,
    from: 1,
    crows: true,
    rivals: 0,
    pace: GENTLE,
    nests: false,
    carriers: false,
    news: 'crows guard their patch - dive away, or swat one with your talons',
  },
  {
    number: 3,
    from: 3,
    crows: true,
    rivals: 1,
    pace: GENTLE,
    nests: false,
    carriers: false,
    news: 'a rival hawk hunts here - climb above it, then dive with your talons out',
  },
  {
    number: 4,
    from: 6,
    crows: true,
    rivals: 1,
    pace: GENTLE,
    nests: true,
    carriers: true,
    news: 'rival nests - raid their food, and dive on rivals carrying some',
  },
  {
    number: 5,
    from: 10,
    crows: true,
    rivals: 2,
    pace: RIVAL,
    nests: true,
    carriers: true,
    news: 'the whole valley is awake - rivals hunt in pairs and fly faster',
  },
]

export function stageFor(bankedCount: number): Stage {
  let stage = STAGES[0]
  for (const s of STAGES) if (bankedCount >= s.from) stage = s
  return stage
}

// --- Saved progress --------------------------------------------------------------

export type Progress = { banked: number; bankedCount: number }

const KEY = 'raptor.progress'

/** Anything unreadable - missing, corrupted, from another version - is a fresh start. */
export function parseProgress(raw: string | null): Progress {
  try {
    const data = JSON.parse(raw ?? '')
    const banked = Number(data?.banked)
    const bankedCount = Number(data?.bankedCount)
    if (Number.isFinite(banked) && Number.isFinite(bankedCount) && banked >= 0 && bankedCount >= 0) {
      return { banked: Math.floor(banked), bankedCount: Math.floor(bankedCount) }
    }
  } catch {
    // Fall through to a fresh start.
  }
  return { banked: 0, bankedCount: 0 }
}

export function loadProgress(): Progress {
  // Outside a browser - the tests - there is nothing saved, and touching Node's
  // own localStorage prints a warning.
  if (typeof window === 'undefined') return { banked: 0, bankedCount: 0 }
  try {
    return parseProgress(localStorage.getItem(KEY))
  } catch {
    return { banked: 0, bankedCount: 0 }
  }
}

export function saveProgress(progress: Progress): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Not remembered, but the game carries on.
  }
}
