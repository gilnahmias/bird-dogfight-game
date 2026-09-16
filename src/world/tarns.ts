/**
 * Mountain tarns: the small lakes that sit in hollows high on the hills.
 *
 * They exist so that waterfalls have somewhere to come FROM. A fall that starts
 * halfway down a bare slope has no reason to be there; one that spills over the
 * lip of a tarn does. The tarn's outlet - the lowest point on its rim - is
 * exactly where the water would leave, so that is where the fall begins.
 *
 * The basins themselves are part of the terrain (see `tarnSite`), so this is a
 * lookup rather than a search. The previous version hunted the height field for
 * accidental hollows and found four in a seven kilometre square, none of them
 * near the player - which is why nobody could find a lake or a waterfall.
 *
 * The main water plane is a single sheet at sea level and cannot represent a
 * lake at 180m, so each tarn carries its own small surface.
 */
import { Vector3 } from 'three'
import { meshHeightAt, TARN_RADIUS, tarnSitesNear } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

export type Tarn = {
  /** Centre of the pool, at the water surface. */
  centre: Vector3
  /** Surface height, which is the height of the lowest point on the rim. */
  level: number
  radius: number
  /** Where the water spills out, on the rim. */
  outlet: Vector3
  /** Height of the rim crest at the outlet - the level water actually goes over. */
  outletGround: number
  /** Horizontal direction the outflow runs. */
  outflow: Vector3
}

const SEARCH_RADIUS = 3400

export function findTarns(
  seed: string,
  centre: Vector3,
  max = 24,
  radius = SEARCH_RADIUS,
): Tarn[] {
  const tarns: Tarn[] = []
  for (const site of tarnSitesNear(centre.x, centre.z, radius, seed)) {
    if (tarns.length >= max) break
    const toRim = new Vector3(Math.cos(site.outletAngle), 0, Math.sin(site.outletAngle))
    const outlet = new Vector3(
      site.x + toRim.x * TARN_RADIUS,
      site.level,
      site.z + toRim.z * TARN_RADIUS,
    )
    tarns.push({
      centre: new Vector3(site.x, site.level, site.z),
      level: site.level,
      // Drawn WIDER than the water actually reaches, and left to be buried by
      // the ground where the basin climbs above the waterline. A disc cut to the
      // pool's own size leaves a ring of dry basin showing below the shoreline,
      // and the lake reads as a sticker laid in a saucer; letting the terrain do
      // the cutting gives a shoreline that fits the hollow exactly.
      radius: TARN_RADIUS * 1.04,
      outlet,
      outletGround: site.level + 0.4,
      /*
        Straight out through the notch the terrain has cut for it.

        This used to search for the steepest way down from the outlet, which sent
        the stream off across the hillside at an angle to the channel the ground
        actually offers - so the water ran over rock instead of through its own
        outflow.
      */
      outflow: toRim,
    })
  }
  return tarns
}

/**
 * How far the ground falls away below a tarn's outlet, following the outflow.
 * This is what decides whether the spill is a waterfall or just a stream.
 */
export function outletDrop(tarn: Tarn, seed: string, runout = 200): number {
  let lowest = tarn.level
  for (let d = 10; d <= runout; d += 10) {
    const h = meshHeightAt(
      tarn.outlet.x + tarn.outflow.x * d,
      tarn.outlet.z + tarn.outflow.z * d,
      seed,
      WORLD.lodSegments[0],
    )
    lowest = Math.min(lowest, Math.max(h, WORLD.waterLevel))
  }
  return tarn.level - lowest
}
