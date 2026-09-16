/**
 * The raptor itself: body, wings, tail and talons, built from primitives.
 *
 * Its own file because the player is not the only bird in the sky any more -
 * rivals are the same animal in different colours, and the one thing that must
 * not happen is two raptors drifting apart as models. → skipped: a real modelled
 * and skinned bird, add when the dogfight is proven fun.
 */
import { useMemo, type RefObject } from 'react'
import { DoubleSide, ExtrudeGeometry, Group, Shape, ShapeGeometry } from 'three'
import { PLUMAGE, type Plumage } from './plumage.ts'
import {
  alula,
  armShape,
  ELBOW_X,
  greaterCoverts,
  HAND_LEADING,
  handShape,
  lesserCoverts,
  primaries,
  secondaries,
  tailFeathers,
} from './wingShapes.ts'

/** Forward is -Z. */
export function BirdModel({
  left,
  right,
  feet,
  palette = PLUMAGE,
}: {
  left: WingJoints
  right: WingJoints
  feet: { left: RefObject<Group | null>; right: RefObject<Group | null> }
  palette?: Plumage
}) {
  const { feather: FEATHER, featherDark: FEATHER_DARK, belly: BELLY } = palette
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
      <Tail palette={palette} />
      {/* The feet. These are the weapon, so they get built properly. */}
      <Foot side={-1} grip={feet.left} palette={palette} />
      <Foot side={1} grip={feet.right} palette={palette} />

      <group position={[0.35, 0.12, 0]}>
        <Wing joints={left} palette={palette} />
      </group>
      {/*
        The mirror sits on a group the animation never writes to. The flap
        animation sets scale.x on the shoulder every frame to tuck the wing, and
        if the mirror lived there it would be wiped out on the first frame and
        fold both wings onto the same side of the bird.
      */}
      <group position={[-0.35, 0.12, 0]} scale={[-1, 1, 1]}>
        <Wing joints={right} palette={palette} />
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

function Foot({
  side,
  grip,
  palette,
}: {
  side: number
  grip: RefObject<Group | null>
  palette: Plumage
}) {
  const FEATHER_LIGHT = palette.featherLight
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
function Wing({ joints, palette }: { joints: WingJoints; palette: Plumage }) {
  const {
    feather: FEATHER,
    featherMid: FEATHER_MID,
    featherDark: FEATHER_DARK,
    featherLight: FEATHER_LIGHT,
  } = palette
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
        {/*
          The hand is ONE rigid piece: spar, primaries and alula all hang off the
          wrist together. They used to straddle it - the spar on the elbow, the
          feathers on the wrist - so every beat pivoted the quills away from the
          bone they grow out of and opened a visible gap across the middle of the
          wing.

          The wrist sits on the leading edge rather than mid-chord, because the
          twist turns about this group. Twisting about the middle swings both
          edges of the hand away from the arm; twisting about the leading edge
          keeps that edge joined and lifts only the trailing edge, which is what
          feathering looks like on a real wing.
        */}
        <group ref={joints.wrist} position={[0, 0, HAND_LEADING]}>
          <group position={[0, 0, -HAND_LEADING]}>
            <mesh geometry={hand} rotation={FLAT} castShadow>
              <meshStandardMaterial color={FEATHER} roughness={0.92} flatShading />
            </mesh>
            {/* Above the spar, not under it. Tucked below, the hand panel hid
                them completely once the whole manus became one rigid piece - the
                wing ended in a blunt plank instead of a spread of fingers. */}
            <Feathers shapes={useMemo(() => primaries(), [])} color={FEATHER_DARK} lift={0.03} />
            <Feathers shapes={useMemo(() => alula(), [])} color={FEATHER_LIGHT} lift={0.07} />
          </group>
        </group>
      </group>
    </group>
  )
}
/* oxlint-enable react/refs */

function Tail({ palette }: { palette: Plumage }) {
  const { feather: FEATHER, featherDark: FEATHER_DARK } = palette
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
