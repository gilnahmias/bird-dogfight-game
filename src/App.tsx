import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, Vector3 } from 'three'
import { Bird } from './flight/Bird.tsx'
import { ChaseCamera } from './flight/ChaseCamera.tsx'
import { attachInput } from './flight/input.ts'
import { createBird } from './flight/physics.ts'
import { TerrainChunks } from './world/TerrainChunks.tsx'
import { Water } from './world/Water.tsx'
import { Scatter } from './world/Scatter.tsx'
import { HUD } from './ui/HUD.tsx'
import { DevBridge } from './dev/DevBridge.tsx'
import { departureDirection, findNestSite, launchPoint, nestPoint } from './world/nest.ts'
import { Nest } from './world/Nest.tsx'
import { Motes } from './world/Motes.tsx'
import { Clouds, Sun, type CloudPatch } from './world/Clouds.tsx'
import { SkyDome } from './world/SkyDome.tsx'
import { CloudShadows } from './world/CloudShadows.tsx'
import { SKY, SUN_DIRECTION, sunPosition } from './world/sky.ts'
import { Shadow } from './world/Shadow.tsx'
import { findWaterfalls } from './world/waterfalls.ts'
import { findTarns } from './world/tarns.ts'
import { Tarns } from './world/Tarns.tsx'
import { PreyField } from './world/Prey.tsx'
import { Rivals } from './entities/Rivals.tsx'
import { Waterfalls } from './world/Waterfalls.tsx'
import { Splashes } from './world/Splashes.tsx'
import { T, WORLD } from './game/constants.ts'

const SEED = 'pine-ridge'

export default function App() {
  useEffect(attachInput, [])

  // Every run starts at the nest, launching down its open departure line.
  const site = useMemo(() => findNestSite(SEED), [])
  const spawn = useMemo(() => launchPoint(site), [site])
  const falls = useMemo(
    () => findWaterfalls(SEED, site.pos, departureDirection(site.heading)),
    [site],
  )
  const tarns = useMemo(() => findTarns(SEED, site.pos), [site])
  // Cloud positions are published upward so their shade can be cast on the ground.
  const [patches, setPatches] = useState<CloudPatch[]>([])
  const cloudDrift = useRef(new Vector3())
  const onPatches = useCallback((next: CloudPatch[]) => setPatches(next), [])
  // The run opens standing in the nest. Space is the launch.
  const bird = useMemo(() => createBird(spawn, site.heading, true), [spawn, site.heading])
  const nest = useMemo(() => nestPoint(site), [site])
  // A stable handle on the bird's position, for the world to build itself around.
  const target = useMemo(() => ({ current: bird.pos as Vector3 }), [bird])

  return (
    <>
      <Canvas
        camera={{ fov: T.camFovBase, near: 0.5, far: WORLD.fogFar + 400 }}
        shadows={false}
        dpr={[1, 1.75]}
        /*
          Filmic tone mapping keeps the bright end - sun glare on water, sunlit
          rock against dark forest - from flattening into white.
        */
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.95 }}
      >
        <fog attach="fog" args={[SKY.fog, WORLD.fogNear, WORLD.fogFar]} />
        <SkyDome />
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
        <Tarns tarns={tarns} />
        <Waterfalls falls={falls} />
        <Motes target={target} seed={SEED} />
        <Clouds target={target} seed={SEED} onPatches={onPatches} driftOut={cloudDrift} />
        <CloudShadows patches={patches} seed={SEED} drift={cloudDrift} />

        <Splashes />
        <Rivals bird={bird} seed={SEED} />
        <PreyField bird={bird} seed={SEED} nest={nest} />
        <Shadow state={bird} seed={SEED} />
        <Bird state={bird} seed={SEED} spawn={spawn} heading={site.heading} nest={nest} />
        <ChaseCamera state={bird} />
        <DevBridge bird={bird} />
      </Canvas>
      <HUD nest={nest} bird={bird} seed={SEED} />
    </>
  )
}
