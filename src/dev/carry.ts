/**
 * Can the bird get its catch home?
 *   node --experimental-strip-types src/dev/carry.ts
 *
 * Prey is taken at the water and banked at the nest, which is up on a ridge, so
 * every successful hunt ends in a climb under load. If that climb is impossible
 * the whole loop is: the fish is caught, and then nothing can be done with it.
 */
import { Vector3 } from 'three'
import { createBird, step, type Input } from '../flight/physics.ts'
import { PREY } from '../world/prey.ts'
import { T } from '../game/constants.ts'

const CALM = { wind: new Vector3(0, 0, 0) }
const dt = 1 / 60
const CLIMB: Input = { roll: 0, pitch: 0.3, brake: false }
const HANDS_OFF: Input = { roll: 0, pitch: 0, brake: false }

/** Best sustained climb the bird can hold at a given talon load. */
function bestClimb(load: number, input: Input) {
  const b = createBird(new Vector3(0, 1000, 0))
  b.load = load
  for (let i = 0; i < 10 / dt; i++) step(b, HANDS_OFF, CALM, dt)
  const y0 = b.pos.y
  const seconds = 20
  for (let i = 0; i < seconds / dt; i++) step(b, input, CALM, dt)
  return { climb: (b.pos.y - y0) / seconds, speed: b.airspeed }
}

/** The trip that matters: from the water up to a nest on a ridge. */
const NEST_HEIGHT = 175

console.log('load  kg    climb(nose up)  speed   climb(hands off)   time to 175m')
for (const load of [0, PREY.mouse.weight, PREY.fish.weight, PREY.rabbit.weight, T.maxLoad]) {
  const up = bestClimb(load, CLIMB)
  const off = bestClimb(load, HANDS_OFF)
  const time = up.climb > 0.05 ? `${(NEST_HEIGHT / up.climb).toFixed(0)}s` : 'never'
  console.log(
    `${load.toFixed(1).padStart(4)}  ${(load * T.loadMassPerUnit).toFixed(2).padStart(4)}  ` +
      `${up.climb.toFixed(1).padStart(8)} m/s   ${up.speed.toFixed(1).padStart(5)}   ` +
      `${off.climb.toFixed(1).padStart(8)} m/s        ${time.padStart(6)}`,
  )
}
