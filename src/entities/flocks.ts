/**
 * The other birds: the ones that are just there, and the crows.
 *
 * A sky with only raptors in it is empty between fights. Flocks are the life of
 * the place - gulls working the shoreline, crows over the woods, swallows
 * skimming the meadows - and they cost almost nothing, because a flock member
 * has no state at all: where it is is a function of the time.
 *
 * Crows are the exception. Fly near their flock and a few break off and mob
 * you, the way real crows mob a hawk. Deliberately forgiving: a peck costs a
 * little speed and a shove, never the catch and never the run, and you can shake
 * them by diving away or knock one out of the air.
 */
import { Vector3 } from 'three'
import { heightAt, jitter } from '../world/terrain.ts'
import { WORLD } from '../game/constants.ts'

export type FlockKind = 'gull' | 'crow' | 'swallow'

export type Flock = {
  id: number
  kind: FlockKind
  centre: Vector3
  size: number
}

/** How far above the ground a flock bird always stays. */
const CLEAR_OF_GROUND = 8

/** One flock per cell of this size, where the ground suits one. */
const FLOCK_CELL = 520

export const FLOCK_STYLE: Record<
  FlockKind,
  { members: [number, number]; radius: number; above: number; speed: number; flap: number; scale: number }
> = {
  // Wide lazy circles high over the water, barely flapping.
  gull: { members: [5, 9], radius: 70, above: 45, speed: 11, flap: 2.2, scale: 1.1 },
  // A loose, busier knot over the trees.
  crow: { members: [6, 10], radius: 45, above: 35, speed: 13, flap: 4.5, scale: 1.05 },
  // Fast, low, tight turns over open grass.
  swallow: { members: [7, 12], radius: 30, above: 12, speed: 17, flap: 9, scale: 0.45 },
}

const cache = new Map<string, Flock | null>()

export function flockAt(cellX: number, cellZ: number, seed: string): Flock | null {
  const key = `${seed}:${cellX}:${cellZ}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let flock: Flock | null = null
  // Not every cell has birds: a sky with a flock every five hundred metres is a
  // cloud of flies.
  if (jitter(cellX, cellZ, 91) < 0.55) {
    const x = (cellX + 0.2 + jitter(cellX, cellZ, 92) * 0.6) * FLOCK_CELL
    const z = (cellZ + 0.2 + jitter(cellZ, cellX, 93) * 0.6) * FLOCK_CELL
    const ground = heightAt(x, z, seed)
    const kind: FlockKind =
      ground < WORLD.waterLevel + 4 ? 'gull' : ground < 70 && jitter(cellX, cellZ, 94) < 0.5 ? 'swallow' : 'crow'
    if (ground < 220) {
      const [lo, hi] = FLOCK_STYLE[kind].members
      flock = {
        id: Math.abs(cellX * 92821 + cellZ * 68917) % 100000,
        kind,
        centre: new Vector3(x, Math.max(ground, WORLD.waterLevel) + FLOCK_STYLE[kind].above, z),
        size: lo + Math.floor(jitter(cellZ, cellX, 95) * (hi - lo + 1)),
      }
    }
  }
  cache.set(key, flock)
  return flock
}

export function flocksNear(x: number, z: number, radius: number, seed: string): Flock[] {
  const cells = Math.ceil(radius / FLOCK_CELL) + 1
  const cx = Math.floor(x / FLOCK_CELL)
  const cz = Math.floor(z / FLOCK_CELL)
  const out: Flock[] = []
  for (let dz = -cells; dz <= cells; dz++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const f = flockAt(cx + dx, cz + dz, seed)
      if (f && Math.hypot(f.centre.x - x, f.centre.z - z) <= radius) out.push(f)
    }
  }
  return out
}

/**
 * Where member `i` of a flock is at a given time, and which way it faces.
 *
 * Each bird circles the flock centre on its own radius, height and pace, with a
 * slow wobble in all three, so the flock mills about rather than rotating as a
 * rigid wheel. Pure function of time: nothing to store, nothing to step.
 */
export function memberAt(
  flock: Flock,
  i: number,
  time: number,
  out: { pos: Vector3; heading: number; flap: number },
  seed: string,
): void {
  const style = FLOCK_STYLE[flock.kind]
  const seedA = jitter(flock.id + i * 13, i, 96)
  const seedB = jitter(i, flock.id + i * 7, 97)
  const radius = style.radius * (0.45 + seedA * 0.75)
  const pace = (style.speed / radius) * (0.8 + seedB * 0.4) * (seedA < 0.5 ? 1 : -1)
  const angle = time * pace + seedB * Math.PI * 2
  const wobble = Math.sin(time * 0.37 + i) * radius * 0.25
  out.pos.set(
    flock.centre.x + Math.cos(angle) * (radius + wobble),
    flock.centre.y + Math.sin(time * 0.6 + seedA * 9) * style.above * 0.25 + (seedB - 0.5) * 10,
    flock.centre.z + Math.sin(angle) * (radius + wobble),
  )
  // The circle is flat and the hills are not: a bird whose loop crosses a rise
  // would fly through it. Kept a few metres clear of whatever is below.
  const floor = Math.max(heightAt(out.pos.x, out.pos.z, seed), WORLD.waterLevel) + CLEAR_OF_GROUND
  if (out.pos.y < floor) out.pos.y = floor
  // Facing along the circle: the tangent, in the direction of travel.
  out.heading = Math.atan2(-Math.sin(angle) * Math.sign(pace), Math.cos(angle) * Math.sign(pace)) - Math.PI / 2
  out.flap = Math.sin(time * style.flap + seedA * 20)
}

// --- Mobbing -----------------------------------------------------------------

export const MOB = {
  /** Fly this close to a crow flock and some of them come for you. */
  range: 170,
  /** How many at once. */
  size: 3,
  /**
   * How long they keep at it before losing interest.
   *
   * Short: flying straight through a mob and ignoring it cost nine pecks in
   * eleven seconds, which is the crows winning an argument they should only
   * be starting.
   */
  seconds: 8,
  /** Seconds before the same flock will mob again. */
  rest: 25,
  /**
   * Their chase speed: faster than a cruising raptor, which is what makes them a
   * nuisance - and slower than one diving hard, which is the escape.
   *
   * At thirty, barely faster than a cruise of twenty-six, a crow starting any
   * distance behind never caught up before it lost interest, and the mobbing
   * never happened.
   */
  speed: 33,
  /** How close a crow has to get to peck. */
  peckRange: 4.5,
  /**
   * Seconds between pecks from the same crow.
   *
   * At 1.8 three crows landed nine pecks in ten seconds on a bird flying
   * straight through them - a nag rather than a nuisance.
   */
  peckEvery: 3,
  /** Speed the bird keeps after a peck. */
  peckKeep: 0.88,
  /**
   * Fall this far behind and the crow gives up.
   *
   * Well past the range they notice you from. It used to be inside it, so a
   * mob that started at the edge of its range was already too far away and
   * quit on its first frame - measured, not one peck in a pass straight at a
   * flock.
   */
  loseRange: 260,
} as const

export type Mobber = {
  pos: Vector3
  vel: Vector3
  /** Seconds left before it loses interest. */
  timer: number
  /** Seconds until it may peck again. */
  cooldown: number
  /** Knocked out of the air, or given up: heading home and no longer a threat. */
  done: boolean
}

export type MobEvent = 'none' | 'peck' | 'gave-up'

const toward = new Vector3()

/**
 * Chase the player for one step.
 *
 * Plain pursuit with a limited turn, so a crow can be out-turned and out-dived:
 * a bird that always tracks you perfectly is not being mobbed, it is being
 * followed by a camera.
 */
export function stepMobber(
  m: Mobber,
  player: { pos: Vector3; vel: Vector3 },
  dt: number,
): MobEvent {
  if (m.done) {
    // Wheeling away and climbing back to its flock.
    m.vel.y += 6 * dt
    m.pos.addScaledVector(m.vel, dt)
    return 'none'
  }

  m.timer -= dt
  m.cooldown = Math.max(0, m.cooldown - dt)
  const apart = m.pos.distanceTo(player.pos)
  if (m.timer <= 0 || apart > MOB.loseRange) {
    m.done = true
    return 'gave-up'
  }

  // Aim a little ahead of the bird.
  toward.copy(player.pos).addScaledVector(player.vel, Math.min(0.6, apart / MOB.speed)).sub(m.pos)
  const wanted = toward.normalize().multiplyScalar(MOB.speed)
  // Limited turn: blend toward the pursuit velocity.
  m.vel.lerp(wanted, Math.min(1, dt * 2.4))
  if (m.vel.length() > MOB.speed) m.vel.setLength(MOB.speed)
  m.pos.addScaledVector(m.vel, dt)

  if (apart < MOB.peckRange && m.cooldown <= 0) {
    m.cooldown = MOB.peckEvery
    return 'peck'
  }
  return 'none'
}

/**
 * Whether the player knocks a mobbing crow out of the air.
 *
 * Easier than beating a rival, on purpose: a crow is a nuisance, not a duel. Any
 * pass that is closing fast with the talons out, or coming down on it from
 * above, will do.
 */
export function swatsCrow(
  player: { pos: Vector3; vel: Vector3; talons: number },
  crow: Mobber,
): boolean {
  if (crow.done) return false
  const apart = player.pos.distanceTo(crow.pos)
  if (apart > 7) return false
  const fromAbove = player.pos.y > crow.pos.y + 2
  return player.talons > 0.4 || fromAbove
}
