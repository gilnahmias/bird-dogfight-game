/**
 * The animals, and the loop they exist for: catch, carry, bank.
 *
 * A pool of prey is kept around the bird and topped up as it moves, so the world
 * always has something to hunt without simulating animals hundreds of metres
 * away. Caught animals leave the pool and ride in the talons until the bird
 * passes its nest.
 */
import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { FWD, UP } from '../flight/physics.ts'
import {
  canBank,
  canCatch,
  loadOf,
  type Prey,
  spawnPreyAround,
  talonPoint,
  valueOf,
} from './prey.ts'
import { useGame } from '../game/store.ts'
import { T } from '../game/constants.ts'

/** How many animals are alive around the bird at once. */
const POOL = 46
/** They are kept inside this radius, and topped up beyond this one. */
const RANGE = 620
const REFRESH_AT = 380

const fwd = new Vector3()
const down = new Vector3()
const grab = new Vector3()

/* oxlint-disable react/immutability -- `bird` is the simulation state object,
   deliberately shared and mutated in place by the frame loop sixty times a
   second. Its talon load changes here because catching is what changes it; the
   rule is aimed at React props that feed rendering, which this never does. */
export function PreyField({
  bird,
  seed,
  nest,
}: {
  bird: BirdState
  seed: string
  nest: Vector3
}) {
  /*
    The frame loop owns the pool; React only holds the list to draw.

    Prey is mutated sixty times a second - caught, dropped, topped up - and none
    of that may cause a render. So the live set lives in refs, and a snapshot is
    pushed into state only on the rare frames when the membership changes.
  */
  const alive = useRef<Prey[]>([])
  const carried = useRef<Prey[]>([])
  const seeded = useRef(false)
  const lastTopUp = useRef(new Vector3(Infinity, 0, Infinity))
  const groups = useRef<Map<number, Group>>(new Map())
  const [rendered, setRendered] = useState<Prey[]>([])

  const sync = useCallback(() => setRendered([...alive.current, ...carried.current]), [])

  useFrame(() => {
    const state = useGame.getState()

    if (!seeded.current) {
      seeded.current = true
      alive.current = spawnPreyAround(bird.pos, seed, POOL, RANGE)
      lastTopUp.current.copy(bird.pos)
      sync()
    }

    // --- Top up the field as the bird travels ------------------------------
    if (bird.pos.distanceTo(lastTopUp.current) > REFRESH_AT) {
      lastTopUp.current.copy(bird.pos)
      // Drop anything far behind, and fill the gap ahead.
      alive.current = alive.current.filter((p) => p.pos.distanceTo(bird.pos) < RANGE * 1.25)
      const missing = POOL - alive.current.length
      if (missing > 0) {
        alive.current = alive.current.concat(
          spawnPreyAround(bird.pos, seed, missing, RANGE, REFRESH_AT * 0.6),
        )
      }
      sync()
    }

    // --- Catching ----------------------------------------------------------
    if (!bird.dead && bird.talons >= 0.55) {
      fwd.copy(FWD).applyQuaternion(bird.quat)
      down.copy(UP).applyQuaternion(bird.quat).negate()
      talonPoint(bird.pos, fwd, down, bird.talons, grab)

      const attempt = {
        talonPoint: grab,
        talons: bird.talons,
        load: loadOf(carried.current),
        maxLoad: T.maxLoad,
      }

      for (const prey of alive.current) {
        if (!canCatch(attempt, prey)) continue
        prey.caught = true
        carried.current.push(prey)
        alive.current = alive.current.filter((p) => p !== prey)
        attempt.load = loadOf(carried.current)
        bird.load = attempt.load
          sync()
        break // one animal per pass; the talons close on what they close on
      }
    }

    // --- Banking -----------------------------------------------------------
    if (carried.current.length > 0 && canBank(bird.pos, nest)) {
      const gained = valueOf(carried.current)
      const count = carried.current.length
      carried.current = []
      bird.load = 0
      useGame.setState({
        banked: state.banked + gained,
        bankedCount: state.bankedCount + count,
        carried: 0,
        load: 0,
      })
      sync()
    }

    // Losing the catch is the cost of being hit, and of hitting the ground.
    if (bird.dead && carried.current.length > 0) {
      carried.current = []
      bird.load = 0
      sync()
    }

    // --- Animate -----------------------------------------------------------
    const time = performance.now() / 1000
    for (const prey of alive.current) {
      const group = groups.current.get(prey.id)
      if (!group) continue
      if (prey.kind === 'fish') {
        // Fish hold station at the surface and flick.
        group.position.set(prey.pos.x, prey.pos.y + Math.sin(time * 2 + prey.phase) * 0.12, prey.pos.z)
        group.rotation.y = prey.heading + Math.sin(time * 1.6 + prey.phase) * 0.5
      } else {
        // Land animals hop, which is what makes them findable from the air.
        const hop = Math.max(0, Math.sin(time * 2.4 + prey.phase))
        group.position.set(prey.pos.x, prey.pos.y + hop * 0.5, prey.pos.z)
        group.rotation.y = prey.heading + Math.sin(time * 0.6 + prey.phase) * 0.8
      }
    }

    // Carried animals ride in the talons.
    for (let i = 0; i < carried.current.length; i++) {
      const group = groups.current.get(carried.current[i].id)
      if (!group) continue
      fwd.copy(FWD).applyQuaternion(bird.quat)
      down.copy(UP).applyQuaternion(bird.quat).negate()
      talonPoint(bird.pos, fwd, down, bird.talons, grab)
      group.position.copy(grab).addScaledVector(fwd, -i * 0.42)
      group.rotation.y = 0
      group.rotation.x = Math.PI * 0.5
    }

    // Keep the HUD in step without writing to it every frame.
    if (state.carried !== carried.current.length || state.load !== loadOf(carried.current)) {
      useGame.setState({ carried: carried.current.length, load: loadOf(carried.current) })
    }
  })

  return (
    <group>
      {rendered.map((prey) => (
        <group
          key={prey.id}
          ref={(node) => {
            if (node) groups.current.set(prey.id, node)
            else groups.current.delete(prey.id)
          }}
          position={prey.pos}
        >
          <Animal kind={prey.kind} />
        </group>
      ))}
    </group>
  )
}

/* oxlint-enable react/immutability */

const FUR = '#8a6b4a'
const FUR_DARK = '#5d4630'
const SCALE = '#b9c6cf'

function Animal({ kind }: { kind: Prey['kind'] }) {
  if (kind === 'fish') {
    return (
      <group>
        <mesh scale={[0.5, 0.32, 1]}>
          <sphereGeometry args={[0.55, 8, 6]} />
          <meshStandardMaterial color={SCALE} roughness={0.35} metalness={0.35} flatShading />
        </mesh>
        <mesh position={[0, 0, 0.62]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.3, 0.42, 4]} />
          <meshStandardMaterial color={SCALE} roughness={0.4} metalness={0.3} flatShading />
        </mesh>
      </group>
    )
  }

  const big = kind === 'rabbit'
  const size = big ? 1 : 0.55
  return (
    <group scale={size}>
      {/* body */}
      <mesh scale={[0.62, 0.6, 1]}>
        <sphereGeometry args={[0.46, 8, 6]} />
        <meshStandardMaterial color={FUR} roughness={1} flatShading />
      </mesh>
      {/* head */}
      <mesh position={[0, 0.22, -0.46]}>
        <sphereGeometry args={[0.26, 8, 6]} />
        <meshStandardMaterial color={FUR_DARK} roughness={1} flatShading />
      </mesh>
      {/* ears - what makes a rabbit read as a rabbit from the air */}
      {big &&
        [-0.12, 0.12].map((x) => (
          <mesh key={x} position={[x, 0.52, -0.46]} rotation={[0.2, 0, x * 1.6]}>
            <capsuleGeometry args={[0.055, 0.32, 3, 6]} />
            <meshStandardMaterial color={FUR_DARK} roughness={1} flatShading />
          </mesh>
        ))}
      {/* tail */}
      <mesh position={[0, 0.12, 0.44]}>
        <sphereGeometry args={[0.15, 6, 5]} />
        <meshStandardMaterial color="#d8cfc0" roughness={1} flatShading />
      </mesh>
    </group>
  )
}
