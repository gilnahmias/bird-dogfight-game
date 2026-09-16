import test from 'node:test'
import assert from 'node:assert/strict'
import { CLEARANCE, keepAboveGround, keepCameraClear } from './cameraRig.ts'

const out = { x: 0, y: 0, z: 0 }

test('in open air the camera is left exactly where it wanted to be', () => {
  const flat = () => 0
  const bird = { x: 0, y: 100, z: 0 }
  const camera = { x: 0, y: 103, z: 11 }
  keepCameraClear(bird, camera, flat, out)
  assert.deepEqual(out, camera)
})

test('a camera that has swung into a hillside is lifted out of it', () => {
  // The bug: contouring along a slope and turning, the trailing camera ended up
  // below the ground on the uphill side - and from inside the single-sided
  // terrain, the mountain is see-through.
  const slope = (x: number) => x * 0.8 // rising toward +x
  const bird = { x: 0, y: 6, z: 0 }
  const camera = { x: 10, y: 4, z: 3 } // uphill, and underground (ground there is 8)
  keepCameraClear(bird, camera, slope, out)
  const groundUnder = slope(out.x)
  assert.ok(
    out.y >= groundUnder + CLEARANCE - 1e-9,
    `camera is ${(out.y - groundUnder).toFixed(2)}m above the ground, needs ${CLEARANCE}`,
  )
})

test('a hill between the bird and the camera pulls the camera in front of it', () => {
  // A ridge five metres behind the bird, taller than the line to the camera.
  const ridge = (_x: number, z: number) => (z > 4 && z < 7 ? 40 : 0)
  const bird = { x: 0, y: 20, z: 0 }
  const camera = { x: 0, y: 24, z: 12 }
  keepCameraClear(bird, camera, ridge, out)
  assert.ok(out.z <= 4, `the camera stayed at z=${out.z.toFixed(1)}, on the far side of the ridge`)
  // What matters is that it can SEE the bird: nothing solid on the line between.
  for (let i = 1; i < 20; i++) {
    const t = i / 20
    const y = out.y + (bird.y - out.y) * t
    const z = out.z + (bird.z - out.z) * t
    assert.ok(y >= ridge(0, z), `the ridge still hides the bird at z=${z.toFixed(1)}`)
  }
})

test('the floor is judged over a footprint, not a point', () => {
  // A spike just beside the camera: a single-point check misses it, and the
  // near plane's lower corner would still be inside it.
  const spike = (x: number, z: number) => (Math.hypot(x - 2, z - 11) < 0.6 ? 30 : 0)
  const bird = { x: 0, y: 30, z: 0 }
  const camera = { x: 0, y: 30, z: 11 }
  keepCameraClear(bird, camera, spike, out)
  assert.ok(out.y >= 30 + CLEARANCE - 1e-9, `the camera sat ${out.y.toFixed(1)}m high beside a 30m spike`)
})

test('it can be asked to write into the camera it was given', () => {
  const flat = () => 50
  const camera = { x: 0, y: 40, z: 11 }
  keepCameraClear({ x: 0, y: 60, z: 0 }, camera, flat, camera)
  assert.ok(camera.y >= 50 + CLEARANCE - 1e-9)
})

test('blocked, the camera rises over the obstacle before it pulls in', () => {
  // A wall right across the view behind the bird, so swinging round does not
  // clear it but rising a little does. Pulling in would put the camera on top of
  // the bird looking straight down.
  const wall = (_x: number, z: number) => (z > 5 && z < 7 ? 21.6 : 0)
  const bird = { x: 0, y: 20, z: 0 }
  const camera = { x: 0, y: 22, z: 11 }
  keepCameraClear(bird, camera, wall, out)
  assert.ok(out.z > 10, `it pulled in to z=${out.z.toFixed(1)} when rising would have done`)
  assert.ok(out.y > 22, 'it should have risen to see over the wall')
})

test('wherever the camera ends up, it can see the bird', () => {
  // The regression: pull in, then lift straight up for the floor, and a bump in
  // between hides the bird again. Try a spread of awkward terrains.
  const terrains = [
    (x: number, z: number) => Math.sin(x * 0.4) * 6 + z * 1.4,
    (x: number, z: number) => (Math.hypot(x, z - 6) < 3 ? 30 : 0),
    (x: number) => Math.abs(x) * 2.5,
    (_x: number, z: number) => Math.max(0, 14 - Math.abs(z - 5) * 4),
  ]
  for (const [n, terrain] of terrains.entries()) {
    const bird = { x: 0, y: terrain(0, 0) + 5, z: 0 }
    const camera = { x: 1, y: bird.y + 2.8, z: 11 }
    keepCameraClear(bird, camera, terrain, out)
    for (let i = 1; i < 40; i++) {
      const t = i / 40
      const px = out.x + (bird.x - out.x) * t
      const py = out.y + (bird.y - out.y) * t
      const pz = out.z + (bird.z - out.z) * t
      assert.ok(py >= terrain(px, pz) - 1e-6, `terrain ${n}: the bird is hidden at t=${t.toFixed(2)}`)
    }
  }
})

test('the floor on its own only lifts to the ground, it never ratchets', () => {
  const flat = () => 10
  const p = { x: 0, y: 5, z: 0 }
  for (let i = 0; i < 50; i++) keepAboveGround(p, flat)
  assert.ok(Math.abs(p.y - (10 + CLEARANCE)) < 1e-9, `applied repeatedly, it climbed to ${p.y}`)
})

test('beside a slope the camera swings toward lower ground and stays low', () => {
  // The case that mattered in the game: contouring along a hillside. Rising over
  // the slope looked down on the bird at eighty degrees; swinging away from it
  // keeps the view behind the bird.
  const hillside = (x: number) => Math.max(0, x) * 1.6 // steep ground to +x
  const bird = { x: 0, y: 6, z: 0 }
  const camera = { x: 6, y: 8.8, z: 9 } // swung round onto the uphill side
  keepCameraClear(bird, camera, hillside, out)
  const lookDown = (Math.atan2(out.y - bird.y, Math.hypot(out.x - bird.x, out.z - bird.z)) * 180) / Math.PI
  assert.ok(out.x < camera.x, `it should have swung away from the slope, x went ${camera.x} -> ${out.x.toFixed(1)}`)
  assert.ok(lookDown < 45, `looking down on the bird at ${lookDown.toFixed(0)} degrees`)
})
