/**
 * The nest: a twig bowl on the crag the run starts from.
 *
 * Visual landmark only for now - it is the home base the hunting loop will bank
 * food into, but nothing depends on it yet.
 * → skipped: banking, stored food, chicks. Added in the hunting-loop phase.
 */
import { useMemo } from 'react'
import type { NestSite } from './nest.ts'
import { jitter } from './terrain.ts'

const TWIG = '#6b573c'
const TWIG_DARK = '#4c3d2a'

export function Nest({ site }: { site: NestSite }) {
  // Sticks laid around the rim, at angles fixed by the site so the nest looks
  // the same every time you come home to it.
  const sticks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + jitter(site.pos.x, site.pos.z, i) * 0.4
        const r = 2.0 + jitter(site.pos.z, site.pos.x, i) * 0.7
        return {
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          len: 1.6 + jitter(site.pos.x + i, site.pos.z, 9) * 1.7,
          tilt: (jitter(site.pos.x, site.pos.z + i, 5) - 0.5) * 0.5,
          spin: a + Math.PI / 2,
        }
      }),
    [site],
  )

  return (
    <group position={[site.pos.x, site.pos.y, site.pos.z]}>
      {/* the bowl, sunk slightly so it never floats over uneven ground */}
      <mesh position={[0, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[2.4, 0.75, 6, 16]} />
        <meshStandardMaterial color={TWIG} roughness={1} flatShading />
      </mesh>
      {/* the floor of the nest */}
      <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 16]} />
        <meshStandardMaterial color={TWIG_DARK} roughness={1} />
      </mesh>
      {sticks.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, 0.55, s.z]}
          rotation={[Math.PI / 2 + s.tilt, 0, s.spin]}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.16, s.len, 4]} />
          <meshStandardMaterial color={i % 3 ? TWIG : TWIG_DARK} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  )
}
