/**
 * Trees, as two instanced meshes (trunks and canopies) sharing one set of
 * transforms. One draw call each, rebuilt only when the player crosses a chunk
 * boundary. Placement comes from terrain.ts, so trees only ever stand on forest
 * ground that is not too steep to hold them.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { heightAt, jitter, sampleGround } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const CANDIDATES_PER_CHUNK = 110

function placeTrees(cx: number, cz: number, seed: string) {
  const out: { x: number; y: number; z: number; scale: number; spin: number }[] = []
  const r = WORLD.treeChunkRadius
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const ox = (cx + dx) * WORLD.chunkSize
      const oz = (cz + dz) * WORLD.chunkSize
      for (let i = 0; i < CANDIDATES_PER_CHUNK; i++) {
        const x = ox + jitter(ox + i, oz, 1) * WORLD.chunkSize
        const z = oz + jitter(ox, oz + i, 2) * WORLD.chunkSize
        // Reject on height alone first - that is one noise sample instead of ten,
        // and it throws out most candidates before the expensive test.
        const h = heightAt(x, z, seed)
        if (h < 2 || h > 175) continue
        const ground = sampleGround(x, z, seed)
        if (ground.biome !== 'forest' || ground.slope > 0.3) continue
        out.push({
          x,
          y: ground.h,
          z,
          scale: 0.75 + jitter(x, z, 3) * 0.7,
          spin: jitter(x, z, 4) * Math.PI * 2,
        })
        if (out.length >= WORLD.treeCount) return out
      }
    }
  }
  return out
}

const TRUNK_H = 6
const CANOPY_H = 11

export function Scatter({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const trunks = useRef<InstancedMesh>(null)
  const canopies = useRef<InstancedMesh>(null)
  const [center, setCenter] = useState<[number, number]>([0, 0])
  const last = useRef('')

  useFrame(() => {
    const cx = Math.floor(target.current.x / WORLD.chunkSize)
    const cz = Math.floor(target.current.z / WORLD.chunkSize)
    const key = `${cx},${cz}`
    if (key === last.current) return
    last.current = key
    setCenter([cx, cz])
  })

  const trees = useMemo(() => placeTrees(center[0], center[1], seed), [center, seed])

  useEffect(() => {
    const m = new Matrix4()
    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)
    for (const [mesh, height, yOffset] of [
      [trunks.current, TRUNK_H, TRUNK_H / 2],
      [canopies.current, CANOPY_H, TRUNK_H + CANOPY_H / 2 - 1.5],
    ] as const) {
      if (!mesh) continue
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i]
        pos.set(t.x, t.y + yOffset * t.scale, t.z)
        quat.setFromAxisAngle(up, t.spin)
        scale.set(t.scale, t.scale, t.scale)
        mesh.setMatrixAt(i, m.compose(pos, quat, scale))
      }
      // Anything past the real count is parked at the origin scaled to nothing.
      scale.set(0, 0, 0)
      pos.set(0, 0, 0)
      for (let i = trees.length; i < WORLD.treeCount; i++) {
        mesh.setMatrixAt(i, m.compose(pos, quat, scale))
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      void height
    }
  }, [trees])

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, WORLD.treeCount]} castShadow>
        <cylinderGeometry args={[0.35, 0.55, TRUNK_H, 5]} />
        <meshStandardMaterial color="#4a3a2c" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, WORLD.treeCount]} castShadow>
        <coneGeometry args={[3.1, CANOPY_H, 7]} />
        <meshStandardMaterial color="#2f4a2b" roughness={1} />
      </instancedMesh>
    </group>
  )
}
