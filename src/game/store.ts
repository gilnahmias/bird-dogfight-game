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

type GameState = Telemetry & {
  /** Food value banked at the nest. */
  banked: number
  /** How many animals have been banked. */
  bankedCount: number
  /** How many are in the talons right now. */
  carried: number
  runStartedAt: number
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
  banked: 0,
  bankedCount: 0,
  carried: 0,
  runStartedAt: Date.now(),
  setTelemetry: (t) => set(t),
  // Banked food survives a death - it is in the nest, not in the bird.
  reset: () => set({ ...initialTelemetry, carried: 0, runStartedAt: Date.now() }),
}))
