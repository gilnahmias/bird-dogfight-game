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
  stamina: number
  stallWarn: number
  stalled: boolean
  /** Vertical speed of the air itself - the variometer, not the bird's climb. */
  lift: number
  load: number
  dead: boolean
}

type GameState = Telemetry & {
  banked: number
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
  stamina: 100,
  stallWarn: 0,
  stalled: false,
  lift: 0,
  load: 0,
  dead: false,
}

export const useGame = create<GameState>((set) => ({
  ...initialTelemetry,
  banked: 0,
  carried: 0,
  runStartedAt: Date.now(),
  setTelemetry: (t) => set(t),
  reset: () => set({ ...initialTelemetry, carried: 0, runStartedAt: Date.now() }),
}))
