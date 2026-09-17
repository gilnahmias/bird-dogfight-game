/**
 * Is the fight fair?
 *   node --experimental-strip-types src/dev/dogfight.ts
 *
 * Runs the rival AI against a scripted player and reports what happens. The
 * numbers that matter are not "does the AI work" but whether a ten year old can
 * live with it: a bird flying straight and level should be caught sometimes, a
 * bird that runs should get away, and a bird that turns and climbs should be
 * able to take the rival instead.
 */
import { Vector3 } from 'three'
import { createBird, FWD, RIGHT, step, UP, type BirdState, type Input } from '../flight/physics.ts'
import { STAGES } from '../game/progress.ts'
import {
  closingSpeed,
  playerStrikes,
  RIVAL,
  type Pace,
  resolveStrike,
  stepRival,
  type Quarry,
  type Rival,
} from '../entities/rivals.ts'

const dt = 1 / 60

function rivalNear(player: Vector3, heading: Vector3, range = 420): Rival {
  const angle = Math.atan2(heading.x, heading.z) + 0.4
  const pos = new Vector3(player.x + Math.cos(angle) * range, player.y, player.z + Math.sin(angle) * range)
  return {
    id: 1,
    pos,
    vel: new Vector3(player.x - pos.x, 0, player.z - pos.z).normalize().multiplyScalar(RIVAL.cruise),
    mode: 'patrol',
    timer: 0,
    home: pos.clone(),
    spin: 1,
    dead: false,
    dying: 0,
    kind: 1,
    carrying: null,
    nest: null,
  }
}

type Tactic = 'straight' | 'run' | 'hunt it'

/**
 * Fly the player's actual bird, not an approximation of one.
 *
 * The balance question is whether a PLAYER can win, and the player has a flight
 * model with inertia, a turn rate and a climb rate. A lerped velocity answers a
 * different and much easier question.
 */
function steer(bird: BirdState, target: Vector3): Input {
  const fwd = FWD.clone().applyQuaternion(bird.quat)
  const right = RIGHT.clone().applyQuaternion(bird.quat)
  const up = UP.clone().applyQuaternion(bird.quat)
  const to = new Vector3().subVectors(target, bird.pos).normalize()
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  // Bank toward it, and pull the nose onto it. Pitch is positive nose-up.
  return {
    roll: clamp(to.dot(right) * 3),
    pitch: clamp(to.dot(up) * 3 + (to.dot(fwd) < 0 ? 0.3 : 0)),
    brake: false,
  }
}

const NEUTRAL: Input = { roll: 0, pitch: 0, brake: false }
const CALM = { wind: new Vector3(0, 0, 0) }

/** Fly one encounter and report how it ended. */
function encounter(tactic: Tactic, pace: Pace, seconds = 45) {
  const bird = createBird(new Vector3(0, 400, 0))
  const rival = rivalNear(bird.pos, new Vector3(0, 0, -1))

  let closest = Infinity
  let nearest: Record<string, unknown> = {}
  let struck = 0
  let beaten = 0
  let mercy = 0

  const aim = new Vector3()
  for (let i = 0; i < seconds / dt; i++) {
    let input = NEUTRAL
    if (!rival.dead) {
      if (tactic === 'run') {
        // Away from it, nose down for speed.
        aim.copy(bird.pos).add(new Vector3().subVectors(bird.pos, rival.pos).setY(-60))
        input = steer(bird, aim)
      } else if (tactic === 'hunt it') {
        const above = bird.pos.y - rival.pos.y
        if (above < 30) {
          // Climb first: straight up is not an option for a bird, so climb while
          // holding a line past it.
          aim.copy(rival.pos).setY(rival.pos.y + 140)
          input = steer(bird, aim)
        } else {
          // Lead it, and fly THROUGH: a tail chase converges on the rival's own
          // speed and nothing ever connects.
          aim.copy(rival.pos).addScaledVector(rival.vel, 0.6)
          input = steer(bird, aim)
        }
      }
    }
    step(bird, input, CALM, dt)

    const heading = FWD.clone().applyQuaternion(bird.quat)
    stepRival(rival, { pos: bird.pos, vel: bird.vel, perched: false, dead: false } satisfies Quarry, dt, i * dt, pace)
    if (rival.dead) continue

    const apart = bird.pos.distanceTo(rival.pos)
    if (apart < closest) {
      closest = apart
      nearest = {
        apart,
        closing: closingSpeed(
          { pos: rival.pos, vel: rival.vel, forward: rival.vel.clone().normalize() },
          { pos: bird.pos, vel: bird.vel, forward: heading },
        ),
        rivalAbove: rival.pos.y - bird.pos.y,
        mode: rival.mode,
      }
    }

    if (process.env.DOGFIGHT_TRACE && tactic === 'straight' && rival.mode === 'commit' && i % 15 === 0) {
      console.log(
        `   t=${(i * dt).toFixed(1)} apart=${apart.toFixed(0)} above=${(rival.pos.y - bird.pos.y).toFixed(0)} ` +
          `rivalSpeed=${rival.vel.length().toFixed(0)} birdSpeed=${bird.airspeed.toFixed(0)} ` +
          `closing=${closingSpeed({ pos: rival.pos, vel: rival.vel, forward: rival.vel.clone().normalize() }, { pos: bird.pos, vel: bird.vel, forward: heading }).toFixed(1)}`,
      )
    }

    mercy = Math.max(0, mercy - dt)
    const attacker = { pos: rival.pos, vel: rival.vel, forward: rival.vel.clone().normalize() }
    const player = { pos: bird.pos, vel: bird.vel, forward: heading }
    let strike = resolveStrike(attacker, player)
    // A hunting player puts the talons out for the pass, as the game's does.
    if (strike === 'none' && tactic === 'hunt it' && playerStrikes(attacker, player)) strike = 'target'
    if (strike === 'attacker' && mercy <= 0) {
      struck++
      // The same grace and break-off as Rivals.tsx.
      mercy = 10
      bird.vel.multiplyScalar(0.55)
      rival.mode = 'overshoot'
      rival.timer = 15
    }
    if (strike === 'target') {
      beaten++
      rival.dead = true
    }
  }
  return { closest, struck, beaten, nearest }
}

const paces: [string, Pace][] = [
  ['first rival', STAGES.find((s) => s.rivals > 0)!.pace],
  ['full', RIVAL],
]
for (const [name, pace] of paces) {
  console.log(`\n${name} (cruise ${pace.cruise}, dive ${pace.diveSpeed})`)
  console.log('tactic            closest   hits on you   rivals beaten')
  for (const tactic of ['straight', 'run', 'hunt it'] as const) {
    const r = encounter(tactic, pace, tactic === 'straight' ? 90 : 45)
    console.log(
      `${tactic.padEnd(16)}  ${r.closest.toFixed(0).padStart(5)}m   ${String(r.struck).padStart(6)}        ${String(r.beaten).padStart(6)}`,
    )
    if (process.env.DOGFIGHT_DEBUG) {
      console.log(
        '   at the closest point:',
        Object.entries(r.nearest)
          .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(1) : v}`)
          .join('  '),
      )
    }
  }
}
