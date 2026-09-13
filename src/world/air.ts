/**
 * The moving air: prevailing wind, thermals, ridge lift and sink.
 *
 * This is what makes the terrain worth reading. A hands-off glide sinks at
 * 2.8 m/s, so anywhere the air rises faster than that is free altitude, and the
 * player's job becomes finding it: sunlit dry ground for thermals, the windward
 * face of a ridge for ridge lift, and staying off the lakes.
 *
 * Everything here is returned as a wind vector that the flight model treats as
 * real airflow, so lift interacts with the wing honestly rather than the bird
 * being teleported upward.
 */
import { Vector3 } from 'three'
import { clamp, fbm, fieldsFor, hashSeed, smoothstep } from './noise.ts'
import { heightAt, moistureAt, normalAt } from './terrain.ts'
import { AIR, WORLD } from '../game/constants.ts'

export type AirSample = {
  /** Full air velocity: horizontal wind plus whatever the air is doing vertically. */
  wind: Vector3
  /** Vertical air speed, split out for the variometer and the dust motes. */
  lift: number
  thermal: number
  ridge: number
}

export function createAirSample(): AirSample {
  return { wind: new Vector3(), lift: 0, thermal: 0, ridge: 0 }
}

/** Prevailing wind direction for a seed, as a unit vector in the XZ plane. */
export function windDirection(seed: string, out = new Vector3()): Vector3 {
  const angle = (hashSeed(`${seed}:wind`) / 0xffffffff) * Math.PI * 2
  return out.set(Math.sin(angle), 0, -Math.cos(angle))
}

/** The surface the bird is flying over: the lake top, or the ground. */
export function surfaceAt(x: number, z: number, seed: string): number {
  return Math.max(heightAt(x, z, seed), WORLD.waterLevel)
}

/**
 * How hard the ground drives a thermal. Dry ground bakes, wet ground and forest
 * do not, and water gives nothing at all.
 */
function groundHeat(x: number, z: number, ground: number, seed: string): number {
  if (ground < WORLD.waterLevel) return 0
  return clamp(0.5 - moistureAt(x, z, seed) * 0.5, 0, 1)
}

/**
 * Thermal strength alone, without the ridge or wind terms. Cheap on purpose -
 * the dust motes sample it once per mote per frame and cannot afford the
 * surface normal.
 */
export function thermalAt(x: number, y: number, z: number, seed: string, time = 0): number {
  const ground = heightAt(x, z, seed)
  const heat = groundHeat(x, z, ground, seed)
  if (heat <= 0) return 0

  const agl = y - Math.max(ground, WORLD.waterLevel)
  if (agl < 0 || agl > AIR.thermalCeiling) return 0

  // Thermals drift downwind, the way real ones do. Without this the air moves at
  // 7 m/s while the columns stand still, and a bird circling a core is blown out
  // of it within a turn or two - which makes thermalling impossible rather than
  // skilful. Sampling the static field upwind of here is the same thing as the
  // field having drifted downwind.
  const drift = windDirection(seed, driftVec).multiplyScalar(AIR.windSpeed * time)
  const sx = x - drift.x
  const sz = z - drift.z

  const field = fbm(fieldsFor(seed, 'air', 1)[0], sx * AIR.thermalScale, sz * AIR.thermalScale, 3)
  const core = smoothstep(AIR.thermalThreshold, 0.6, field)

  // A thermal needs height to organise and dies out at its ceiling.
  const profile =
    smoothstep(0, AIR.thermalRampHeight, agl) *
    (1 - smoothstep(AIR.thermalCeiling * 0.65, AIR.thermalCeiling, agl))

  // Air rising in the cores has to come down in between them.
  return (AIR.thermalGain * core - AIR.interThermalSink * (1 - core)) * heat * profile
}

const normal: [number, number, number] = [0, 0, 0]
const wind = new Vector3()
const driftVec = new Vector3()

export function sampleAir(pos: Vector3, seed: string, out: AirSample, time = 0): AirSample {
  const { x, y, z } = pos
  windDirection(seed, wind).multiplyScalar(AIR.windSpeed)

  const ground = heightAt(x, z, seed)
  const surface = Math.max(ground, WORLD.waterLevel)
  const agl = y - surface

  // --- Ridge lift ---------------------------------------------------------
  // The horizontal part of the surface normal points downhill, so wind blowing
  // into the slope gives a negative dot product. Its magnitude already carries
  // both the wind speed and the steepness.
  let ridge = 0
  if (agl >= 0 && agl < AIR.ridgeCeiling) {
    normalAt(x, z, seed, normal)
    const facing = -(normal[0] * wind.x + normal[2] * wind.z)
    // Ridge lift hugs the slope and fades with height, unlike a thermal.
    const decay = 1 - agl / AIR.ridgeCeiling
    ridge = AIR.ridgeGain * facing * decay * (facing > 0 ? 1 : AIR.leeFactor)
  }

  // --- Thermals -----------------------------------------------------------
  const thermal = thermalAt(x, y, z, seed, time)

  // --- Water --------------------------------------------------------------
  let sink = 0
  if (ground < WORLD.waterLevel) {
    sink = -AIR.waterSink * (1 - smoothstep(0, AIR.waterSinkHeight, Math.max(0, agl)))
  }

  out.ridge = ridge
  out.thermal = thermal
  out.lift = ridge + thermal + sink
  out.wind.set(wind.x, out.lift, wind.z)
  return out
}
