/** How many mountain tarns each seed offers, and how close the nearest one is. */
import { findTarns, outletDrop } from '../world/tarns.ts'
import { findNestSite } from '../world/nest.ts'

for (const seed of ['pine-ridge', 'alpine', 'coastal', 'basin']) {
  const site = findNestSite(seed)
  const tarns = findTarns(seed, site.pos)
  const drops = tarns.map((t) => outletDrop(t, seed))
  const near = tarns.map((t) => t.centre.distanceTo(site.pos))
  console.log(
    `${seed.padEnd(11)} tarns ${String(tarns.length).padStart(2)}  ` +
      `nearest ${(Math.min(...near) / 1000).toFixed(2)}km  ` +
      `best drop ${Math.max(...drops).toFixed(0).padStart(3)}m  ` +
      `falls over 9m: ${drops.filter((d) => d > 9).length}`,
  )
}
