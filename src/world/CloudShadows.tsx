/**
 * The shade clouds throw on the ground.
 *
 * Cumulus marks a thermal, so its shadow marks one too: the dark patches sliding
 * across the hills are the same columns of lift the bird is hunting for, seen
 * from the other end. That makes the shading a gameplay cue rather than dressing.
 *
 * Each cloud gets one soft disc, projected along the sun onto the ground the way
 * the bird's shadow is. Softness comes from a generated radial-gradient texture -
 * no file to load - and the whole set is one instanced draw call.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { meshHeightAt } from './terrain.ts'
import { SUN_DIRECTION } from './sky.ts'
import { WORLD } from '../game/constants.ts'

const CAPACITY = 24
/** Horizontal metres the shadow is thrown per metre of cloud height. */
const REACH = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) / SUN_DIRECTION.y
const CAST = new Vector3(-SUN_DIRECTION.x, 0, -SUN_DIRECTION.z).normalize()

/** A soft round blot, drawn once into a canvas rather than loaded from a file. */
function shadowTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Flat in the middle, falling away over the outer half: a cloud shadow has a
  // soft edge but a solid core.
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.92)')
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.42)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

export type CloudPatch = { position: Vector3; radius: number }

export function CloudShadows({
  patches,
  seed,
  drift,
}: {
  patches: CloudPatch[]
  seed: string
  drift: { current: Vector3 }
}) {
  const mesh = useRef<InstancedMesh>(null)
  const texture = useMemo(() => shadowTexture(), [])
  const scratch = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
      p: new Vector3(),
      s: new Vector3(),
    }),
    [],
  )

  useEffect(() => () => texture.dispose(), [texture])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const { q, p, s, m: matrix } = scratch

    for (let i = 0; i < CAPACITY; i++) {
      const patch = patches[i]
      if (!patch) {
        m.setMatrixAt(i, matrix.makeScale(0, 0, 0))
        continue
      }
      // Clouds are carried downwind between rebuilds; their shade goes with them.
      const x0 = patch.position.x + drift.current.x
      const z0 = patch.position.z + drift.current.z

      // Where the sun ray from the cloud meets the ground. One pass is plenty:
      // the blot is hundreds of metres across and its edge is soft.
      let groundY = Math.max(
        meshHeightAt(x0, z0, seed, WORLD.lodSegments[0]),
        WORLD.waterLevel,
      )
      const reach = Math.max(0, patch.position.y - groundY) * REACH
      const x = x0 + CAST.x * reach
      const z = z0 + CAST.z * reach
      groundY = Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)

      p.set(x, groundY + 0.5, z)
      s.setScalar(patch.radius * 2.3)
      m.setMatrixAt(i, matrix.compose(p, q, s))
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CAPACITY]} frustumCulled={false} renderOrder={0}>
      <planeGeometry args={[1, 1]} />
      {/*
        Light: this is shade, not a hole. It also has to stay lighter than the
        bird's own shadow, which the player reads for altitude.
      */}
      <meshBasicMaterial
        map={texture}
        color="#42556b"
        transparent
        opacity={0.3}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-3}
        polygonOffsetUnits={-3}
      />
    </instancedMesh>
  )
}
