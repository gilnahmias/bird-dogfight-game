/**
 * What the player gets to hear, and when.
 *
 * The sounds themselves are synthesized in engine.ts; this is the part that
 * decides, and it is pure so it can be tested. A rival should announce itself
 * once when it comes into the picture, call again while it is close, and scream
 * the moment it commits to a dive - the dive is the one sound that has to be
 * impossible to miss, because it is the warning that makes the fight fair.
 */
import type { Vector3 } from 'three'
import type { RivalMode } from '../entities/rivals.ts'
import type { Mobber } from '../entities/flocks.ts'
import type { Waterfall } from '../world/waterfalls.ts'

/**
 * The live things in the world that make a noise.
 *
 * Handed over by reference from the components that own them - one assignment a
 * frame, or when their list changes - so the audio never has to reach into
 * React state and the entities never have to know audio exists.
 */
export const audible: {
  rivals: readonly { id: number; pos: Vector3; mode: RivalMode; dead: boolean; kind: number }[]
  crows: readonly Mobber[]
  falls: readonly Waterfall[]
} = { rivals: [], crows: [], falls: [] }

/** A rival inside this range has "come into the picture". Fog starts at about here. */
export const NOTICE_RANGE = 650
/** Heard again only after going this far away, so one rival at the edge cannot nag. */
export const FORGET_RANGE = 900
/** Close enough that it keeps calling. */
export const CLOSE_RANGE = 260
/** Seconds between calls while close. */
export const CALL_EVERY = 7
/** A dive scream is heard from further than a call is repeated. */
export const DIVE_RANGE = 700

/** What the player remembers about one rival. */
export type Ear = { heard: boolean; last: number; mode: RivalMode }

export function newEar(mode: RivalMode): Ear {
  return { heard: false, last: -Infinity, mode }
}

export type Call = 'none' | 'call' | 'dive'

/** Whether this rival makes a sound this frame. Updates the memory in place. */
export function rivalCall(
  ear: Ear,
  rival: { mode: RivalMode; dead: boolean },
  distance: number,
  now: number,
): Call {
  const was = ear.mode
  ear.mode = rival.mode
  if (rival.dead) return 'none'

  if (distance > FORGET_RANGE) ear.heard = false

  if (rival.mode === 'commit' && was !== 'commit' && distance < DIVE_RANGE) {
    ear.heard = true
    ear.last = now
    return 'dive'
  }
  if (!ear.heard && distance < NOTICE_RANGE) {
    ear.heard = true
    ear.last = now
    return 'call'
  }
  if (ear.heard && distance < CLOSE_RANGE && now - ear.last > CALL_EVERY) {
    ear.last = now
    return 'call'
  }
  return 'none'
}

/**
 * Loudness of the wind past the bird, 0 to 1.
 *
 * Silent at a standstill, a hush at cruise, a roar in a dive - the dive is where
 * speed is the whole point, and it should sound like it.
 */
export function windLevel(airspeed: number, perched: boolean): number {
  if (perched) return 0
  const t = Math.max(0, airspeed - 8) / 52
  return Math.min(1, t * t * 0.8 + t * 0.2)
}

/** Midpoint of a fall, where its sound comes from. */
export function fallSource(fall: Waterfall, out: Vector3): Vector3 {
  return out.copy(fall.top).add(fall.base).multiplyScalar(0.5)
}
