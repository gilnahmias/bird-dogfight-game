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
import { Group, Vector3 } from 'three'
import { createBird, resolveGround, step, type BirdState } from './physics.ts'
import { input } from './input.ts'
import { T, WORLD } from '../game/constants.ts'
import { biomeAt, heightAt, tarnPoolAt } from '../world/terrain.ts'
import { addSplash } from '../world/splash.ts'
import { useGame } from '../game/store.ts'
import { createAirSample, sampleAir } from '../world/air.ts'
import { applyWingPose, createRhythm, stepRhythm, wingPose } from './wingPose.ts'
import { BirdModel, type WingJoints } from './RaptorModel.tsx'

const FIXED_DT = 1 / 120
const MAX_STEPS = 8
const TELEMETRY_INTERVAL = 0.1

/** How close to the middle of the nest counts as standing in it. */
const NEST_PERCH_RADIUS = 4.5

export function Bird({
  state,
  seed,
  spawn,
  heading,
  nest,
}: {
  state: BirdState
  seed: string
  spawn: Vector3
  heading: number
  /** The nest, up in the crown of its tree - a perch the terrain knows nothing about. */
  nest: Vector3
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
  const rhythm = useRef(createRhythm())
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

      const terrain = heightAt(state.pos.x, state.pos.z, seed)
      const wet = biomeAt(state.pos.x, state.pos.z, seed) === 'water'

      /*
        The nest is a surface too.

        It sits in the crown of a tree, twenty-six metres above ground that the
        contact code otherwise knows everything about - so without this the bird
        standing in its own nest is, as far as the physics is concerned, in open
        air, and the run begins by falling out of it.
      */
      const overNest =
        Math.hypot(state.pos.x - nest.x, state.pos.z - nest.z) < NEST_PERCH_RADIUS &&
        state.pos.y > nest.y - 3
      const floor = overNest ? Math.max(terrain, nest.y) : terrain
      // A mountain tarn is water too. Without this the bird passes through the
      // surface it can see and hits the basin floor a dozen metres below, so the
      // one place in the world built for a low pass over water was the one place
      // that killed you for trying it.
      const pool = tarnPoolAt(state.pos.x, state.pos.z, seed)
      const onWater = (wet || pool !== null) && !overNest
      const surface = pool ?? Math.max(terrain, WORLD.waterLevel)
      const arriving = state.vel.length()
      const contact = resolveGround(state, onWater ? surface : floor, onWater, FIXED_DT)
      // Water costs speed instead of killing, so the spray is the only thing
      // that tells the player they hit it - and where.
      if (contact === 'splash') addSplash(state.pos.x, surface, state.pos.z, arriving)
    }

    // Restart after a crash.
    if (state.dead && input.restart) {
      const fresh = createBird(spawn, heading, true)
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
    // Beats in bursts, and holds them out between. Continuous flapping reads as
    // a wind-up toy and hides the thing worth seeing, which is the air doing the
    // work; a permanently frozen glider pose reads as a model plane. The rhythm
    // is what sits between the two.
    // Standing in the nest the wings are FOLDED, not beating: a perched bird is
    // resting, and the rhythm is only about flying.
    const resting = state.perched && state.launchTimer <= 0

    stepRhythm(
      rhythm.current,
      {
        airspeed: state.airspeed,
        climbRate: state.climbRate,
        cruiseSpeed: T.cruiseSpeed,
        perched: state.perched,
      },
      delta,
    )
    if (resting) wingPhase.current += delta
    else if (rhythm.current.beating) wingPhase.current += delta / T.flapInterval
    else wingPhase.current += delta * 0.09 // the barest drift, so a glide is not a freeze

    const pose = wingPose(wingPhase.current, rhythm.current.beating, state.airspeed, {
      perched: resting,
    })
    // Published for the shadow: the mark on the ground is the bird seen from the
    // sun, so it has to narrow as the wings come up.
    /* oxlint-disable-next-line react/immutability -- `state` is the simulation
       object, shared and mutated in place by this frame loop by design; it feeds
       no props and no render. */
    state.wingAngle = pose.shoulder + pose.elbow * 0.5

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

