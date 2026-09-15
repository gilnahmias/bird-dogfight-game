/** What the shadow actually looks like at the altitudes the bird really flies. */
import { apparentSize, shadowFor, MAX_HEIGHT } from '../world/shadow.ts'
import { SUN_DIRECTION } from '../world/sky.ts'

const reach = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) / SUN_DIRECTION.y
const elevation = (Math.asin(SUN_DIRECTION.y) * 180) / Math.PI

console.log(`sun elevation ${elevation.toFixed(0)} deg, shadow thrown ${reach.toFixed(2)}x its height`)
console.log('\nagl     size   thrown   opacity   on screen   readable?')
for (const h of [0, 10, 25, 50, 80, 120, 160, 200, 260, 300, 380]) {
  const s = shadowFor(h)
  const degrees = (apparentSize(h, reach) * 180) / Math.PI
  const readable = !s.visible
    ? 'NOT DRAWN'
    : s.opacity > 0.12 && degrees > 1.6
      ? 'yes'
      : s.opacity > 0.05 && degrees > 1.0
        ? 'barely'
        : 'invisible'
  console.log(
    `${String(h).padStart(4)}m ${s.size.toFixed(1).padStart(6)}m ${(h * reach).toFixed(0).padStart(7)}m ` +
      `${s.opacity.toFixed(3).padStart(8)}   ${degrees.toFixed(1).padStart(6)} deg   ${readable}`,
  )
}
console.log(`\nfade height: ${MAX_HEIGHT}m`)
