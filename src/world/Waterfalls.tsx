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
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, type ShaderMaterial, Vector3 } from 'three'
import type { Waterfall } from './waterfalls.ts'
import { TIME_OPERATOR } from './waterfallFlow.ts'

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
    across.normalize().multiplyScalar(half)

    positions.push(p.x - across.x - fall.top.x, p.y - across.y - fall.top.y, p.z - across.z - fall.top.z)
    positions.push(p.x + across.x - fall.top.x, p.y + across.y - fall.top.y, p.z + across.z - fall.top.z)

    // v runs 1 at the lip down to 0 at the foot, which is what the shader expects.
    const v = 1 - i / (path.length - 1)
    uvs.push(0, v, 1, v)

    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uWater;
  uniform vec3 uFoam;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    // uv.y is 1 at the lip and 0 at the pool.
    float fall = 1.0 - vUv.y;

    // Streaks of water at varying speeds, so the sheet never looks like one
    // sliding image.
    float streaks = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float lane = floor(vUv.x * (7.0 + fi * 4.0));
      float speed = 0.85 + hash(lane + fi * 13.0) * 1.5;
      float phase = hash(lane * 3.1 + fi) * 10.0;
      // The time term's sign decides which way the water goes, and it is taken
      // from waterfallFlow.ts so that a test covers it. Added rather than
      // subtracted, the streaks climb the cliff - which is what they were doing.
      float v = fract(fall * (2.0 + fi) * 1.6 ${TIME_OPERATOR} uTime * speed + phase);
      streaks += smoothstep(0.55, 1.0, v) * (0.34 - fi * 0.05);
    }

    // The sheet frays as it falls and blows out into spray at the bottom.
    float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
    float fray = mix(1.0, 0.55 + streaks, smoothstep(0.25, 1.0, fall));
    float foam = smoothstep(0.72, 1.0, fall);

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

export function Waterfalls({ falls }: { falls: Waterfall[] }) {
  return (
    <group>
      {falls.map((fall, i) => (
        <Fall key={i} fall={fall} />
      ))}
    </group>
  )
}
