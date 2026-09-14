/** Where the waterfalls ended up, and how far they are from the nest. */
import { findWaterfalls } from '../world/waterfalls.ts'
import { findNestSite } from '../world/nest.ts'

const SEED = process.argv[2] ?? 'pine-ridge'
const site = findNestSite(SEED)
const falls = findWaterfalls(SEED, site.pos)
console.log(`nest at ${site.pos.x}, ${site.pos.z} (${site.pos.y.toFixed(0)}m), edge drop ${site.edgeDrop.toFixed(0)}m`)
console.log(`${falls.length} waterfalls:`)
for (const w of falls) {
  const d = Math.hypot(w.top.x - site.pos.x, w.top.z - site.pos.z)
  console.log(
    `  ${String(Math.round(w.top.x)).padStart(6)},${String(Math.round(w.top.z)).padStart(6)}   ` +
      `drop ${(w.top.y - w.base.y).toFixed(0).padStart(3)}m   run ${Math.hypot(w.base.x - w.top.x, w.base.z - w.top.z).toFixed(0).padStart(3)}m   width ${w.width.toFixed(0).padStart(2)}m   ` +
      `${(d / 1000).toFixed(1)}km from the nest`,
  )
}
