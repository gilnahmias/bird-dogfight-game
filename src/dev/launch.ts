/**
 * The first ten seconds of a run:
 *   node --experimental-strip-types src/dev/launch.ts
 *
 * The bird starts standing in its nest, high in a tree on a ridge, and the
 * player presses space. What happens next is the first thing anybody sees, and
 * it was measured falling out of the sky: the leap left the bird at 15 m/s when
 * it needs about 22 to hold height, so it sank into the hillside below its own
 * nest within three seconds - hands off, and with the nose held up.
 */
import { createBird, resolveGround, step, type Input } from '../flight/physics.ts'
import { departureDirection, findNestSite, launchPoint, nestPoint } from '../world/nest.ts'
import { createAirSample, sampleAir } from '../world/air.ts'
import { heightAt, biomeAt, tarnPoolAt } from '../world/terrain.ts'
import { WORLD } from '../game/constants.ts'

const dt = 1 / 120
const NEST_PERCH_RADIUS = 4.5

/**
 * Fly the opening of a run and report how close it came to the ground.
 *
 * Space is held for `hold` seconds - the leap off the perch - and then the
 * player's follow-up input takes over, which is exactly the sequence the game
 * opens with.
 */
function openRun(seed: string, after: Input, seconds = 10, hold = 1.2, afterFor = 2) {
  const site = findNestSite(seed)
  const spawn = launchPoint(site)
  const nest = nestPoint(site)
  const bird = createBird(spawn, site.heading, true)
  const air = createAirSample()

  let lowestClearance = Infinity
  let peak = bird.pos.y
  let fate = 'flying'
  for (let i = 0; i < seconds / dt && !bird.dead; i++) {
    sampleAir(bird.pos, seed, air)
    // Space for the leap, then the player's follow-up for a moment, then hands
    // off. Holding elevator for ten seconds just loops the bird and measures
    // nothing.
    const t = i * dt
    step(bird, t < hold ? LEAP : t < hold + afterFor ? after : HANDS_OFF, air, dt)
    const terrain = heightAt(bird.pos.x, bird.pos.z, seed)
    const overNest =
      Math.hypot(bird.pos.x - nest.x, bird.pos.z - nest.z) < NEST_PERCH_RADIUS &&
      bird.pos.y > nest.y - 3
    const pool = tarnPoolAt(bird.pos.x, bird.pos.z, seed)
    const wet = (biomeAt(bird.pos.x, bird.pos.z, seed) === 'water' || pool !== null) && !overNest
    const floor = overNest ? Math.max(terrain, nest.y) : terrain
    const surface = pool ?? Math.max(terrain, WORLD.waterLevel)
    const contact = resolveGround(bird, wet ? surface : floor, wet, dt)
    if (contact === 'crash') fate = `crashed at ${(i * dt).toFixed(1)}s`
    if (i > 0.4 / dt) lowestClearance = Math.min(lowestClearance, bird.pos.y - terrain)
    peak = Math.max(peak, bird.pos.y)
  }
  return {
    fate,
    speed: bird.airspeed,
    climb: bird.climbRate,
    clearance: lowestClearance,
    climbed: peak - spawn.y,
    away: Math.hypot(bird.pos.x - spawn.x, bird.pos.z - spawn.z),
    heading: departureDirection(site.heading),
  }
}

const LEAP: Input = { roll: 0, pitch: 0, brake: true }
const HANDS_OFF: Input = { roll: 0, pitch: 0, brake: false }
const NOSE_UP: Input = { roll: 0, pitch: 0.5, brake: false }

if (process.argv[2] === 'trace') {
  const seed = process.argv[3] ?? 'pine-ridge'
  const site = findNestSite(seed)
  const spawn = launchPoint(site)
  const nest = nestPoint(seed === '' ? site : site)
  const bird = createBird(spawn, site.heading, true)
  const air = createAirSample()
  console.log(`nest ${nest.x.toFixed(0)},${nest.y.toFixed(0)},${nest.z.toFixed(0)}  spawn y ${spawn.y.toFixed(1)}  ground ${heightAt(spawn.x, spawn.z, seed).toFixed(1)}`)
  for (let i = 0; i < 6 / dt; i++) {
    sampleAir(bird.pos, seed, air)
    step(bird, i * dt < 1.2 ? LEAP : HANDS_OFF, air, dt)
    const terrain = heightAt(bird.pos.x, bird.pos.z, seed)
    const overNest =
      Math.hypot(bird.pos.x - nest.x, bird.pos.z - nest.z) < NEST_PERCH_RADIUS && bird.pos.y > nest.y - 3
    const floor = overNest ? Math.max(terrain, nest.y) : terrain
    const contact = resolveGround(bird, floor, false, dt)
    if (i % 24 === 0) {
      console.log(
        `t=${(i * dt).toFixed(2)} y=${bird.pos.y.toFixed(1)} agl=${(bird.pos.y - terrain).toFixed(1)} ` +
          `v=${bird.airspeed.toFixed(1)} climb=${bird.climbRate.toFixed(1)} aoa=${bird.aoa.toFixed(2)} ` +
          `lt=${bird.launchTimer.toFixed(2)} perched=${bird.perched} ${contact}`,
      )
    }
    if (bird.dead) { console.log('dead at', (i * dt).toFixed(2)); break }
  }
  process.exit(0)
}

for (const seed of ['pine-ridge', 'alpine', 'coastal', 'basin']) {
  for (const [name, after] of [
    ['hands off', HANDS_OFF],
    ['nose up', NOSE_UP],
  ] as const) {
    const r = openRun(seed, after)
    console.log(
      `${seed.padEnd(11)} ${name.padEnd(10)} ` +
        `${r.fate.padEnd(18)} clearance ${r.clearance.toFixed(0).padStart(4)}m  ` +
        `speed ${r.speed.toFixed(1).padStart(5)}  climb ${r.climb.toFixed(1).padStart(6)}  ` +
        `travelled ${r.away.toFixed(0).padStart(4)}m`,
    )
  }
}
