/**
 * Terrain mesh. A ring of chunks around the player, each built from heightAt, at
 * a resolution that drops with distance.
 *
 * Every chunk carries a downward skirt around its perimeter. Neighbouring chunks
 * at different resolutions do not agree on the height along their shared edge, so
 * without skirts you see slivers of sky through the seams; with them you see the
 * side of the hill, which nobody notices.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, type Vector3 } from 'three'
import { biomeFrom, heightAt, moistureAt, snowAt } from './terrain.ts'
import { WORLD } from '../game/constants.ts'

const SKIRT_DROP = 60

const BIOME_COLOR = {
  water: new Color('#5a6b4a'), // lake bed, seen through the water
  rock: new Color('#8d8a86'),
  forest: new Color('#3f5f38'),
  grass: new Color('#7d9153'),
} as const

const SNOW = new Color('#e8edf2')
const SAND = new Color('#b9ae85')

function colorFor(h: number, slope: number, moisture: number, out: Color) {
  out.copy(BIOME_COLOR[biomeFrom(h, slope, moisture)])
  // Shorelines read as beach, peaks as snow. Both are cheap and both do a lot of
  // work in making the terrain legible from the air.
  if (h > WORLD.waterLevel && h < 6) out.lerp(SAND, 1 - h / 6)
  out.lerp(SNOW, snowAt(h, slope, moisture))
  return out
}

/** Chunk geometry is expensive enough to be worth keeping between frames. */
const geometryCache = new Map<string, BufferGeometry>()

function buildChunk(cx: number, cz: number, segments: number, seed: string): BufferGeometry {
  const key = `${seed}:${cx}:${cz}:${segments}`
  const cached = geometryCache.get(key)
  if (cached) return cached

  const size = WORLD.chunkSize
  const originX = cx * size
  const originZ = cz * size
  const step = size / segments
  const side = segments + 1

  // Sample heights with a one-vertex border on every side. The border is what
  // lets us derive normals and slope from the grid itself rather than calling
  // back into the noise four more times per vertex.
  const padded = side + 2
  const heights = new Float32Array(padded * padded)
  for (let iz = -1; iz <= segments + 1; iz++) {
    for (let ix = -1; ix <= segments + 1; ix++) {
      heights[(iz + 1) * padded + (ix + 1)] = heightAt(originX + ix * step, originZ + iz * step, seed)
    }
  }
  const sample = (ix: number, iz: number) => heights[(iz + 1) * padded + (ix + 1)]

  const gridCount = side * side
  const skirtCount = side * 4 * 2
  const positions = new Float32Array((gridCount + skirtCount) * 3)
  const normals = new Float32Array((gridCount + skirtCount) * 3)
  const colors = new Float32Array((gridCount + skirtCount) * 3)
  const c = new Color()

  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const i = iz * side + ix
      const x = originX + ix * step
      const z = originZ + iz * step
      const h = sample(ix, iz)
      positions[i * 3] = x
      positions[i * 3 + 1] = h
      positions[i * 3 + 2] = z

      // Central difference across the grid, in world units.
      const nx = sample(ix - 1, iz) - sample(ix + 1, iz)
      const nz = sample(ix, iz - 1) - sample(ix, iz + 1)
      const ny = 2 * step
      const len = Math.hypot(nx, ny, nz)
      normals[i * 3] = nx / len
      normals[i * 3 + 1] = ny / len
      normals[i * 3 + 2] = nz / len

      colorFor(h, 1 - ny / len, moistureAt(x, z, seed), c)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  const indices: number[] = []
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * side + ix
      const b = a + 1
      const d = a + side
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }

  // Skirt: duplicate each edge vertex, drop the copy, and bridge the two.
  let next = gridCount
  const edge = (i: number) => {
    const top = next++
    positions[top * 3] = positions[i * 3]
    positions[top * 3 + 1] = positions[i * 3 + 1]
    positions[top * 3 + 2] = positions[i * 3 + 2]
    const bottom = next++
    positions[bottom * 3] = positions[i * 3]
    positions[bottom * 3 + 1] = positions[i * 3 + 1] - SKIRT_DROP
    positions[bottom * 3 + 2] = positions[i * 3 + 2]
    for (const v of [top, bottom]) {
      normals[v * 3] = normals[i * 3]
      normals[v * 3 + 1] = normals[i * 3 + 1]
      normals[v * 3 + 2] = normals[i * 3 + 2]
      colors[v * 3] = colors[i * 3]
      colors[v * 3 + 1] = colors[i * 3 + 1]
      colors[v * 3 + 2] = colors[i * 3 + 2]
    }
    return [top, bottom] as const
  }

  const runs = [
    Array.from({ length: side }, (_, ix) => ix), // z = min
    Array.from({ length: side }, (_, ix) => (side - 1) * side + ix), // z = max
    Array.from({ length: side }, (_, iz) => iz * side), // x = min
    Array.from({ length: side }, (_, iz) => iz * side + side - 1), // x = max
  ]
  for (const run of runs) {
    let prev: readonly [number, number] | null = null
    for (const i of run) {
      const cur = edge(i)
      if (prev) indices.push(prev[0], prev[1], cur[0], cur[0], prev[1], cur[1])
      prev = cur
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  geometryCache.set(key, geo)
  return geo
}

/** Drop cached geometry once the player is nowhere near it. */
function pruneCache(cx: number, cz: number) {
  if (geometryCache.size < 400) return
  for (const [key, geo] of geometryCache) {
    const parts = key.split(':')
    const kx = Number(parts[1])
    const kz = Number(parts[2])
    if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > WORLD.viewChunks + 2) {
      geo.dispose()
      geometryCache.delete(key)
    }
  }
}

export function TerrainChunks({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const [center, setCenter] = useState<[number, number]>([0, 0])
  const last = useRef('')

  useFrame(() => {
    const cx = Math.floor(target.current.x / WORLD.chunkSize)
    const cz = Math.floor(target.current.z / WORLD.chunkSize)
    const key = `${cx},${cz}`
    if (key === last.current) return
    last.current = key
    pruneCache(cx, cz)
    setCenter([cx, cz])
  })

  const chunks = useMemo(() => {
    const [cx, cz] = center
    const out: { key: string; geo: BufferGeometry }[] = []
    const r = WORLD.viewChunks
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz))
        const lod = ring <= 1 ? 0 : ring <= 2 ? 1 : ring <= 4 ? 2 : 3
        const segments = WORLD.lodSegments[lod]
        out.push({
          key: `${cx + dx}:${cz + dz}:${segments}`,
          geo: buildChunk(cx + dx, cz + dz, segments, seed),
        })
      }
    }
    return out
  }, [center, seed])

  return (
    <group>
      {chunks.map(({ key, geo }) => (
        <mesh key={key} geometry={geo} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}
