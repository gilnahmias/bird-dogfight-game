/**
 * Where the game's state turns into sound, once a frame.
 *
 * Lives inside the canvas because the ears ride the camera. Everything that
 * makes a noise is read from `audible` or from the store's counters, so no
 * entity has to call into the audio and a muted game is simply this doing
 * nothing.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { useGame } from '../game/store.ts'
import { RIVAL_KINDS } from '../entities/rivalKinds.ts'
import type { Mobber } from '../entities/flocks.ts'
import { audible, fallSource, newEar, rivalCall, windLevel, type Ear } from './ears.ts'
import {
  attachAudio,
  audio,
  caw,
  placeListener,
  screech,
  setPaused,
  setWind,
  startFall,
  type FallVoice,
} from './engine.ts'

/** Smaller birds, higher voices. */
const PITCH: Record<string, number> = { falcon: 1.18, buzzard: 1, eagle: 0.8 }

const forward = new Vector3()
const up = new Vector3()
const source = new Vector3()

export function Soundscape({ bird }: { bird: BirdState }) {
  const camera = useThree((s) => s.camera)
  const ears = useRef(new Map<number, Ear>())
  const falls = useRef(new Map<string, FallVoice>())
  const fallList = useRef<unknown>(null)
  const crowsHeard = useRef(new WeakSet<Mobber>())
  const counts = useRef({ pecked: 0, swatted: 0 })

  useEffect(attachAudio, [])
  useEffect(
    () =>
      useGame.subscribe((s, previous) => {
        if (s.paused !== previous.paused) setPaused(s.paused)
      }),
    [],
  )

  useFrame((state) => {
    if (!audio()) return
    const now = state.clock.elapsedTime

    camera.getWorldDirection(forward)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    placeListener(camera.position, forward, up)

    setWind(bird.dead ? 0 : windLevel(bird.airspeed, bird.perched))

    // --- Waterfalls: one voice per fall in range, keyed by where it is ---------
    if (audible.falls !== fallList.current) {
      fallList.current = audible.falls
      const wanted = new Set<string>()
      for (const fall of audible.falls) {
        const key = `${fall.top.x.toFixed(0)}:${fall.top.z.toFixed(0)}`
        wanted.add(key)
        if (!falls.current.has(key)) {
          const voice = startFall(fallSource(fall, source), fall.width)
          if (voice) falls.current.set(key, voice)
        }
      }
      for (const [key, voice] of falls.current) {
        if (wanted.has(key)) continue
        voice.stop()
        falls.current.delete(key)
      }
    }

    // --- Rivals ------------------------------------------------------------
    for (const rival of audible.rivals) {
      let ear = ears.current.get(rival.id)
      if (!ear) {
        ear = newEar(rival.mode)
        ears.current.set(rival.id, ear)
      }
      const call = rivalCall(ear, rival, rival.pos.distanceTo(bird.pos), now)
      if (call !== 'none') {
        screech(rival.pos, PITCH[RIVAL_KINDS[rival.kind]?.name] ?? 1, call === 'dive')
      }
    }
    if (ears.current.size > audible.rivals.length + 8) {
      const live = new Set(audible.rivals.map((r) => r.id))
      for (const id of ears.current.keys()) if (!live.has(id)) ears.current.delete(id)
    }

    // --- Crows: a racket when they come for you, and at every peck and swat --
    for (const crow of audible.crows) {
      if (crowsHeard.current.has(crow)) continue
      crowsHeard.current.add(crow)
      if (!crow.done) caw(crow.pos, 2)
    }
    const { pecked, crowsSwatted } = useGame.getState()
    if (pecked > counts.current.pecked || crowsSwatted > counts.current.swatted) {
      const nearest = audible.crows.reduce<Mobber | null>(
        (best, c) =>
          !best || c.pos.distanceToSquared(bird.pos) < best.pos.distanceToSquared(bird.pos) ? c : best,
        null,
      )
      if (nearest) caw(nearest.pos, 1)
    }
    counts.current.pecked = pecked
    counts.current.swatted = crowsSwatted
  })

  return null
}
