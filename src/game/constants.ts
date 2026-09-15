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

  // Lift curve. It saturates instead of breaking down: there is no stall in this
  // model, so pulling the nose up costs speed and climb but never drops the wing
  // out from under the player.
  clSlope: 5.0, // per radian
  /** Angle of attack where lift has essentially flattened off. */
  aoaSoftLimit: 0.34, // rad

  // Drag: cd0 is parasitic, inducedK multiplies cl^2.
  cd0: 0.03,
  inducedK: 0.05,

  // --- Control authority --------------------------------------------------
  // Authority scales with airspeed: no airflow, no control. This is what makes
  // a stall feel like a stall without needing a spin model.
  refSpeed: 20, // m/s at which control authority is full
  /**
   * The speed the bird holds under its own power. It beats its wings constantly,
   * so it accelerates toward this and coasts past it in a dive.
   */
  cruiseSpeed: 21,
  /** Cap on the thrust the governor may call for. */
  maxThrust: 26,
  /**
   * Thrust available while standing on the ground.
   *
   * A bird leaps off, it does not taxi. Cruise thrust with the nose up is worth
   * well under the bird's own weight, so without this the player could land and
   * then never leave - perched forever, alive, with nothing to do.
   */
  launchThrust: 78,
  /**
   * Seconds the leap keeps pushing once it starts.
   *
   * A committed burst rather than a per-frame check, because sitting on the
   * ground the bird flickers in and out of contact - and gating the shove on
   * that flag meant it fired on maybe half the frames, leaving the bird
   * shuffling along the deck instead of getting away.
   */
  launchDuration: 1.1,
  /** Speed kept per second while standing on the ground. */
  groundFriction: 0.02,
  /** Control never fades out entirely - a braking bird still has to steer. */
  minAuthority: 0.35,
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
  /**
   * Roll stability, always acting, not just when the stick is centred. It turns
   * the roll axis into a bank command: the wings settle where the input balances
   * the levelling torque, so holding right gives a steady bank of about
   * asin(rollRate / rollStability) instead of a barrel roll.
   *
   * This is what makes soaring possible at all - a thermal has to be circled to
   * stay in it, and a rate-only roll axis cannot hold a circle. It also means the
   * bird can never end up inverted by accident.
   */
  rollStability: 3.1,


  // --- Wingbeat -----------------------------------------------------------
  /** Seconds per beat. Purely how fast the wings look like they are working. */
  flapInterval: 0.4,

  // --- Brake and talons ---------------------------------------------------
  /**
   * Multiplier on drag with the feet fully out. Spreading the talons and fanning
   * the tail is enormously draggy, which is exactly how a bird sheds speed.
   */
  brakeDrag: 9.0,
  /**
   * How much of its own weight the bird holds up while flaring.
   *
   * Deliberately just under 1. At 1.15 it hovered indefinitely a few metres up
   * and could never actually land; a shade under its own weight means a braking
   * bird settles, and drag from the spread talons caps the sink at about 4 m/s -
   * inside what counts as a landing rather than an impact.
   */
  flareSupport: 0.94,
  /**
   * Fraction of cruise below which the flare starts holding the bird up at all.
   * Above this the wing is still flying and needs no help - and giving it help
   * anyway threw the bird skyward on every hunting pass.
   */
  flareOnset: 0.62,
  /** Seconds-to-full for throwing the feet forward, and for tucking them back. */
  talonOutRate: 6.0,
  talonInRate: 2.6,

  // --- Carry load ---------------------------------------------------------
  maxLoad: 6.0, // talon weight budget (arbitrary units, 1 unit = 0.35 kg)
  loadMassPerUnit: 0.35, // kg
  loadAuthorityPenalty: 0.55, // control authority lost at full load

  // --- Ground -------------------------------------------------------------
  groundClearance: 1.2, // m below which we are touching terrain
  // Touching solid ground is survivable now: the bird can brake to a standstill
  // and beat its way back off the deck, so landing is a move rather than a
  // failure. Arriving fast is still fatal.
  waterDragFactor: 0.55, // speed retained per second while dragging through water
  // Skim a lake fast and you get away with it. Settle onto it and you drown -
  // which is what keeps a low pass over water a real decision.
  drownSpeed: 9.0, // m/s
  /** Slow enough, and sinking gently enough, to put the feet down and perch. */
  landingSpeed: 7.5, // m/s
  landingSink: 6.0, // m/s
  /**
   * Downward speed at impact above which the ground kills.
   *
   * Judged on how hard the bird arrives, not on how fast it is travelling.
   * Brushing the grass at speed on the way out of a takeoff is survivable;
   * flying into a hillside is not. Using horizontal speed instead meant every
   * takeoff ended in a crash a second after leaving the ground.
   */
  crashSink: 9.0, // m/s
  /** Speed kept per second while scraping along the ground. */
  scrapeFriction: 0.35,

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

/**
 * The moving air. These are the numbers that decide whether the sky is worth
 * reading, so they are tuned against one benchmark: a hands-off glide sinks at
 * 2.8 m/s, so lift has to beat that comfortably or soaring is a lie.
 */
export const AIR = {
  /** Prevailing wind. Direction comes from the seed, so each zone has its own. */
  windSpeed: 7.0,

  // --- Thermals -----------------------------------------------------------
  /** Peak core strength, well above the 2.8 m/s it has to beat. */
  thermalGain: 6.5,
  /** Cores are where the field crosses this, so thermals are sparse, not everywhere. */
  thermalThreshold: 0.12,
  /** Thermals need ground clearance to organise, and they top out. */
  thermalRampHeight: 55,
  thermalCeiling: 540,
  /** Air that goes up somewhere has to come down elsewhere. */
  interThermalSink: 1.2,
  /** Size of the cores: smaller means harder to core, and more rewarding. */
  thermalScale: 0.0022,

  // --- Ridge lift ---------------------------------------------------------
  /** Applied to the component of wind blowing into a slope. */
  ridgeGain: 1.25,
  /** Ridge lift is a thin band hugging the slope, unlike a thermal. */
  ridgeCeiling: 170,
  /** The lee side sinks, which is what makes the wrong side of a ridge dangerous. */
  leeFactor: 0.85,

  // --- Water --------------------------------------------------------------
  /** Cold water gives nothing back and actively pulls you down. */
  waterSink: 1.7,
  waterSinkHeight: 240,
} as const
