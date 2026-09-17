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
import {
  heightAt,
  jitter,
  meshHeightAt,
  moistureAt,
  slopeAt,
  TARN_RADIUS,
  tarnPoolAt,
  tarnSitesNear,
} from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type PreyKind = 'mouse' | 'fish' | 'snake' | 'rabbit'

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
  // A snake moves, which makes it a target you have to lead rather than one you
  // can simply fall on. Worth more than a fish for that, and a shade more
  // forgiving to grab, because the body you are aiming at is long.
  snake: { weight: 3, value: 70, grabRadius: 5.0 },
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
  /**
   * Food rather than a live animal: something already killed and left in a
   * rival's nest, or dropped in a fight. It does not move and does not hop.
   */
  still?: boolean
  /** The rival nest it was taken from, if any - so the nest knows it is gone. */
  nest?: number
}

/** Highest ground a land animal lives on: above it is bare rock and snow. */
const TREELINE = 210
/** Steepest ground an animal can stand or move on. */
const FOOTHOLD = 0.34

/**
 * Whether a land animal can be at a point: dry, not a cliff, not up in the snow.
 *
 * Shared by where animals are PUT and where they may GO, so a moving snake can
 * never wander somewhere it could not have been born - into a tarn, off a cliff,
 * or down onto the beach.
 */
export function standable(x: number, z: number, seed: string): boolean {
  const ground = heightAt(x, z, seed)
  if (ground < WORLD.waterLevel + 1.5 || ground > TREELINE) return false
  if (tarnPoolAt(x, z, seed) !== null) return false
  return slopeAt(x, z, seed) <= FOOTHOLD
}

/** Where prey of each kind is allowed to be. */
export function siteFor(x: number, z: number, seed: string): PreyKind | null {
  const ground = heightAt(x, z, seed)

  // Mountain tarns hold fish too. Without this the lakes the world goes to the
  // trouble of carving are scenery, and every fishing pass happens at sea level.
  const pool = tarnPoolAt(x, z, seed)
  if (pool !== null && pool - ground > 2) return 'fish'

  // Fish sit at the surface of open water, not on a puddle edge.
  if (ground < WORLD.waterLevel - 3) return 'fish'
  if (!standable(x, z, seed)) return null

  /*
    Rabbits are the default on open ground; mice only in the wettest cover, and
    snakes on warm, dry, broken slopes.

    Mice used to take everything wetter than the middle of the moisture range,
    which in these hills is most of the land: measured, a nest could have as few
    as four rabbits within four hundred metres. Rabbits are the animal the player
    goes looking for.
  */
  const moisture = moistureAt(x, z, seed)
  if (moisture > 0.26) return 'mouse'
  if (moisture < 0.05 && slopeAt(x, z, seed) > 0.1 && jitter(x, z, 31) < 0.4) return 'snake'
  return 'rabbit'
}

/** The surface a piece of prey rests on - the lake top, or the drawn ground. */
export function surfaceFor(kind: PreyKind, x: number, z: number, seed: string): number {
  if (kind === 'fish') return tarnPoolAt(x, z, seed) ?? WORLD.waterLevel
  return meshHeightAt(x, z, seed, WORLD.lodSegments[0])
}

let nextId = 1

/** Most of the animal pool the open sea may take. */
const SEA_SHARE = 0.2

/** How many fish each mountain tarn holds. */
const FISH_PER_TARN = 4
/** How far out tarns are stocked. */
const STOCK_RANGE = 900

/**
 * Stock a mountain lake with fish.
 *
 * Scattering prey at random over a six hundred metre circle and hoping some of
 * it lands in a hundred metre pool does not work: measured, the pool fills up
 * with land animals long before the scatter ever tries the water, and the player
 * flew to a lake and found it empty. A lake has fish in it because it is a lake.
 *
 * Ids are derived from the tarn rather than counted, so the same fish is the
 * same fish every time the field is topped up - otherwise every pass over a lake
 * would stack a fresh shoal on top of the last one.
 */
function stockTarn(tarn: { x: number; z: number; level: number }, seed: string): Prey[] {
  const out: Prey[] = []
  for (let i = 0; i < FISH_PER_TARN; i++) {
    const a = jitter(tarn.x + i * 5.7, tarn.z, 21) * Math.PI * 2
    // Square-rooted so they spread over the pool rather than crowding the middle.
    const r = Math.sqrt(jitter(tarn.x, tarn.z + i * 3.3, 22)) * TARN_RADIUS * 0.62
    const x = tarn.x + Math.cos(a) * r
    const z = tarn.z + Math.sin(a) * r
    // Only where there is really water: the rim of the basin is dry ground.
    if (heightAt(x, z, seed) > tarn.level - 1) continue
    out.push({
      id: -Math.abs(Math.round(tarn.x * 31 + tarn.z * 17) * 8 + i) - 1,
      kind: 'fish',
      pos: new Vector3(x, tarn.level, z),
      heading: jitter(x, z, 23) * Math.PI * 2,
      phase: jitter(x, z, 24) * Math.PI * 2,
      caught: false,
    })
  }
  return out
}

/** Every fish that belongs in the lakes around a point. */
export function stockedFish(centre: Vector3, seed: string, radius = STOCK_RANGE): Prey[] {
  return tarnSitesNear(centre.x, centre.z, radius, seed).flatMap((tarn) => stockTarn(tarn, seed))
}

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
  /*
    The sea may only have a share of the pool.

    It is seventy percent of the land around the nest, so a scatter that takes
    whatever it lands on fills a third of the pool with fish offshore - and the
    rabbits the player actually goes looking for are what gets squeezed out.
  */
  const seaQuota = Math.floor(count * SEA_SHARE)
  let seaFish = 0
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
    if (kind === 'fish' && tarnPoolAt(x, z, seed) === null) {
      if (seaFish >= seaQuota) continue
      seaFish++
    }

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
  const reach = spec.grabRadius + (prey.nest !== undefined ? NEST_GRAB_BONUS : 0)
  return attempt.talonPoint.distanceTo(prey.pos) <= reach
}

/**
 * Extra reach for food sitting in a rival's nest.
 *
 * The bowl is five metres across in the crown of a tree, and a bird braking to
 * take something sinks as it slows: measured on a raid pass, the bird sank below
 * the bowl eight metres short of the food. Anything in the bowl counts as in
 * the bowl - the skill is in finding the nest and getting to it, not in
 * threading a rabbit-sized gap at the top of a tree.
 */
export const NEST_GRAB_BONUS = 3.5

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

// --- Movement --------------------------------------------------------------

/**
 * How the animals that move, move.
 *
 * Slow on purpose. The player is a ten year old flying a bird at twenty-five
 * metres a second; a target that moves is more fun than one that sits, but one
 * that outruns a braking raptor is not a target at all.
 */
export const GAIT = {
  snake: {
    /** Metres a second along the ground. */
    speed: 1.6,
    /** How hard the path meanders, radians a second at the peak of a swing. */
    meander: 0.9,
  },
  rabbit: {
    /** Metres a second during a hop. */
    speed: 3.4,
    /** Seconds in the air, and seconds sat still, per hop. */
    hop: 0.34,
    rest: 1.5,
    /** Height of a hop at its top. */
    height: 0.55,
  },
} as const

/** Where a rabbit is in its hop: 0 on the ground, up to 1 at the top of a hop. */
export function hopLift(prey: Prey, time: number): number {
  const cycle = GAIT.rabbit.hop + GAIT.rabbit.rest
  const t = (time + prey.phase) % cycle
  if (t > GAIT.rabbit.hop) return 0
  return Math.sin((t / GAIT.rabbit.hop) * Math.PI)
}

const ahead = new Vector3()

/**
 * Move an animal for one frame. Mutates `prey.pos` and `prey.heading`.
 *
 * Only snakes and rabbits move; everything else is left alone. Movement never
 * takes an animal anywhere `standable` refuses - blocked, it turns away instead,
 * which is also what makes a snake read as a snake: it follows the ground rather
 * than a straight line.
 */
export function stepPrey(prey: Prey, dt: number, time: number, seed: string): Prey {
  if (prey.caught || prey.still) return prey

  let speed = 0
  if (prey.kind === 'snake') {
    // A slow, smooth meander: two sine swings at unrelated rates, so no two
    // snakes and no two minutes of the same snake follow the same path.
    const swing = Math.sin(time * 0.45 + prey.phase) + 0.5 * Math.sin(time * 1.3 + prey.phase * 2)
    prey.heading += swing * GAIT.snake.meander * dt
    speed = GAIT.snake.speed
  } else if (prey.kind === 'rabbit') {
    if (hopLift(prey, time) <= 0) {
      // Between hops it may change its mind about where it is going.
      const cycle = GAIT.rabbit.hop + GAIT.rabbit.rest
      const hopIndex = Math.floor((time + prey.phase) / cycle)
      prey.heading = prey.phase * 3 + hopIndex * 1.7 + Math.sin(hopIndex * 2.3 + prey.phase) * 1.2
      return prey
    }
    speed = GAIT.rabbit.speed
  } else {
    return prey
  }

  // Forward is -Z in model space, the same way as every other animal here.
  ahead.set(
    prey.pos.x - Math.sin(prey.heading) * speed * dt,
    0,
    prey.pos.z - Math.cos(prey.heading) * speed * dt,
  )
  if (!standable(ahead.x, ahead.z, seed)) {
    // Blocked: turn away and try again next frame rather than stepping into it.
    prey.heading += Math.PI * 0.55
    return prey
  }
  prey.pos.x = ahead.x
  prey.pos.z = ahead.z
  prey.pos.y = meshHeightAt(ahead.x, ahead.z, seed, WORLD.lodSegments[0])
  return prey
}

/**
 * A piece of food that did not come from the scatter: dropped by a rival, taken
 * from a nest. Counted ids, like the scatter's, so it never collides with a
 * stocked animal's derived one.
 */
export function makeFood(kind: PreyKind, at: Vector3): Prey {
  return {
    id: nextId++,
    kind,
    pos: at.clone(),
    heading: jitter(at.x, at.z, 51) * Math.PI * 2,
    phase: jitter(at.x, at.z, 52) * Math.PI * 2,
    caught: false,
    still: true,
  }
}
