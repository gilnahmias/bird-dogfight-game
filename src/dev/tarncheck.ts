/** Why a seed does or does not get mountain tarns. Counts each rejection reason. */
import { heightAt, tarnFieldAt } from '../world/terrain.ts'
import { findTarns, outletDrop } from '../world/tarns.ts'
import { findNestSite } from '../world/nest.ts'

for (const seed of ['pine-ridge', 'alpine', 'coastal', 'basin']) {
  const site = findNestSite(seed)
  const reasons = { height: 0, rise: 0, flat: 0, dry: 0, ok: 0 }
  for (let dz = -2600; dz <= 2600; dz += 70) {
    for (let dx = -2600; dx <= 2600; dx += 70) {
      const x = site.pos.x + dx
      const z = site.pos.z + dz
      const floor = heightAt(x, z, seed)
      if (floor < 42 || floor > 245) { reasons.height++; continue }
      let lowest = Infinity, total = 0
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const h = heightAt(x + Math.cos(a) * 34, z + Math.sin(a) * 34, seed)
        total += h
        lowest = Math.min(lowest, h)
      }
      if (total / 16 - floor < 2.2) { reasons.rise++; continue }
      if (lowest - floor < 1.2) { reasons.flat++; continue }
      if (tarnFieldAt(x, z, seed) < 0.35) { reasons.dry++; continue }
      reasons.ok++
    }
  }
  const tarns = findTarns(seed, site.pos)
  const drops = tarns.map((t) => outletDrop(t, seed))
  console.log(
    `${seed.padEnd(11)} kept ${String(tarns.length).padStart(2)}  ` +
      `best drop ${(drops.length ? Math.max(...drops) : 0).toFixed(0).padStart(3)}m   ` +
      `rejected: height ${reasons.height}, no rim ${reasons.rise}, too flat ${reasons.flat}, dry ${reasons.dry}, passed ${reasons.ok}`,
  )
}
