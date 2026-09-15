/**
 * The sky.
 *
 * Hand-written rather than the atmospheric scattering shader this started with.
 * That one produced a flat, blown-out white at every elevation and every
 * turbidity: measured, its raw output was fully saturated before tone mapping,
 * so nothing downstream could recover a colour from it. Rather than keep tuning
 * parameters that could not reach the result, this draws the gradient directly.
 *
 * Deep blue overhead, paling toward the horizon the way real atmosphere does,
 * with a warm bloom around the sun. It is a dome carried with the camera, so it
 * is never approached and never left behind.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, type Mesh, type ShaderMaterial, Vector3 } from 'three'
import { SUN_DIRECTION } from './sky.ts'
import { WORLD } from '../game/constants.ts'

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSun;
  uniform vec3 uSunGlow;

  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);

    // Height in the sky, 0 at the horizon and 1 overhead. The power curve keeps
    // the blue high and compresses the pale band down near the horizon, which is
    // what stops the whole sky reading as washed out.
    float height = clamp(dir.y, 0.0, 1.0);
    vec3 color = mix(uHorizon, uZenith, pow(height, 0.42));

    // Below the horizon it darkens toward the haze, so the dome has a bottom
    // when the bird is diving and looking down past the terrain.
    if (dir.y < 0.0) {
      color = mix(uHorizon, uGround, clamp(-dir.y * 2.2, 0.0, 1.0));
    }

    // The sun's bloom: tight core, broad warm halo, and a general warming of the
    // whole side of the sky it is on.
    float toSun = max(dot(dir, uSun), 0.0);
    color += uSunGlow * pow(toSun, 220.0) * 1.1;
    color += uSunGlow * pow(toSun, 9.0) * 0.32;
    color += uSunGlow * pow(toSun, 2.0) * 0.07;

    gl_FragColor = vec4(color, 1.0);
  }
`

export function SkyDome() {
  const mesh = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)
  const radius = (WORLD.fogFar + 400) * 0.85

  const uniforms = useMemo(
    () => ({
      uZenith: { value: new Vector3(0.16, 0.38, 0.72) },
      uHorizon: { value: new Vector3(0.72, 0.83, 0.92) },
      uGround: { value: new Vector3(0.42, 0.47, 0.5) },
      uSun: { value: SUN_DIRECTION.clone().normalize() },
      uSunGlow: { value: new Vector3(1.0, 0.86, 0.62) },
    }),
    [],
  )

  useFrame((frame) => {
    mesh.current?.position.copy(frame.camera.position)
  })

  return (
    <mesh ref={mesh} renderOrder={-10}>
      <sphereGeometry args={[radius, 32, 20]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={BackSide}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  )
}
