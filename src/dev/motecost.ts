/**
 * Frame budget for the dust motes, which sample the thermal field per mote per
 * frame. Run after touching air.ts or Motes.tsx:
 *   node --experimental-strip-types src/dev/motecost.ts
 */
import { surfaceAt, thermalAt } from '../world/air.ts'

const SEED = 'pine-ridge'
const MOTES = 150
const TRIES = 2
const FRAMES = 120

// Worst case: empty sky, so every mote pays for a full failed search every time
// it is allowed to retry.
let sink = 0
const t0 = performance.now()
for (let f = 0; f < FRAMES; f++) {
  for (let i = 0; i < MOTES; i++) {
    for (let t = 0; t < TRIES; t++) {
      const x = (i * 37 + f * 11) % 3000
      const z = (i * 91 + f * 7) % 3000
      const y = surfaceAt(x, z, SEED) + 120
      sink += thermalAt(x, y, z, SEED, f / 60)
    }
  }
}
const ms = (performance.now() - t0) / FRAMES
console.log(`motes: ${MOTES} x ${TRIES} searches = ${(MOTES * TRIES).toLocaleString()} samples/frame`)
console.log(`worst-case cost: ${ms.toFixed(2)} ms/frame  (budget is 16.7ms)`)
console.log(`verdict: ${ms < 2 ? 'fine' : ms < 5 ? 'acceptable' : 'TOO SLOW - throttle harder'}`)
void sink
