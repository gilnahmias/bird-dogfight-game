/**
 * Every tuning number in the game lives here.
 *
 * Flight feel cannot be derived on paper, so these are calibration knobs, not
 * constants of nature. The dev tuning panel binds directly to this object -
 * nothing else in the codebase is allowed to hardcode a physics number.
 */
export const TUNING = {
  // --- Airframe -----------------------------------------------------------
  mass: 4.0, // kg, a large raptor
  wingArea: 0.62, // m^2
  airDensity: 1.225, // kg/m^3
  gravity: 9.81, // m/s^2

  // Lift curve. clSlope * stallAngle = max lift coefficient, which sets stall
  // speed: sqrt(2*m*g / (rho*S*clMax)) ~= 9 m/s with these numbers.
  clSlope: 5.0, // per radian
  stallAngle: 0.26, // rad (~15 deg)
  stallClFloor: 0.3, // fraction of clMax still produced deep in a stall

  // Drag: cd0 is parasitic, inducedK multiplies cl^2.
  cd0: 0.03,
  inducedK: 0.05,

  // --- Control authority --------------------------------------------------
  // Authority scales with airspeed: no airflow, no control. This is what makes
  // a stall feel like a stall without needing a spin model.
  refSpeed: 20, // m/s at which control authority is full
  pitchRate: 1.15, // rad/s at full authority
  rollRate: 2.6, // rad/s at full authority

  // Passive stability. pitchStability pulls the nose toward the airflow, which
  // is most of what makes the aircraft recover on its own. weathervane yaws the
  // nose out of a sideslip, which is what turns a bank into a coordinated turn.
  pitchStability: 2.6,
  weathervane: 2.6,
  // Hands off, the wing settles at this angle of attack rather than at zero.
  // Zero would mean zero lift, which noses the bird straight over into a dive.
  // This is the knob that sets the natural glide speed (~19 m/s here).
  trimAoa: 0.06, // rad
  // Hands off, the wings roll back toward level. Keeps a beginner from ending up
  // quietly inverted, without taking away the ability to hold a hard bank.
  rollAutoLevel: 2.2,

  // Extra nose-down torque past the stall angle. The player can fight it (which
  // delays recovery) but cannot cancel it, so letting go always recovers.
  stallRecovery: 4.0,
  stallFightFactor: 0.55, // how much of the recovery torque holding pitch-up cancels

  // --- Flapping -----------------------------------------------------------
  flapImpulse: 4.2, // N*s per wingbeat, along body up+forward
  flapInterval: 0.4, // s between beats while holding flap
  flapStaminaCost: 3.5,
  staminaMax: 100,
  staminaRegen: 7.0, // per second while not flapping
  // Assist: auto-flap when airspeed decays toward stall, so a new player cannot
  // simply fall out of the sky while learning.
  autoFlapSpeed: 11.0, // m/s

  // --- Carry load ---------------------------------------------------------
  maxLoad: 6.0, // talon weight budget (arbitrary units, 1 unit = 0.35 kg)
  loadMassPerUnit: 0.35, // kg
  loadAuthorityPenalty: 0.55, // control authority lost at full load

  // --- Ground -------------------------------------------------------------
  groundClearance: 1.2, // m below which we are touching terrain
  // Touching solid ground always ends the run. A raptor that is on the ground
  // cannot generate enough thrust to get airborne again in this model, so any
  // other rule leaves the player stranded, alive, with nothing to do.
  waterDragFactor: 0.55, // speed retained per second while dragging through water
  // Skim a lake fast and you get away with it. Settle onto it and you drown -
  // which is what keeps a low pass over water a real decision.
  drownSpeed: 9.0, // m/s

  // --- Camera -------------------------------------------------------------
  camDistance: 11,
  camHeight: 2.8,
  /**
   * How far ahead of the bird the camera looks. Too far and the sightline passes
   * over the bird's head, which pushes it off the bottom of the screen.
   */
  camLookAhead: 4.0,
  camLerp: 6.0, // position smoothing, per second
  camRollShare: 0.28, // fraction of the bird's bank the camera copies
  camFovBase: 62,
  camFovSpeedKick: 14, // extra FOV degrees at high speed
  camFovSpeedRef: 45, // m/s at which the kick is full
} as const

export type Tuning = { -readonly [K in keyof typeof TUNING]: number }

/** Live, mutable copy the game reads. The dev panel writes to this. */
export const T: Tuning = { ...TUNING }

// --- World ----------------------------------------------------------------
export const WORLD = {
  waterLevel: 0,
  chunkSize: 256,
  /** Chunk rings drawn around the player. */
  viewChunks: 6,
  /** Mesh segments per chunk at each LOD level. */
  lodSegments: [40, 28, 16, 10, 8],
  treeCount: 4200,
  treeChunkRadius: 3,
  /**
   * Fog has to finish hiding the world before the terrain runs out. viewChunks *
   * chunkSize is the radius of real ground (1536m here), so fogFar must sit
   * comfortably inside it or the player sees the edge of the map.
   */
  fogNear: 380,
  fogFar: 1400,
} as const
