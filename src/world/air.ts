/**
 * The moving air: wind, thermals, ridge lift and sink.
 *
 * Phase 1 stub - calm air everywhere, so the flight model can be judged on its
 * own before lift sources are layered on top. Phase 2 fills this in.
 */
import type { Vector3 } from 'three'

export type AirSample = { wind: Vector3 }

export function sampleAir(_pos: Vector3, _seed: string, out: AirSample): AirSample {
  out.wind.set(0, 0, 0)
  return out
}
