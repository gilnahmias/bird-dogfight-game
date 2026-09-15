/**
 * The bird's shadow on the ground.
 *
 * This is an altitude instrument, not decoration. Over open terrain there is
 * nothing to judge height against, and the altimeter is not something you can
 * read while threading a valley.
 *
 * It is cast along the sun, not straight down. Straight down seems like the
 * obvious choice for judging height - the shadow sits right under you - but it
 * puts the shadow roughly 86 degrees below the camera's sightline at cruising
 * altitude, which is far outside the field of view. A shadow you can never see
 * measures nothing. Cast along the sun it lands out ahead, sweeps toward the
 * bird as it descends, and meets it on touchdown, which is both what real flight
 * looks like and a far better read on height.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { type Mesh, type MeshBasicMaterial, Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { meshHeightAt } from './terrain.ts'
import { shadowFor } from './shadow.ts'
import { SUN_DIRECTION } from './sky.ts'
import { FWD } from '../flight/physics.ts'
import { WORLD } from '../game/constants.ts'

/** How many times to refine the landing point against the terrain under it. */
const SOLVE_STEPS = 4

const fwd = new Vector3()
/** Horizontal direction the shadow is thrown, away from the sun. */
const cast = new Vector3(-SUN_DIRECTION.x, 0, -SUN_DIRECTION.z).normalize()
/** Horizontal metres travelled per metre of altitude. */
const REACH = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) / SUN_DIRECTION.y

export function Shadow({ state, seed }: { state: BirdState; seed: string }) {
  const mesh = useRef<Mesh>(null)

  useFrame(() => {
    const m = mesh.current
    if (!m) return

    // Where the sun ray from the bird meets the ground. Solved by iteration
    // rather than marched: guess a landing height, walk the ray that far, sample
    // the ground there, repeat. It settles in a few rounds even over a slope,
    // and costs a handful of samples instead of dozens.
    let groundY = Math.max(meshHeightAt(state.pos.x, state.pos.z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)
    let x = state.pos.x
    let z = state.pos.z
    for (let i = 0; i < SOLVE_STEPS; i++) {
      const drop = state.pos.y - groundY
      if (drop <= 0) break
      const reach = drop * REACH
      x = state.pos.x + cast.x * reach
      z = state.pos.z + cast.z * reach
      groundY = Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)
    }

    // Height above the ground it is actually cast onto.
    const height = state.pos.y - groundY
    const look = shadowFor(height)
    m.visible = look.visible && !state.dead
    if (!m.visible) return

    m.position.set(x, groundY + 0.3, z)
    // Slightly elongated so the blob reads as a wingspan rather than a puddle.
    m.scale.set(look.size, look.size * 0.7, 1)

    // Turn with the bird so the blob reads as a bird, not as a dot.
    fwd.copy(FWD).applyQuaternion(state.quat)
    m.rotation.z = -Math.atan2(fwd.x, -fwd.z)
    ;(m.material as MeshBasicMaterial).opacity = look.opacity
  })

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <circleGeometry args={[1, 24]} />
      {/*
        polygonOffset pulls the blob toward the camera in depth without moving it
        in space, so it cannot sink into a slope between terrain vertices the way
        a fixed height offset does.
      */}
      <meshBasicMaterial
        color="#101c26"
        transparent
        opacity={0.4}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
      />
    </mesh>
  )
}
