/**
 * Food handed to the player's talons from somewhere other than the ground.
 *
 * Stealing happens in the rivals' frame loop, and the talons belong to the prey
 * field's. A module-level queue joins the two the same way splash.ts joins the
 * physics to the spray: whoever takes food pushes it here, and the prey field
 * collects it on its next frame - so neither owns the other, and nothing has to
 * render to hand it over.
 */
import { Vector3 } from 'three'
import type { PreyKind } from './prey.ts'

export type Gift = { kind: PreyKind; at: Vector3 }

const pending: Gift[] = []

/** Put food into the player's talons, or onto the ground below if they are full. */
export function giveToTalons(kind: PreyKind, at: Vector3): void {
  pending.push({ kind, at: at.clone() })
}

/** Everything handed over since the last call. Empties the queue. */
export function collectGifts(): Gift[] {
  return pending.splice(0)
}
