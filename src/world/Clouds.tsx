/**
 * Cumulus clouds, and the sun.
 *
 * The clouds are not decoration. Real cumulus forms at the top of a thermal,
 * where rising air cools enough for its moisture to condense - so a cloud marks
 * a column of lift underneath it. Placing them over the thermal field makes the
 * sky readable from a distance: fly toward the clouds to find lift, and the
 * empty blue between them is where you sink.
 *
 * Each cloud is a clump of instanced blobs sharing one draw call, refreshed when
 * the player moves a chunk rather than every frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { thermalAt, windDirection } from './air.ts'
import { heightAt } from './terrain.ts'
import { jitter } from './terrain.ts'
import { AIR, WORLD } from '../game/constants.ts'
import { SUN_DIRECTION, SUN_DISTANCE } from './sky.ts'

/** Blobs per cloud, and clouds in the sky around the player. */
const PUFFS_PER_CLOUD = 7
const MAX_CLOUDS = 26
const PUFF_CAPACITY = MAX_CLOUDS * PUFFS_PER_CLOUD

/** How far out clouds are placed, and how strong a thermal has to be to raise one. */
const RANGE = 1700
const SEARCH_STEP = 300
const MIN_THERMAL = 1.6

/** Cloudbase sits just above the top of the thermals that feed it. */
const CLOUDBASE = AIR.thermalCeiling * 0.88

type Puff = { pos: Vector3; scale: number; spin: number }

function buildClouds(centreX: number, centreZ: number, seed: string, time: number): Puff[] {
  const puffs: Puff[] = []

  for (let dz = -RANGE; dz <= RANGE && puffs.length < PUFF_CAPACITY; dz += SEARCH_STEP) {
    for (let dx = -RANGE; dx <= RANGE && puffs.length < PUFF_CAPACITY; dx += SEARCH_STEP) {
      const x = centreX + dx
      const z = centreZ + dz
      const ground = heightAt(x, z, seed)
      if (ground < WORLD.waterLevel) continue // no cumulus over cold water

      const strength = thermalAt(x, ground + AIR.thermalCeiling * 0.5, z, seed, time)
      if (strength < MIN_THERMAL) continue

      // Bigger cloud over a stronger thermal, so the sky shows you where the
      // best lift is, not merely that some exists.
      const size = 46 + (strength / AIR.thermalGain) * 72
      const base = ground + CLOUDBASE

      for (let i = 0; i < PUFFS_PER_CLOUD; i++) {
        const a = (i / PUFFS_PER_CLOUD) * Math.PI * 2 + jitter(x, z, i) * 1.5
        const r = i === 0 ? 0 : size * (0.35 + jitter(x + i, z, 2) * 0.55)
        puffs.push({
          pos: new Vector3(
            x + Math.cos(a) * r,
            base + (jitter(x, z + i, 3) - 0.3) * size * 0.3,
            z + Math.sin(a) * r,
          ),
          scale: size * (i === 0 ? 0.62 : 0.3 + jitter(x, z, 4 + i) * 0.34),
          spin: jitter(x + i, z + i, 5) * Math.PI,
        })
      }
    }
  }
  return puffs
}

/**
 * How often the sky is rebuilt against the drifting thermal field.
 *
 * Between rebuilds the clouds are carried downwind at exactly the speed the
 * thermals move, so they stay over their own lift. Rebuilding resets that offset
 * to zero and re-places them at the new time, which lines up with where they had
 * already drifted to - so there is no jump.
 */
const REBUILD_SECONDS = 24

export function Clouds({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const mesh = useRef<InstancedMesh>(null)
  const [centre, setCentre] = useState<[number, number]>([0, 0])
  const [epoch, setEpoch] = useState(0)
  const last = useRef('')
  const drift = useMemo(() => new Vector3(), [])

  useFrame((frame) => {
    const s = WORLD.chunkSize * 3
    const cx = Math.round(target.current.x / s)
    const cz = Math.round(target.current.z / s)
    const key = `${cx},${cz}`
    if (key !== last.current) {
      last.current = key
      setCentre([cx * s, cz * s])
    }
    const wanted = Math.floor(frame.clock.elapsedTime / REBUILD_SECONDS)
    if (wanted !== epoch) setEpoch(wanted)
  })

  const puffs = useMemo(
    () => buildClouds(centre[0], centre[1], seed, epoch * REBUILD_SECONDS),
    [centre, seed, epoch],
  )

  useEffect(() => {
    if (!mesh.current) return
    const m = new Matrix4()
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const scale = new Vector3()
    for (let i = 0; i < PUFF_CAPACITY; i++) {
      const puff = puffs[i]
      if (!puff) {
        mesh.current.setMatrixAt(i, m.makeScale(0, 0, 0))
        continue
      }
      q.setFromAxisAngle(up, puff.spin)
      // Squashed: cumulus is wider than it is tall, with a flat base.
      scale.set(puff.scale, puff.scale * 0.62, puff.scale)
      mesh.current.setMatrixAt(i, m.compose(puff.pos, q, scale))
    }
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [puffs])

  // Carried downwind at the same speed as the thermals below, so a cloud stays
  // over the lift that made it.
  useFrame((frame) => {
    if (!mesh.current) return
    const since = frame.clock.elapsedTime - epoch * REBUILD_SECONDS
    windDirection(seed, drift).multiplyScalar(AIR.windSpeed * since)
    mesh.current.position.set(drift.x, 0, drift.z)
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, PUFF_CAPACITY]}
      frustumCulled={false}
      renderOrder={-1}
    >
      <icosahedronGeometry args={[1, 1]} />
      {/*
        Opaque on purpose. Seven overlapping blobs per cloud with transparency
        would sort against each other and flicker as the camera turns; solid
        blobs just read as a lumpy cumulus, which is what they are.
      */}
      <meshStandardMaterial color="#f6f8fb" roughness={1} flatShading />
    </instancedMesh>
  )
}

/**
 * The sun itself: a disc with a soft corona, parked far off in the sun
 * direction and carried with the camera so it never comes any closer.
 */
export function Sun() {
  const group = useRef<Mesh>(null)
  const glow = useRef<Mesh>(null)

  useFrame((frame) => {
    const offset = SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).add(frame.camera.position)
    group.current?.position.copy(offset)
    glow.current?.position.copy(offset)
    group.current?.lookAt(frame.camera.position)
    glow.current?.lookAt(frame.camera.position)
  })

  return (
    <group>
      {/*
        depthTest stays ON. The sun is a real object out in the world, so a ridge
        in front of it has to hide it - with the test off it painted straight
        over the mountains and read as a sticker on the lens.
      */}
      <mesh ref={glow} renderOrder={-2}>
        <circleGeometry args={[190, 32]} />
        <meshBasicMaterial
          color="#ffcf87"
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={group} renderOrder={-1}>
        <circleGeometry args={[46, 32]} />
        <meshBasicMaterial
          color="#fffaf0"
          transparent
          opacity={1}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
