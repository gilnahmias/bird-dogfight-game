/**
 * Dust and seed heads carried up by the rising air.
 *
 * A variometer tells you lift is here, but only after you are already in it.
 * These make lift something you can *see* from a distance and steer toward,
 * which is the difference between hunting for thermals and reading the sky.
 *
 * One instanced mesh, so the whole effect is a single draw call. Motes sample
 * the cheap thermal field only - never the full air sample, which would need the
 * surface normal per mote per frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { surfaceAt, thermalAt } from './air.ts'
import { AIR } from '../game/constants.ts'

const COUNT = 95
/** Motes live in a box this wide around the bird. */
const RANGE = 150
const HEIGHT = 190
/** Below this the air is not worth showing, so the mote is recycled. */
const MIN_LIFT = 1.4

type Mote = {
  pos: Vector3
  spin: number
  scale: number
  /**
   * Empty sky is the common case, and hunting for lift costs noise lookups. A
   * mote that fails to find any waits before trying again, so flying over a dead
   * valley does not burn the frame budget on 150 failed searches every frame.
   */
  retryAt: number
}

export function Motes({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const mesh = useRef<InstancedMesh>(null)

  // Seeded on mount rather than during render: these are random, and random
  // belongs in an effect, not in the render pass.
  const motes = useRef<Mote[]>([])
  useEffect(() => {
    motes.current = Array.from({ length: COUNT }, () => ({
      pos: new Vector3(Infinity, Infinity, Infinity), // parked until first placed
      spin: Math.random() * Math.PI * 2,
      scale: 0.35 + Math.random() * 0.5,
      retryAt: Math.random() * 0.6, // stagger the first search across frames
    }))
    if (!mesh.current) return
    const m = new Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < COUNT; i++) mesh.current.setMatrixAt(i, m)
    mesh.current.instanceMatrix.needsUpdate = true
  }, [])

  const scratch = useMemo(
    () => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), up: new Vector3(0, 1, 0) }),
    [],
  )

  useFrame((frame, delta) => {
    if (!mesh.current || motes.current.length === 0) return
    const centre = target.current
    const time = frame.clock.elapsedTime
    const { m, q, s, up } = scratch

    for (let i = 0; i < COUNT; i++) {
      const mote = motes.current[i]
      const outOfRange =
        !Number.isFinite(mote.pos.x) ||
        Math.abs(mote.pos.x - centre.x) > RANGE ||
        Math.abs(mote.pos.z - centre.z) > RANGE ||
        mote.pos.y - centre.y > HEIGHT * 0.6 ||
        centre.y - mote.pos.y > HEIGHT * 0.6

      let lift = outOfRange ? 0 : thermalAt(mote.pos.x, mote.pos.y, mote.pos.z, seed, time)

      if (outOfRange || lift < MIN_LIFT) {
        if (time < mote.retryAt) {
          mesh.current.setMatrixAt(i, m.makeScale(0, 0, 0))
          continue
        }
        // Look for rising air somewhere near the bird, and give up quietly if
        // there is none - empty sky should look empty.
        let placed = false
        for (let tries = 0; tries < 2 && !placed; tries++) {
          const x = centre.x + (Math.random() - 0.5) * 2 * RANGE
          const z = centre.z + (Math.random() - 0.5) * 2 * RANGE
          const y = Math.max(
            surfaceAt(x, z, seed) + 12,
            centre.y + (Math.random() - 0.5) * HEIGHT * 0.7,
          )
          if (thermalAt(x, y, z, seed, time) >= MIN_LIFT) {
            mote.pos.set(x, y, z)
            mote.scale = 0.55 + Math.random() * 0.7
            placed = true
          }
        }
        if (!placed) {
          mote.pos.set(Infinity, Infinity, Infinity)
          mote.retryAt = time + 0.4 + Math.random() * 0.8
          mesh.current.setMatrixAt(i, m.makeScale(0, 0, 0))
          continue
        }
        lift = thermalAt(mote.pos.x, mote.pos.y, mote.pos.z, seed, time)
      }

      // Ride the air: up with the thermal, and downwind with everything else.
      mote.pos.y += lift * delta
      mote.spin += delta * 1.6

      // Fade in at the edges of the box so motes do not pop into existence.
      const edge =
        1 -
        Math.max(
          Math.abs(mote.pos.x - centre.x) / RANGE,
          Math.abs(mote.pos.z - centre.z) / RANGE,
          Math.abs(mote.pos.y - centre.y) / (HEIGHT * 0.6),
        )
      const scale = mote.scale * Math.max(0, Math.min(1, edge * 2.5)) * Math.min(1, lift / AIR.thermalGain + 0.35)

      q.setFromAxisAngle(up, mote.spin)
      s.setScalar(scale)
      mesh.current.setMatrixAt(i, m.compose(mote.pos, q, s))
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      {/*
        Unlit on purpose. Lit blobs in mid-air are shaded dark against a bright
        sky and read as dirt on the screen rather than as sunlit dust.
      */}
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial color="#fff1cf" transparent opacity={0.5} depthWrite={false} />
    </instancedMesh>
  )
}
