/**
 * The rival nests near the bird: trees with an eyrie in the crown, marked in the
 * owner's colours. The food in them is prey the prey field puts there; this only
 * draws the nests.
 *
 * Streamed around the bird, like the lakes, so a nest exists wherever you fly to
 * rather than only near where the run started.
 */
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Vector3 } from 'three'
import { Nest } from '../world/Nest.tsx'
import { RIVAL_KINDS } from './rivalKinds.ts'
import { rivalNestsNear, type RivalNest } from './rivalNests.ts'

/** How far out nests are drawn. Past the fog, because a tall tree is a landmark. */
const DRAW_RANGE = 2200
const RESTOCK_AFTER = 500

export function RivalNests({
  target,
  seed,
  home,
}: {
  target: { current: Vector3 }
  seed: string
  home: Vector3
}) {
  const [nests, setNests] = useState<RivalNest[]>(() =>
    rivalNestsNear(target.current.x, target.current.z, DRAW_RANGE, seed, home),
  )
  const built = useRef(target.current.clone())

  useFrame(() => {
    if (target.current.distanceTo(built.current) < RESTOCK_AFTER) return
    built.current.copy(target.current)
    setNests(rivalNestsNear(target.current.x, target.current.z, DRAW_RANGE, seed, home))
  })

  return (
    <group>
      {nests.map((n) => (
        <Nest key={n.id} site={n.site} accent={RIVAL_KINDS[n.kind].palette.featherLight} />
      ))}
    </group>
  )
}
