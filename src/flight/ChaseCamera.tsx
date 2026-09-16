/**
 * Chase camera: behind and above the bird, looking where the bird is going.
 *
 * It deliberately does not copy the bird's roll. A camera welded to a rolling
 * aircraft is nauseating and hides the horizon, which is the one reference the
 * player needs. It copies a fraction of the bank instead, which reads as banking
 * without taking the horizon away.
 */
// oxlint-disable react/immutability -- driving the three.js camera imperatively from
// the frame loop is the intended react-three-fiber pattern; there is no render pass
// to hand a new camera position to.
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { BirdState } from './physics.ts'
import { FWD, UP } from './physics.ts'
import { T, WORLD } from '../game/constants.ts'
import { meshHeightAt } from '../world/terrain.ts'
import { keepAboveGround, keepCameraClear } from './cameraRig.ts'

const fwd = new Vector3()
const up = new Vector3()
const desired = new Vector3()
const offset = new Vector3()
const lookTarget = new Vector3()
const levelUp = new Vector3()
const m = new Matrix4()
const noRoll = new Quaternion()
const blended = new Quaternion()
const target = new Vector3()
/** How quickly a collision correction is eased in and out, per second. */
const CORRECTION_RATE = 10

export function ChaseCamera({ state, seed }: { state: BirdState; seed: string }) {
  const camera = useThree((s) => s.camera)
  const smoothed = useRef<Vector3 | null>(null)
  const smoothedLook = useRef<Vector3 | null>(null)
  const shown = useRef<Vector3 | null>(null)

  useFrame((_, delta) => {
    fwd.copy(FWD).applyQuaternion(state.quat)
    up.copy(UP).applyQuaternion(state.quat)

    // Build a roll-free orientation that still looks along the bird's nose. Near
    // vertical, world up is a useless reference, so fall back to the bird's own.
    levelUp.set(0, 1, 0)
    if (Math.abs(fwd.y) > 0.94) levelUp.lerp(up, (Math.abs(fwd.y) - 0.94) / 0.06).normalize()
    m.lookAt(desired.set(0, 0, 0), fwd, levelUp)
    noRoll.setFromRotationMatrix(m)
    // lookAt builds a -Z-forward basis, which is what we want, then we add back a
    // slice of the bird's real roll for feel.
    blended.copy(noRoll).slerp(state.quat, T.camRollShare)

    offset.set(0, T.camHeight, T.camDistance).applyQuaternion(blended)
    desired.copy(state.pos).add(offset)


    if (!smoothed.current) smoothed.current = desired.clone()
    if (!smoothedLook.current) smoothedLook.current = state.pos.clone()

    // Exponential smoothing, framerate independent.
    const k = 1 - Math.exp(-T.camLerp * delta)
    smoothed.current.lerp(desired, k)
    lookTarget.copy(state.pos).addScaledVector(fwd, T.camLookAhead)
    smoothedLook.current.lerp(lookTarget, Math.min(1, k * 1.6))

    /*
      Keep it out of the mountain.

      The lag is exactly what drags the camera into a hill - it is still
      following where the bird was a moment ago, which on a turn along a slope is
      uphill and underground. So the corrected position is worked out FROM the
      lagged one every frame, but never written back into it: fed back, each
      frame's rise became the next frame's starting point and the camera climbed
      away from the bird without limit.

      The correction is eased so it does not pop, and then held above the ground
      outright, so the easing can never carry it into the terrain.
    */
    const groundAt = (x: number, z: number) =>
      Math.max(meshHeightAt(x, z, seed, WORLD.lodSegments[0]), WORLD.waterLevel)
    keepCameraClear(state.pos, smoothed.current, groundAt, target)
    if (!shown.current) shown.current = target.clone()
    shown.current.lerp(target, 1 - Math.exp(-CORRECTION_RATE * delta))
    keepAboveGround(shown.current, groundAt)
    camera.position.copy(shown.current)
    camera.up.copy(levelUp).lerp(up, T.camRollShare).normalize()
    camera.lookAt(smoothedLook.current)

    // Speed reads better as a widening lens than as a number on the HUD.
    if (camera instanceof PerspectiveCamera) {
      const kick = Math.min(1, state.airspeed / T.camFovSpeedRef)
      const wanted = T.camFovBase + kick * T.camFovSpeedKick
      camera.fov += (wanted - camera.fov) * Math.min(1, delta * 3)
      camera.updateProjectionMatrix()
    }
    // NOTE: no renderPriority argument. In react-three-fiber any priority above
    // zero switches off the automatic render loop and makes the callback
    // responsible for calling gl.render itself - which silently renders nothing.
    // Ordering is handled by mounting Bird before ChaseCamera, and a one-frame
    // lag would be invisible through the smoothing anyway.
  })

  return null
}
