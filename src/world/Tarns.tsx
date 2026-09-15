/**
 * The water surface of a mountain tarn.
 *
 * The main lake is one plane at sea level and cannot represent a pool at 180m,
 * so each tarn carries its own small disc. They are still, shallow and cold:
 * mirror-like at a glance, with only the faintest ripple, which is what
 * separates a tarn from the open water below.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type ShaderMaterial, Vector3 } from 'three'
import type { Tarn } from './tarns.ts'
import { SUN_DIRECTION } from './sky.ts'

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uSun;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    // A tarn is sheltered, so the ripple is small and slow.
    vec2 p = vWorld.xz;
    float a = sin(p.x * 0.26 + uTime * 0.7) * 0.012;
    float b = sin(p.y * 0.31 - uTime * 0.55) * 0.011;
    float c = sin((p.x + p.y) * 0.18 + uTime * 0.4) * 0.009;
    vec3 normal = normalize(vec3(a + c, 1.0, b + c));

    vec3 viewDir = normalize(uCamera - vWorld);
    float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 4.0);
    vec3 color = mix(uDeep, uSky, clamp(fresnel * 1.3, 0.0, 0.95));

    vec3 halfway = normalize(uSun + viewDir);
    color += vec3(1.0, 0.97, 0.9) * pow(max(dot(normal, halfway), 0.0), 190.0) * 1.6;

    // Fade the very edge so the disc does not end in a hard rim against the rock.
    float edge = 1.0 - smoothstep(0.86, 1.0, length(vUv - 0.5) * 2.0);
    gl_FragColor = vec4(color, 0.93 * edge);
  }
`

function Pool({ tarn }: { tarn: Tarn }) {
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCamera: { value: new Vector3() },
      uSun: { value: SUN_DIRECTION.clone().normalize() },
      // Brighter than the sea on purpose. A mountain tarn really is a different
      // colour - glacial, turquoise - and it is also the only thing that says
      // "water up there" from a kilometre away.
      uDeep: { value: new Vector3(0.07, 0.24, 0.3) },
      uSky: { value: new Vector3(0.66, 0.86, 0.94) },
    }),
    [],
  )

  useFrame((frame) => {
    if (!material.current) return
    material.current.uniforms.uTime.value = frame.clock.elapsedTime
    material.current.uniforms.uCamera.value.copy(frame.camera.position)
  })

  return (
    <mesh
      position={[tarn.centre.x, tarn.level, tarn.centre.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
    >
      <circleGeometry args={[tarn.radius, 28]} />
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
  )
}

export function Tarns({ tarns }: { tarns: Tarn[] }) {
  return (
    <group>
      {tarns.map((tarn, i) => (
        <Pool key={i} tarn={tarn} />
      ))}
    </group>
  )
}
