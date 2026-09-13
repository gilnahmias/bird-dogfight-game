/**
 * Instruments. Read from the throttled telemetry in the store, never from the
 * simulation directly, so the UI cannot cost the frame loop anything.
 *
 * The stall warning is the one piece of UI the flight model genuinely needs: the
 * bird stalls silently otherwise, and a death the player could not see coming is
 * the fastest way to lose them.
 */
import { useGame } from '../game/store.ts'
import { T } from '../game/constants.ts'

export function HUD() {
  const { airspeed, altitudeAgl, climbRate, stamina, stallWarn, stalled, dead } = useGame()

  const stallSpeed = Math.sqrt(
    (2 * T.mass * T.gravity) / (T.airDensity * T.wingArea * T.clSlope * T.stallAngle),
  )

  return (
    <div className="hud">
      <div className="hud-left">
        <Gauge label="airspeed" value={airspeed.toFixed(0)} unit="m/s" warn={airspeed < stallSpeed * 1.15} />
        <Gauge label="altitude" value={Math.max(0, altitudeAgl).toFixed(0)} unit="m agl" />
        <Gauge
          label="climb"
          value={`${climbRate >= 0 ? '+' : ''}${climbRate.toFixed(1)}`}
          unit="m/s"
          good={climbRate > 0.4}
        />
      </div>

      <div className="hud-right">
        <div className="bar-label">stamina</div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${(stamina / T.staminaMax) * 100}%`,
              background: stamina < 25 ? '#e0703a' : '#6fc46f',
            }}
          />
        </div>
      </div>

      {stallWarn > 0 && !dead && (
        <div className="stall" style={{ opacity: 0.35 + stallWarn * 0.65 }}>
          {stalled ? 'STALL' : 'STALL WARNING'}
          <div className="stall-hint">ease off - it recovers itself</div>
        </div>
      )}

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
        <span><b>space</b> flap</span>
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
