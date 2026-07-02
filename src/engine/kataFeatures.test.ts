import { describe, expect, it } from 'vitest'

import { passTurn, playMove } from '../game/rules'
import { createGame } from '../game/rules'
import { encodeKataFeatures, GLOBAL_FEATURES, NN_BOARD_SIZE, SPATIAL_FEATURES } from './kataFeatures'

const featureAt = (features: Float32Array, point: number, channel: number) =>
  features[point * SPATIAL_FEATURES + channel]

describe('KataGo feature encoder', () => {
  it('encodes the fixed tensor shapes and a smaller-board mask', () => {
    const features = encodeKataFeatures(createGame(9))
    expect(features.binInputs).toHaveLength(NN_BOARD_SIZE * NN_BOARD_SIZE * SPATIAL_FEATURES)
    expect(features.globalInputs).toHaveLength(GLOBAL_FEATURES)
    const maskCount = Array.from({ length: NN_BOARD_SIZE * NN_BOARD_SIZE }, (_, point) =>
      featureAt(features.binInputs, point, 0),
    ).reduce((sum, value) => sum + value, 0)
    expect(maskCount).toBe(81)
  })

  it('encodes stones relative to the next player and move history', () => {
    let game = createGame(19)
    game = playMove(game, 3 * 19 + 3).game
    const features = encodeKataFeatures(game)
    const point = 3 * 19 + 3
    expect(featureAt(features.binInputs, point, 2)).toBe(1)
    expect(featureAt(features.binInputs, point, 9)).toBe(1)
    expect(features.globalInputs[5]).toBeCloseTo(7.5 / 20)
  })

  it('encodes pass history and Chinese positional-ko globals', () => {
    const game = passTurn(createGame(19)).game
    const features = encodeKataFeatures(game)
    expect(features.globalInputs[0]).toBe(1)
    expect(features.globalInputs[6]).toBe(1)
    expect(features.globalInputs[7]).toBe(0.5)
    expect(features.globalInputs[14]).toBe(1)
  })
})
