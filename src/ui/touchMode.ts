/**
 * Whether the player is on a touchscreen right now.
 *
 * Starts from what the device says it has, then follows whatever was actually
 * used last, so a laptop with a touchscreen works both ways. Also sets a class on
 * the body, which is how the HUD's layout switches.
 */
import { useSyncExternalStore } from 'react'

let touchMode = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const modeListeners = new Set<() => void>()

function setTouchMode(value: boolean) {
  if (value === touchMode) return
  touchMode = value
  document.body.classList.toggle('touch', value)
  for (const listener of modeListeners) listener()
}

if (typeof window !== 'undefined') {
  document.body.classList.toggle('touch', touchMode)
  window.addEventListener('pointerdown', (e) => setTouchMode(e.pointerType === 'touch'), true)
}

export function useTouchMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      modeListeners.add(listener)
      return () => modeListeners.delete(listener)
    },
    () => touchMode,
  )
}

