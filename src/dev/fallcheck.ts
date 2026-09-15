/** Why a tarn does or does not produce a waterfall. */
import { findTarns } from '../world/tarns.ts'
import { findNestSite } from '../world/nest.ts'
import { meshHeightAt } from '../world/terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEED = process.argv[2] ?? 'pine-ridge'
const site = findNestSite(SEED)
const ground = (x: number, z: number) =>
  Math.max(meshHeightAt(x, z, SEED, WORLD.lodSegments[0]), WORLD.waterLevel)

for (const tarn of findTarns(SEED, site.pos)) {
  const atOutlet = ground(tarn.outlet.x, tarn.outlet.z)
  const profile: string[] = []
  for (let d = 0; d <= 60; d += 5) {
    profile.push(
      ground(tarn.outlet.x + tarn.outflow.x * d, tarn.outlet.z + tarn.outflow.z * d).toFixed(0),
    )
  }
  console.log(
    `tarn ${String(Math.round(tarn.centre.x)).padStart(6)},${String(Math.round(tarn.centre.z)).padStart(6)} ` +
      `level ${tarn.level.toFixed(0).padStart(4)}m  rim ${tarn.outletGround.toFixed(0).padStart(4)}m  ` +
      `ground at outlet ${atOutlet.toFixed(0).padStart(4)}m`,
  )
  console.log(`   downhill from the outlet every 5m: ${profile.join(' ')}`)
}
