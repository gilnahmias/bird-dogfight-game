/** Distribution of the tarn field, so its thresholds are calibrated not guessed. */
import { tarnFieldAt, heightAt } from '../world/terrain.ts'

for (const seed of ['pine-ridge', 'coastal']) {
  const values: number[] = []
  let inBand = 0
  for (let i = 0; i < 40000; i++) {
    const x = (i % 200) * 60 - 6000
    const z = Math.floor(i / 200) * 60 - 6000
    values.push(tarnFieldAt(x, z, seed))
    const h = heightAt(x, z, seed)
    if (h > 46 && h < 240) inBand++
  }
  values.sort((a, b) => a - b)
  const q = (p: number) => values[Math.floor(p * (values.length - 1))].toFixed(3)
  console.log(
    `${seed}: tarnField p50 ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${values[values.length-1].toFixed(3)}` +
      `   |  above 0.35: ${((values.filter(v=>v>0.35).length/values.length)*100).toFixed(1)}%` +
      `   |  in height band: ${((inBand/values.length)*100).toFixed(0)}%`,
  )
}
