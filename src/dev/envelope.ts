/**
 * Flight envelope readout, for tuning by eye without launching the game:
 *   node --experimental-strip-types src/dev/envelope.ts
 * Run it after touching any number in game/constants.ts.
 */
import { Vector3 } from 'three'
import { createBird, step, type Input } from '../flight/physics.ts'
import { T } from '../game/constants.ts'

const CALM = { wind: new Vector3(0, 0, 0) }

const dt = 1 / 60

/** Settle into a hands-off glide first, so every case starts from real cruise. */
function atCruise(load: number) {
  const b = createBird(new Vector3(0, 5000, 0))
  b.load = load
  for (let i = 0; i < 12 / dt; i++) step(b, { roll: 0, pitch: 0, flap: false }, CALM, dt)
  return b
}

/**
 * Hold an input for a short window, the way a player actually does. Holding
 * elevator for 12s just loops the bird, which measures nothing.
 */
function window(input: Input, seconds: number, load = 0) {
  const b = atCruise(load)
  const v0 = b.airspeed
  const y0 = b.pos.y
  const x0 = b.pos.x
  const z0 = b.pos.z
  let stalled = false
  let minStamina = b.stamina
  for (let i = 0; i < seconds / dt; i++) {
    step(b, input, CALM, dt)
    stalled ||= b.stalled
    minStamina = Math.min(minStamina, b.stamina)
  }
  const dy = b.pos.y - y0
  const dist = Math.hypot(b.pos.x - x0, b.pos.z - z0)
  return {
    speed: b.airspeed,
    dSpeed: b.airspeed - v0,
    avgClimb: dy / seconds,
    pathAngle: (Math.atan2(dy, dist) * 180) / Math.PI,
    aoa: (b.aoa * 180) / Math.PI,
    stalled,
    minStamina,
  }
}

const WINDOW = 2.5
const cases: [string, Input, number][] = [
  ['hands-off glide', { roll: 0, pitch: 0, flap: false }, 0],
  ['glide, full load', { roll: 0, pitch: 0, flap: false }, T.maxLoad],
  ['flap, hold level', { roll: 0, pitch: 0.12, flap: true }, 0],
  ['flap, climb', { roll: 0, pitch: 0.3, flap: true }, 0],
  ['flap, climb, full load', { roll: 0, pitch: 0.3, flap: true }, T.maxLoad],
  ['shallow dive', { roll: 0, pitch: -0.4, flap: false }, 0],
  ['full dive', { roll: 0, pitch: -1, flap: false }, 0],
  ['full elevator back', { roll: 0, pitch: 1, flap: false }, 0],
  ['hard bank', { roll: 1, pitch: 0.1, flap: false }, 0],
]

const rows = [['case (' + WINDOW + 's from cruise)', 'speed', 'd speed', 'climb', 'path', 'aoa', 'stall', 'stamina']]
for (const [name, input, load] of cases) {
  const r = window(input, WINDOW, load)
  const sign = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1)
  rows.push([
    name,
    `${r.speed.toFixed(1)} m/s`,
    `${sign(r.dSpeed)}`,
    `${sign(r.avgClimb)} m/s`,
    `${sign(r.pathAngle)} deg`,
    `${r.aoa.toFixed(1)} deg`,
    r.stalled ? 'STALL' : '-',
    r.minStamina.toFixed(0),
  ])
}

const cruise = atCruise(0)
const glideRatio = Math.abs(cruise.airspeed / cruise.climbRate)
const stallSpeed = Math.sqrt(
  (2 * T.mass * T.gravity) / (T.airDensity * T.wingArea * T.clSlope * T.stallAngle),
)
const flapSeconds = (T.staminaMax / T.flapStaminaCost) * T.flapInterval

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '))
console.log(
  [
    '',
    `cruise (hands off):      ${cruise.airspeed.toFixed(1)} m/s, sink ${cruise.climbRate.toFixed(1)} m/s`,
    `glide ratio:             ${glideRatio.toFixed(1)} : 1`,
    `stall speed:             ${stallSpeed.toFixed(1)} m/s`,
    `sustained flapping:      ${flapSeconds.toFixed(0)} s, recharges in ${(T.staminaMax / T.staminaRegen).toFixed(0)} s`,
  ].join('\n'),
)
