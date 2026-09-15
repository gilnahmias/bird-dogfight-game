/**
 * Water.
 *
 * One big plane at the water level that follows the player, so lakes and rivers
 * are simply wherever the terrain dips below it. A flat lit plane reads as
 * linoleum, so the surface is a shader: overlapping travelling waves perturb the
 * normal, the horizon goes mirror-like through Fresnel while the water underfoot
 * stays deep and blue, and the sun scatters off the chop.
 *
 * No textures, so there is nothing to load and nothing to tile.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { type Mesh, type ShaderMaterial, Vector3 } from 'three'
import { WORLD } from '../game/constants.ts'

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
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
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uFogColor;

  varying vec3 vWorld;

  /**
   * Sum of travelling waves. Each one contributes a slope, and the slopes add
   * up into a surface normal - cheaper and calmer than any noise, and it never
   * shimmers because every term is a smooth function of position and time.
   */
  vec3 waveNormal(vec2 p, float time) {
    vec2 slope = vec2(0.0);
    vec2 dir = normalize(vec2(0.86, 0.5));
    float amp = 0.055;
    float freq = 0.085;
    float speed = 0.9;
    for (int i = 0; i < 5; i++) {
      float phase = dot(p, dir) * freq + time * speed;
      slope += dir * cos(phase) * amp * freq;
      // Rotate and shorten for the next octave, so the chop is not a corduroy.
      dir = vec2(dir.x * 0.6 - dir.y * 0.8, dir.x * 0.8 + dir.y * 0.6);
      amp *= 0.76;
      freq *= 1.9;
      speed *= 1.18;
    }
    return normalize(vec3(-slope.x, 1.0, -slope.y));
  }

  void main() {
    vec3 view = uCamera - vWorld;
    float dist = length(view);
    vec3 viewDir = view / dist;

    // Waves flatten out with distance, otherwise the far water turns to noise.
    float detail = 1.0 - smoothstep(180.0, 1400.0, dist);
    vec3 normal = waveNormal(vWorld.xz, uTime);
    normal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, detail));

    // Fresnel: transparent and deep underfoot, mirror-bright toward the horizon.
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 4.0);

    vec3 body = mix(uDeep, uShallow, pow(facing, 1.6) * 0.55);
    vec3 color = mix(body, uSky, clamp(fresnel * 1.15, 0.0, 0.92));

    // Sun glitter: a tight specular off the chop, plus the broad sheen around it
    // that makes a lake look wet rather than varnished.
    vec3 halfway = normalize(uSun + viewDir);
    float spec = pow(max(dot(normal, halfway), 0.0), 220.0);
    float sheen = pow(max(dot(normal, halfway), 0.0), 18.0);
    color += vec3(1.0, 0.96, 0.86) * (spec * 2.4 + sheen * 0.16);

    // Match the scene fog, or the lake stays sharp while the land behind it fades.
    float fog = smoothstep(uFogNear, uFogFar, dist);
    color = mix(color, uFogColor, fog);

    gl_FragColor = vec4(color, mix(0.93, 1.0, fresnel));
  }
`

export function Water({ target, sun }: { target: { current: Vector3 }; sun: Vector3 }) {
  const mesh = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)
  // Wider than the camera's far plane in every direction, so the edge of the
  // plane is always beyond anything that can be drawn. Otherwise the far side of
  // the lake ends in a hard straight line across the horizon.
  const span = WORLD.chunkSize * (WORLD.viewChunks * 2 + 6)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCamera: { value: new Vector3() },
      uSun: { value: sun.clone().normalize() },
      uDeep: { value: new Vector3(0.04, 0.13, 0.2) },
      uShallow: { value: new Vector3(0.13, 0.35, 0.42) },
      uSky: { value: new Vector3(0.62, 0.75, 0.87) },
      uFogNear: { value: WORLD.fogNear },
      uFogFar: { value: WORLD.fogFar },
      uFogColor: { value: new Vector3(0.66, 0.77, 0.85) },
    }),
    [sun],
  )

  useFrame((frame) => {
    if (mesh.current) {
      // Snap to the chunk grid so the plane never appears to slide under the bird.
      const s = WORLD.chunkSize
      mesh.current.position.set(
        Math.round(target.current.x / s) * s,
        WORLD.waterLevel,
        Math.round(target.current.z / s) * s,
      )
    }
    if (material.current) {
      material.current.uniforms.uTime.value = frame.clock.elapsedTime
      material.current.uniforms.uCamera.value.copy(frame.camera.position)
    }
  })

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[span, span]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
      />
    </mesh>
  )
}
