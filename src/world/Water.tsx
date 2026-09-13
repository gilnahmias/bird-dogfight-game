/**
 * Water. One big plane at the water level that follows the player, so lakes and
 * rivers are simply wherever the terrain dips below it. → skipped: real water
 * shader and shoreline foam, add when the hunting loop is in and it is worth it.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh, Vector3 } from 'three'
import { WORLD } from '../game/constants.ts'

export function Water({ target }: { target: { current: Vector3 } }) {
  const mesh = useRef<Mesh>(null)
  // Wider than the camera's far plane in every direction, so the edge of the
  // plane is always beyond anything that can be drawn. Otherwise the far side of
  // the lake ends in a hard straight line across the horizon.
  const span = WORLD.chunkSize * (WORLD.viewChunks * 2 + 6)

  useFrame(() => {
    if (!mesh.current) return
    // Snap to the chunk grid so the plane never appears to slide under the bird.
    const s = WORLD.chunkSize
    mesh.current.position.set(
      Math.round(target.current.x / s) * s,
      WORLD.waterLevel,
      Math.round(target.current.z / s) * s,
    )
  })

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[span, span]} />
      <meshStandardMaterial
        color="#2e5f7a"
        transparent
        opacity={0.82}
        roughness={0.12}
        metalness={0.35}
      />
    </mesh>
  )
}
