/**
 * Prey: what the talons are for.
 *
 * All of it lives on the ground or in the water, never in the air. That is the
 * whole point of the hunting loop - food is where the bird is least safe, so
 * every meal costs a descent, a slow pass and a climb back out. Nothing can be
 * collected by flying along at altitude.
 *
 * Siting and the catch rule are pure so the loop can be reasoned about without
 * a scene: what may be caught, what it costs to carry, and what it is worth.
 */
import { Vector3 } from 'three'
import { heightAt, jitter, meshHeightAt, moistureAt, slopeAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type PreyKind = 'mouse' | 'fish' | 'rabbit'

export type PreySpec = {
  /** Talon weight it takes up, against the bird's budget. */
  weight: number
  /** Food banked at the nest. */
  value: number
  /**
   * How close the talons have to be.
   *
   * Deliberately generous. Flown properly, the bird is descending at 12 m/s with
   * a chase camera and a hopping target; measured on a real pass, the talons got
   * no nearer than 4.7m even when lined up. A radius under that makes the catch
   * a matter of luck rather than of flying, and the skill is meant to be in
   * committing to the low slow pass at all - not in threading a two-metre eye.
   */
  grabRadius: number
}

/**
 * The risk/reward ladder. A rabbit is worth five mice but eats two thirds of
 * the talon budget and sits on open ground, which is where the bird has to slow
 * down, get low, and commit.
 */
export const PREY: Record<PreyKind, PreySpec> = {
  mouse: { weight: 1, value: 20, grabRadius: 4.0 },
  fish: { weight: 2, value: 45, grabRadius: 5.0 },
  rabbit: { weight: 4, value: 100, grabRadius: 4.5 },
}

export type Prey = {
  id: number
  kind: PreyKind
  /** Where it sits, on the surface. */
  pos: Vector3
  /** Radians, the direction it faces as it wanders. */
  heading: number
  /** Its own clock, so a field of them does not move in lockstep. */
  phase: number
  caught: boolean
}

/** Where prey of each kind is allowed to be. */
export function siteFor(x: number, z: number, seed: string): PreyKind | null {
  const ground = heightAt(x, z, seed)

  // Fish sit at the surface of open water, not on a puddle edge.
  if (ground < WORLD.waterLevel - 3) return 'fish'
  if (ground < WORLD.waterLevel + 1.5) return null // the shoreline itself: nothing

  // Land animals want ground they could actually stand on.
  if (slopeAt(x, z, seed) > 0.34) return null
  if (ground > 210) return null // above the treeline

  // Rabbits in the grass, mice nearer cover.
  return moistureAt(x, z, seed) > 0.05 ? 'mouse' : 'rabbit'
}

/** The surface a piece of prey rests on - the lake top, or the drawn ground. */
export function surfaceFor(kind: PreyKind, x: number, z: number, seed: string): number {
  if (kind === 'fish') return WORLD.waterLevel
  return meshHeightAt(x, z, seed, WORLD.lodSegments[0])
}

let nextId = 1

/**
 * Populate a ring around a point, skipping anywhere the ground says no.
 *
 * Deterministic in position for a given cell, so prey does not shimmer in and
 * out as the bird circles, but the pool itself is mutable - caught animals stay
 * caught.
 */
export function spawnPreyAround(
  centre: Vector3,
  seed: string,
  count: number,
  radius: number,
  minRadius = 0,
): Prey[] {
  const out: Prey[] = []
  const cell = 40
  for (let i = 0; i < count * 14 && out.length < count; i++) {
    // A deterministic scatter keyed on the cell the bird is in.
    const cx = Math.floor(centre.x / cell)
    const cz = Math.floor(centre.z / cell)
    const a = jitter(cx + i * 7.3, cz + i * 3.1, 11) * Math.PI * 2
    const r = minRadius + Math.sqrt(jitter(cx + i, cz - i, 12)) * (radius - minRadius)
    const x = centre.x + Math.cos(a) * r
    const z = centre.z + Math.sin(a) * r

    const kind = siteFor(x, z, seed)
    if (!kind) continue

    out.push({
      id: nextId++,
      kind,
      pos: new Vector3(x, surfaceFor(kind, x, z, seed), z),
      heading: jitter(x, z, 13) * Math.PI * 2,
      phase: jitter(x, z, 14) * Math.PI * 2,
      caught: false,
    })
  }
  return out
}

/**
 * Where the talons actually are, which is what has to reach the prey - not the
 * bird's centre. Roughly under the body and a little forward when thrown out.
 */
export function talonPoint(
  pos: Vector3,
  forward: Vector3,
  down: Vector3,
  talons: number,
  out = new Vector3(),
): Vector3 {
  return out
    .copy(pos)
    .addScaledVector(down, 0.5 + talons * 0.9)
    .addScaledVector(forward, talons * 0.7)
}

export type CatchAttempt = {
  talonPoint: Vector3
  /** 0 tucked, 1 thrown fully forward. */
  talons: number
  /** Talon weight already used. */
  load: number
  maxLoad: number
}

/**
 * Whether a given animal can be taken right now.
 *
 * The talons have to be OUT. That is the whole design of the control: the same
 * key that slows the bird down is the one that opens its feet, so taking prey
 * means committing to a slow, low pass rather than swatting things at cruise.
 */
export function canCatch(attempt: CatchAttempt, prey: Prey): boolean {
  if (prey.caught) return false
  if (attempt.talons < 0.55) return false
  const spec = PREY[prey.kind]
  if (attempt.load + spec.weight > attempt.maxLoad) return false
  return attempt.talonPoint.distanceTo(prey.pos) <= spec.grabRadius
}

/** Total talon weight of a set of animals. */
export function loadOf(carried: Prey[]): number {
  return carried.reduce((sum, p) => sum + PREY[p.kind].weight, 0)
}

/** Total food value of a set of animals. */
export function valueOf(carried: Prey[]): number {
  return carried.reduce((sum, p) => sum + PREY[p.kind].value, 0)
}

/**
 * Close enough to the nest to drop what the bird is carrying into it.
 *
 * Measured horizontally, with a separate and much larger allowance for height.
 * A straight distance check fails the obvious case: the nest is on a crag, so
 * the bird arrives over the top of it, and passing twenty metres overhead is a
 * delivery, not a miss.
 */
export function canBank(birdPos: Vector3, nestPos: Vector3): boolean {
  const horizontal = Math.hypot(birdPos.x - nestPos.x, birdPos.z - nestPos.z)
  if (horizontal > BANK_RADIUS) return false
  const above = birdPos.y - nestPos.y
  return above > -BANK_RADIUS && above < BANK_CEILING
}

/**
 * Generous on purpose: a pass over the nest banks the catch.
 *
 * Requiring a landing would make every trip end in the fiddliest manoeuvre in
 * the game, which is a poor reward for having just done the hard part.
 */
export const BANK_RADIUS = 22
/** How high overhead still counts as dropping it in. */
export const BANK_CEILING = 45
