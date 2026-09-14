/**
 * Does the nest sit on the drawn ground, or on the ground the maths believes in?
 *
 * The terrain mesh samples heightAt on a grid and draws flat triangles between
 * those samples. On a peak - which is exactly where nests are sited - the
 * triangle spans the summit and sits BELOW the true height, so anything placed
 * at heightAt floats above the visible surface.
 */
import { findNestSite } from '../world/nest.ts'
import { meshHeightAt } from '../world/terrain.ts'
import { WORLD } from '../game/constants.ts'

const SEED = process.argv[2] ?? 'pine-ridge'
const site = findNestSite(SEED)

console.log(`nest for "${SEED}" at ${site.pos.x}, ${site.pos.z}`)
console.log(`  heightAt (the maths):        ${site.pos.y.toFixed(2)}m`)
for (const segments of WORLD.lodSegments) {
  const mesh = meshHeightAt(site.pos.x, site.pos.z, SEED, segments)
  const gap = site.pos.y - mesh
  console.log(
    `  drawn mesh at ${String(segments).padStart(2)} segments: ${mesh.toFixed(2)}m   ` +
      `${gap >= 0 ? 'nest floats' : 'nest buried'} by ${Math.abs(gap).toFixed(2)}m`,
  )
}
