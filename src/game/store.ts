/**
 * Game state that the UI reads. The flight simulation itself does NOT live here -
 * it runs in a ref inside the frame loop, and pushes a throttled telemetry
 * snapshot in, so a 60fps simulation does not cause 60 React renders a second.
 */
import { create } from 'zustand'

export type Telemetry = {
  airspeed: number
  altitudeAgl: number
  altitudeMsl: number
  climbRate: number
  /** Vertical speed of the air itself - the variometer, not the bird's climb. */
  lift: number
  /** 0 tucked, 1 thrown fully forward. */
  talons: number
  perched: boolean
  load: number
  dead: boolean
}

export type Threat = 'none' | 'watching' | 'diving'

type GameState = Telemetry & {
  /** What the rivals are doing, for the warning on screen. */
  threat: Threat
  /** Where that rival is, relative to the nose, in radians. */
  threatBearing: number
  /** How far above the bird it is, in metres. Negative means below. */
  threatAbove: number
  /** Whether that rival has food in its talons - food that can be won. */
  threatCarrying: boolean
  /** How many rivals have been knocked out of the sky. */
  rivalsBeaten: number
  /** How many crows are mobbing the bird right now. */
  mobbed: number
  /** Pecks taken, and crows knocked out of the air. */
  pecked: number
  crowsSwatted: number
  /** How many times the player has been hit. */
  struck: number
  /** Food value banked at the nest. */
  banked: number
  /** How many animals have been banked. */
  bankedCount: number
  /** How many are in the talons right now. */
  carried: number
  runStartedAt: number
  /** Frozen by a click: nothing simulates or renders until the next one. */
  paused: boolean
  togglePause: () => void
  setTelemetry: (t: Partial<Telemetry>) => void
  reset: () => void
}

const initialTelemetry: Telemetry = {
  airspeed: 0,
  altitudeAgl: 0,
  altitudeMsl: 0,
  climbRate: 0,
  lift: 0,
  talons: 0,
  perched: false,
  load: 0,
  dead: false,
}

export const useGame = create<GameState>((set) => ({
  ...initialTelemetry,
  threat: 'none',
  threatBearing: 0,
  threatAbove: 0,
  threatCarrying: false,
  rivalsBeaten: 0,
  mobbed: 0,
  pecked: 0,
  crowsSwatted: 0,
  struck: 0,
  banked: 0,
  bankedCount: 0,
  carried: 0,
  runStartedAt: Date.now(),
  paused: false,
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setTelemetry: (t) => set(t),
  // Banked food survives a death - it is in the nest, not in the bird.
  reset: () =>
    set({ ...initialTelemetry, carried: 0, threat: 'none', runStartedAt: Date.now() }),
}))
