/** Where the waterfalls ended up, and how far they are from the nest. */
import { findWaterfalls } from '../world/waterfalls.ts'
import { departureDirection, findNestSite } from '../world/nest.ts'

const SEED = process.argv[2] ?? 'pine-ridge'
const site = findNestSite(SEED)
const falls = findWaterfalls(SEED, site.pos, departureDirection(site.heading))
const all = findWaterfalls(SEED, site.pos, null, 10000)
console.log(`candidate falls in range: ${all.length}`)
console.log(`nest at ${site.pos.x}, ${site.pos.z} (${site.pos.y.toFixed(0)}m), edge drop ${site.edgeDrop.toFixed(0)}m`)
console.log(`${falls.length} waterfalls:`)
const dir = departureDirection(site.heading)
console.log('(along = metres down the departure line, off = metres to the side of it)')
for (const w of falls) {
  const d = Math.hypot(w.top.x - site.pos.x, w.top.z - site.pos.z)
  const rx = w.top.x - site.pos.x
  const rz = w.top.z - site.pos.z
  const along = rx * dir.x + rz * dir.z
  const off = Math.abs(rx * -dir.z + rz * dir.x)
  console.log(
    `  ${String(Math.round(w.top.x)).padStart(6)},${String(Math.round(w.top.z)).padStart(6)}   ` +
      `drop ${(w.top.y - w.base.y).toFixed(0).padStart(3)}m   run ${Math.hypot(w.base.x - w.top.x, w.base.z - w.top.z).toFixed(0).padStart(3)}m   width ${w.width.toFixed(0).padStart(2)}m   ` +
      `${(d / 1000).toFixed(1)}km away   along ${along.toFixed(0).padStart(6)}m  off ${off.toFixed(0).padStart(5)}m` +
      `${along > 0 && off < 400 ? '   <- in view on launch' : ''}`,
  )
}
