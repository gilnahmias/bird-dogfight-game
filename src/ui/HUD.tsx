/**
 * Instruments. Read from the throttled telemetry in the store, never from the
 * simulation directly, so the UI cannot cost the frame loop anything.
 *
 * The stall warning is the one piece of UI the flight model genuinely needs: the
 * bird stalls silently otherwise, and a death the player could not see coming is
 * the fastest way to lose them.
 */
import { useGame } from '../game/store.ts'

export function HUD() {
  const { airspeed, altitudeAgl, climbRate, lift, talons, perched, dead } = useGame()

  return (
    <div className="hud">
      <div className="hud-left">
        <Gauge label="airspeed" value={airspeed.toFixed(0)} unit="m/s" warn={talons > 0.4} />
        <Gauge label="altitude" value={Math.max(0, altitudeAgl).toFixed(0)} unit="m agl" />
        <Gauge
          label="climb"
          value={`${climbRate >= 0 ? '+' : ''}${climbRate.toFixed(1)}`}
          unit="m/s"
          good={climbRate > 0.4}
        />
        {/*
          The variometer: what the air is doing, not what the bird is doing. This
          is the instrument that makes soaring playable - it tells you there is
          lift here before your altimeter has caught up, which is the difference
          between finding a thermal and flying straight through one.
        */}
        <Vario lift={lift} />
      </div>

      <div className="hud-right">
        <div className="bar-label">talons</div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${talons * 100}%`, background: talons > 0.5 ? '#e0b545' : '#7a8794' }}
          />
        </div>
      </div>

      {perched && !dead && <div className="perched">PERCHED &middot; hold a direction to take off</div>}

      {dead && (
        <div className="dead">
          <div className="dead-title">CRASHED</div>
          <div className="dead-hint">press Enter to fly again</div>
        </div>
      )}

      <div className="controls">
        <span><b>&larr; &rarr;</b> bank</span>
        <span><b>&darr;</b> nose up</span>
        <span><b>&uarr;</b> nose down</span>
        <span><b>space</b> brake &amp; talons</span>
      </div>
    </div>
  )
}

function Vario({ lift }: { lift: number }) {
  const strength = Math.min(1, Math.abs(lift) / 4)
  const rising = lift > 0.3
  const sinking = lift < -0.3
  return (
    <div className="gauge vario">
      <div className="gauge-label">air</div>
      <div
        className={`gauge-value${rising ? ' good' : ''}${sinking ? ' warn' : ''}`}
        style={{ opacity: 0.45 + strength * 0.55 }}
      >
        <span className="vario-arrow">{rising ? '\u25b2' : sinking ? '\u25bc' : '\u2013'}</span>
        {`${lift >= 0 ? '+' : ''}${lift.toFixed(1)}`}
        <span className="gauge-unit">m/s</span>
      </div>
    </div>
  )
}

function Gauge({
  label,
  value,
  unit,
  warn,
  good,
}: {
  label: string
  value: string
  unit: string
  warn?: boolean
  good?: boolean
}) {
  return (
    <div className="gauge">
      <div className="gauge-label">{label}</div>
      <div className={`gauge-value${warn ? ' warn' : ''}${good ? ' good' : ''}`}>
        {value}
        <span className="gauge-unit">{unit}</span>
      </div>
    </div>
  )
}
