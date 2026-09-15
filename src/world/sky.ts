/**
 * Where the sun is, and what colour the day is.
 *
 * One definition, used by the sky dome, the directional light, the water
 * specular and the clouds. When these disagree the scene quietly stops making
 * sense: water glinting from a direction nothing is lit from.
 */
import { Vector3 } from 'three'

/**
 * Mid-afternoon rather than noon. A high sun flattens terrain into a uniform
 * green; low light rakes across the ridges and gives the hills their shape,
 * which matters when reading the ground is the whole game.
 */
/**
 * Sun elevation is about 26 degrees. Deliberately low, for two reasons: raking
 * light gives the ridges their shape, and a low sun throws long shadows. The
 * bird's shadow is its altitude read-out, and at cruising height a short shadow
 * falls too steeply below the camera to ever appear on screen - it takes a long
 * one to land far enough ahead to be seen.
 */
export const SUN_DIRECTION = new Vector3(0.40, 0.45, -0.80).normalize()

/** How far off the sun sits. Beyond the terrain, inside the camera's far plane. */
export const SUN_DISTANCE = 1500

export const SKY = {
  /** Fed to the atmospheric sky shader. */
  turbidity: 2.4,
  rayleigh: 2.6,
  mieCoefficient: 0.006,
  mieDirectionalG: 0.82,
  /** Haze the distance fades into. Warmer than the zenith, like real haze. */
  fog: '#a6c2d8',
  /** Light colours. */
  sunLight: '#fff2d6',
  skyLight: '#bcd8f0',
  groundLight: '#7a7f63',
} as const

export function sunPosition(): [number, number, number] {
  const p = SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE)
  return [p.x, p.y, p.z]
}
