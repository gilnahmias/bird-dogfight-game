/**
 * Rival nests: where the other raptors live, and where their food is.
 *
 * Placed the way the tarns are - one candidate per large cell of the world,
 * deterministic, and asked for around wherever the bird happens to be - rather
 * than searched for once at startup. The lakes were done the startup way first,
 * and every lake further than the first search was dry; nests do not get to
 * repeat that.
 *
 * The food in a nest is ordinary prey that does not move. That is deliberate:
 * raiding a nest is the catch the player already knows - talons out, low pass,
 * carry it home - aimed at a tree instead of a field.
 */
import { Vector3 } from 'three'
import { type NestSite, NEST_TREE_HEIGHT } from '../world/nest.ts'
import { jitter, meshGapAt, meshHeightAt, slopeAt, tarnPoolAt, heightAt } from '../world/terrain.ts'
import type { Prey, PreyKind } from '../world/prey.ts'
import { WORLD } from '../game/constants.ts'
import { RIVAL_KINDS } from './rivalKinds.ts'

/**
 * One nest per cell of this size, at most.
 *
 * At eleven hundred metres the nearest rival nest to the player's could be two
 * kilometres out, which is a long way to go for a first raid.
 */
const NEST_CELL = 800
/** Rivals do not build on the player's doorstep. */
export const MIN_FROM_HOME = 700
/** Food items a full nest holds. */
export const FOOD_PER_NEST = 3
/** Seconds before a raided slot has food in it again. */
export const RESTOCK_SECONDS = 90

export type RivalNest = {
  id: number
  /** Shaped like the player's nest site, so it can be drawn by the same code. */
  site: NestSite
  /** Centre of the bowl, up in the crown. */
  bowl: Vector3
  /** Which rival lives here: an index into RIVAL_KINDS. */
  kind: number
}

/** What each slot in a nest holds. Big prey, mostly: a raid should be worth it. */
const LARDER: PreyKind[] = ['rabbit', 'fish', 'snake', 'rabbit', 'fish']

const cache = new Map<string, RivalNest | null>()

/**
 * The nest for one cell of the world, or null if the cell has nowhere to put
 * one. `home` is the player's nest, which rivals keep their distance from.
 */
export function rivalNestAt(
  cellX: number,
  cellZ: number,
  seed: string,
  home: Vector3,
): RivalNest | null {
  const key = `${seed}:${cellX}:${cellZ}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let best: Spot | null = null
  for (let i = 0; i < 10; i++) {
    const x = (cellX + 0.15 + jitter(cellX + i * 11, cellZ, 81) * 0.7) * NEST_CELL
    const z = (cellZ + 0.15 + jitter(cellZ, cellX + i * 7, 82) * 0.7) * NEST_CELL
    const spot = judge(x, z, seed, home)
    if (spot && (!best || spot.score > best.score)) best = spot
  }

  const id = Math.abs(cellX * 7919 + cellZ * 104729) % 100000 + 1
  let nest = best ? build(best, id, jitter(cellX, cellZ, 83), seed) : null
  // Leave room for the guaranteed nest near home rather than crowding it.
  if (nest) {
    const near = homeNest(seed, home)
    if (near && near.bowl.distanceTo(nest.bowl) < 400) nest = null
  }
  cache.set(key, nest)
  return nest
}

type Spot = { x: number; z: number; h: number; score: number }

/** Whether a tree can hold a nest here, and how commanding the spot is. */
function judge(x: number, z: number, seed: string, home: Vector3): Spot | null {
  if (Math.hypot(x - home.x, z - home.z) < MIN_FROM_HOME) return null
  const h = heightAt(x, z, seed)
  // Where a tree can stand: dry land, below the snow, not a cliff, not a lake,
  // and where the drawn ground agrees with the height field - otherwise the tree
  // floats, which is the bug the player's own nest had first.
  if (h < 45 || h > 200) return null
  if (slopeAt(x, z, seed) > 0.22) return null
  if (tarnPoolAt(x, z, seed) !== null) return null
  if (Math.abs(meshGapAt(x, z, seed)) > 3) return null
  // A commanding spot: higher than its surroundings.
  let around = 0
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    around += heightAt(x + Math.cos(a) * 120, z + Math.sin(a) * 120, seed)
  }
  return { x, z, h, score: h - around / 6 }
}

function build(spot: Spot, id: number, pick: number, seed: string): RivalNest {
  const foot = Math.min(spot.h, meshHeightAt(spot.x, spot.z, seed, WORLD.lodSegments[0])) - 0.4
  return {
    id,
    site: {
      pos: new Vector3(spot.x, foot, spot.z),
      heading: 0,
      clearance: 0,
      edgeDrop: 0,
      edgeAngle: 0,
      treeHeight: NEST_TREE_HEIGHT,
    },
    bowl: new Vector3(spot.x, foot + NEST_TREE_HEIGHT + 0.6, spot.z),
    kind: Math.floor(pick * RIVAL_KINDS.length) % RIVAL_KINDS.length,
  }
}

const homeCache = new Map<string, RivalNest | null>()

/**
 * The one nest every world has within reach of home.
 *
 * The cells alone leave gaps wherever their grid happens to fall: with the same
 * spacing, one world's nearest rival nest was a kilometre from home and
 * another's nearly two. A first raid should not depend on where a grid line
 * lands, so the ring just beyond the player's own territory always gets the
 * best spot in it.
 */
function homeNest(seed: string, home: Vector3): RivalNest | null {
  const key = `${seed}:${home.x.toFixed(0)}:${home.z.toFixed(0)}`
  const hit = homeCache.get(key)
  if (hit !== undefined) return hit
  let best: Spot | null = null
  for (let r = HOME_RING[0]; r <= HOME_RING[1]; r += 90) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      const spot = judge(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, seed, home)
      if (spot && (!best || spot.score > best.score)) best = spot
    }
  }
  const nest = best ? build(best, 0, jitter(home.x, home.z, 84), seed) : null
  homeCache.set(key, nest)
  return nest
}

/** Where the guaranteed nest goes: out of the player's territory, not far out. */
const HOME_RING = [850, 1400]

/** Every rival nest within `radius` of a point, nearest first. */
export function rivalNestsNear(
  x: number,
  z: number,
  radius: number,
  seed: string,
  home: Vector3,
): RivalNest[] {
  const cells = Math.ceil(radius / NEST_CELL) + 1
  const cx = Math.floor(x / NEST_CELL)
  const cz = Math.floor(z / NEST_CELL)
  const found: RivalNest[] = []
  const near = homeNest(seed, home)
  if (near && Math.hypot(near.bowl.x - x, near.bowl.z - z) <= radius) found.push(near)
  for (let dz = -cells; dz <= cells; dz++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const nest = rivalNestAt(cx + dx, cz + dz, seed, home)
      if (nest && Math.hypot(nest.bowl.x - x, nest.bowl.z - z) <= radius) found.push(nest)
    }
  }
  found.sort((a, b) => Math.hypot(a.bowl.x - x, a.bowl.z - z) - Math.hypot(b.bowl.x - x, b.bowl.z - z))
  return found
}

/**
 * When each slot was last raided, in seconds of game time.
 *
 * Module-level on purpose: the nests are streamed in and out as the bird moves,
 * and a raid has to be remembered when the nest comes back - otherwise flying
 * away and returning would refill it instantly.
 */
const raidedAt = new Map<number, number>()

/** The id a slot's food always has. Negative, and clear of the stocked fish. */
export function foodId(nest: RivalNest, slot: number): number {
  return -1_000_000_000 - nest.id * 10 - slot
}

export function markRaided(id: number, now: number): void {
  raidedAt.set(id, now)
}

/** Forget every raid. For tests. */
export function resetRaids(): void {
  raidedAt.clear()
}

/**
 * The food sitting in a nest right now, as still prey in the bowl. Slots raided
 * less than RESTOCK_SECONDS ago are empty.
 */
export function nestFood(nest: RivalNest, now: number): Prey[] {
  const out: Prey[] = []
  for (let slot = 0; slot < FOOD_PER_NEST; slot++) {
    const id = foodId(nest, slot)
    const raided = raidedAt.get(id)
    if (raided !== undefined && now - raided < RESTOCK_SECONDS) continue
    const a = (slot / FOOD_PER_NEST) * Math.PI * 2 + nest.id
    out.push({
      id,
      kind: LARDER[(nest.id + slot) % LARDER.length],
      pos: new Vector3(nest.bowl.x + Math.cos(a) * 0.9, nest.bowl.y, nest.bowl.z + Math.sin(a) * 0.9),
      heading: a,
      phase: a,
      caught: false,
      still: true,
      nest: nest.id,
    })
  }
  return out
}
