import { describe, expect, it } from 'vitest'

import { createGame, hashBoard, passTurn, playMove, scoreChineseArea, undo } from './rules'

function play(game: ReturnType<typeof createGame>, ...points: number[]) {
  return points.reduce((state, point) => {
    const result = playMove(state, point)
    expect(result.ok, result.reason).toBe(true)
    return result.game
  }, game)
}

describe('Go rules', () => {
  it('captures a surrounded stone', () => {
    let game = createGame(9)
    game = play(game, 1, 10, 9, 20, 11, 30)
    const result = playMove(game, 19)
    expect(result.ok).toBe(true)
    expect(result.captured).toBe(1)
    expect(result.game.position.board[10]).toBeNull()
    expect(result.game.position.captures.black).toBe(1)
  })

  it('rejects suicide', () => {
    let game = createGame(9)
    game = play(game, 0, 1, 8, 9, 16, 11, 24, 19)
    const result = playMove(game, 10)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('没有气')
  })

  it('ends after two passes and can undo', () => {
    let game = createGame(9)
    game = passTurn(game).game
    game = passTurn(game).game
    expect(game.finished).toBe(true)
    expect(undo(game).finished).toBe(false)
  })

  it('rejects a ko recapture through positional superko', () => {
    const game = createGame(9)
    const board = [...game.position.board]
    ;[1, 9, 19].forEach((point) => { board[point] = 'black' })
    ;[2, 10, 12, 20].forEach((point) => { board[point] = 'white' })
    game.position = { ...game.position, board }
    game.boardHashes = [hashBoard(board)]

    const capture = playMove(game, 11)
    expect(capture.ok).toBe(true)
    expect(capture.captured).toBe(1)

    const recapture = playMove(capture.game, 10)
    expect(recapture.ok).toBe(false)
    expect(recapture.reason).toContain('全局同形禁着')
  })

  it('scores enclosed territory with Chinese area scoring', () => {
    let game = createGame(9, 0)
    game = play(game, 1, 80, 9)
    const score = scoreChineseArea(game)
    expect(score.blackTerritory).toBeGreaterThan(0)
    expect(score.black).toBeGreaterThan(0)
  })
})
