/**
 * The player's raptor: owns the flight state, drives the simulation, and draws a
 * bird around it.
 *
 * The simulation runs on a fixed 1/120s step with an accumulator. A variable dt
 * straight from the frame loop makes the aerodynamics feel different on different
 * machines, and a single long frame (alt-tab) would launch the bird into orbit.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { ExtrudeGeometry, Group, Shape, Vector3 } from 'three'
import { createBird, resolveGround, step, type BirdState } from './physics.ts'
import { input } from './input.ts'
import { T } from '../game/constants.ts'
import { biomeAt, heightAt } from '../world/terrain.ts'
import { useGame } from '../game/store.ts'
import { createAirSample, sampleAir } from '../world/air.ts'
import { applyWingPose, wingPose } from './wingPose.ts'

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
  const left: WingJoints = {
    shoulder: useRef<Group>(null),
    elbow: useRef<Group>(null),
    wrist: useRef<Group>(null),
  }
  const right: WingJoints = {
    shoulder: useRef<Group>(null),
    elbow: useRef<Group>(null),
    wrist: useRef<Group>(null),
  }
  const accumulator = useRef(0)
  const telemetryClock = useRef(0)
  const wingPhase = useRef(0)
  const setTelemetry = useGame((s) => s.setTelemetry)
  const air = useMemo(() => createAirSample(), [])

  // Lock the wings out of the render loop's way on mount.
  useEffect(() => {
    wingPhase.current = 0
  }, [state])

  useFrame((frame, delta) => {
    accumulator.current += Math.min(delta, MAX_STEPS * FIXED_DT)

    // Sampled once per frame, not once per substep. The air field changes over
    // tens of metres and the bird covers about one metre per substep, so this is
    // free accuracy given up for a real saving in noise lookups.
    if (!state.dead) sampleAir(state.pos, seed, air, frame.clock.elapsedTime)

    let steps = 0
    while (accumulator.current >= FIXED_DT && steps < MAX_STEPS) {
      accumulator.current -= FIXED_DT
      steps++

      if (state.dead) break
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

    // Wings. The stroke travels out from the shoulder rather than the whole wing
    // swinging as one piece, which is the difference between a wing and a plank.
    const beatsPerSecond = 1 / T.flapInterval
    if (state.flapping) wingPhase.current += delta * beatsPerSecond
    else wingPhase.current += delta * 0.32 // a slow idle breath, so it never looks frozen

    const pose = wingPose(wingPhase.current, state.flapping, state.airspeed)

    for (const wing of [left, right]) {
      const { shoulder, elbow, wrist } = wing
      if (!shoulder.current || !elbow.current || !wrist.current) continue
      applyWingPose(
        { shoulder: shoulder.current, elbow: elbow.current, wrist: wrist.current },
        pose,
      )
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
        lift: air.lift,
        load: state.load,
        dead: state.dead,
      })
    }
  })

  return (
    <group ref={root}>
      <BirdModel left={left} right={right} />
    </group>
  )
}

const FEATHER = '#6b4f35'
const FEATHER_DARK = '#4a3524'
const FEATHER_LIGHT = '#8a6a48'
const BELLY = '#d8cbb4'

/**
 * Low-poly raptor built from primitives. Forward is -Z. → skipped: a real
 * modelled and skinned bird, add when the flight loop is proven fun.
 */
function BirdModel({ left, right }: { left: WingJoints; right: WingJoints }) {
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

      <group position={[0.35, 0.12, 0]}>
        <Wing joints={left} />
      </group>
      {/*
        The mirror sits on a group the animation never writes to. The flap
        animation sets scale.x on the shoulder every frame to tuck the wing, and
        if the mirror lived there it would be wiped out on the first frame and
        fold both wings onto the same side of the bird.
      */}
      <group position={[-0.35, 0.12, 0]} scale={[-1, 1, 1]}>
        <Wing joints={right} />
      </group>
    </group>
  )
}

/**
 * Wing plan-form, split at the elbow and again at the wrist.
 *
 * It is three pieces rather than one because a wing that pivots only at the
 * shoulder reads as a board. Splitting it lets the stroke travel outward, with
 * each joint trailing the one inboard of it.
 */
function innerShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.62)
  s.quadraticCurveTo(1.0, -0.8, 2.0, -0.72)
  s.lineTo(2.0, 0.82)
  s.quadraticCurveTo(1.0, 0.86, 0, 0.66)
  s.closePath()
  return s
}

function outerShape(): Shape {
  const s = new Shape()
  s.moveTo(0, -0.72)
  s.quadraticCurveTo(1.0, -0.6, 1.95, -0.06)
  s.lineTo(1.9, 0.4)
  s.quadraticCurveTo(1.0, 0.74, 0, 0.82)
  s.closePath()
  return s
}

/**
 * One feather, as an outline in the wing's own plane.
 *
 * Feathers are built as arrays of shapes fed to a single ExtrudeGeometry rather
 * than as a mesh each: ExtrudeGeometry accepts many shapes and merges them, so a
 * whole row of primaries costs one draw call. That matters once the sky has
 * rival raptors in it, not just this one.
 *
 * `angle` splays the feather; 0 points straight back along the chord.
 */
function feather(cx: number, cy: number, length: number, width: number, angle: number): Shape {
  const outline: [number, number][] = [
    [0, 0],
    [width * 0.5, length * 0.28],
    [width * 0.36, length * 0.76],
    [0, length],
    [-width * 0.36, length * 0.76],
    [-width * 0.5, length * 0.28],
  ]
  const shape = new Shape()
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  outline.forEach(([px, py], i) => {
    const x = cx + px * cos - py * sin
    const y = cy + px * sin + py * cos
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()
  return shape
}

/** A row of feathers laid along the span, fanning as they go outboard. */
function featherRow(
  count: number,
  spanFrom: number,
  spanTo: number,
  chord: number,
  lengthFrom: number,
  lengthTo: number,
  width: number,
  angleFrom: number,
  angleTo: number,
): Shape[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    return feather(
      spanFrom + (spanTo - spanFrom) * t,
      chord,
      lengthFrom + (lengthTo - lengthFrom) * t,
      width,
      angleFrom + (angleTo - angleFrom) * t,
    )
  })
}

/** Secondaries: the short feathers along the trailing edge of the inner wing. */
function secondaryShapes(): Shape[] {
  return featherRow(7, 0.15, 1.95, 0.55, 0.78, 0.92, 0.3, 0.16, -0.1)
}

/** Coverts: the small overlapping feathers that sheathe the leading edge. */
function covertShapes(): Shape[] {
  return featherRow(6, 0.25, 1.8, -0.5, 0.5, 0.42, 0.26, 2.9, 3.25)
}

/** Primaries: the long fingers at the wingtip that splay in a glide. */
function primaryShapes(): Shape[] {
  return featherRow(6, 0.0, 0.7, -0.05, 1.5, 1.15, 0.3, 1.25, 2.05)
}

/** Tail feathers, fanned rather than a single slab. */
function tailShapes(): Shape[] {
  return featherRow(7, -0.42, 0.42, 0, 1.25, 1.25, 0.34, -0.42, 0.42)
}

const EXTRUDE = { depth: 0.09, bevelEnabled: false } as const
const FEATHER_EXTRUDE = { depth: 0.05, bevelEnabled: false } as const

/** Lay an extruded plan-form flat: chord along Z, thickness in Y. */
const FLAT: [number, number, number] = [Math.PI / 2, 0, 0]

/** Where the elbow sits along the wing, and the wrist beyond it. */
const ELBOW_X = 2.0
const WRIST_X = 1.95

export type WingJoints = {
  shoulder: RefObject<Group | null>
  elbow: RefObject<Group | null>
  wrist: RefObject<Group | null>
}

/* oxlint-disable react/refs -- handing a ref object to `ref=` is what refs are
   for; the rule is aimed at reading `.current` during render, which this does
   not do. The joints have to be refs because the frame loop poses them 60 times
   a second and must never trigger a render. */
function Wing({ joints }: { joints: WingJoints }) {
  const inner = useMemo(() => new ExtrudeGeometry(innerShape(), EXTRUDE), [])
  const outer = useMemo(() => new ExtrudeGeometry(outerShape(), EXTRUDE), [])
  const secondaries = useMemo(() => new ExtrudeGeometry(secondaryShapes(), FEATHER_EXTRUDE), [])
  const coverts = useMemo(() => new ExtrudeGeometry(covertShapes(), FEATHER_EXTRUDE), [])
  const primaries = useMemo(() => new ExtrudeGeometry(primaryShapes(), FEATHER_EXTRUDE), [])

  return (
    <group ref={joints.shoulder}>
      <mesh geometry={inner} rotation={FLAT} castShadow>
        <meshStandardMaterial color={FEATHER} roughness={0.9} flatShading />
      </mesh>
      {/* sat just above and below the panel so both faces show feathering */}
      <mesh geometry={secondaries} position={[0, 0.045, 0]} rotation={FLAT}>
        <meshStandardMaterial color={FEATHER_DARK} roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={coverts} position={[0, 0.07, 0]} rotation={FLAT}>
        <meshStandardMaterial color={FEATHER_LIGHT} roughness={0.95} flatShading />
      </mesh>

      <group ref={joints.elbow} position={[ELBOW_X, 0, 0]}>
        <mesh geometry={outer} rotation={FLAT} castShadow>
          <meshStandardMaterial color={FEATHER} roughness={0.92} flatShading />
        </mesh>

        <group ref={joints.wrist} position={[WRIST_X, 0, 0]}>
          <mesh geometry={primaries} rotation={FLAT}>
            <meshStandardMaterial color={FEATHER_DARK} roughness={0.95} flatShading />
          </mesh>
        </group>
      </group>
    </group>
  )
}
/* oxlint-enable react/refs */

function Tail() {
  const tail = useMemo(() => new ExtrudeGeometry(tailShapes(), FEATHER_EXTRUDE), [])
  return (
    <mesh geometry={tail} position={[0, 0.02, 0.95]} rotation={FLAT}>
      <meshStandardMaterial color={FEATHER_DARK} roughness={0.9} flatShading />
    </mesh>
  )
}
