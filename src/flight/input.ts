/**
 * Keyboard state. A plain mutable object, not React state - it is read from the
 * frame loop 60 times a second and must never trigger a render.
 *
 * Left/Right bank (which turns you). Down pulls the nose up, Up pushes it down,
 * like a plane. Space brakes and puts the talons out - one key, because for a
 * raptor they are one movement: the feet come forward to slow down, to land, and
 * to take something.
 */
import type { Input } from './physics.ts'

const pressed = new Set<string>()

export const input: Input & { restart: boolean } = {
  roll: 0,
  pitch: 0,
  brake: false,
  restart: false,
}

const TRACKED = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'Enter',
])

function refresh() {
  const left = pressed.has('ArrowLeft') || pressed.has('KeyA')
  const right = pressed.has('ArrowRight') || pressed.has('KeyD')
  const noseDown = pressed.has('ArrowUp') || pressed.has('KeyW')
  const noseUp = pressed.has('ArrowDown') || pressed.has('KeyS')
  input.roll = (right ? 1 : 0) - (left ? 1 : 0)
  input.pitch = (noseUp ? 1 : 0) - (noseDown ? 1 : 0)
  input.brake = pressed.has('Space')
  input.restart = pressed.has('Enter')
}

export function attachInput() {
  const down = (e: KeyboardEvent) => {
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
  // Losing focus mid-turn would otherwise leave the bird banked forever.
  const clear = () => {
    pressed.clear()
    refresh()
  }
  window.addEventListener('keydown', down, { passive: false })
  window.addEventListener('keyup', up, { passive: false })
  window.addEventListener('blur', clear)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', clear)
    clear()
  }
}
