/**
 * The on-screen controls for a phone or tablet.
 *
 * Left thumb steers with a stick that appears wherever it lands - on a phone
 * there is no fixed place a thumb reliably finds, so the control comes to the
 * thumb instead. The resting ring shows where to start. Right thumb holds
 * TALONS, the Space key: brake, catch, land, and launch from the nest.
 *
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { OWN_POINTER, STICK_RADIUS, setTouch, stickAxis } from '../flight/input.ts'
import { useGame } from '../game/store.ts'
import { isMuted, onMuteChange, toggleMute } from '../audio/engine.ts'
import { useTouchMode } from './touchMode.ts'

/**
 * Keep receiving this finger's moves after it slides off the element.
 *
 * Can throw if the pointer is already gone by the time the handler runs; losing
 * capture then only means a drag off the edge ends early, so it is not fatal.
 */
function capture(e: PointerEvent) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // The finger has already lifted.
  }
}

// --- The stick -------------------------------------------------------------------

function Stick() {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const pointer = useRef<number | null>(null)
  // Also kept in a ref: moves can arrive before React has rendered the new origin.
  const start = useRef({ x: 0, y: 0 })

  const move = (e: PointerEvent, from: { x: number; y: number }) => {
    let dx = e.clientX - from.x
    let dy = e.clientY - from.y
    const length = Math.hypot(dx, dy)
    if (length > STICK_RADIUS) {
      dx *= STICK_RADIUS / length
      dy *= STICK_RADIUS / length
    }
    setKnob({ x: dx, y: dy })
    // Screen up is climb (positive pitch, nose up): a thumb points where to go.
    setTouch({ roll: stickAxis(dx), pitch: -stickAxis(dy) })
  }

  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer.current) return
    pointer.current = null
    setOrigin(null)
    setKnob({ x: 0, y: 0 })
    setTouch({ roll: 0, pitch: 0 })
  }

  return (
    <div
      className="stick-zone"
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || pointer.current !== null) return
        pointer.current = e.pointerId
        capture(e)
        start.current = { x: e.clientX, y: e.clientY }
        setOrigin(start.current)
        move(e, start.current)
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) move(e, start.current)
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        className={`stick${origin ? ' active' : ''}`}
        style={origin ? { left: origin.x, top: origin.y } : undefined}
      >
        <div className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        {!origin && <div className="stick-label">steer</div>}
      </div>
    </div>
  )
}

// --- Buttons ---------------------------------------------------------------------

function HoldButton({
  className,
  label,
  onChange,
}: {
  className: string
  label: string
  onChange: (held: boolean) => void
}) {
  const [held, setHeld] = useState(false)
  const set = (value: boolean) => {
    setHeld(value)
    onChange(value)
  }
  return (
    // Not marked as its own pointer: a tap on TALONS should still resume a
    // paused game or fly again after a crash, like a tap anywhere else.
    <button
      type="button"
      className={`touch-button ${className}${held ? ' held' : ''}`}
      onPointerDown={(e) => {
        capture(e)
        set(true)
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path
          d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  )
}

export function TouchControls() {
  const touch = useTouchMode()
  const paused = useGame((s) => s.paused)
  const muted = useSyncExternalStore(onMuteChange, isMuted)
  // Switching to the mouse mid-press unmounts the buttons before they hear the release.
  useEffect(() => {
    if (!touch) setTouch({ roll: 0, pitch: 0, brake: false, drop: false })
  }, [touch])
  if (!touch) return null

  return (
    <div className="touch-controls">
      <Stick />
      <HoldButton className="talons" label="TALONS" onChange={(held) => setTouch({ brake: held })} />
      <HoldButton className="drop" label="DROP" onChange={(held) => setTouch({ drop: held })} />
      <div className="touch-corner">
        <button
          type="button"
          {...{ [OWN_POINTER]: '' }}
          className="corner-button"
          aria-label={muted ? 'Sound on' : 'Sound off'}
          onPointerDown={toggleMute}
        >
          <SpeakerIcon muted={muted} />
        </button>
        <button
          type="button"
          {...{ [OWN_POINTER]: '' }}
          className="corner-button"
          aria-label={paused ? 'Resume' : 'Pause'}
          onPointerDown={() => useGame.getState().togglePause()}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            {paused ? (
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            ) : (
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
            )}
          </svg>
        </button>
      </div>
    </div>
  )
}
