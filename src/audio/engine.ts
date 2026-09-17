/**
 * Every sound in the game, synthesized.
 *
 * The project has no assets and the audio keeps it that way: noise and a few
 * oscillators are enough for wind, falling water, a raptor's scream and a soft
 * bed of music, and none of it has to be downloaded.
 *
 * Positions are real. The listener rides the camera and every bird and waterfall
 * sits in the world through a PannerNode, so a screech comes from where the
 * rival actually is - behind you, above you, off to the left - which is half of
 * what makes it useful.
 *
 * Browsers will not start audio until the page has been interacted with, so the
 * context is created on the first key press or click. M mutes, and is remembered.
 */
import type { Vector3 } from 'three'

const MUTE_KEY = 'raptor.muted'

/** Overall levels. The music is a bed under the game, never on top of it. */
const LEVEL = { master: 0.9, music: 0.3, wind: 0.32, falls: 2.2, calls: 1.6 }

let ctx: AudioContext | null = null
let master: GainNode
let musicBus: GainNode
let windGain: GainNode
let windFilter: BiquadFilterNode
let whiteNoise: AudioBuffer
let brownNoise: AudioBuffer
let muted = readMuted()
let paused = false
const listeners = new Set<(muted: boolean) => void>()
/** Dev only: every call made, for checking from the console. */
const heardCalls: string[] = []

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function onMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toggleMute(): void {
  muted = !muted
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Not remembered, but still muted for this visit.
  }
  syncRunning()
  for (const listener of listeners) listener(muted)
}

/** A paused game is a silent one: the music and the waterfalls wait too. */
export function setPaused(value: boolean): void {
  paused = value
  syncRunning()
}

/** Suspended rather than turned down, so a muted or hidden game costs no CPU. */
function syncRunning() {
  if (!ctx) return
  if (muted || paused || document.hidden) void ctx.suspend()
  else void ctx.resume()
}

/** The context, once the player has touched the page. Null before that. */
export function audio(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null
}

/**
 * Hook the page up: unlock on first interaction, M to mute, quiet when hidden.
 * Returns the cleanup, so it can be used directly as an effect.
 */
export function attachAudio(): () => void {
  const unlock = () => {
    if (!ctx) start()
    syncRunning()
  }
  const key = (e: KeyboardEvent) => {
    if (e.code === 'KeyM' && !e.repeat) toggleMute()
    unlock()
  }
  window.addEventListener('keydown', key)
  window.addEventListener('pointerdown', unlock)
  document.addEventListener('visibilitychange', syncRunning)
  return () => {
    window.removeEventListener('keydown', key)
    window.removeEventListener('pointerdown', unlock)
    document.removeEventListener('visibilitychange', syncRunning)
  }
}

function start() {
  ctx = new AudioContext()
  const out = new DynamicsCompressorNode(ctx, { threshold: -14, ratio: 4 })
  out.connect(ctx.destination)
  master = new GainNode(ctx, { gain: LEVEL.master })
  master.connect(out)

  if (import.meta.env.DEV) {
    // A level meter and a log of calls, so the mix can be checked from the console.
    const meter = new AnalyserNode(ctx, { fftSize: 2048 })
    out.connect(meter)
    const samples = new Float32Array(meter.fftSize)
    Object.assign(window, {
      sound: {
        ctx,
        calls: heardCalls,
        screech,
        caw,
        level: () => {
          meter.getFloatTimeDomainData(samples)
          return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
        },
      },
    })
  }

  whiteNoise = noise(ctx, false)
  brownNoise = noise(ctx, true)

  const reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, 3.2) })
  reverb.connect(master)

  // Wind: noise through a band that opens up with speed.
  windFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 400, Q: 0.7 })
  windGain = new GainNode(ctx, { gain: 0 })
  loop(whiteNoise).connect(windFilter).connect(windGain).connect(master)

  musicBus = new GainNode(ctx, { gain: LEVEL.music })
  musicBus.connect(master)
  musicBus.connect(new GainNode(ctx, { gain: 0.7 })).connect(reverb)
  startMusic()
}

function noise(context: AudioContext, brown: boolean): AudioBuffer {
  const length = context.sampleRate * 4
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    if (brown) {
      // Integrated noise: the low rumble of a lot of water landing.
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    } else {
      data[i] = white
    }
  }
  return buffer
}

/** A decaying burst of noise, which is all a room's echo is. */
function impulse(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.5
    }
  }
  return buffer
}

function loop(buffer: AudioBuffer): AudioBufferSourceNode {
  const source = new AudioBufferSourceNode(ctx!, { buffer, loop: true })
  // A random start, so two loops of the same buffer do not phase against each other.
  source.start(0, Math.random() * buffer.duration)
  return source
}

// --- The listener ------------------------------------------------------------

/** Put the ears where the camera is, facing where it faces. */
export function placeListener(pos: Vector3, forward: Vector3, up: Vector3): void {
  const c = audio()
  if (!c) return
  const l = c.listener
  if (l.positionX) {
    const t = c.currentTime
    l.positionX.setTargetAtTime(pos.x, t, 0.02)
    l.positionY.setTargetAtTime(pos.y, t, 0.02)
    l.positionZ.setTargetAtTime(pos.z, t, 0.02)
    l.forwardX.setTargetAtTime(forward.x, t, 0.02)
    l.forwardY.setTargetAtTime(forward.y, t, 0.02)
    l.forwardZ.setTargetAtTime(forward.z, t, 0.02)
    l.upX.setTargetAtTime(up.x, t, 0.02)
    l.upY.setTargetAtTime(up.y, t, 0.02)
    l.upZ.setTargetAtTime(up.z, t, 0.02)
  } else {
    // Firefox has only the older setters.
    l.setPosition(pos.x, pos.y, pos.z)
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z)
  }
}

function panner(at: Vector3, options: PannerOptions): PannerNode {
  return new PannerNode(ctx!, {
    positionX: at.x,
    positionY: at.y,
    positionZ: at.z,
    ...options,
  })
}

// --- Wind ----------------------------------------------------------------------

/** 0 to 1, from ears.windLevel. */
export function setWind(level: number): void {
  const c = audio()
  if (!c) return
  const t = c.currentTime
  windGain.gain.setTargetAtTime(level * LEVEL.wind, t, 0.25)
  windFilter.frequency.setTargetAtTime(250 + level * 1400, t, 0.25)
}

// --- Waterfalls ------------------------------------------------------------------

export type FallVoice = { stop: () => void }

/**
 * A waterfall: a rumble and a hiss, heard from its own place in the world.
 *
 * Falloff is exponential rather than the default inverse law, because under the
 * inverse law a fall four hundred metres away is still clearly audible and the
 * whole range sounds like it is raining.
 */
export function startFall(at: Vector3, width: number): FallVoice | null {
  if (!ctx) return null
  const size = Math.min(1.4, 0.6 + width / 20)
  const place = panner(at, {
    panningModel: 'equalpower',
    distanceModel: 'exponential',
    refDistance: 50,
    rolloffFactor: 1.5,
  })
  const gain = new GainNode(ctx, { gain: 0 })
  gain.gain.setTargetAtTime(LEVEL.falls * size, ctx.currentTime, 1.5)
  place.connect(gain).connect(master)

  const rumble = loop(brownNoise)
  rumble.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 500 })).connect(place)
  const hiss = loop(whiteNoise)
  hiss
    .connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.5 }))
    .connect(new GainNode(ctx, { gain: 0.35 }))
    .connect(place)

  return {
    stop: () => {
      const c = ctx!
      gain.gain.setTargetAtTime(0, c.currentTime, 0.4)
      rumble.stop(c.currentTime + 2)
      hiss.stop(c.currentTime + 2)
    },
  }
}

// --- Birds -------------------------------------------------------------------------

/** Where a call comes from. Close calls use HRTF, which sells above and behind. */
function callPlace(at: Vector3): PannerNode {
  return panner(at, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    // Far enough that a rival at the edge of the fog is still clearly a rival.
    refDistance: 120,
    rolloffFactor: 1,
  })
}

/**
 * A raptor's scream: the drawn-out, falling "kee-eeer" of a hawk.
 *
 * A bright sawtooth sweeping down, roughened by a fast tremolo - that rasp is
 * what makes it a bird rather than a whistle - with a little breath of noise
 * under it. `pitch` separates the three kinds of rival: the falcon is thin and
 * high, the eagle lower and heavier. A dive is shorter, higher and comes twice.
 */
export function screech(at: Vector3, pitch: number, urgent: boolean): void {
  const c = audio()
  if (!c) return
  const repeats = urgent ? 2 : 1
  if (import.meta.env.DEV) heardCalls.push(urgent ? 'dive' : 'screech')
  for (let r = 0; r < repeats; r++) {
    const t = c.currentTime + r * 0.42 + Math.random() * 0.05
    const length = urgent ? 0.45 : 0.95
    const peak = (urgent ? 3300 : 2900) * pitch

    const place = callPlace(at)
    place.connect(master)
    const out = new GainNode(c, { gain: 0 })
    out.connect(place)
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(LEVEL.calls * (urgent ? 1.2 : 1), t + 0.04)
    out.gain.setValueAtTime(LEVEL.calls * (urgent ? 1.1 : 0.9), t + length * 0.55)
    out.gain.exponentialRampToValueAtTime(0.001, t + length)

    const voice = new OscillatorNode(c, { type: 'sawtooth' })
    voice.frequency.setValueAtTime(peak * 0.8, t)
    voice.frequency.exponentialRampToValueAtTime(peak, t + 0.07)
    voice.frequency.exponentialRampToValueAtTime(peak * 0.58, t + length)

    // The rasp: amplitude shaken sixty-odd times a second.
    const rasp = new GainNode(c, { gain: 0.6 })
    const shake = new OscillatorNode(c, { type: 'square', frequency: 55 + Math.random() * 15 })
    const depth = new GainNode(c, { gain: 0.4 })
    shake.connect(depth).connect(rasp.gain)

    const tone = new BiquadFilterNode(c, { type: 'bandpass', frequency: peak, Q: 2.5 })
    tone.frequency.setValueAtTime(peak, t)
    tone.frequency.exponentialRampToValueAtTime(peak * 0.6, t + length)
    voice.connect(rasp).connect(tone).connect(out)

    const breath = new AudioBufferSourceNode(c, { buffer: whiteNoise })
    breath
      .connect(new BiquadFilterNode(c, { type: 'bandpass', frequency: peak * 1.2, Q: 3 }))
      .connect(new GainNode(c, { gain: 0.25 }))
      .connect(out)

    for (const source of [voice, shake, breath]) {
      source.start(t)
      source.stop(t + length + 0.05)
    }
  }
}

/**
 * A crow's caw: short, flat and harsh - a buzzy low tone pushed through the
 * nasal formants of a beak, which is what separates it from the hawk's scream.
 */
export function caw(at: Vector3, times = 1): void {
  const c = audio()
  if (!c) return
  const pitch = 0.9 + Math.random() * 0.25
  if (import.meta.env.DEV) heardCalls.push('caw')
  for (let i = 0; i < times; i++) {
    const t = c.currentTime + i * (0.28 + Math.random() * 0.06) + Math.random() * 0.1
    const length = 0.22 + Math.random() * 0.06

    const place = callPlace(at)
    place.connect(master)
    const out = new GainNode(c, { gain: 0 })
    out.connect(place)
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(LEVEL.calls * 1.3, t + 0.02)
    out.gain.exponentialRampToValueAtTime(0.001, t + length)

    const voice = new OscillatorNode(c, { type: 'sawtooth' })
    voice.frequency.setValueAtTime(520 * pitch, t)
    voice.frequency.linearRampToValueAtTime(610 * pitch, t + 0.05)
    voice.frequency.exponentialRampToValueAtTime(380 * pitch, t + length)

    const rasp = new GainNode(c, { gain: 0.5 })
    const shake = new OscillatorNode(c, { type: 'square', frequency: 38 })
    shake.connect(new GainNode(c, { gain: 0.5 })).connect(rasp.gain)
    voice.connect(rasp)
    for (const formant of [1150, 1700]) {
      rasp.connect(new BiquadFilterNode(c, { type: 'bandpass', frequency: formant * pitch, Q: 4 })).connect(out)
    }

    for (const source of [voice, shake]) {
      source.start(t)
      source.stop(t + length + 0.05)
    }
  }
}

// --- Music ---------------------------------------------------------------------------

/*
  Soft and slow, and never the same twice: long pad chords wandering through D
  major with a few plucked notes drifting over the top. Built to sit under an
  hour of flying without the player ever noticing it loop, because it does not.
*/

/** One bar, in seconds. */
const BAR = 7
/** Pad chords as MIDI notes: D, Bm, G, A, and the gentler Em for variety. */
const CHORDS = [
  [62, 66, 69],
  [59, 62, 66],
  [55, 59, 62],
  [57, 61, 64],
  [52, 55, 59],
]
/** Which chord may follow which: always somewhere that sounds like it belongs. */
const NEXT = [
  [1, 2, 3, 2],
  [2, 4, 3],
  [0, 3, 4, 0],
  [0, 0, 1],
  [2, 3],
]
/** The D major pentatonic, up where a melody sits clear of the pads. */
const MELODY = [74, 76, 78, 81, 83, 86]

function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function startMusic() {
  let chord = 0
  let nextBar = ctx!.currentTime + 1.5
  const schedule = () => {
    if (!ctx || ctx.state !== 'running') return
    while (nextBar < ctx.currentTime + 2) {
      playBar(chord, nextBar)
      const options = NEXT[chord]
      chord = options[Math.floor(Math.random() * options.length)]
      nextBar += BAR
    }
  }
  schedule()
  // ponytail: a timer rather than an AudioWorklet clock; a bar is seven seconds
  // and the lookahead is two, so timer jitter is inaudible.
  setInterval(schedule, 500)
}

function playBar(chord: number, t: number) {
  for (const note of CHORDS[chord]) pad(hz(note), t)
  // The bass, an octave under the root.
  pad(hz(CHORDS[chord][0] - 12), t, 0.7)

  const notes = Math.floor(Math.random() * 4)
  for (let i = 0; i < notes; i++) {
    const when = t + 0.8 + Math.random() * (BAR - 2)
    pluck(hz(MELODY[Math.floor(Math.random() * MELODY.length)]), when)
  }
}

function pad(frequency: number, t: number, level = 1) {
  const c = ctx!
  const hold = BAR + 1.5
  const gain = new GainNode(c, { gain: 0 })
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.06 * level, t + 2.5)
  gain.gain.setValueAtTime(0.06 * level, t + hold - 3)
  gain.gain.linearRampToValueAtTime(0, t + hold)
  const filter = new BiquadFilterNode(c, { type: 'lowpass', frequency: 900, Q: 0.3 })
  filter.connect(gain).connect(musicBus)
  for (const detune of [-6, 6]) {
    const osc = new OscillatorNode(c, { type: 'triangle', frequency, detune })
    osc.connect(filter)
    osc.start(t)
    osc.stop(t + hold + 0.1)
  }
}

function pluck(frequency: number, t: number) {
  const c = ctx!
  const gain = new GainNode(c, { gain: 0 })
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.07, t + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0005, t + 3)
  gain.connect(musicBus)
  const osc = new OscillatorNode(c, { type: 'sine', frequency })
  osc.connect(gain)
  osc.start(t)
  osc.stop(t + 3.1)
}
