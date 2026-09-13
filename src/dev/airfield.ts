/**
 * Air field readout, for tuning lift by eye:
 *   npm run air
 * The benchmark to beat is the hands-off sink rate from `npm run envelope`.
 */
import { Vector3 } from 'three'
import { createAirSample, sampleAir, thermalAt, windDirection } from '../world/air.ts'
import { heightAt, normalAt } from '../world/terrain.ts'
import { findNestSite } from '../world/nest.ts'
import { createBird, step } from '../flight/physics.ts'
import { AIR, WORLD } from '../game/constants.ts'

const SEED = process.argv[2] ?? 'pine-ridge'
const dt = 1 / 120

let best = 0
let core: { x: number; z: number; g: number } | null = null
let worst = 0
let dead: { x: number; z: number; g: number } | null = null
let lifting = 0
let land = 0

for (let i = 0; i < 30000; i++) {
  const x = (i % 170) * 70 - 6000
  const z = Math.floor(i / 170) * 70 - 6000
  const g = heightAt(x, z, SEED)
  if (g < WORLD.waterLevel) continue
  land++
  const t = thermalAt(x, g + 200, z, SEED)
  if (t > 0) lifting++
  if (t > best) {
    best = t
    core = { x, z, g }
  }
  if (t < worst) {
    worst = t
    dead = { x, z, g }
  }
}

/** Fly with a fixed input and no flapping, and report the altitude change. */
function fly(x: number, z: number, y: number, seconds: number, roll = 0, pitch = 0) {
  const bird = createBird(new Vector3(x, y, z))
  const air = createAirSample()
  const y0 = bird.pos.y
  for (let i = 0; i < seconds / dt; i++) {
    sampleAir(bird.pos, SEED, air, i * dt)
    step(bird, { roll, pitch, flap: false }, air, dt)
  }
  return { dy: bird.pos.y - y0, speed: bird.airspeed, stamina: bird.stamina }
}

const glide = (x: number, z: number, y: number, seconds: number) => fly(x, z, y, seconds).dy

const wind = windDirection(SEED)
console.log(`seed "${SEED}"`)
console.log(`wind        ${AIR.windSpeed} m/s toward (${wind.x.toFixed(2)}, ${wind.z.toFixed(2)})`)
console.log(`thermals    strongest ${best.toFixed(2)} m/s, worst sink ${worst.toFixed(2)} m/s`)
console.log(`coverage    ${((lifting / land) * 100).toFixed(0)}% of dry sky is rising at 200m agl\n`)

console.log('hands-off glide, no flapping:')
for (const seconds of [10, 20, 40]) {
  const inCore = core ? glide(core.x, core.z, core.g + 200, seconds) : 0
  const inSink = dead ? glide(dead.x, dead.z, dead.g + 200, seconds) : 0
  const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}m`
  console.log(`  ${String(seconds).padStart(3)}s   thermal core ${sign(inCore).padStart(7)}    dead air ${sign(inSink).padStart(7)}`)
}

console.log('\ncircling the core (this is how a thermal is actually worked):')
for (const [roll, pitch] of [[0.3, 0.2], [0.55, 0.28], [0.75, 0.35], [0.9, 0.45]] as const) {
  if (!core) break
  const r = fly(core.x, core.z, core.g + 150, 60, roll, pitch)
  const bankDeg = ((Math.asin(Math.min(1, (roll * 2.6) / 3.1)) * 180) / Math.PI).toFixed(0)
  console.log(
    `  roll ${roll.toFixed(2)} (~${bankDeg} deg bank)  60s -> ${r.dy >= 0 ? '+' : ''}${r.dy.toFixed(0)}m` +
      `   speed ${r.speed.toFixed(1)} m/s   stamina ${Math.round(r.stamina)}`,
  )
}

// The air right where every run begins.
const site = findNestSite(SEED)
console.log(`\nnest at ${site.pos.x},${site.pos.z} (${site.pos.y.toFixed(0)}m):`)
for (const agl of [26, 60, 120, 200]) {
  const a = sampleAir(new Vector3(site.pos.x, site.pos.y + agl, site.pos.z), SEED, createAirSample())
  console.log(
    `  ${String(agl).padStart(4)}m agl   ridge ${a.ridge.toFixed(2)}   thermal ${a.thermal.toFixed(2)}   total ${a.lift.toFixed(2)} m/s`,
  )
}

// Best windward slope, for ridge soaring.
let bestRidge = 0
let ridgeAt: { x: number; z: number; g: number } | null = null
for (let i = 0; i < 30000; i++) {
  const x = (i % 170) * 70 - 6000
  const z = Math.floor(i / 170) * 70 - 6000
  const g = heightAt(x, z, SEED)
  if (g < 40) continue
  const a = sampleAir(new Vector3(x, g + 20, z), SEED, createAirSample())
  if (a.ridge > bestRidge) {
    bestRidge = a.ridge
    ridgeAt = { x, z, g }
  }
}
console.log(`\nridge lift  best ${bestRidge.toFixed(2)} m/s at ${ridgeAt?.x},${ridgeAt?.z} (${ridgeAt?.g.toFixed(0)}m)`)
if (ridgeAt) {
  const n = normalAt(ridgeAt.x, ridgeAt.z, SEED)
  console.log(`            slope ${(Math.hypot(n[0], n[2]) * 100).toFixed(0)}%, ceiling ${AIR.ridgeCeiling}m`)
  for (const agl of [10, 40, 90, 150, 220]) {
    const a = sampleAir(new Vector3(ridgeAt.x, ridgeAt.g + agl, ridgeAt.z), SEED, createAirSample())
    console.log(`            ${String(agl).padStart(4)}m agl  ridge ${a.ridge.toFixed(2)}  total ${a.lift.toFixed(2)} m/s`)
  }
}
