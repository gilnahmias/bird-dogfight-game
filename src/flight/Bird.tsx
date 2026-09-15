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
import { DoubleSide, ExtrudeGeometry, Group, Shape, ShapeGeometry, Vector3 } from 'three'
import { createBird, resolveGround, step, type BirdState } from './physics.ts'
import { input } from './input.ts'
import { T } from '../game/constants.ts'
import { biomeAt, heightAt } from '../world/terrain.ts'
import { useGame } from '../game/store.ts'
import { createAirSample, sampleAir } from '../world/air.ts'
import { applyWingPose, wingPose } from './wingPose.ts'
import {
  alula,
  armShape,
  ELBOW_X,
  greaterCoverts,
  handShape,
  lesserCoverts,
  primaries,
  secondaries,
  tailFeathers,
  WRIST_X,
} from './wingShapes.ts'

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
  const feet = { left: useRef<Group>(null), right: useRef<Group>(null) }
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
    // The wings never stop. A bird under power is always working, and a frozen
    // glider pose was the single thing that most made this read as a model plane.
    wingPhase.current += delta / T.flapInterval

    const pose = wingPose(wingPhase.current, true, state.airspeed)

    // Feet: tucked up in flight, thrown forward and open on the brake.
    for (const foot of [feet.left.current, feet.right.current]) {
      if (!foot) continue
      foot.rotation.x = -1.15 + state.talons * 1.55
      foot.position.z = 0.02 - state.talons * 0.34
      foot.position.y = state.talons * 0.06
    }

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
        lift: air.lift,
        load: state.load,
        talons: state.talons,
        perched: state.perched,
        dead: state.dead,
      })
    }
  })

  return (
    <group ref={root}>
      <BirdModel left={left} right={right} feet={feet} />
    </group>
  )
}

const FEATHER = '#6b4f35'
const FEATHER_MID = '#5b422c'
const FEATHER_DARK = '#3f2c1e'
const FEATHER_LIGHT = '#8a6a48'
const BELLY = '#d8cbb4'

/**
 * Low-poly raptor built from primitives. Forward is -Z. → skipped: a real
 * modelled and skinned bird, add when the flight loop is proven fun.
 */
function BirdModel({
  left,
  right,
  feet,
}: {
  left: WingJoints
  right: WingJoints
  feet: { left: RefObject<Group | null>; right: RefObject<Group | null> }
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
      {/* The feet. These are the weapon, so they get built properly. */}
      <Foot side={-1} grip={feet.left} />
      <Foot side={1} grip={feet.right} />

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

const SCALE_SKIN = '#e0b545'
const CLAW = '#2a2420'

/**
 * A raptor's foot: a feathered leg, three forward toes and a hallux behind,
 * each toe two jointed segments ending in a hooked claw.
 *
 * Built as a group that can be curled, because the talons are about to become a
 * verb rather than a decoration - held tucked in flight, thrown forward and
 * open to strike or to take prey.
 */
function Toe({
  spread,
  pitch,
  length,
  claw,
}: {
  spread: number
  pitch: number
  length: number
  claw: number
}) {
  return (
    <group rotation={[pitch, spread, 0]}>
      {/* first segment */}
      <mesh position={[0, 0, -length * 0.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, length, 5]} />
        <meshStandardMaterial color={SCALE_SKIN} roughness={0.55} flatShading />
      </mesh>
      {/* second segment, angled down toward the claw */}
      <group position={[0, 0, -length]} rotation={[0.7, 0, 0]}>
        <mesh position={[0, 0, -length * 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.035, length * 0.64, 5]} />
          <meshStandardMaterial color={SCALE_SKIN} roughness={0.55} flatShading />
        </mesh>
        {/* the hook */}
        <mesh
          position={[0, -0.04, -length * 0.64 - 0.06]}
          rotation={[claw, 0, 0]}
          castShadow
        >
          <coneGeometry args={[0.035, 0.26, 6]} />
          <meshStandardMaterial color={CLAW} roughness={0.35} metalness={0.15} flatShading />
        </mesh>
      </group>
    </group>
  )
}

function Foot({ side, grip }: { side: number; grip: RefObject<Group | null> }) {
  return (
    <group position={[side * 0.19, -0.3, 0.16]}>
      {/* feathered thigh, so the leg does not sprout from nothing */}
      <mesh position={[0, -0.02, 0.04]} castShadow>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color={FEATHER_LIGHT} roughness={0.95} flatShading />
      </mesh>
      {/* tarsus */}
      <group ref={grip}>
        <mesh position={[0, -0.16, 0.02]} castShadow>
          <cylinderGeometry args={[0.05, 0.058, 0.3, 6]} />
          <meshStandardMaterial color={SCALE_SKIN} roughness={0.55} flatShading />
        </mesh>
        <group position={[0, -0.3, 0]}>
          <Toe spread={side * 0.42} pitch={0.2} length={0.2} claw={1.15} />
          <Toe spread={side * 0.06} pitch={0.12} length={0.24} claw={1.2} />
          <Toe spread={-side * 0.34} pitch={0.22} length={0.19} claw={1.15} />
          {/* hallux: the back toe, the one that does the killing */}
          <Toe spread={Math.PI - side * 0.12} pitch={0.3} length={0.17} claw={1.35} />
        </group>
      </group>
    </group>
  )
}

const SPAR = { depth: 0.07, bevelEnabled: false } as const

/** Lay a flat plan-form out: chord along Z, thickness in Y. */
const FLAT: [number, number, number] = [Math.PI / 2, 0, 0]

export type WingJoints = {
  shoulder: RefObject<Group | null>
  elbow: RefObject<Group | null>
  wrist: RefObject<Group | null>
}

/**
 * A row of flat feathers. Stacked at slightly different heights so they layer
 * rather than fight for the same pixels, and double sided because a plane with
 * no thickness has no back.
 */
function Feathers({
  shapes,
  color,
  lift,
}: {
  shapes: Shape[]
  color: string
  lift: number
}) {
  const geometry = useMemo(() => new ShapeGeometry(shapes, 8), [shapes])
  return (
    <mesh geometry={geometry} position={[0, lift, 0]} rotation={FLAT}>
      <meshStandardMaterial
        color={color}
        roughness={0.95}
        flatShading
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

/* oxlint-disable react/refs -- handing a ref object to `ref=` is what refs are
   for; the rule is aimed at reading `.current` during render, which this does
   not do. The joints have to be refs because the frame loop poses them 60 times
   a second and must never trigger a render. */
function Wing({ joints }: { joints: WingJoints }) {
  const arm = useMemo(() => new ExtrudeGeometry(armShape(), SPAR), [])
  const hand = useMemo(() => new ExtrudeGeometry(handShape(), SPAR), [])

  return (
    <group ref={joints.shoulder}>
      <mesh geometry={arm} rotation={FLAT} castShadow>
        <meshStandardMaterial color={FEATHER} roughness={0.9} flatShading />
      </mesh>
      <Feathers shapes={useMemo(() => secondaries(), [])} color={FEATHER} lift={0.0} />
      <Feathers shapes={useMemo(() => greaterCoverts(), [])} color={FEATHER_MID} lift={0.05} />
      <Feathers shapes={useMemo(() => lesserCoverts(), [])} color={FEATHER_LIGHT} lift={0.09} />

      <group ref={joints.elbow} position={[ELBOW_X, 0, 0]}>
        <mesh geometry={hand} rotation={FLAT} castShadow>
          <meshStandardMaterial color={FEATHER} roughness={0.92} flatShading />
        </mesh>

        <group ref={joints.wrist} position={[WRIST_X, 0, 0]}>
          <Feathers shapes={useMemo(() => primaries(), [])} color={FEATHER_DARK} lift={-0.01} />
          <Feathers shapes={useMemo(() => alula(), [])} color={FEATHER_LIGHT} lift={0.07} />
        </group>
      </group>
    </group>
  )
}
/* oxlint-enable react/refs */

function Tail() {
  const shapes = useMemo(() => tailFeathers(), [])
  return (
    <group position={[0, 0.02, 0.95]}>
      <Feathers shapes={shapes} color={FEATHER_DARK} lift={0} />
      {/* upper tail coverts, covering where the fan meets the body */}
      <mesh position={[0, 0.06, -0.08]} rotation={FLAT}>
        <circleGeometry args={[0.34, 10]} />
        <meshStandardMaterial color={FEATHER} roughness={0.95} flatShading side={DoubleSide} />
      </mesh>
    </group>
  )
}
