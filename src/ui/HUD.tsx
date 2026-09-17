/**
 * Instruments. Read from the throttled telemetry in the store, never from the
 * simulation directly, so the UI cannot cost the frame loop anything.
 *
 * The stall warning is the one piece of UI the flight model genuinely needs: the
 * bird stalls silently otherwise, and a death the player could not see coming is
 * the fastest way to lose them.
 */
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import type { BirdState } from '../flight/physics.ts'
import { FWD } from '../flight/physics.ts'
import { useGame } from '../game/store.ts'
import { T } from '../game/constants.ts'
import { tarnSitesNear } from '../world/terrain.ts'
import { rivalNestsNear } from '../entities/rivalNests.ts'

export function HUD({ nest, bird, seed }: { nest: Vector3; bird: BirdState; seed: string }) {
  const {
    airspeed,
    altitudeAgl,
    climbRate,
    lift,
    talons,
    perched,
    dead,
    load,
    carried,
    banked,
    threat,
    threatBearing,
    threatAbove,
    threatCarrying,
    rivalsBeaten,
  } = useGame()

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
        <div className="bar-label">talons {carried > 0 ? `- carrying ${carried}` : ''}</div>
        <div className="bar">
          {/*
            One bar, two readings: how far the feet are out, and how full they
            are. They are the same resource - a full load is what stops the bird
            taking anything else.
          */}
          <div
            className="bar-fill"
            style={{ width: `${talons * 100}%`, background: talons > 0.5 ? '#e0b545' : '#7a8794' }}
          />
          <div className="bar-load" style={{ width: `${(load / T.maxLoad) * 100}%` }} />
        </div>
      </div>

      <div className="score">
        <div className="score-value">{banked}</div>
        <div className="score-label">banked</div>
      </div>

      {perched && !dead && <div className="perched">IN THE NEST &middot; press SPACE to launch</div>}

      {threat !== 'none' && !dead && (
        <ThreatWarning
          threat={threat}
          bearing={threatBearing}
          above={threatAbove}
          carrying={threatCarrying}
        />
      )}

      {carried > 0 && !dead && <Pointer target={nest} label="nest" bird={bird} tone="home" />}
      {carried === 0 && !dead && <LakePointer bird={bird} seed={seed} />}
      {carried === 0 && !dead && <RivalNestPointer bird={bird} seed={seed} home={nest} />}

      {rivalsBeaten > 0 && (
        <div className="rivals-beaten">rivals beaten {rivalsBeaten}</div>
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
        <span><b>space</b> brake &amp; talons</span>
        <span><b>x</b> drop</span>
        <span>catch prey low, bank it at the nest</span>
        <span>beat a rival by diving on it from above, talons out</span>
        <span>raid rival nests, steal from rivals carrying food</span>
      </div>
    </div>
  )
}

/**
 * Which way something is, and how far.
 *
 * Polled rather than driven from the store, because the bearing changes every
 * frame and the HUD must not re-render at sixty hertz.
 */
function Pointer({
  target,
  label,
  bird,
  tone,
}: {
  target: Vector3
  label: string
  bird: BirdState
  tone: 'home' | 'water' | 'rival'
}) {
  const [bearing, setBearing] = useState(0)
  const [distance, setDistance] = useState(0)
  const frame = useRef(0)

  useEffect(() => {
    const forward = new Vector3()
    const tick = () => {
      forward.copy(FWD).applyQuaternion(bird.quat)
      const dx = target.x - bird.pos.x
      const dz = target.z - bird.pos.z
      // Angle from where the bird is looking to where the target is.
      const toTarget = Math.atan2(dx, -dz)
      const heading = Math.atan2(forward.x, -forward.z)
      let delta = toTarget - heading
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      setBearing(delta)
      setDistance(Math.hypot(dx, dz))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [target, bird])

  const onCourse = Math.abs(bearing) < 0.25
  return (
    <div className={`nest-pointer ${tone}${onCourse ? ' on-course' : ''}`}>
      <div className="nest-arrow" style={{ transform: `rotate(${bearing}rad)` }}>
        &uarr;
      </div>
      <div className="nest-distance">
        {distance < 1000 ? `${distance.toFixed(0)}m` : `${(distance / 1000).toFixed(1)}km`}
      </div>
      <div className="nest-label">{label}</div>
    </div>
  )
}

/**
 * Where the nearest mountain lake is.
 *
 * The world has a dozen of them within a few kilometres, each with a waterfall
 * spilling out of it, and the player still could not find one - a hundred metre
 * pool in a three kilometre landscape is a needle, and the fog closes in at
 * 1.4km. Nothing else in the game says "there is water up there", so this does.
 *
 * Shown only when the talons are EMPTY: with a catch to carry, the way home is
 * the live question and two compasses would be one too many.
 */
function LakePointer({ bird, seed }: { bird: BirdState; seed: string }) {
  const [lake, setLake] = useState<Vector3 | null>(null)

  useEffect(() => {
    const find = () => {
      const near = tarnSitesNear(bird.pos.x, bird.pos.z, LAKE_SEARCH, seed)[0]
      setLake(near ? new Vector3(near.x, near.level, near.z) : null)
    }
    find()
    // The nearest lake changes as the bird travels, but slowly. Once a second is
    // plenty, and it keeps a cell scan out of the frame loop.
    const timer = setInterval(find, 1000)
    return () => clearInterval(timer)
  }, [bird, seed])

  if (!lake) return null
  return <Pointer target={lake} label="lake" bird={bird} tone="water" />
}

/**
 * Where the nearest rival nest is - the other way to get food, and a fight.
 *
 * Out to the right, mirroring the lake compass on the left, so neither ever sits
 * on top of the other or of the rival warning in the middle.
 */
function RivalNestPointer({ bird, seed, home }: { bird: BirdState; seed: string; home: Vector3 }) {
  const [target, setTarget] = useState<Vector3 | null>(null)

  useEffect(() => {
    const find = () => {
      const near = rivalNestsNear(bird.pos.x, bird.pos.z, RIVAL_NEST_SEARCH, seed, home)[0]
      setTarget(near ? near.bowl.clone() : null)
    }
    find()
    const timer = setInterval(find, 1000)
    return () => clearInterval(timer)
  }, [bird, seed, home])

  if (!target) return null
  return <Pointer target={target} label="rival nest" bird={bird} tone="rival" />
}

/** How far to look for a rival nest to point at. */
const RIVAL_NEST_SEARCH = 2500

/** How far to look for a lake to point at. Beyond this, it is not news. */
const LAKE_SEARCH = 3000

/**
 * The warning that a rival is working on you.
 *
 * Two stages, because the fight is meant to be winnable by reading it. A rival
 * climbs before it dives and that climb is the warning: the player who looks up
 * and climbs too, or turns and gets speed, wins the exchange. A dive that
 * arrived out of nowhere would just be a tax.
 */
function ThreatWarning({
  threat,
  bearing,
  above,
  carrying,
}: {
  threat: 'watching' | 'diving'
  bearing: number
  above: number
  carrying: boolean
}) {
  const diving = threat === 'diving'
  // Which way to LOOK. A compass bearing says where it is on the ground; half
  // the answer to "where is it" is whether you have to look up or down.
  const height = Math.round(above)
  const vertical = height > 8 ? `${height}m above` : height < -8 ? `${-height}m below` : 'level'
  return (
    <div className={`threat${diving ? ' diving' : ''}`}>
      <div className="threat-arrow" style={{ transform: `rotate(${bearing}rad)` }}>
        &uarr;
      </div>
      <div className="threat-text">{diving ? 'RIVAL DIVING' : 'rival climbing'}</div>
      <div className="threat-height">{vertical}</div>
      <div className="threat-hint">
        {/* A rival with food is a prize as well as a threat: say so, because
            it is the reason to turn and fight rather than run. */}
        {carrying ? 'it has food - dive on it' : diving ? 'turn away or climb' : 'get above it'}
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
