/**
 * Flocks in the sky, and crows that mob the player.
 *
 * Every flock bird of a kind is one instance of one mesh, so the whole sky of
 * them costs three draw calls. A distant bird is a silhouette, and a silhouette
 * is what these are: a body and a pair of wings bent into a shallow V. Flapping
 * is the V flipping, which is all a flap is from two hundred metres.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import type { BirdState } from '../flight/physics.ts'
import { RIGHT } from '../flight/physics.ts'
import { useGame } from '../game/store.ts'
import {
  type Flock,
  FLOCK_STYLE,
  type FlockKind,
  flocksNear,
  memberAt,
  MOB,
  type Mobber,
  stepMobber,
  swatsCrow,
} from './flocks.ts'

/** How far out flocks are drawn, and how far the bird moves before we look again. */
const FLOCK_RANGE = 1400
const RELOOK_AFTER = 400
/** Instances allocated per kind. */
const CAPACITY = 220

const COLOURS: Record<FlockKind, string> = {
  gull: '#e8ecee',
  crow: '#1c1d22',
  swallow: '#28324f',
}

/**
 * A bird silhouette: a slim diamond body and two wings whose tips sit ABOVE the
 * shoulders. Scaled by a negative amount in Y, the tips drop below - so a flap is
 * one number per instance, and the geometry never changes.
 */
function silhouette(): BufferGeometry {
  // prettier-ignore
  const v = [
    // body: nose, left, tail, right (a flat diamond), plus a spine point on top
    0, 0, -0.9,   -0.18, 0, 0,   0, 0, 0.9,   0.18, 0, 0,   0, 0.12, 0,
    // left wing: shoulder front, shoulder back, tip back, tip front. A broad
    // wing with a blunt, fingered tip rather than a spike: seen from behind in a
    // chase a pointed triangle is edge-on and all but disappears.
    -0.12, 0, -0.3,   -0.12, 0, 0.35,   -1.5, 0.45, 0.45,   -1.65, 0.45, 0.02,
    // right wing
    0.12, 0, -0.3,   0.12, 0, 0.35,   1.5, 0.45, 0.45,   1.65, 0.45, 0.02,
  ]
  // prettier-ignore
  const index = [
    0, 1, 4,   1, 2, 4,   2, 3, 4,   3, 0, 4,
    0, 3, 2,   0, 2, 1,
    5, 6, 7,   5, 7, 8,
    9, 11, 10, 9, 12, 11,
  ]
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

const member = { pos: new Vector3(), heading: 0, flap: 0 }
const matrix = new Matrix4()
const turn = new Quaternion()
const scale = new Vector3()
const up = new Vector3(0, 1, 0)
const right = new Vector3()
const hidden = new Matrix4().makeScale(0, 0, 0)

type Mob = { flock: number; crows: Mobber[] }

/** A stable React key per crow, for as long as that crow exists. */
const crowKeys = new WeakMap<Mobber, number>()
let nextCrowKey = 1
function keyOf(crow: Mobber): number {
  let key = crowKeys.get(crow)
  if (key === undefined) {
    key = nextCrowKey++
    crowKeys.set(crow, key)
  }
  return key
}

/* oxlint-disable react/immutability -- `bird` is the simulation state object,
   mutated in place by the frame loop by design. A peck changes the bird's
   velocity because that is what being pecked does. */
export function Flocks({ bird, seed }: { bird: BirdState; seed: string }) {
  const geometry = useMemo(() => silhouette(), [])
  const meshes = useRef<Partial<Record<FlockKind, InstancedMesh | null>>>({})
  const [flocks, setFlocks] = useState<Flock[]>(() =>
    flocksNear(bird.pos.x, bird.pos.z, FLOCK_RANGE, seed),
  )
  const built = useRef(bird.pos.clone())
  const mobs = useRef<Mob[]>([])
  const [mobCrows, setMobCrows] = useState<Mobber[]>([])
  const crowViews = useRef<Map<Mobber, CrowView>>(new Map())
  const restUntil = useRef<Map<number, number>>(new Map())

  useFrame((frame, delta) => {
    const time = frame.clock.elapsedTime
    const dt = Math.min(delta, 0.05)

    if (bird.pos.distanceTo(built.current) > RELOOK_AFTER) {
      built.current.copy(bird.pos)
      setFlocks(flocksNear(bird.pos.x, bird.pos.z, FLOCK_RANGE, seed))
    }

    // --- The crows notice you -------------------------------------------
    if (!bird.dead && !bird.perched) {
      for (const flock of flocks) {
        if (flock.kind !== 'crow') continue
        if (mobs.current.some((m) => m.flock === flock.id)) continue
        if ((restUntil.current.get(flock.id) ?? 0) > time) continue
        if (flock.centre.distanceTo(bird.pos) > MOB.range) continue
        const crows: Mobber[] = []
        for (let i = 0; i < Math.min(MOB.size, flock.size); i++) {
          memberAt(flock, i, time, member, seed)
          const toward = bird.pos.clone().sub(member.pos).setLength(MOB.speed)
          crows.push({ pos: member.pos.clone(), vel: toward, timer: MOB.seconds, cooldown: 0.6, done: false })
        }
        mobs.current.push({ flock: flock.id, crows })
        restUntil.current.set(flock.id, time + MOB.rest)
        setMobCrows(mobs.current.flatMap((m) => m.crows))
      }
    }

    // --- Mobbing ---------------------------------------------------------
    let active = 0
    for (const mob of mobs.current) {
      for (const crow of mob.crows) {
        if (!crow.done && swatsCrow({ pos: bird.pos, vel: bird.vel, talons: bird.talons }, crow)) {
          // Knocked out of the air: it tumbles away, and that is the end of it.
          crow.done = true
          crow.vel.set(crow.vel.x * 0.3, -8, crow.vel.z * 0.3)
          useGame.setState({ crowsSwatted: useGame.getState().crowsSwatted + 1 })
          continue
        }
        const event = stepMobber(crow, bird, dt)
        if (event === 'peck' && !bird.dead) {
          /*
            A peck: a little speed gone and a shove to one side. Never the catch
            and never the run - crows are a nuisance, and the thing to learn from
            them is that a raptor can simply leave.
          */
          bird.vel.multiplyScalar(MOB.peckKeep)
          right.copy(RIGHT).applyQuaternion(bird.quat)
          bird.vel.addScaledVector(right, (Math.random() - 0.5) * 5)
          useGame.setState({ pecked: useGame.getState().pecked + 1 })
        }
        if (!crow.done) active++
      }
    }
    // Forget mobs once every crow in them has gone home.
    const mobsBefore = mobs.current.length
    mobs.current = mobs.current.filter((m) =>
      m.crows.some((c) => !c.done || c.pos.distanceTo(bird.pos) < 250),
    )
    if (mobs.current.length !== mobsBefore) setMobCrows(mobs.current.flatMap((m) => m.crows))
    if (useGame.getState().mobbed !== active) useGame.setState({ mobbed: active })

    // Dev builds only: hand the flocks and any mob to the bridge for testing.
    if (import.meta.env.DEV) {
      const bridge = (window as unknown as { game?: { flocks?: Flock[]; mobs?: Mob[] } }).game
      if (bridge) {
        bridge.flocks = flocks
        bridge.mobs = mobs.current
      }
    }

    // --- Draw ------------------------------------------------------------
    const counts: Record<FlockKind, number> = { gull: 0, crow: 0, swallow: 0 }
    const put = (kind: FlockKind, pos: Vector3, heading: number, flap: number) => {
      const mesh = meshes.current[kind]
      if (!mesh || counts[kind] >= CAPACITY) return
      const size = FLOCK_STYLE[kind].scale
      turn.setFromAxisAngle(up, heading)
      scale.set(size, size * flap, size)
      mesh.setMatrixAt(counts[kind]++, matrix.compose(pos, turn, scale))
    }

    for (const flock of flocks) {
      // Crows that have left to mob are not also still circling at home.
      const away = mobs.current.find((m) => m.flock === flock.id)?.crows.length ?? 0
      for (let i = away; i < flock.size; i++) {
        memberAt(flock, i, time, member, seed)
        put(flock.kind, member.pos, member.heading, member.flap)
      }
    }
    // Mobbing crows are close enough to be seen properly, so they are real
    // models rather than silhouettes: position and wings, set here.
    for (const mob of mobs.current) {
      for (const crow of mob.crows) {
        const view = crowViews.current.get(crow)
        if (!view?.body) continue
        view.body.position.copy(crow.pos)
        view.body.rotation.set(crow.done ? time * 5 : 0, Math.atan2(-crow.vel.x, -crow.vel.z), 0)
        const flap = Math.sin(time * 16 + crow.pos.x) * 0.85
        if (view.left) view.left.rotation.z = flap
        if (view.right) view.right.rotation.z = -flap
      }
    }

    for (const kind of Object.keys(counts) as FlockKind[]) {
      const mesh = meshes.current[kind]
      if (!mesh) continue
      for (let i = counts[kind]; i < mesh.count; i++) mesh.setMatrixAt(i, hidden)
      mesh.count = Math.max(counts[kind], 1)
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      {mobCrows.map((crow) => (
        <MobCrow
          key={keyOf(crow)}
          onView={(view) => {
            if (view) crowViews.current.set(crow, view)
            else crowViews.current.delete(crow)
          }}
        />
      ))}
      {(['gull', 'crow', 'swallow'] as const).map((kind) => (
        <instancedMesh
          key={kind}
          ref={(node) => {
            meshes.current[kind] = node
          }}
          args={[geometry, undefined, CAPACITY]}
          frustumCulled={false}
        >
          <meshStandardMaterial color={COLOURS[kind]} roughness={0.9} flatShading side={DoubleSide} />
        </instancedMesh>
      ))}
    </group>
  )
}
/* oxlint-enable react/immutability */

type CrowView = { body: Group | null; left: Group | null; right: Group | null }

const CROW_BLACK = '#17181c'
const CROW_SHEEN = '#2b2f3a'

/**
 * A crow near enough to peck you: a real little bird, not a silhouette.
 *
 * Seen from five metres the flat silhouette the flocks use is a black
 * parallelogram, which is not something anyone reads as a crow. Only the few
 * birds actually mobbing get this, so the cost stays a handful of meshes.
 */
function MobCrow({ onView }: { onView: (view: CrowView | null) => void }) {
  const view = useRef<CrowView>({ body: null, left: null, right: null })
  return (
    <group
      ref={(node) => {
        view.current.body = node
        onView(node ? view.current : null)
      }}
      scale={1.7}
    >
      {/* body */}
      <mesh scale={[0.26, 0.22, 0.55]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={CROW_BLACK} roughness={0.55} flatShading />
      </mesh>
      {/* head and beak */}
      <mesh position={[0, 0.1, -0.52]} scale={0.17}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={CROW_SHEEN} roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, 0.07, -0.74]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.05, 0.2, 5]} />
        <meshStandardMaterial color="#0c0c0e" roughness={0.4} />
      </mesh>
      {/* tail fan */}
      <mesh position={[0, 0.02, 0.62]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.15]}>
        <coneGeometry args={[0.2, 0.45, 5]} />
        <meshStandardMaterial color={CROW_BLACK} roughness={0.6} flatShading />
      </mesh>
      {/* wings, hinged at the shoulder so they can beat */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * 0.2, 0.06, -0.05]}
          ref={(node) => {
            if (side < 0) view.current.left = node
            else view.current.right = node
          }}
        >
          <mesh position={[side * 0.46, 0, 0.05]} scale={[0.92, 0.04, 0.36]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={CROW_BLACK} roughness={0.6} flatShading />
          </mesh>
          {/* fingered tip */}
          <mesh position={[side * 0.98, 0, 0.12]} scale={[0.3, 0.03, 0.26]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={CROW_SHEEN} roughness={0.6} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  )
}
