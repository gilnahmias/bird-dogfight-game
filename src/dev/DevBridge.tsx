/**
 * Dev-only handle on the running game, hung off `window.game`.
 *
 * Exists because a browser throttles requestAnimationFrame to nothing when the
 * window is not visible, which makes an automated check of the rendered scene
 * impossible. With this, a frame can be forced and the result inspected. It is
 * also the fastest way to tune by hand: `game.T.rollRate = 4` takes effect on the
 * next frame.
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { BirdState } from '../flight/physics.ts'
import { T } from '../game/constants.ts'
import { useGame } from '../game/store.ts'

export function DevBridge({ bird }: { bird: BirdState }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const advance = useThree((s) => s.advance)
  const r3f = useThree((s) => s.get)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, {
      game: {
        bird,
        T,
        gl,
        scene,
        camera,
        store: useGame,
        /** The canvas's own state: clock, frameloop. */
        r3f,
        /** Force one frame, for when the tab is not visible. */
        frame: (t = performance.now()) => advance(t),
        stats: () => ({
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
        }),
      },
    })
  }, [bird, gl, scene, camera, advance, r3f])

  return null
}
