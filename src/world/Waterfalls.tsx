/**
 * Falling water.
 *
 * Water only reads as water when it moves, and the whole project is asset-free,
 * so the motion is a small shader rather than a scrolling texture: stacked
 * streaks running down the sheet at different rates, fraying toward the bottom,
 * with foam where it lands.
 *
 * Each fall is one double-sided quad plus a mist disc, so a fall costs two draw
 * calls and no texture memory.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, type ShaderMaterial, Vector3 } from 'three'
import { findWaterfalls, type Waterfall } from './waterfalls.ts'
import { TIME_OPERATOR } from './waterfallFlow.ts'

/**
 * How wide the water is at a point along its line, as a fraction of `width`.
 *
 * A fall is not a ribbon of constant width: it leaves the lake as a stream,
 * narrows through the notch, and then spreads as it falls and breaks up. Drawn
 * at one width from end to end it reads as a strip of tape laid on the hill.
 */
function widthAt(index: number, lead: number, count: number): number {
  const wobble = 1 + Math.sin(index * 0.9) * 0.1
  if (index < lead) {
    // The stream: narrow, widening a little as it nears the lip.
    const t = lead <= 1 ? 1 : index / (lead - 1)
    return (0.3 + t * 0.28) * wobble
  }
  // The fall: opens out from the lip and frays wider toward the foot.
  const t = count - lead <= 1 ? 1 : (index - lead) / (count - lead - 1)
  return (0.66 + t * 0.5) * wobble
}

/**
 * The sheet, built as a strip of quads following the fall path.
 *
 * Explicit vertices rather than a rotated plane: the path bends with the rock,
 * so there is no single orientation a flat plane could take, and building the
 * corners directly means there is no Euler order to get wrong.
 */
function sheetGeometry(fall: Waterfall): BufferGeometry {
  const path = fall.path
  const half = fall.width / 2
  const positions: number[] = []
  const uvs: number[] = []
  const flow: number[] = []
  const indices: number[] = []
  const across = new Vector3()
  const segment = new Vector3()

  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    // Across the flow at this point, horizontal.
    const next = path[Math.min(i + 1, path.length - 1)]
    const prev = path[Math.max(i - 1, 0)]
    segment.subVectors(next, prev)
    across.crossVectors(segment, new Vector3(0, 1, 0))
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0)
    across.normalize().multiplyScalar(half * widthAt(i, fall.lead, path.length))

    positions.push(p.x - across.x - fall.top.x, p.y - across.y - fall.top.y, p.z - across.z - fall.top.z)
    positions.push(p.x + across.x - fall.top.x, p.y + across.y - fall.top.y, p.z + across.z - fall.top.z)

    // v runs 1 at the lip down to 0 at the foot, which is what the shader expects.
    const v = 1 - i / (path.length - 1)
    uvs.push(0, v, 1, v)

    // 0 while it is still a stream on the ground, 1 once it is falling. The
    // shader runs the water slower and drier over the first stretch.
    const falling = i < fall.lead ? 0 : 1
    flow.push(falling, falling)

    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const vertexShader = /* glsl */ `
  attribute float aFlow;
  varying vec2 vUv;
  varying float vFlow;
  void main() {
    vUv = uv;
    vFlow = aFlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uWater;
  uniform vec3 uFoam;
  varying vec2 vUv;
  varying float vFlow;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    // uv.y is 1 at the lip and 0 at the pool.
    float fall = 1.0 - vUv.y;

    // Streaks of water at varying speeds, so the sheet never looks like one
    // sliding image. Slower over the stretch that is still a stream.
    float rate = mix(0.35, 1.0, vFlow);
    float streaks = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float lane = floor(vUv.x * (7.0 + fi * 4.0));
      float speed = (0.85 + hash(lane + fi * 13.0) * 1.5) * rate;
      float phase = hash(lane * 3.1 + fi) * 10.0;
      // The time term's sign decides which way the water goes, and it is taken
      // from waterfallFlow.ts so that a test covers it. Added rather than
      // subtracted, the streaks climb the cliff - which is what they were doing.
      float v = fract(fall * (2.0 + fi) * 1.6 ${TIME_OPERATOR} uTime * speed + phase);
      streaks += smoothstep(0.55, 1.0, v) * (0.34 - fi * 0.05);
    }

    /*
      The edges.

      A hard-edged ribbon is the thing that reads as cut paper rather than as
      water, so the sides are soft AND they move: the boundary wanders with
      height and time, which is what makes the outline look like it is flowing
      rather than like a shape with water drawn inside it.
    */
    float wander = sin(vUv.y * 11.0 + uTime * 0.7) * 0.05 + sin(vUv.y * 23.0 - uTime * 1.1) * 0.03;
    float x = vUv.x + wander;
    float softness = mix(0.16, 0.3, fall);
    float edge = smoothstep(0.0, softness, x) * smoothstep(1.0, 1.0 - softness, x);

    // The sheet frays as it falls and blows out into spray at the bottom.
    float fray = mix(1.0, 0.55 + streaks, smoothstep(0.25, 1.0, fall));
    float foam = smoothstep(0.72, 1.0, fall) * vFlow;

    vec3 color = mix(uWater, uFoam, clamp(streaks * 1.9 + foam * 0.85, 0.0, 1.0));
    float alpha = edge * fray * mix(0.9, 0.62, fall);
    alpha = clamp(alpha + foam * 0.3, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha * 0.92);
  }
`

function Fall({ fall }: { fall: Waterfall }) {
  const material = useRef<ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWater: { value: new Vector3(0.62, 0.76, 0.84) },
      uFoam: { value: new Vector3(0.97, 0.99, 1.0) },
    }),
    [],
  )

  useFrame((frame) => {
    if (material.current) material.current.uniforms.uTime.value = frame.clock.elapsedTime
  })

  const geometry = useMemo(() => sheetGeometry(fall), [fall])

  return (
    <group position={[fall.top.x, fall.top.y, fall.top.z]}>
      <mesh geometry={geometry}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {/* mist where it lands, lying flat at the foot of the fall */}
      <mesh
        position={[fall.base.x - fall.top.x, fall.base.y - fall.top.y + 0.7, fall.base.z - fall.top.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[fall.width * 0.75, 18]} />
        <meshBasicMaterial color="#eef6fa" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** How far out falls are drawn, and how far the bird moves before we look again. */
const FALL_RANGE = 2200
const RESTOCK_AFTER = 500

/**
 * The waterfalls near the bird.
 *
 * Streamed for the same reason the lakes are: worked out once at the nest, every
 * tarn beyond that first search spilled over its lip into nothing.
 */
export function Waterfalls({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const [falls, setFalls] = useState<Waterfall[]>(() =>
    findWaterfalls(seed, target.current, null, 8, FALL_RANGE),
  )
  const built = useRef(target.current.clone())

  useFrame(() => {
    if (target.current.distanceTo(built.current) < RESTOCK_AFTER) return
    built.current.copy(target.current)
    setFalls(findWaterfalls(seed, target.current, null, 8, FALL_RANGE))
  })

  return (
    <group>
      {falls.map((fall) => (
        <Fall key={`${fall.top.x.toFixed(0)}:${fall.top.z.toFixed(0)}`} fall={fall} />
      ))}
    </group>
  )
}
