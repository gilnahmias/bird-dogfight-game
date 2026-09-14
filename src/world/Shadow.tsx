/**
 * The bird's shadow on the ground.
 *
 * This is an altitude instrument, not decoration. Over open terrain there is
 * nothing to judge height against, and the number on the HUD is not something
 * you can read while threading a valley. A shadow directly below the bird gives
 * height at a glance: close and sharp means low, wide and faint means high.
 *
 * Deliberately cast straight down rather than along the sun. A sun-angle shadow
 * is more truthful but useless for judging height, because it slides away from
 * the bird as you climb.
 *
 * → skipped: real shadow mapping. It would cost a depth pass over the whole
 *   terrain to produce a blob this size, and would not answer the question the
 *   player is asking.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { type Mesh, type MeshBasicMaterial, Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { meshHeightAt } from './terrain.ts'
import { shadowFor } from './shadow.ts'
import { FWD } from '../flight/physics.ts'
import { WORLD } from '../game/constants.ts'

const fwd = new Vector3()

export function Shadow({ state, seed }: { state: BirdState; seed: string }) {
  const mesh = useRef<Mesh>(null)

  useFrame(() => {
    const m = mesh.current
    if (!m) return

    // Sit on the surface the player can see, not the height field, or the shadow
    // sinks into ridges. A small lift clears z-fighting with the terrain.
    const ground = meshHeightAt(state.pos.x, state.pos.z, seed, WORLD.lodSegments[0])
    const surface = Math.max(ground, WORLD.waterLevel)
    const height = state.pos.y - surface

    const shadow = shadowFor(height)
    m.visible = shadow.visible && !state.dead
    if (!m.visible) return

    m.position.set(state.pos.x, surface + 0.35, state.pos.z)
    // Slightly elongated so the blob reads as a wingspan rather than a puddle.
    m.scale.set(shadow.size, shadow.size * 0.7, 1)

    // Turn with the bird so the blob reads as a bird, not as a dot.
    fwd.copy(FWD).applyQuaternion(state.quat)
    m.rotation.z = -Math.atan2(fwd.x, -fwd.z)

    // Hard and dark underfoot, soft and faint from altitude.
    ;(m.material as MeshBasicMaterial).opacity = shadow.opacity
  })

  return (
    // Flat on the ground. The circle is squashed along the bird's axis so the
    // silhouette reads as a wingspan rather than a puddle.
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 1]} renderOrder={1}>
      <circleGeometry args={[1, 24]} />
      <meshBasicMaterial color="#14202a" transparent opacity={0.4} depthWrite={false} />
    </mesh>
  )
}
