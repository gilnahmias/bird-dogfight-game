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
 *
 * Three things make it read as a shadow rather than a decal:
 *
 *   shape   a raptor silhouette that narrows as the wings come up, so the mark
 *           on the ground flaps in step with the bird above it
 *   blur    a soft edge that widens with height - the sun is a disc, so the
 *           penumbra grows with the gap. This is the second altitude cue, and
 *           the one that still reads when the shadow is too small to measure.
 *   smear   the outline projected onto the actual surface, so a hillside
 *           stretches it along the slope while flat ground takes it square
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CanvasTexture,
  DoubleSide,
  Quaternion,
  LinearFilter,
  Matrix4,
  type Mesh,
  type ShaderMaterial,
  Vector3,
} from 'three'
import { meshHeightAt, normalAt } from './terrain.ts'
import { castOnto, castToGround, litness, shadowFor } from './shadow.ts'
import { SUN_DIRECTION } from './sky.ts'
import { FWD, RIGHT } from '../flight/physics.ts'
import { WORLD } from '../game/constants.ts'

/** How many times to refine the landing point against the terrain under it. */
const SOLVE_STEPS = 3
/**
 * Time constant for settling the ground reading, in seconds.
 *
 * The landing point is solved by iterating against a noisy heightfield, and
 * frame to frame that solve lands a metre or two apart on broken ground - which
 * showed up as a shadow that twitched. Only the GROUND reading is smoothed, not
 * the bird's own position, so the shadow never lags the bird.
 */
const SETTLE = 0.09

/** Horizontal direction the shadow is thrown, away from the sun. */
const cast = new Vector3(-SUN_DIRECTION.x, 0, -SUN_DIRECTION.z).normalize()
/** Horizontal metres travelled per metre of altitude. */
const REACH = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) / SUN_DIRECTION.y
/** Direction the sunlight travels: downward, opposite the sun. */
const LIGHT = SUN_DIRECTION.clone().negate().normalize()

const fwd = new Vector3()
const right = new Vector3()
const spanAxis = new Vector3()
const lengthAxis = new Vector3()
const up = new Vector3()
const seat = new Vector3()
const basis = new Matrix4()
const FLAT: [number, number, number] = [0, 1, 0]

/** Body length as a fraction of the wingspan. */
const BODY_RATIO = 0.82

/**
 * The silhouette, drawn once into a canvas: a raptor from directly above.
 *
 * Deliberately blurred as it is drawn. The material then thresholds the gradient,
 * so the SAME texture gives a hard edge on the deck and a soft one at altitude -
 * no second texture, no blur pass, one uniform.
 */
let shared: CanvasTexture | null = null

/**
 * The one silhouette, built on first use and shared by every bird.
 *
 * There is a shadow per bird in the sky and rivals come and go every few
 * seconds; a texture each meant a fresh 256px canvas and a fresh upload to the
 * GPU for every rival that ever appeared, none of which were ever released.
 */
function silhouetteTexture(): CanvasTexture {
  if (shared) return shared
  shared = buildSilhouette()
  return shared
}

function buildSilhouette(): CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new CanvasTexture(canvas)

  ctx.fillStyle = '#000'
  // Blurred on the way in, which is what the material's softness works on.
  ctx.filter = 'blur(10px)'
  const mid = size / 2

  // Wings: long, swept, and tapering to the slotted hand of a soaring raptor.
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(mid + side * 10, 94)
    ctx.quadraticCurveTo(mid + side * 68, 86, mid + side * 118, 106)
    ctx.quadraticCurveTo(mid + side * 124, 114, mid + side * 108, 124)
    ctx.quadraticCurveTo(mid + side * 62, 132, mid + side * 12, 150)
    ctx.closePath()
    ctx.fill()
  }

  // Body and head: narrow, or the bird reads as a moth.
  ctx.beginPath()
  ctx.ellipse(mid, 130, 12, 46, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(mid, 82, 11, 15, 0, 0, Math.PI * 2)
  ctx.fill()

  // Tail: a spread fan, which is most of what makes a bird read as a raptor
  // rather than a gull from directly above.
  ctx.beginPath()
  ctx.moveTo(mid - 13, 168)
  ctx.quadraticCurveTo(mid - 26, 208, mid - 30, 232)
  ctx.lineTo(mid + 30, 232)
  ctx.quadraticCurveTo(mid + 26, 208, mid + 13, 168)
  ctx.closePath()
  ctx.fill()

  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return texture
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The edge is recovered from the blurred silhouette by thresholding it. A narrow
 * band around the midpoint is a hard edge; a wide one is all penumbra.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D silhouette;
  uniform float soft;
  uniform float strength;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    float mask = texture2D(silhouette, vUv).a;
    float edge = smoothstep(0.5 - soft, 0.5 + soft, mask);
    if (edge <= 0.002) discard;
    gl_FragColor = vec4(tint, edge * strength);
  }
`

/**
 * Anything that can throw a shadow: the player, and every rival.
 *
 * Structural rather than tied to BirdState, because a rival is steered rather
 * than flown and has no flight state - but it is the same bird in the same sky
 * and it must leave the same mark on the ground.
 */
export type ShadowCaster = {
  pos: Vector3
  quat: Quaternion
  /** Where the wings are in the beat, radians. */
  wingAngle: number
  dead: boolean
}

export function Shadow({ state, seed }: { state: ShadowCaster; seed: string }) {
  const mesh = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)
  const settled = useRef({ groundY: NaN, nx: 0, ny: 1, nz: 0 })
  const texture = useMemo(() => silhouetteTexture(), [])
  const uniforms = useMemo(
    () => ({
      silhouette: { value: texture },
      soft: { value: 0.1 },
      strength: { value: 0.5 },
      /*
        Very nearly black, and LINEAR rather than a colour picked by eye.
        This shader writes straight into a linear buffer without the colour
        management the standard materials get, so a value that looks like a
        reasonable dark grey as a hex code lands far brighter than the shaded
        ground it sits on - the bird's shadow came out as a PALE bird on a
        hillside already in shade. Anything below the darkest lit surface cannot
        do that. The slight blue is the sky lighting the shadow, which is what a
        real one is lit by.
      */
      tint: { value: new Vector3(0.01, 0.015, 0.03) },
    }),
    [texture],
  )

  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return

    let onWater = false
    const groundAt = (x: number, z: number) => {
      const h = meshHeightAt(x, z, seed, WORLD.lodSegments[0])
      onWater = h < WORLD.waterLevel
      return Math.max(h, WORLD.waterLevel)
    }

    const memory = settled.current
    const hit = castToGround(state.pos, cast, REACH, memory.groundY, groundAt, SOLVE_STEPS)
    const x = hit.x
    const z = hit.z
    let groundY = hit.groundY

    // Settle the ground reading. Without this the solve lands a metre or two
    // apart between frames over broken terrain, and the shadow twitches.
    const blend = Number.isNaN(memory.groundY) ? 1 : 1 - Math.exp(-delta / SETTLE)
    memory.groundY = Number.isNaN(memory.groundY)
      ? groundY
      : memory.groundY + (groundY - memory.groundY) * blend
    groundY = memory.groundY

    const height = state.pos.y - groundY
    const look = shadowFor(height)
    m.visible = look.visible && !state.dead
    if (!m.visible) return

    // Over water the shadow lies on the surface, not on the drowned slope under
    // it - which is otherwise steep enough to smear and darken the mark for no
    // reason the player can see.
    const normal = onWater ? FLAT : normalAt(x, z, seed)
    memory.nx += (normal[0] - memory.nx) * blend
    memory.ny += (normal[1] - memory.ny) * blend
    memory.nz += (normal[2] - memory.nz) * blend
    up.set(memory.nx, memory.ny, memory.nz).normalize()

    // The outline is the bird's own plane, so a banked bird throws a narrow mark
    // and the wingbeat is visible on the ground.
    right.copy(RIGHT).applyQuaternion(state.quat)
    fwd.copy(FWD).applyQuaternion(state.quat)
    const spread = Math.cos(state.wingAngle)
    spanAxis.copy(right).multiplyScalar(2 * look.size * spread)
    lengthAxis.copy(fwd).multiplyScalar(2 * look.size * BODY_RATIO)

    // Projected onto the surface it lands on: flat ground takes the outline
    // square, a slope smears it along the fall line.
    castOnto(spanAxis, up, LIGHT, spanAxis)
    castOnto(lengthAxis, up, LIGHT, lengthAxis)

    // Lifted a little along the surface normal, and pulled forward in depth by
    // the material, so it cannot sink into a slope between terrain vertices.
    seat.set(x, groundY, z).addScaledVector(up, 0.35)
    basis.makeBasis(spanAxis, lengthAxis, up).setPosition(seat)
    m.matrix.copy(basis)
    m.matrixWorldNeedsUpdate = true

    const mat = material.current
    if (mat) {
      mat.uniforms.soft.value = look.blur
      // Faded on faces the sun barely reaches: there is no light there to block,
      // and it is also where the projection stretches furthest.
      mat.uniforms.strength.value = look.opacity * litness(up, LIGHT)
    }
  })

  return (
    <mesh ref={mesh} matrixAutoUpdate={false} renderOrder={1} frustumCulled={false}>
      {/* A unit quad. The frame loop writes the matrix that lays it on the ground. */}
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
      />
    </mesh>
  )
}
