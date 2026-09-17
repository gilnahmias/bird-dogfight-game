/**
 * Keeps game time continuous across a pause.
 *
 * Pausing switches the canvas to frameloop 'never', and react-three-fiber
 * resets its clock to zero whenever the frameloop changes. Rivals, crows and
 * clouds all schedule against that clock, so a reset would leave a crow flock
 * "resting" for however long the game had been running. This puts the time
 * back where it was.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useStore } from '@react-three/fiber'

export function PauseClock() {
  const store = useStore()
  const elapsed = useRef(0)

  useFrame((state) => {
    elapsed.current = state.clock.elapsedTime
  })

  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.frameloop !== previous.frameloop) state.clock.elapsedTime = elapsed.current
      }),
    [store],
  )

  return null
}
