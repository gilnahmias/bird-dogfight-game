/**
 * Rival raptors in the world: spawning, striking, and being struck.
 *
 * The rule itself lives in rivals.ts and is symmetric - this only feeds the
 * player and each rival into it and applies what comes back. Deliberately
 * forgiving: a rival that lands a strike takes your catch and knocks you about,
 * it does not kill you. The thing being taught is "commit from above", and you
 * cannot learn it from a game that ends the run the first time you get it wrong.
 */
import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Quaternion, Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { FWD } from '../flight/physics.ts'
import { BirdModel, type WingJoints } from '../flight/RaptorModel.tsx'
import { applyWingPose, wingPose } from '../flight/wingPose.ts'
import { heightAt } from '../world/terrain.ts'
import { useGame } from '../game/store.ts'
import { RIVAL, resolveStrike, stepRival, type Rival } from './rivals.ts'

/** How many rivals are in the air at once. */
const MAX_RIVALS = 2
/** How far out they appear, and how far out they are forgotten. */
const SPAWN_RANGE = 520
const FORGET_RANGE = 1500
/** Seconds between a kill (either way) and the next rival turning up. */
const RESPAWN_DELAY = 12
/** Seconds after being hit during which the player cannot be hit again. */
const MERCY = 4
/** Speed the player keeps after a rival connects. */
const KNOCK = 0.55

let nextId = 1

const fwd = new Vector3()
const rivalFwd = new Vector3()
const spin = new Quaternion()

function spawnRival(near: Vector3, heading: Vector3, seed: string): Rival {
  // Ahead of the bird rather than anywhere around it: a rival that appears
  // behind a bird travelling at twenty-five metres a second is a rival the
  // player never meets.
  const facing = Math.atan2(heading.x, heading.z)
  const angle = facing + (Math.random() - 0.5) * 1.6
  const range = SPAWN_RANGE * (0.7 + Math.random() * 0.5)
  const x = near.x + Math.cos(angle) * range
  const z = near.z + Math.sin(angle) * range
  // Comes in at the player's own height, not above it: a rival that appears
  // already holding the advantage has skipped the part the player can read.
  const y = Math.max(near.y, heightAt(x, z, seed) + 60)
  // Facing back toward the bird it has come to look at.
  const inbound = angle + Math.PI
  return {
    id: nextId++,
    pos: new Vector3(x, y, z),
    vel: new Vector3(Math.cos(inbound), 0, Math.sin(inbound)).multiplyScalar(RIVAL.cruise),
    mode: 'patrol',
    timer: 0,
    home: new Vector3(x, y, z),
    spin: Math.random() < 0.5 ? -1 : 1,
    dead: false,
    dying: 0,
  }
}

/* oxlint-disable react/immutability -- `bird` is the simulation state object,
   shared and mutated in place by the frame loop by design. A strike changes the
   bird's velocity because that is what being hit does. */
export function Rivals({ bird, seed }: { bird: BirdState; seed: string }) {
  const rivals = useRef<Rival[]>([])
  const groups = useRef<Map<number, Group>>(new Map())
  const joints = useRef<Map<number, { left: WingJoints; right: WingJoints }>>(new Map())
  const cooldown = useRef(RESPAWN_DELAY * 0.4)
  const mercy = useRef(0)
  const [rendered, setRendered] = useState<Rival[]>([])
  const sync = useCallback(() => setRendered([...rivals.current]), [])

  useFrame((frame, delta) => {
    const dt = Math.min(delta, 0.05)
    const time = frame.clock.elapsedTime
    mercy.current = Math.max(0, mercy.current - dt)

    // --- Who is around -----------------------------------------------------
    const before = rivals.current.length
    rivals.current = rivals.current.filter(
      (r) =>
        r.pos.distanceTo(bird.pos) < FORGET_RANGE &&
        !(r.dead && (r.dying > 6 || r.pos.y < heightAt(r.pos.x, r.pos.z, seed))),
    )
    cooldown.current -= dt
    // None turn up while the bird is standing in its nest: the game should not
    // open with something already hunting you.
    if (
      rivals.current.length < MAX_RIVALS &&
      cooldown.current <= 0 &&
      !bird.perched &&
      !bird.dead
    ) {
      rivals.current.push(spawnRival(bird.pos, fwd.copy(FWD).applyQuaternion(bird.quat), seed))
      cooldown.current = RESPAWN_DELAY
    }
    if (rivals.current.length !== before) sync()

    // --- Fly them ----------------------------------------------------------
    fwd.copy(FWD).applyQuaternion(bird.quat)
    const quarry = { pos: bird.pos, vel: bird.vel, perched: bird.perched, dead: bird.dead }
    const player = { pos: bird.pos, vel: bird.vel, forward: fwd }

    let threat: 'none' | 'watching' | 'diving' = 'none'
    let bearing = 0

    for (const rival of rivals.current) {
      stepRival(rival, quarry, dt, time)
      if (rival.dead) continue

      // Never let a rival fly into the ground.
      const floor = heightAt(rival.pos.x, rival.pos.z, seed) + 25
      if (rival.pos.y < floor) {
        rival.pos.y = floor
        if (rival.vel.y < 0) rival.vel.y *= -0.2
      }

      rivalFwd.copy(rival.vel).normalize()
      const strike = resolveStrike({ pos: rival.pos, vel: rival.vel, forward: rivalFwd }, player)

      if (strike === 'attacker' && mercy.current <= 0 && !bird.dead) {
        // Hit. The catch goes, the bird is thrown off, and there is a moment of
        // grace so a single pass cannot turn into a mauling.
        bird.hit += 1
        bird.vel.multiplyScalar(KNOCK)
        mercy.current = MERCY
        rival.mode = 'overshoot'
        rival.timer = RIVAL.recover
        useGame.setState({ struck: useGame.getState().struck + 1 })
      } else if (strike === 'target') {
        // The player got it: exactly the same rule, read the other way round.
        rival.dead = true
        rival.dying = 0
        rival.vel.multiplyScalar(0.3)
        useGame.setState({ rivalsBeaten: useGame.getState().rivalsBeaten + 1 })
        sync()
      }

      if (!rival.dead) {
        const seen = rival.mode === 'commit' ? 'diving' : rival.mode === 'climb' ? 'watching' : 'none'
        if (seen === 'diving' || (seen === 'watching' && threat === 'none')) {
          threat = seen
          const dx = rival.pos.x - bird.pos.x
          const dz = rival.pos.z - bird.pos.z
          const heading = Math.atan2(fwd.x, -fwd.z)
          let delta2 = Math.atan2(dx, -dz) - heading
          while (delta2 > Math.PI) delta2 -= Math.PI * 2
          while (delta2 < -Math.PI) delta2 += Math.PI * 2
          bearing = delta2
        }
      }
    }

    if (useGame.getState().threat !== threat) useGame.setState({ threat })
    if (threat !== 'none') useGame.setState({ threatBearing: bearing })

    // --- Draw them ---------------------------------------------------------
    for (const rival of rivals.current) {
      const group = groups.current.get(rival.id)
      if (!group) continue
      group.position.copy(rival.pos)
      rivalFwd.copy(rival.vel)
      if (rivalFwd.lengthSq() > 1e-6) {
        rivalFwd.normalize()
        group.quaternion.setFromUnitVectors(FWD, rivalFwd)
        if (rival.dead) {
          // Tumbling, which is how you know you got it.
          spin.setFromAxisAngle(rivalFwd, rival.dying * 6)
          group.quaternion.premultiply(spin)
        }
      }

      const wings = joints.current.get(rival.id)
      if (!wings) continue
      // Beating hard while climbing, tucked in the dive: the wings say what the
      // rival is doing before the HUD does.
      const beating = rival.mode === 'climb' || rival.mode === 'overshoot'
      const phase = time / (beating ? 0.55 : 1.6) + rival.id
      const pose = wingPose(phase, beating && !rival.dead, rival.vel.length())
      for (const wing of [wings.left, wings.right]) {
        if (!wing.shoulder.current || !wing.elbow.current || !wing.wrist.current) continue
        applyWingPose(
          { shoulder: wing.shoulder.current, elbow: wing.elbow.current, wrist: wing.wrist.current },
          pose,
        )
      }
    }
  })

  return (
    <group>
      {rendered.map((rival) => (
        <RivalBird
          key={rival.id}
          onGroup={(node) => {
            if (node) groups.current.set(rival.id, node)
            else groups.current.delete(rival.id)
          }}
          onJoints={(set) => joints.current.set(rival.id, set)}
        />
      ))}
    </group>
  )
}
/* oxlint-enable react/immutability */

/* oxlint-disable react/refs -- handing ref objects to `ref=` and registering
   them with the frame loop is what refs are for; the rule is aimed at reading
   `.current` during render, which this does not do. The joints have to be refs
   because the frame loop poses them sixty times a second. */
function RivalBird({
  onGroup,
  onJoints,
}: {
  onGroup: (node: Group | null) => void
  onJoints: (set: { left: WingJoints; right: WingJoints }) => void
}) {
  const left: WingJoints = { shoulder: useRef(null), elbow: useRef(null), wrist: useRef(null) }
  const right: WingJoints = { shoulder: useRef(null), elbow: useRef(null), wrist: useRef(null) }
  const feet = { left: useRef<Group>(null), right: useRef<Group>(null) }

  return (
    <group
      ref={(node) => {
        onGroup(node)
        if (node) onJoints({ left, right })
      }}
    >
      <BirdModel left={left} right={right} feet={feet} />
    </group>
  )
}
/* oxlint-enable react/refs */
