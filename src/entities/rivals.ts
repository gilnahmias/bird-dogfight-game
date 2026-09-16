/**
 * Rival raptors: the part of the world that hunts back.
 *
 * The rule is the one the player already knows from their own talons, used
 * against them. A strike lands when it comes from ABOVE or BEHIND and fast; a
 * slow pass, or one made from below, loses. Nothing about it is a special case
 * for the AI - `resolveStrike` is symmetric, and the same call decides both who
 * hit whom when a rival dives on the player and when the player dives on a
 * rival.
 *
 * Pure: no scene objects, no React. Rival flight is deliberately NOT the full
 * aerodynamic model - a rival does not need to be flyable, only to be READ, and
 * a steering model that always does what the state machine intends is easier to
 * tune into a fair fight than one fighting its own stall margin.
 */
import { Vector3 } from 'three'

/**
 * What a rival is doing. The climb is what makes them readable: a rival that
 * means to strike goes up FIRST, in the open, and the player has that long to
 * decide whether to run, turn into it, or take the height for themselves.
 */
export type RivalMode = 'patrol' | 'climb' | 'commit' | 'overshoot'

export type Rival = {
  id: number
  pos: Vector3
  vel: Vector3
  mode: RivalMode
  /** Seconds left in the current mode, for the ones that time out. */
  timer: number
  /** Where it loiters when it has no reason to be anywhere else. */
  home: Vector3
  /** Which way round its patrol circle it goes. */
  spin: number
  dead: boolean
  /** Seconds since it was killed, for the fall. */
  dying: number
}

export const RIVAL = {
  /**
   * Cruising speed of a rival on patrol.
   *
   * A shade faster than the player's cruise, and no more. Slower, measured, and
   * it could never close at all - it trailed three hundred metres behind and the
   * fight never happened. Much faster and running away stops working, which is
   * the escape a ten year old needs to have.
   */
  cruise: 28,
  /** Flat out, coming down. */
  diveSpeed: 40,
  /** How hard it can turn, radians per second. */
  turnRate: 1.6,
  /** And in a committed dive, where it is actively tracking. */
  diveTurnRate: 2.9,
  /**
   * It notices the player inside this.
   *
   * Generous, because the player cruises faster than a rival patrols: measured
   * at four hundred metres, a rival simply watched the bird disappear and never
   * got a chance to be part of the game at all.
   */
  seeRange: 780,
  /** Inside this, a patrolling rival drifts toward the bird rather than circling. */
  approachRange: 1200,
  /** Height it wants over the player before committing. */
  advantage: 55,
  /** Seconds of climbing before it gives up and tries again. */
  climbPatience: 14,
  /**
   * How steeply it climbs, as a slope. At cruise this is about four metres a
   * second - deliberately LESS than the player's best climb of five and a half.
   *
   * This is the single number that decides whether the fight is winnable. A
   * rival that out-climbs the player owns the height for ever, and height is the
   * whole game: measured against the real flight model, at seven metres a second
   * the player could not get above it once in forty-five seconds.
   */
  climbSlope: 0.14,
  /**
   * Seconds a committed dive lasts before it is a miss.
   *
   * Long, because the closing rate in a stoop on a bird already running is only
   * about fifteen metres a second: measured at seven seconds, the dive broke off
   * sixty metres short every single time, and the rival was harmless.
   */
  divePatience: 13,
  /**
   * Slant range it must be inside before it commits.
   *
   * Height alone was not enough: a rival that had its fifty-five metres while
   * still four hundred metres back spent the whole dive chasing a bird that was
   * simply flying away, and the pass never happened. It has to be close AND
   * high, which is also what a real stoop looks like.
   */
  commitRange: 170,
  /**
   * Seconds of recovery after a pass, during which it cannot strike.
   *
   * This is the pace of the whole fight: climb, stoop, recover, climb again. At
   * three seconds a rival was landing a hit every twenty seconds on a player who
   * ignored it, which for the audience this is aimed at is a nag rather than a
   * threat. It is also the window the player is meant to attack in.
   */
  recover: 5,
  /**
   * How close the talons have to be for an exchange to happen at all.
   *
   * Roughly a wingspan and a half. Nine metres was measured to be unhittable:
   * a stoop that flies its last line rather than steering all the way in misses
   * by fifteen or twenty, and every pass came to nothing.
   */
  reach: 14,
  /**
   * Closing speed below which a pass is just two birds crossing.
   *
   * Low on purpose. Anything that tracks its target all the way in - a stoop, a
   * tail chase - converges on the target's own velocity, so a strict threshold
   * quietly means that only head-on passes ever land, and head-on passes are the
   * one case the rule calls a draw.
   */
  strikeSpeed: 5,
  /**
   * Inside this, a diving rival stops correcting and holds its line.
   *
   * At forty metres and forty metres a second, the player has about a second to
   * move - long enough to be a decision, short enough to need to have seen the
   * dive coming.
   */
  lockRange: 40,
  /** How far above counts as coming down on someone. */
  fromAbove: 6,
  /** Descending this much faster than the other bird counts as stooping on it. */
  stoopRate: 6,
  /** How far behind, along the target's own heading, counts as on its tail. */
  fromBehind: 0.55,
} as const

export type Combatant = {
  pos: Vector3
  vel: Vector3
  /** Unit vector: the way it is facing. */
  forward: Vector3
}

export type Strike = 'none' | 'attacker' | 'target'

/** How fast two birds are closing on each other, in m/s. */
export function closingSpeed(a: Combatant, b: Combatant): number {
  const gap = new Vector3().subVectors(b.pos, a.pos)
  const distance = gap.length()
  if (distance < 1e-3) return a.vel.distanceTo(b.vel)
  gap.divideScalar(distance)
  // Positive when the gap is shrinking.
  return a.vel.dot(gap) - b.vel.dot(gap)
}

const gap = new Vector3()

/** Whether `a` is in a position `b` cannot answer. */
export function hasAdvantage(a: Combatant, b: Combatant): boolean {
  if (a.pos.y > b.pos.y + RIVAL.fromAbove) return true
  // Below it: no claim at all, whatever else is true. This is the other half of
  // the rule the player hunts by - you strike downward or you do not strike.
  if (a.pos.y < b.pos.y - RIVAL.fromAbove) return false

  /*
    Level with it, but coming DOWN on it.

    Height at the instant of the pass is a snapshot, and a stoop that arrives
    level has still been a stoop: measured, a player who climbed above a rival
    and dived on it crossed at nought metres and the exchange came out as a miss,
    because by then the two were within a few metres of each other. What decides
    it is who is falling on whom.
  */
  if (a.vel.y < b.vel.y - RIVAL.stoopRate) return true
  if (b.vel.y < a.vel.y - RIVAL.stoopRate) return false

  /*
    On its tail: behind it and going the same way, judged FLAT.

    Measured in three dimensions, a bird eight metres below and three behind
    counted as being on the tail - the line up to it points backwards - so a
    rival climbing from underneath scored the same as one sitting on its
    quarry's back. Height is settled above; this is only about the horizontal.
  */
  gap.subVectors(a.pos, b.pos)
  gap.y = 0
  if (gap.lengthSq() < 1e-6) return false
  gap.normalize()
  const heading = tmpHeading.copy(b.forward)
  heading.y = 0
  if (heading.lengthSq() < 1e-6) return false
  heading.normalize()
  const onTail = gap.dot(heading) < -0.3
  const together = flatDot(a.forward, b.forward)
  return onTail && together > RIVAL.fromBehind
}

const tmpHeading = new Vector3()
const flatA = new Vector3()
const flatB = new Vector3()

/** How aligned two headings are, ignoring climb and dive. */
function flatDot(a: Vector3, b: Vector3): number {
  flatA.set(a.x, 0, a.z)
  flatB.set(b.x, 0, b.z)
  if (flatA.lengthSq() < 1e-6 || flatB.lengthSq() < 1e-6) return 0
  return flatA.normalize().dot(flatB.normalize())
}

/**
 * Who wins when two birds pass inside talon reach.
 *
 * Symmetric by construction: asked once per pair, it answers with whichever had
 * the advantage, or 'none' when neither did. A bird wins by arriving fast AND
 * from a position the other cannot answer - above it, or on its tail. That is
 * the whole combat model, and it is the same rule the player was taught by
 * hunting: commit from height, or do not commit.
 */
export function resolveStrike(a: Combatant, b: Combatant): Strike {
  if (a.pos.distanceTo(b.pos) > RIVAL.reach) return 'none'

  const aWins = hasAdvantage(a, b)
  const bWins = hasAdvantage(b, a)

  // The pass has to be going somewhere. Only just, though: a bird that has
  // worked its way above or behind another has already done the hard part, and
  // both a stoop and a tail chase converge on the target's own speed as they
  // arrive - measured, a player who climbed above a rival and dived on it closed
  // the last few metres at half a metre a second, and nothing happened.
  if (closingSpeed(a, b) < RIVAL.strikeSpeed) return 'none'

  // Both, or neither: they miss. Two birds arriving head-on with equal claim is
  // a near miss, not a double kill.
  if (aWins === bWins) return 'none'
  return aWins ? 'attacker' : 'target'
}

/** What the rival needs to know about the bird it is hunting. */
export type Quarry = {
  pos: Vector3
  vel: Vector3
  /** A bird on the ground or in its nest is not worth attacking. */
  perched: boolean
  dead: boolean
}

/**
 * Decide what a rival should be doing.
 *
 * Split out from the steering so the decision can be tested on its own: the
 * whole point of the climb phase is that the player gets a warning, and a test
 * can hold the AI to committing only from height.
 */
export function nextMode(rival: Rival, quarry: Quarry, dt: number): { mode: RivalMode; timer: number } {
  const timer = Math.max(0, rival.timer - dt)
  const range = rival.pos.distanceTo(quarry.pos)
  const asleep = quarry.dead || quarry.perched || range > RIVAL.seeRange

  if (asleep) return { mode: 'patrol', timer }

  switch (rival.mode) {
    case 'patrol':
      // Anything it can see is worth climbing on.
      return { mode: 'climb', timer: RIVAL.climbPatience }

    case 'climb': {
      const above = rival.pos.y - quarry.pos.y
      // Committed once it has the height AND is close enough for the dive to
      // land, not on a timer: that is what makes the stoop readable rather than
      // arbitrary.
      if (above >= RIVAL.advantage && range < RIVAL.commitRange) {
        return { mode: 'commit', timer: RIVAL.divePatience }
      }
      // Given up on getting above: break off and try again from patrol.
      if (timer <= 0) return { mode: 'overshoot', timer: RIVAL.recover }
      return { mode: 'climb', timer }
    }

    case 'commit': {
      // The pass is over when the dive has spent itself, or when the rival is
      // below its quarry - past that point it is climbing at something faster
      // than it is, which is how a rival gets killed rather than kills.
      if (timer <= 0 || rival.pos.y < quarry.pos.y - RIVAL.fromAbove) {
        return { mode: 'overshoot', timer: RIVAL.recover }
      }
      return { mode: 'commit', timer }
    }

    case 'overshoot':
      return timer <= 0 ? { mode: 'patrol', timer: 0 } : { mode: 'overshoot', timer }
  }
}

const desired = new Vector3()
const toQuarry = new Vector3()
const aim = new Vector3()

/**
 * Fly a rival for one step.
 *
 * Steering, not aerodynamics: it picks the velocity it wants and turns toward it
 * at a limited rate. A rival that had to fly the player's flight model would
 * spend its time recovering from its own mistakes, and the fight is meant to be
 * about the player's.
 */
export function stepRival(rival: Rival, quarry: Quarry, dt: number, time: number): Rival {
  if (rival.dead) {
    rival.dying += dt
    // Killed: it falls, and keeps whatever sideways speed it had.
    rival.vel.y -= 9.81 * dt
    rival.pos.addScaledVector(rival.vel, dt)
    return rival
  }

  const next = nextMode(rival, quarry, dt)
  rival.mode = next.mode
  rival.timer = next.timer

  toQuarry.subVectors(quarry.pos, rival.pos)
  const range = toQuarry.length()
  if (range > 1e-3) toQuarry.divideScalar(range)

  let speed: number = RIVAL.cruise
  switch (rival.mode) {
    case 'patrol': {
      if (range < RIVAL.approachRange) {
        // Coming over to have a look. Level and unhurried - this is the part of
        // the fight the player is supposed to SEE before anything happens.
        desired.copy(toQuarry)
        desired.y *= 0.3
        desired.normalize()
        speed = RIVAL.cruise
      } else {
        // A slow circle over its own ground.
        const angle = time * 0.22 * rival.spin + rival.id
        aim.set(
          rival.home.x + Math.cos(angle) * 150 - rival.pos.x,
          rival.home.y + 40 - rival.pos.y,
          rival.home.z + Math.sin(angle) * 150 - rival.pos.z,
        )
        desired.copy(aim).normalize()
      }
      break
    }
    case 'climb': {
      // Up, and closing: it wants height over its quarry, which means being
      // ABOVE it rather than merely higher than it somewhere else.
      desired.copy(toQuarry)
      desired.y = 0
      if (desired.lengthSq() > 1e-6) desired.normalize()
      const wanted = rival.pos.y - quarry.pos.y
      /*
        A BIRD'S climb, not a rocket's.

        The first version pointed itself up at forty-five degrees and went up at
        twenty-two metres a second, which no player can answer - the bird climbs
        at five or six. Held to a third of that, the climb takes the best part of
        ten seconds, and those ten seconds are the warning the whole fight is
        built on.
      */
      const lift = wanted < RIVAL.advantage ? RIVAL.climbSlope : 0.05
      // The slope goes on a UNIT horizontal, so the climb rate is the slope
      // times the speed and nothing else. Shortening the horizontal first - to
      // ease off as it closes - quietly steepened the climb to seven metres a
      // second instead of four; how hard it is chasing must not change how fast
      // it goes up.
      desired.y = lift
      desired.normalize()
      speed = range > 160 ? RIVAL.cruise : RIVAL.cruise * 0.8
      break
    }
    case 'commit': {
      /*
        Straight at it, leading the target a little so a turning bird is not a
        free escape - but only until the last fifty metres. Inside that the
        stoop is committed and flies its line.

        Two reasons, and they are the same reason. A rival that steers all the
        way in converges on its quarry's velocity and arrives alongside it at
        walking pace, which is not a strike; and it can never be dodged, which is
        the only part of this the player gets to be good at.
      */
      if (range > RIVAL.lockRange) {
        /*
          Lead by how long the dive will actually take.

          Capped at a fixed second and a bit, it under-led badly: from a hundred
          and seventy metres out the dive takes four seconds, the bird covers a
          hundred metres in that time, and every stoop arrived where the bird had
          been. Measured, a rival diving on a player flying dead straight never
          got closer than fifty-eight metres.
        */
        const flight = Math.min(3.5, (range / RIVAL.diveSpeed) * 1.25)
        aim.copy(quarry.pos).addScaledVector(quarry.vel, flight)
        desired.subVectors(aim, rival.pos).normalize()
      } else {
        desired.copy(rival.vel).normalize()
      }
      speed = RIVAL.diveSpeed
      break
    }
    case 'overshoot': {
      /*
        The window.

        A pass that misses leaves the rival below its quarry and slow, and it
        stays that way for a few seconds before it starts climbing again. That is
        the player's opening: turn, come down on it, and the same rule that was
        just used against you works for you. Climbing away hard instead - which
        is what it used to do - left nothing to answer with.
      */
      desired.copy(rival.vel).normalize()
      desired.y = 0.12
      desired.normalize()
      speed = RIVAL.cruise * 0.7
      break
    }
  }

  // Turn toward the heading it wants, at a limited rate.
  const heading = rival.vel.length() > 1e-3 ? rival.vel.clone().normalize() : desired.clone()
  const rate = rival.mode === 'commit' ? RIVAL.diveTurnRate : RIVAL.turnRate
  const turn = Math.min(1, (rate * dt) / Math.max(0.2, heading.angleTo(desired)))
  heading.lerp(desired, turn).normalize()

  rival.vel.copy(heading).multiplyScalar(speed)
  rival.pos.addScaledVector(rival.vel, dt)
  return rival
}
