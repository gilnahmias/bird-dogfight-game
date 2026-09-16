/**
 * Trees: one instanced mesh per kind of canopy, plus one for every trunk. Five
 * draw calls for a forest, rebuilt only when the player crosses a chunk
 * boundary. Placement comes from terrain.ts, so trees only ever stand on forest
 * ground that is not too steep to hold them, and what grows where comes from
 * trees.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { heightAt, jitter, moistureAt, sampleGround, tarnPoolAt } from './terrain.ts'
import { treeStyle, TREE_KINDS, type TreeKind } from './trees.ts'
import { WORLD } from '../game/constants.ts'

const CANDIDATES_PER_CHUNK = 110

type Tree = {
  x: number
  y: number
  z: number
  scale: number
  spin: number
  kind: TreeKind
  color: Color
}

function placeTrees(cx: number, cz: number, seed: string): Tree[] {
  const out: Tree[] = []
  const r = WORLD.treeChunkRadius
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const ox = (cx + dx) * WORLD.chunkSize
      const oz = (cz + dz) * WORLD.chunkSize
      for (let i = 0; i < CANDIDATES_PER_CHUNK; i++) {
        const x = ox + jitter(ox + i, oz, 1) * WORLD.chunkSize
        const z = oz + jitter(ox, oz + i, 2) * WORLD.chunkSize
        // Reject on height alone first - that is one noise sample instead of ten,
        // and it throws out most candidates before the expensive test.
        const h = heightAt(x, z, seed)
        if (h < 2 || h > 175) continue
        const ground = sampleGround(x, z, seed)
        if (ground.biome !== 'forest' || ground.slope > 0.3) continue
        // Not in a mountain lake. The biome field knows about the sea and not
        // about tarns, so without this a conifer stands in the middle of the
        // water.
        if (tarnPoolAt(x, z, seed) !== null) continue
        const style = treeStyle(x, z, ground.h, moistureAt(x, z, seed))
        out.push({
          x,
          y: ground.h,
          z,
          scale: style.scale,
          spin: jitter(x, z, 4) * Math.PI * 2,
          kind: style.kind,
          color: style.color,
        })
        if (out.length >= WORLD.treeCount) return out
      }
    }
  }
  return out
}

/**
 * The shape of each kind, in metres at scale 1: how tall the trunk is, and the
 * canopy that sits on it.
 */
const SHAPE: Record<
  TreeKind,
  { trunk: number; girth: number; canopy: number; lift: number; flat: number }
> = {
  /*
    `lift` is how far the canopy is dropped onto the trunk.

    Kept small on purpose. Set generously the canopy swallows the trunk and the
    tree reads as a blob sitting on the ground rather than as something standing
    up - which is exactly what the first version of this did.
  */
  spire: { trunk: 7, girth: 0.95, canopy: 15, lift: 1.4, flat: 1 },
  fir: { trunk: 6, girth: 1.05, canopy: 10.5, lift: 1.1, flat: 1 },
  /*
    Broadleaves are FLAT, and stand on a tall trunk.

    A sphere on a stick is a lollipop from every angle, and from above - which is
    where this game is played - a ball and a cone are the same circle. Flattening
    the crown and lifting it clear of the ground is what makes the difference
    between a wood and a bag of marbles.
  */
  broadleaf: { trunk: 6.5, girth: 1.2, canopy: 7.2, lift: 0.5, flat: 0.5 },
  scrub: { trunk: 2.4, girth: 1, canopy: 3.4, lift: 0.3, flat: 0.55 },
}

/** Trunk geometry is one unit tall, so each tree scales it to its own height. */
const TRUNK_UNIT = 1

export function Scatter({ target, seed }: { target: { current: Vector3 }; seed: string }) {
  const trunks = useRef<InstancedMesh>(null)
  const canopies = useRef<Partial<Record<TreeKind, InstancedMesh | null>>>({})
  const [center, setCenter] = useState<[number, number]>([0, 0])
  const last = useRef('')

  useFrame(() => {
    const cx = Math.floor(target.current.x / WORLD.chunkSize)
    const cz = Math.floor(target.current.z / WORLD.chunkSize)
    const key = `${cx},${cz}`
    if (key === last.current) return
    last.current = key
    setCenter([cx, cz])
  })

  const trees = useMemo(() => placeTrees(center[0], center[1], seed), [center, seed])

  useEffect(() => {
    const m = new Matrix4()
    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    const trunkMesh = trunks.current
    if (trunkMesh) {
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i]
        const shape = SHAPE[t.kind]
        const height = shape.trunk * t.scale
        pos.set(t.x, t.y + height / 2, t.z)
        quat.setFromAxisAngle(up, t.spin)
        // Non-uniform on purpose: one trunk mesh serves every kind, stretched to
        // the height that kind wants.
        scale.set(shape.girth * t.scale, height / TRUNK_UNIT, shape.girth * t.scale)
        trunkMesh.setMatrixAt(i, m.compose(pos, quat, scale))
      }
      trunkMesh.count = trees.length
      trunkMesh.instanceMatrix.needsUpdate = true
      trunkMesh.computeBoundingSphere()
    }

    // Each canopy kind fills its own instanced mesh, in the order the trees came.
    for (const kind of TREE_KINDS) {
      const mesh = canopies.current[kind]
      if (!mesh) continue
      let n = 0
      for (const t of trees) {
        if (t.kind !== kind) continue
        const shape = SHAPE[kind]
        pos.set(t.x, t.y + (shape.trunk + shape.canopy / 2 - shape.lift) * t.scale, t.z)
        quat.setFromAxisAngle(up, t.spin)
        scale.set(t.scale, t.scale * shape.flat, t.scale)
        mesh.setMatrixAt(n, m.compose(pos, quat, scale))
        mesh.setColorAt(n, t.color)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [trees])

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, WORLD.treeCount]} castShadow>
        <cylinderGeometry args={[0.32, 0.52, TRUNK_UNIT, 5]} />
        <meshStandardMaterial color="#4a3a2c" roughness={1} />
      </instancedMesh>

      {/* A narrow spire for the cold ground. */}
      <instancedMesh
        ref={(node) => { canopies.current.spire = node }}
        args={[undefined, undefined, WORLD.treeCount]}
        castShadow
      >
        <coneGeometry args={[2.2, SHAPE.spire.canopy, 6]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>

      {/* A broad fir, the workhorse of the middle slopes. */}
      <instancedMesh
        ref={(node) => { canopies.current.fir = node }}
        args={[undefined, undefined, WORLD.treeCount]}
        castShadow
      >
        <coneGeometry args={[3.3, SHAPE.fir.canopy, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>

      {/* A round broadleaf. */}
      <instancedMesh
        ref={(node) => { canopies.current.broadleaf = node }}
        args={[undefined, undefined, WORLD.treeCount]}
        castShadow
      >
        <icosahedronGeometry args={[3.5, 1]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>

      {/* Scrub: low, scrappy, and what the treeline thins out into. */}
      <instancedMesh
        ref={(node) => { canopies.current.scrub = node }}
        args={[undefined, undefined, WORLD.treeCount]}
        castShadow
      >
        <icosahedronGeometry args={[2.4, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}
