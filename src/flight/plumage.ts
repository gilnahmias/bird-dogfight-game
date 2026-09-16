/**
 * What a raptor is coloured.
 *
 * Its own module because the model file should export components and nothing
 * else - and because rivals are the same bird in other feathers, so these are
 * defaults rather than constants.
 */
/**
 * The player's plumage. Rivals are the same bird in other feathers, so every
 * colour here is a default rather than a constant.
 */
export type Plumage = {
  feather: string
  featherMid: string
  featherDark: string
  featherLight: string
  belly: string
}

export const PLUMAGE: Plumage = {
  feather: '#6b4f35',
  featherMid: '#5b422c',
  featherDark: '#3f2c1e',
  featherLight: '#8a6a48',
  belly: '#d8cbb4',
}
