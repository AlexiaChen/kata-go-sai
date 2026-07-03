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

  it('encodes ladder-captured stones and attacker working moves', () => {
    const game = createGame(9)
    const board = [...game.position.board]
    const point = (x: number, y: number) => y * 9 + x
    board[point(4, 4)] = 'white'
    ;[
      point(3, 4), point(5, 4),
      point(3, 3), point(4, 2), point(5, 3),
      point(3, 5), point(4, 6), point(5, 5),
    ].forEach((black) => { board[black] = 'black' })
    game.position.board = board
    game.position.toPlay = 'black'

    const features = encodeKataFeatures(game)
    const nnPoint = (x: number, y: number) => y * NN_BOARD_SIZE + x
    expect(featureAt(features.binInputs, nnPoint(4, 4), 14)).toBe(1)
    expect(featureAt(features.binInputs, nnPoint(4, 3), 17)).toBe(1)
    expect(featureAt(features.binInputs, nnPoint(4, 5), 17)).toBe(1)
  })
})
