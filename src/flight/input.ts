/**
 * Control state. A plain mutable object, not React state - it is read from the
 * frame loop 60 times a second and must never trigger a render.
 *
 * Left/Right bank (which turns you). Down pulls the nose up, Up pushes it down,
 * like a plane. Space brakes and puts the talons out - one key, because for a
 * raptor they are one movement: the feet come forward to slow down, to land, and
 * to take something. X opens them again and lets the catch go.
 *
 * Touch drives the same controls, not different ones: the thumb stick is the
 * arrow keys (pushed up is nose down, exactly like the Up arrow), the TALONS
 * button is Space and DROP is X. Someone who learns on a phone can pick up the
 * keyboard without relearning which way is down.
 *
 * Pointers, whatever kind: a tap on the pause screen resumes and a tap on the
 * crash screen flies again. A mouse click in flight pauses. A touch in flight
 * never does, because on a phone every touch is a control.
 */
import type { Input } from './physics.ts'
import { useGame } from '../game/store.ts'

const pressed = new Set<string>()

export const input: Input & { restart: boolean; drop: boolean } = {
  roll: 0,
  pitch: 0,
  brake: false,
  restart: false,
  /** Let go of whatever is in the talons. */
  drop: false,
}

/** What the on-screen controls are doing. Merged with the keys in refresh(). */
const touch = { roll: 0, pitch: 0, brake: false, drop: false, restart: false }

const TRACKED = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'KeyX',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'Enter',
])

const clamp = (v: number) => Math.max(-1, Math.min(1, v))

function refresh() {
  const left = pressed.has('ArrowLeft') || pressed.has('KeyA')
  const right = pressed.has('ArrowRight') || pressed.has('KeyD')
  const noseDown = pressed.has('ArrowUp') || pressed.has('KeyW')
  const noseUp = pressed.has('ArrowDown') || pressed.has('KeyS')
  input.roll = clamp((right ? 1 : 0) - (left ? 1 : 0) + touch.roll)
  input.pitch = clamp((noseUp ? 1 : 0) - (noseDown ? 1 : 0) + touch.pitch)
  input.brake = pressed.has('Space') || touch.brake
  input.restart = pressed.has('Enter') || touch.restart
  input.drop = pressed.has('KeyX') || touch.drop
}

/** Set by the on-screen controls. */
export function setTouch(change: Partial<typeof touch>): void {
  Object.assign(touch, change)
  refresh()
}

/** How far the thumb travels for full deflection, in CSS pixels. */
export const STICK_RADIUS = 56
/** Wobble under this is a resting thumb, not an input. */
const DEAD_ZONE = 0.12

/**
 * Deflection to control input: a dead zone, then a gentle curve, so small
 * corrections are small and a full push is still full authority.
 */
export function stickAxis(offset: number): number {
  const t = Math.max(-1, Math.min(1, offset / STICK_RADIUS))
  const magnitude = Math.max(0, (Math.abs(t) - DEAD_ZONE) / (1 - DEAD_ZONE))
  return Math.sign(t) * magnitude ** 1.4
}

/** Elements that handle their own pointers, so a tap on them is not a tap on the game. */
export const OWN_POINTER = 'data-control'

export function attachInput() {
  const down = (e: KeyboardEvent) => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (!e.repeat) useGame.getState().togglePause()
      return
    }
    if (!TRACKED.has(e.code)) return
    e.preventDefault() // stop arrows and space from scrolling the page
    pressed.add(e.code)
    refresh()
  }
  const up = (e: KeyboardEvent) => {
    if (!TRACKED.has(e.code)) return
    e.preventDefault()
    pressed.delete(e.code)
    refresh()
  }
  const pointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    // Checked first: the pause button toggles pause itself, and this must not undo it.
    if (e.target instanceof Element && e.target.closest(`[${OWN_POINTER}]`)) return
    const game = useGame.getState()
    if (game.paused) {
      game.togglePause()
      return
    }
    if (game.dead) {
      setTouch({ restart: true })
      return
    }
    if (e.pointerType === 'mouse') game.togglePause()
  }
  const pointerUp = () => {
    if (touch.restart) setTouch({ restart: false })
  }
  // Losing focus mid-turn would otherwise leave the bird banked forever.
  const clear = () => {
    pressed.clear()
    Object.assign(touch, { roll: 0, pitch: 0, brake: false, drop: false, restart: false })
    refresh()
  }
  window.addEventListener('keydown', down, { passive: false })
  window.addEventListener('keyup', up, { passive: false })
  window.addEventListener('pointerdown', pointerDown)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)
  window.addEventListener('blur', clear)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('pointerdown', pointerDown)
    window.removeEventListener('pointerup', pointerUp)
    window.removeEventListener('pointercancel', pointerUp)
    window.removeEventListener('blur', clear)
    clear()
  }
}
