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
import { DoubleSide, Group, type Mesh, type MeshBasicMaterial, Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { FWD, UP } from '../flight/physics.ts'
import {
  canBank,
  canCatch,
  loadOf,
  type Prey,
  GAIT,
  hopLift,
  makeFood,
  NEST_GRAB_BONUS,
  pickTarget,
  snakeTail,
  PREY,
  spawnPreyAround,
  stepPrey,
  stockedFish,
  SNAKE_LENGTH,
  surfaceFor,
  talonPoint,
  valueOf,
} from './prey.ts'
import { useGame } from '../game/store.ts'
import { stageFor } from '../game/progress.ts'
import { meshHeightAt, normalAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'
import { input } from '../flight/input.ts'
import { markRaided, nestFood, rivalNestsNear } from '../entities/rivalNests.ts'
import { collectGifts } from './talonGifts.ts'
import { T } from '../game/constants.ts'

/**
 * How many animals are alive around the bird at once.
 *
 * Raised with the rabbits in mind: at forty-six, a nest could have four of them
 * within four hundred metres, and they are the animal a player goes looking for.
 */
const POOL = 64
/** They are kept inside this radius, and topped up beyond this one. */
const RANGE = 620
const REFRESH_AT = 380

/** How far out rival nests have their food put in. */
const NEST_STOCK_RANGE = 700
/** Seconds between checks for a raided nest refilling. */
const RESTOCK_CHECK = 4

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
  const wasDropping = useRef(false)
  const lastHit = useRef(0)
  const lastRestock = useRef(0)
  const lastTopUp = useRef(new Vector3(Infinity, 0, Infinity))
  const groups = useRef<Map<number, Group>>(new Map())
  const ring = useRef<Mesh>(null)
  const [rendered, setRendered] = useState<Prey[]>([])

  const sync = useCallback(() => setRendered([...alive.current, ...carried.current]), [])

  /*
    Make sure every lake in range holds its fish.

    The scatter alone left lakes empty - a hundred metre pool inside a six
    hundred metre circle almost never wins the draw, and the pool of animals
    fills up with rabbits first. Stocked fish carry ids derived from their tarn,
    so re-stocking on every top-up cannot pile a second shoal on the first, and
    one already caught stays caught.
  */
  const stockLakes = useCallback(
    (current: Prey[]) => {
      const known = new Set([...current, ...carried.current].map((p) => p.id))
      const missing = stockedFish(bird.pos, seed).filter((fish) => !known.has(fish.id))
      return missing.length ? current.concat(missing) : current
    },
    [bird, seed],
  )

  /*
    And every rival nest in range holds its food.

    Same stable-id trick as the lakes. Raided slots stay empty until they
    restock, and that is remembered by the nests module, not here - the field
    forgets animals as the bird flies away, but a raid has to survive that.
  */
  const stockNests = useCallback(
    (current: Prey[], now: number) => {
      // No nests yet at this stage, so no food in them either.
      if (!stageFor(useGame.getState().bankedCount).nests) {
        return current.some((p) => p.nest !== undefined) ? current.filter((p) => p.nest === undefined) : current
      }
      const known = new Set([...current, ...carried.current].map((p) => p.id))
      const food = rivalNestsNear(bird.pos.x, bird.pos.z, NEST_STOCK_RANGE, seed, nest).flatMap((n) =>
        nestFood(n, now),
      )
      const missing = food.filter((f) => !known.has(f.id))
      return missing.length ? current.concat(missing) : current
    },
    [bird, seed, nest],
  )

  useFrame((_, frameDelta) => {
    const state = useGame.getState()
    const now = performance.now() / 1000

    if (!seeded.current) {
      seeded.current = true
      alive.current = stockNests(stockLakes(spawnPreyAround(bird.pos, seed, POOL, RANGE)), now)
      lastTopUp.current.copy(bird.pos)
      lastRestock.current = now
      sync()
    }

    // A raided nest refills while the bird hangs about waiting for it, not only
    // when it flies off far enough to top the whole field up.
    if (now - lastRestock.current > RESTOCK_CHECK) {
      lastRestock.current = now
      const before = alive.current.length
      alive.current = stockNests(alive.current, now)
      if (alive.current.length !== before) sync()
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
      alive.current = stockNests(stockLakes(alive.current), now)
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
        // Taken from a rival's nest: that slot is empty until it restocks.
        if (prey.nest !== undefined) markRaided(prey.id, now)
        carried.current.push(prey)
        alive.current = alive.current.filter((p) => p !== prey)
        attempt.load = loadOf(carried.current)
        bird.load = attempt.load
          sync()
        break // one animal per pass; the talons close on what they close on
      }
    }

    // --- Handed over -------------------------------------------------------
    /*
      Food won off a rival. Into the talons if there is room for it; otherwise
      it falls to the ground below and waits there, so beating a rival while
      already fully loaded still leaves the prize on the map.
    */
    const gifts = collectGifts()
    if (gifts.length) {
      for (const gift of gifts) {
        const food = makeFood(gift.kind, gift.at)
        if (!bird.dead && loadOf(carried.current) + PREY[gift.kind].weight <= T.maxLoad) {
          food.caught = true
          carried.current.push(food)
          bird.load = loadOf(carried.current)
        } else {
          food.pos.y = surfaceFor(gift.kind, food.pos.x, food.pos.z, seed)
          alive.current = alive.current.concat(food)
        }
      }
      sync()
    }

    // --- Letting go --------------------------------------------------------
    /*
      Dropping is edge-triggered, because the key is held for a moment and a
      held key would otherwise drop one animal per frame. A dropped catch is not
      destroyed - it falls back to the ground and can be taken again, which makes
      letting go a decision about weight rather than a punishment.
    */
    if (input.drop && !wasDropping.current && carried.current.length > 0) {
      for (const prey of carried.current) {
        prey.caught = false
        prey.pos.set(bird.pos.x, surfaceFor(prey.kind, bird.pos.x, bird.pos.z, seed), bird.pos.z)
      }
      alive.current = alive.current.concat(carried.current)
      carried.current = []
      bird.load = 0
      sync()
    }
    wasDropping.current = input.drop

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

    // Losing the catch is the cost of being hit by a rival...
    if (bird.hit !== lastHit.current) {
      lastHit.current = bird.hit
      if (carried.current.length > 0) {
        for (const prey of carried.current) {
          prey.caught = false
          prey.pos.set(bird.pos.x, surfaceFor(prey.kind, bird.pos.x, bird.pos.z, seed), bird.pos.z)
        }
        alive.current = alive.current.concat(carried.current)
        carried.current = []
        bird.load = 0
        sync()
      }
    }

    // ...and of hitting the ground.
    if (bird.dead && carried.current.length > 0) {
      carried.current = []
      bird.load = 0
      sync()
    }

    // Dev builds only: hand the live animals to the bridge, so a test can find a
    // snake and fly at it. One assignment of an existing reference.
    if (import.meta.env.DEV) {
      const bridge = (window as unknown as { game?: { prey?: Prey[]; carried?: Prey[] } }).game
      if (bridge) {
        bridge.prey = alive.current
        bridge.carried = carried.current
      }
    }

    // --- Animate -----------------------------------------------------------
    const time = performance.now() / 1000
    const dt = Math.min(frameDelta, 0.1)
    for (const prey of alive.current) {
      // Rabbits and snakes actually go somewhere; the rest only animate in place.
      stepPrey(prey, dt, time, seed)
      const group = groups.current.get(prey.id)
      if (!group) continue
      if (prey.still) {
        // Food, not an animal: lying where it was left, on its side.
        group.position.copy(prey.pos)
        group.rotation.set(0, prey.heading, prey.kind === 'fish' ? 0 : 1.45)
      } else if (prey.kind === 'fish') {
        // Fish hold station at the surface and flick.
        group.position.set(prey.pos.x, prey.pos.y + Math.sin(time * 2 + prey.phase) * 0.12, prey.pos.z)
        group.rotation.y = prey.heading + Math.sin(time * 1.6 + prey.phase) * 0.5
      } else if (prey.kind === 'rabbit') {
        // Up in an arc while it travels, sat still in between.
        group.position.set(prey.pos.x, prey.pos.y + hopLift(prey, time) * GAIT.rabbit.height, prey.pos.z)
        group.rotation.y = prey.heading
      } else if (prey.kind === 'snake') {
        /*
          Lying ALONG the ground, facing where it is going.

          The body is nearly four metres long and trails straight back, so held
          level it only touches the ground at its head: on a hillside the head
          sank into the rise and the tail stuck out into the air. Pitched to the
          ground between head and tail, the whole body lies on the slope. The
          body's wave animates itself.
        */
        const backX = prey.pos.x + Math.sin(prey.heading) * SNAKE_LENGTH
        const backZ = prey.pos.z + Math.cos(prey.heading) * SNAKE_LENGTH
        const tailY = meshHeightAt(backX, backZ, seed, WORLD.lodSegments[0])
        group.position.set(prey.pos.x, prey.pos.y + 0.05, prey.pos.z)
        group.rotation.order = 'YXZ'
        // Negative: a positive pitch swings the tail (local +Z) DOWN, so a tail
        // resting on higher ground needs the nose-down sense. Checked, not assumed.
        group.rotation.set(-Math.atan2(tailY - prey.pos.y, SNAKE_LENGTH), prey.heading, 0)
      } else {
        // Mice scurry in place, which is what makes them findable from the air.
        const hop = Math.max(0, Math.sin(time * 2.4 + prey.phase))
        group.position.set(prey.pos.x, prey.pos.y + hop * 0.5, prey.pos.z)
        group.rotation.y = prey.heading + Math.sin(time * 0.6 + prey.phase) * 0.8
      }
    }

    // --- The target ring ----------------------------------------------------
    /*
      Low, or with the talons out: mark the animal the bird is lined up on, at
      the size of its catch zone, and turn it gold when a pass right now would
      take it. It answers "which one am I going for" and "am I close enough",
      which is most of what made the catch feel like luck.
    */
    const marker = ring.current
    if (marker) {
      const ground = meshHeightAt(bird.pos.x, bird.pos.z, seed, WORLD.lodSegments[0])
      const hunting = !bird.dead && !bird.perched && (bird.pos.y - ground < TARGET_ALTITUDE || bird.talons > 0.3)
      fwd.copy(FWD).applyQuaternion(bird.quat)
      const load = loadOf(carried.current)
      const target = hunting ? pickTarget(bird.pos, fwd, alive.current, load, T.maxLoad) : null
      marker.visible = target !== null
      if (target) {
        if (target.kind === 'snake' && !target.still) {
          snakeTail(target, marker.position).add(target.pos).multiplyScalar(0.5)
        } else {
          marker.position.copy(target.pos)
        }
        // Laid on the slope rather than flat, or half of it sinks into the hill.
        // Flat on water and in nests, where the ground underneath is not the surface.
        if (target.kind === 'fish' || target.nest !== undefined) slope.set(0, 1, 0)
        else slope.fromArray(normalAt(marker.position.x, marker.position.z, seed))
        marker.quaternion.setFromUnitVectors(RING_FACE, slope)
        marker.position.y = target.pos.y + 0.6
        const reach = PREY[target.kind].grabRadius + (target.nest !== undefined ? NEST_GRAB_BONUS : 0)
        marker.scale.setScalar(reach * (1 + Math.sin(time * 5) * 0.04))
        down.copy(UP).applyQuaternion(bird.quat).negate()
        // Where the talons will be a moment from now: gold has to come early
        // enough to act on, not on the frame the catch would happen anyway.
        talonPoint(bird.pos, fwd, down, 1, grab).addScaledVector(bird.vel, RING_LEAD)
        const inReach = canCatch({ talonPoint: grab, talons: 1, load, maxLoad: T.maxLoad }, target)
        const material = marker.material as MeshBasicMaterial
        material.color.set(inReach ? RING_READY : RING_AIMING)
        material.opacity = inReach ? 0.95 : 0.55
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
      <mesh ref={ring} visible={false} renderOrder={2}>
        {/* Unit radius: scaled to the catch zone of whatever it marks. */}
        <ringGeometry args={[0.86, 1, 48]} />
        {/* Drawn over the ground, not into it: a marker half hidden by the hillside
            it sits on, or by the crest in front of it, marks nothing. */}
        <meshBasicMaterial
          color={RING_AIMING}
          transparent
          opacity={0.55}
          depthWrite={false}
          depthTest={false}
          fog={false}
          // Laid on a slope, the chase camera is as often under its plane as over it.
          side={DoubleSide}
        />
      </mesh>
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

/** Below this height above the ground, the bird counts as hunting. */
const TARGET_ALTITUDE = 40
/** Seconds of warning the gold ring gives: about the time the talons take to come out. */
const RING_LEAD = 0.35
/** The ring geometry faces +Z; this turns it to face along the ground's normal. */
const RING_FACE = new Vector3(0, 0, 1)
const slope = new Vector3()
const RING_AIMING = '#f2f6fa'
const RING_READY = '#ffc94a'

const FUR = '#8a6b4a'
const FUR_DARK = '#5d4630'
const SCALE = '#8fa7b4'
const BELLY = '#e2e8ea'
const FIN = '#6d8592'

// Olive with dark bands: close enough to the grass to be a real animal, far
// enough from it that the banding catches the eye from the air.
const SNAKE = '#8c8a3c'
const SNAKE_DARK = '#2f3419'
/** Body segments, head first. */
const SNAKE_SEGMENTS = 11
const SEGMENT_GAP = 0.26
const SNAKE_SCALE = 1.35
// SNAKE_SEGMENTS * SEGMENT_GAP * SNAKE_SCALE is SNAKE_LENGTH in prey.ts, which the
// catch measures along: change one and the other has to follow.

/**
 * A snake: a tapering chain of segments, with a wave running down it.
 *
 * The wave is the whole point - a snake that slides along the ground stiff is a
 * stick being dragged, and the sideways travelling curve is what reads as
 * slithering even at a glance from fifty metres up. The segments animate
 * themselves in their own frame loop; the field only moves the snake as a whole.
 */
function Snake() {
  const segments = useRef<(Mesh | null)[]>([])

  useFrame(() => {
    const time = performance.now() / 1000
    for (let i = 0; i < SNAKE_SEGMENTS; i++) {
      const segment = segments.current[i]
      if (!segment) continue
      // The head leads the wave and barely moves; the tail swings widest.
      const reach = 0.08 + (i / SNAKE_SEGMENTS) * 0.26
      segment.position.x = Math.sin(time * 7 - i * 0.75) * reach
      segment.position.z = i * SEGMENT_GAP
    }
  })

  return (
    <group scale={SNAKE_SCALE}>
      {Array.from({ length: SNAKE_SEGMENTS }, (_, i) => {
        const taper = 1 - (i / SNAKE_SEGMENTS) * 0.72
        const banded = i % 3 === 1
        return (
          <mesh
            key={i}
            ref={(node) => {
              segments.current[i] = node
            }}
            scale={[0.16 * taper, 0.11 * taper, 0.2]}
          >
            <sphereGeometry args={[1, 7, 5]} />
            <meshStandardMaterial color={banded ? SNAKE_DARK : SNAKE} roughness={0.7} flatShading />
          </mesh>
        )
      })}
      {/* head: a flattened wedge a little wider than the neck */}
      <mesh position={[0, 0.02, -0.18]} scale={[0.19, 0.1, 0.24]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={SNAKE_DARK} roughness={0.6} flatShading />
      </mesh>
    </group>
  )
}

export function Animal({ kind }: { kind: Prey['kind'] }) {
  if (kind === 'snake') return <Snake />

  if (kind === 'fish') {
    /*
      A trout, not a pill.

      The old one was a squashed sphere with a cone stuck on the back, and from
      the air it read as a floating bead. What makes a fish a fish, seen from
      above, is the outline: a body that tapers both ways, a tail that forks, and
      fins breaking the line of it.
    */
    return (
      <group>
        {/* body, tapering to the head and to the wrist of the tail */}
        <mesh scale={[0.42, 0.3, 1]}>
          <sphereGeometry args={[0.62, 10, 7]} />
          <meshStandardMaterial color={SCALE} roughness={0.32} metalness={0.4} flatShading />
        </mesh>
        {/* paler belly, so it reads differently from below */}
        <mesh position={[0, -0.07, 0.02]} scale={[0.34, 0.16, 0.86]}>
          <sphereGeometry args={[0.6, 8, 6]} />
          <meshStandardMaterial color={BELLY} roughness={0.5} />
        </mesh>
        {/* the wrist, narrowing before the tail */}
        <mesh position={[0, 0, 0.5]} scale={[0.2, 0.22, 0.4]}>
          <sphereGeometry args={[0.4, 6, 5]} />
          <meshStandardMaterial color={SCALE} roughness={0.35} metalness={0.35} flatShading />
        </mesh>
        {/* forked tail: two thin blades rather than a cone */}
        {[0.42, -0.42].map((tilt) => (
          <mesh key={tilt} position={[0, tilt * 0.22, 0.76]} rotation={[tilt * 0.7, 0, 0]}>
            <coneGeometry args={[0.2, 0.44, 3]} />
            <meshStandardMaterial
              color={FIN}
              roughness={0.4}
              metalness={0.2}
              flatShading
              side={DoubleSide}
            />
          </mesh>
        ))}
        {/* dorsal fin - the bit that breaks the surface */}
        <mesh position={[0, 0.17, 0.04]} rotation={[0.25, 0, 0]} scale={[0.1, 1, 1]}>
          <coneGeometry args={[0.17, 0.3, 3]} />
          <meshStandardMaterial color={FIN} roughness={0.45} flatShading side={DoubleSide} />
        </mesh>
        {/* pectorals */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.13, -0.03, -0.12]}
            rotation={[0, 0, side * 0.5]}
            scale={[1, 0.12, 0.7]}
          >
            <coneGeometry args={[0.12, 0.26, 3]} />
            <meshStandardMaterial color={FIN} roughness={0.45} flatShading side={DoubleSide} />
          </mesh>
        ))}
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
