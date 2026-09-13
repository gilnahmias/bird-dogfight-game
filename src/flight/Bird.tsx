/**
 * The player's raptor: owns the flight state, drives the simulation, and draws a
 * bird around it.
 *
 * The simulation runs on a fixed 1/120s step with an accumulator. A variable dt
 * straight from the frame loop makes the aerodynamics feel different on different
 * machines, and a single long frame (alt-tab) would launch the bird into orbit.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ExtrudeGeometry, Group, Shape, Vector3 } from 'three'
import { createBird, resolveGround, step, type BirdState } from './physics.ts'
import { input } from './input.ts'
import { T } from '../game/constants.ts'
import { biomeAt, heightAt } from '../world/terrain.ts'
import { useGame } from '../game/store.ts'
import { sampleAir } from '../world/air.ts'

const FIXED_DT = 1 / 120
const MAX_STEPS = 8
const TELEMETRY_INTERVAL = 0.1

export function Bird({
  state,
  seed,
  spawn,
  heading,
}: {
  state: BirdState
  seed: string
  spawn: Vector3
  heading: number
}) {
  const root = useRef<Group>(null)
  const leftWing = useRef<Group>(null)
  const rightWing = useRef<Group>(null)
  const accumulator = useRef(0)
  const telemetryClock = useRef(0)
  const wingPhase = useRef(0)
  const setTelemetry = useGame((s) => s.setTelemetry)
  const air = useMemo(() => ({ wind: new Vector3() }), [])

  // Lock the wings out of the render loop's way on mount.
  useEffect(() => {
    wingPhase.current = 0
  }, [state])

  useFrame((_, delta) => {
    accumulator.current += Math.min(delta, MAX_STEPS * FIXED_DT)

    let steps = 0
    while (accumulator.current >= FIXED_DT && steps < MAX_STEPS) {
      accumulator.current -= FIXED_DT
      steps++

      if (state.dead) break
      sampleAir(state.pos, seed, air)
      step(state, input, air, FIXED_DT)

      const ground = heightAt(state.pos.x, state.pos.z, seed)
      const wet = biomeAt(state.pos.x, state.pos.z, seed) === 'water'
      resolveGround(state, wet ? Math.max(ground, 0) : ground, wet, FIXED_DT)
    }

    // Restart after a crash.
    if (state.dead && input.restart) {
      const fresh = createBird(spawn, heading)
      Object.assign(state, {
        ...fresh,
        pos: state.pos.copy(fresh.pos),
        vel: state.vel.copy(fresh.vel),
        quat: state.quat.copy(fresh.quat),
      })
      useGame.getState().reset()
    }

    // --- Draw --------------------------------------------------------------
    if (root.current) {
      root.current.position.copy(state.pos)
      root.current.quaternion.copy(state.quat)
    }

    // Wings. Beating while flapping, held out in a glide, swept back when fast.
    const beatsPerSecond = 1 / T.flapInterval
    if (state.flapping) wingPhase.current += delta * beatsPerSecond
    else wingPhase.current += delta * 0.35 // a slow idle breath, so it never looks frozen

    const amplitude = state.flapping ? 0.95 : 0.12
    const beat = Math.sin(wingPhase.current * Math.PI * 2) * amplitude
    // Tuck: at high airspeed the wings sweep back and shorten, which is most of
    // what makes a dive read as a dive.
    const tuck = Math.min(1, Math.max(0, (state.airspeed - 26) / 18))
    const dihedral = state.flapping ? 0.06 : 0.16
    for (const [wing, side] of [
      [leftWing.current, 1],
      [rightWing.current, -1],
    ] as const) {
      if (!wing) continue
      wing.rotation.z = side * (dihedral + beat)
      wing.rotation.y = side * tuck * -0.55
      wing.scale.x = 1 - tuck * 0.3
    }

    telemetryClock.current += delta
    if (telemetryClock.current >= TELEMETRY_INTERVAL) {
      telemetryClock.current = 0
      const ground = heightAt(state.pos.x, state.pos.z, seed)
      setTelemetry({
        airspeed: state.airspeed,
        altitudeAgl: state.pos.y - ground,
        altitudeMsl: state.pos.y,
        climbRate: state.climbRate,
        stamina: state.stamina,
        stallWarn: state.stallWarn,
        stalled: state.stalled,
        load: state.load,
        dead: state.dead,
      })
    }
  })

  return (
    <group ref={root}>
      <BirdModel leftWing={leftWing} rightWing={rightWing} />
    </group>
  )
}

const FEATHER = '#6b4f35'
const FEATHER_DARK = '#4a3524'
const BELLY = '#d8cbb4'

/**
 * Low-poly raptor built from primitives. Forward is -Z. → skipped: a real
 * modelled and skinned bird, add when the flight loop is proven fun.
 */
function BirdModel({
  leftWing,
  rightWing,
}: {
  leftWing: React.RefObject<Group | null>
  rightWing: React.RefObject<Group | null>
}) {
  return (
    <group>
      {/* body */}
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.42, 1.5, 4, 10]} />
        <meshStandardMaterial color={FEATHER} roughness={0.85} />
      </mesh>
      {/* belly, so the bird reads differently from above and below */}
      <mesh position={[0, -0.22, 0.05]} rotation={[Math.PI / 2, 0, 0]} scale={[0.92, 1, 0.55]}>
        <capsuleGeometry args={[0.4, 1.4, 4, 10]} />
        <meshStandardMaterial color={BELLY} roughness={0.9} />
      </mesh>
      {/* head */}
      <mesh position={[0, 0.22, -1.05]} castShadow>
        <sphereGeometry args={[0.34, 12, 10]} />
        <meshStandardMaterial color={FEATHER_DARK} roughness={0.85} />
      </mesh>
      {/* beak */}
      <mesh position={[0, 0.14, -1.42]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.38, 6]} />
        <meshStandardMaterial color="#e0b341" roughness={0.6} />
      </mesh>
      <Tail />
      {/* talons, tucked under - these are the weapon, so they should be visible */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, -0.45, 0.35]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.1, 0.12, 0.5]} />
          <meshStandardMaterial color="#d8b23a" roughness={0.5} />
        </mesh>
      ))}

      <group ref={leftWing} position={[0.35, 0.12, 0]}>
        <Wing />
      </group>
      {/*
        The mirror sits on an inner group on purpose. The flap animation writes
        scale.x on the outer group every frame to tuck the wing, and if the
        mirror lived there the animation would wipe it out on the first frame and
        fold both wings onto the same side of the bird.
      */}
      <group ref={rightWing} position={[-0.35, 0.12, 0]}>
        <group scale={[-1, 1, 1]}>
          <Wing />
        </group>
      </group>
    </group>
  )
}

/**
 * Wing plan-form. Boxes read as a plank from the chase camera, which is the one
 * angle the player always has, so the wing is an extruded outline instead:
 * broad chord at the shoulder, swept and tapered to the tip, with the primaries
 * split off as separate feathers so the tip is not a solid edge.
 *
 * Built in the span/chord plane and laid flat by the mesh rotation below.
 */
function wingShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.62) // shoulder, leading edge
  s.quadraticCurveTo(1.6, -0.86, 3.0, -0.5) // leading edge, swept back
  s.lineTo(4.15, -0.02) // toward the wrist
  s.lineTo(4.05, 0.42)
  s.quadraticCurveTo(2.4, 0.92, 1.0, 0.86) // trailing edge
  s.lineTo(0, 0.66)
  s.closePath()
  return s
}

/** A single primary feather, splayed off the wingtip. */
function featherShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.11)
  s.quadraticCurveTo(0.7, -0.15, 1.35, -0.02)
  s.lineTo(1.35, 0.05)
  s.quadraticCurveTo(0.7, 0.16, 0, 0.13)
  s.closePath()
  return s
}

function tailShape(): Shape {
  const s = new Shape()
  s.moveTo(-0.16, 0)
  s.lineTo(0.16, 0)
  s.lineTo(0.62, 1.35) // fanned out at the back
  s.lineTo(-0.62, 1.35)
  s.closePath()
  return s
}

const EXTRUDE = { depth: 0.09, bevelEnabled: false } as const

/** Lay an extruded plan-form flat: chord along Z, thickness in Y. */
const FLAT: [number, number, number] = [Math.PI / 2, 0, 0]

function Wing() {
  const wing = useMemo(() => new ExtrudeGeometry(wingShape(), EXTRUDE), [])
  const feather = useMemo(() => new ExtrudeGeometry(featherShape(), EXTRUDE), [])
  return (
    <group>
      <mesh geometry={wing} rotation={FLAT} castShadow>
        <meshStandardMaterial color={FEATHER} roughness={0.9} flatShading />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          geometry={feather}
          position={[4.0 + i * 0.06, 0.005, -0.05 + i * 0.2]}
          rotation={[Math.PI / 2, 0, -0.18 - i * 0.13]}
        >
          <meshStandardMaterial color={FEATHER_DARK} roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function Tail() {
  const tail = useMemo(() => new ExtrudeGeometry(tailShape(), EXTRUDE), [])
  return (
    <mesh geometry={tail} position={[0, 0.02, 0.95]} rotation={FLAT}>
      <meshStandardMaterial color={FEATHER_DARK} roughness={0.9} flatShading />
    </mesh>
  )
}
