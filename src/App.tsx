import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import { ACESFilmicToneMapping, Group, Vector3 } from 'three'
import { Bird } from './flight/Bird.tsx'
import { ChaseCamera } from './flight/ChaseCamera.tsx'
import { attachInput } from './flight/input.ts'
import { createBird } from './flight/physics.ts'
import { TerrainChunks } from './world/TerrainChunks.tsx'
import { Water } from './world/Water.tsx'
import { Scatter } from './world/Scatter.tsx'
import { HUD } from './ui/HUD.tsx'
import { DevBridge } from './dev/DevBridge.tsx'
import { departureDirection, findNestSite, launchPoint } from './world/nest.ts'
import { Nest } from './world/Nest.tsx'
import { Motes } from './world/Motes.tsx'
import { Clouds, Sun } from './world/Clouds.tsx'
import { SKY, SUN_DIRECTION, sunPosition } from './world/sky.ts'
import { Shadow } from './world/Shadow.tsx'
import { findWaterfalls } from './world/waterfalls.ts'
import { Waterfalls } from './world/Waterfalls.tsx'
import { T, WORLD } from './game/constants.ts'

const SEED = 'pine-ridge'

/**
 * The sky is a box of fixed size sitting at the origin, so it has to be carried
 * along with the camera - otherwise it is simply left behind after the first few
 * hundred metres and the horizon turns black. It also has to fit inside the far
 * plane, or it is clipped away entirely.
 */
function FollowingSky() {
  const group = useRef<Group>(null)
  useFrame((state) => {
    group.current?.position.copy(state.camera.position)
  })
  const distance = (WORLD.fogFar + 400) * 0.8
  return (
    <group ref={group}>
      <Sky
        distance={distance}
        sunPosition={sunPosition()}
        turbidity={SKY.turbidity}
        rayleigh={SKY.rayleigh}
        mieCoefficient={SKY.mieCoefficient}
        mieDirectionalG={SKY.mieDirectionalG}
      />
    </group>
  )
}


export default function App() {
  useEffect(attachInput, [])

  // Every run starts at the nest, launching down its open departure line.
  const site = useMemo(() => findNestSite(SEED), [])
  const spawn = useMemo(() => launchPoint(site), [site])
  const falls = useMemo(
    () => findWaterfalls(SEED, site.pos, departureDirection(site.heading)),
    [site],
  )
  const bird = useMemo(() => createBird(spawn, site.heading), [spawn, site.heading])
  // A stable handle on the bird's position, for the world to build itself around.
  const target = useMemo(() => ({ current: bird.pos as Vector3 }), [bird])

  return (
    <>
      <Canvas
        camera={{ fov: T.camFovBase, near: 0.5, far: WORLD.fogFar + 400 }}
        shadows={false}
        dpr={[1, 1.75]}
        /*
          The atmospheric sky shader outputs high dynamic range values and
          expects to be tone mapped. Without this it clips straight to white and
          the sky has no colour in it at all, at any hour or turbidity - which is
          exactly what it was doing.
        */
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.85 }}
      >
        <fog attach="fog" args={[SKY.fog, WORLD.fogNear, WORLD.fogFar]} />
        <FollowingSky />
        <Sun />
        <hemisphereLight args={[SKY.skyLight, SKY.groundLight, 1.15]} />
        {/*
          Lit from the same direction the sun is drawn in and the water glints
          from. When these drift apart the scene stops making sense without the
          player being able to say why.
        */}
        <directionalLight
          position={sunPosition()}
          intensity={1.75}
          color={SKY.sunLight}
        />

        <TerrainChunks target={target} seed={SEED} />
        <Water target={target} sun={SUN_DIRECTION} />
        <Scatter target={target} seed={SEED} />
        <Nest site={site} />
        <Waterfalls falls={falls} />
        <Motes target={target} seed={SEED} />
        <Clouds target={target} seed={SEED} />

        <Shadow state={bird} seed={SEED} />
        <Bird state={bird} seed={SEED} spawn={spawn} heading={site.heading} />
        <ChaseCamera state={bird} />
        <DevBridge bird={bird} />
      </Canvas>
      <HUD />
    </>
  )
}
