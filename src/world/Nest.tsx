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
const BARK = '#5a4632'
const FOLIAGE = '#33502f'
const FOLIAGE_DARK = '#27402a'

/**
 * The tree the nest is built in.
 *
 * A raptor's eyrie sits in the crown of the tallest thing around, and putting it
 * there solves the problem the rock version was working around: the nest is no
 * longer competing with the terrain for the same few metres, so it cannot be
 * left hovering when the drawn ground disagrees with the height field. The trunk
 * simply starts a little lower and nobody sees it.
 */
function NestTree({ site }: { site: NestSite }) {
  const height = site.treeHeight

  const branches = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 + jitter(site.pos.x, site.pos.z, 60 + i) * 1.1
        return {
          a,
          y: height * (0.45 + i * 0.09),
          len: 3.4 - i * 0.32,
          tilt: 0.5 + jitter(site.pos.x, site.pos.z + i, 70) * 0.3,
        }
      }),
    [site, height],
  )

  return (
    <group>
      {/* trunk, buried well below the foot so it never ends in mid-air */}
      <mesh position={[0, height / 2 - 3, 0]} castShadow>
        <cylinderGeometry args={[0.55, 1.5, height + 6, 7]} />
        <meshStandardMaterial color={BARK} roughness={1} flatShading />
      </mesh>

      {/* bare limbs below the crown, which is what makes it read as a tree */}
      {branches.map((b, i) => (
        <mesh
          key={i}
          position={[Math.cos(b.a) * b.len * 0.5, b.y, Math.sin(b.a) * b.len * 0.5]}
          rotation={[b.tilt * Math.sin(b.a), -b.a, b.tilt * Math.cos(b.a) + Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.16, 0.3, b.len, 5]} />
          <meshStandardMaterial color={BARK} roughness={1} flatShading />
        </mesh>
      ))}

      {/* foliage, in flattened tiers, open at the very top where the nest sits */}
      {[0.52, 0.68, 0.82].map((t, i) => (
        <mesh key={t} position={[0, height * t, 0]} castShadow>
          <coneGeometry args={[7.2 - i * 1.6, 7 - i * 1.2, 7]} />
          <meshStandardMaterial color={i % 2 ? FOLIAGE : FOLIAGE_DARK} roughness={1} flatShading />
        </mesh>
      ))}

      {/* the crotch the nest is wedged into */}
      <mesh position={[0, height - 0.6, 0]}>
        <cylinderGeometry args={[2.9, 2.2, 1.1, 7]} />
        <meshStandardMaterial color={BARK} roughness={1} flatShading />
      </mesh>
    </group>
  )
}

/**
 * `accent` marks a nest as someone else's: a few of the rim sticks and some
 * feathers caught in them take the owner's colours, so a rival's eyrie reads as
 * a rival's from the air rather than as a second copy of home.
 */
export function Nest({ site, accent }: { site: NestSite; accent?: string }) {
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
      <NestTree site={site} />
      {/* the bowl, wedged into the crown of the tree */}
      <mesh position={[0, site.treeHeight + 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[2.4, 0.75, 6, 16]} />
        <meshStandardMaterial color={TWIG} roughness={1} flatShading />
      </mesh>
      {/* the floor of the nest */}
      <mesh position={[0, site.treeHeight + 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 16]} />
        <meshStandardMaterial color={TWIG_DARK} roughness={1} />
      </mesh>
      {sticks.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, site.treeHeight + 0.55, s.z]}
          rotation={[Math.PI / 2 + s.tilt, 0, s.spin]}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.16, s.len, 4]} />
          <meshStandardMaterial
            color={accent && i % 4 === 0 ? accent : i % 3 ? TWIG : TWIG_DARK}
            roughness={1}
            flatShading
          />
        </mesh>
      ))}
      {accent &&
        // Feathers stuck upright in the rim: the owner's calling card.
        [0, 2.1, 4.2].map((a) => (
          <mesh
            key={a}
            position={[Math.cos(a) * 2.4, site.treeHeight + 1.3, Math.sin(a) * 2.4]}
            rotation={[0.25, -a, 0.2]}
          >
            <coneGeometry args={[0.28, 1.9, 4]} />
            <meshStandardMaterial color={accent} roughness={0.9} flatShading />
          </mesh>
        ))}
    </group>
  )
}
