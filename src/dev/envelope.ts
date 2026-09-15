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

/** Settle into hands-off flight first, so every case starts from real cruise. */
function atCruise(load: number) {
  const b = createBird(new Vector3(0, 5000, 0))
  b.load = load
  for (let i = 0; i < 12 / dt; i++) step(b, { roll: 0, pitch: 0, brake: false }, CALM, dt)
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
  let braked = false
  for (let i = 0; i < seconds / dt; i++) {
    step(b, input, CALM, dt)
    braked ||= b.talons > 0.5
  }
  const dy = b.pos.y - y0
  const dist = Math.hypot(b.pos.x - x0, b.pos.z - z0)
  return {
    speed: b.airspeed,
    dSpeed: b.airspeed - v0,
    avgClimb: dy / seconds,
    pathAngle: (Math.atan2(dy, dist) * 180) / Math.PI,
    aoa: (b.aoa * 180) / Math.PI,
    braked,
  }
}

const WINDOW = 2.5
const cases: [string, Input, number][] = [
  ['hands off', { roll: 0, pitch: 0, brake: false }, 0],
  ['hands off, full load', { roll: 0, pitch: 0, brake: false }, T.maxLoad],
  ['brake, talons out', { roll: 0, pitch: 0.12, brake: true }, 0],
  ['climb', { roll: 0, pitch: 0.3, brake: false }, 0],
  ['climb, full load', { roll: 0, pitch: 0.3, brake: false }, T.maxLoad],
  ['shallow dive', { roll: 0, pitch: -0.4, brake: false }, 0],
  ['full dive', { roll: 0, pitch: -1, brake: false }, 0],
  ['full elevator back', { roll: 0, pitch: 1, brake: false }, 0],
  ['hard bank', { roll: 1, pitch: 0.1, brake: false }, 0],
]

const rows = [['case (' + WINDOW + 's from cruise)', 'speed', 'd speed', 'climb', 'path', 'aoa', 'talons']]
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
    r.braked ? 'TALONS' : '-',
  ])
}

const cruise = atCruise(0)

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '))
console.log(
  [
    '',
    `cruise (hands off):      ${cruise.airspeed.toFixed(1)} m/s, ${cruise.climbRate >= 0 ? 'climbing' : 'sinking'} ${Math.abs(cruise.climbRate).toFixed(1)} m/s`,
    `cruise the bird holds:   ${T.cruiseSpeed} m/s under its own power`,
  ].join('\n'),
)
