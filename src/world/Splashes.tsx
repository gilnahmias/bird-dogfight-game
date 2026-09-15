/**
 * Draws the spray from `splash.ts`: a ring spreading across the surface and a
 * handful of droplets thrown up out of it.
 *
 * Everything is pooled and allocated once. A splash is a frame-loop event, and
 * mounting meshes for one would mean a React render in the middle of a hunting
 * pass.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  type Group,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import {
  DROPLETS,
  dropletAt,
  dropletScale,
  MAX_SPLASHES,
  ringOf,
  stepSplashes,
} from './splash.ts'

const matrix = new Matrix4()
const position = new Vector3()
const scale = new Vector3()
const NO_SPIN = new Quaternion()
const point = { x: 0, y: 0, z: 0 }
const HIDDEN = new Matrix4().makeScale(0, 0, 0)

const FOAM = '#dff1f7'

export function Splashes() {
  const drops = useRef<InstancedMesh>(null)
  const rings = useRef<Group>(null)

  useFrame((_, delta) => {
    const live = stepSplashes(Math.min(delta, 0.1))

    const mesh = drops.current
    if (mesh) {
      let n = 0
      for (const splash of live) {
        const size = dropletScale(splash)
        for (let i = 0; i < DROPLETS; i++) {
          if (!dropletAt(splash, i, point)) continue
          position.set(splash.x + point.x, splash.y + point.y, splash.z + point.z)
          scale.setScalar(size)
          mesh.setMatrixAt(n++, matrix.compose(position, NO_SPIN, scale))
        }
      }
      // Park the unused instances rather than resizing the buffer.
      for (let i = n; i < MAX_SPLASHES * DROPLETS; i++) mesh.setMatrixAt(i, HIDDEN)
      mesh.instanceMatrix.needsUpdate = true
    }

    if (rings.current) {
      rings.current.children.forEach((child, i) => {
        const splash = live[i]
        const ring = child as Mesh
        if (!splash) {
          ring.visible = false
          return
        }
        const look = ringOf(splash)
        ring.visible = true
        ring.position.set(splash.x, splash.y + 0.12, splash.z)
        ring.scale.setScalar(look.radius)
        ;(ring.material as MeshBasicMaterial).opacity = look.opacity
      })
    }
  })

  return (
    <group>
      <instancedMesh ref={drops} args={[undefined, undefined, MAX_SPLASHES * DROPLETS]} frustumCulled={false}>
        <sphereGeometry args={[1, 5, 4]} />
        {/* Not additive: glowing spray reads as sparks, and over bright water
            it disappeared into the glare instead of standing out against it. */}
        <meshBasicMaterial color={FOAM} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>
      <group ref={rings}>
        {Array.from({ length: MAX_SPLASHES }, (_, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
            {/* A unit ring, scaled as it spreads. */}
            <ringGeometry args={[0.72, 1, 24]} />
            <meshBasicMaterial color={FOAM} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
