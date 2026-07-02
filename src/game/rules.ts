import type { GameState, MoveResult, Point, Position, ScoreResult, Stone } from './types'

export const other = (stone: Stone): Stone => (stone === 'black' ? 'white' : 'black')

export function createGame(size = 19, komi = 7.5): GameState {
  if (![9, 13, 19].includes(size)) {
    throw new Error(`Unsupported board size: ${size}`)
  }

  const position: Position = {
    size,
    board: Array<Stone | null>(size * size).fill(null),
    toPlay: 'black',
    captures: { black: 0, white: 0 },
    moveNumber: 0,
    consecutivePasses: 0,
    lastMove: null,
    lastMoveWasPass: false,
  }

  return {
    position,
    history: [],
    boardHashes: [hashBoard(position.board)],
    komi,
    finished: false,
  }
}

export function hashBoard(board: Array<Stone | null>): string {
  return board.map((stone) => (stone === 'black' ? 'b' : stone === 'white' ? 'w' : '.')).join('')
}

export function neighbors(point: Point, size: number): Point[] {
  const x = point % size
  const y = Math.floor(point / size)
  const adjacent: Point[] = []
  if (x > 0) adjacent.push(point - 1)
  if (x < size - 1) adjacent.push(point + 1)
  if (y > 0) adjacent.push(point - size)
  if (y < size - 1) adjacent.push(point + size)
  return adjacent
}

export function collectGroup(
  board: Array<Stone | null>,
  start: Point,
  size: number,
): { stones: Point[]; liberties: Set<Point> } {
  const color = board[start]
  if (!color) return { stones: [], liberties: new Set() }

  const stones: Point[] = []
  const liberties = new Set<Point>()
  const pending = [start]
  const visited = new Set<Point>()

  while (pending.length > 0) {
    const point = pending.pop()!
    if (visited.has(point)) continue
    visited.add(point)
    stones.push(point)

    for (const neighbor of neighbors(point, size)) {
      if (board[neighbor] === null) liberties.add(neighbor)
      else if (board[neighbor] === color && !visited.has(neighbor)) pending.push(neighbor)
    }
  }

  return { stones, liberties }
}

export function playMove(game: GameState, point: Point): MoveResult {
  const current = game.position
  if (game.finished) return failure(game, '对局已经结束')
  if (!Number.isInteger(point) || point < 0 || point >= current.board.length) {
    return failure(game, '落点超出棋盘')
  }
  if (current.board[point] !== null) return failure(game, '这里已经有棋子')

  const board = [...current.board]
  const color = current.toPlay
  const opponent = other(color)
  board[point] = color

  let captured = 0
  const checked = new Set<Point>()
  for (const neighbor of neighbors(point, current.size)) {
    if (board[neighbor] !== opponent || checked.has(neighbor)) continue
    const group = collectGroup(board, neighbor, current.size)
    group.stones.forEach((stone) => checked.add(stone))
    if (group.liberties.size === 0) {
      captured += group.stones.length
      group.stones.forEach((stone) => {
        board[stone] = null
      })
    }
  }

  if (collectGroup(board, point, current.size).liberties.size === 0) {
    return failure(game, '禁入点：落子后没有气')
  }

  const nextHash = hashBoard(board)
  if (game.boardHashes.includes(nextHash)) {
    return failure(game, '全局同形禁着：该局面曾经出现过')
  }

  const position: Position = {
    ...current,
    board,
    toPlay: opponent,
    captures: {
      ...current.captures,
      [color]: current.captures[color] + captured,
    },
    moveNumber: current.moveNumber + 1,
    consecutivePasses: 0,
    lastMove: point,
    lastMoveWasPass: false,
  }

  return {
    ok: true,
    game: {
      ...game,
      position,
      history: [...game.history, current],
      boardHashes: [...game.boardHashes, nextHash],
    },
    captured,
  }
}

export function passTurn(game: GameState): MoveResult {
  if (game.finished) return failure(game, '对局已经结束')
  const current = game.position
  const consecutivePasses = current.consecutivePasses + 1
  const position: Position = {
    ...current,
    toPlay: other(current.toPlay),
    moveNumber: current.moveNumber + 1,
    consecutivePasses,
    lastMove: null,
    lastMoveWasPass: true,
  }

  return {
    ok: true,
    captured: 0,
    game: {
      ...game,
      position,
      history: [...game.history, current],
      boardHashes: [...game.boardHashes, hashBoard(current.board)],
      finished: consecutivePasses >= 2,
    },
  }
}

export function undo(game: GameState, steps = 1): GameState {
  if (game.history.length === 0 || steps < 1) return game
  const actualSteps = Math.min(steps, game.history.length)
  const position = game.history[game.history.length - actualSteps]
  return {
    ...game,
    position,
    history: game.history.slice(0, -actualSteps),
    boardHashes: game.boardHashes.slice(0, -actualSteps),
    finished: false,
  }
}

export function isLegalMove(game: GameState, point: Point): boolean {
  return playMove(game, point).ok
}

export function scoreChineseArea(game: GameState): ScoreResult {
  const { board, size } = game.position
  let blackStones = 0
  let whiteStones = 0
  let blackTerritory = 0
  let whiteTerritory = 0
  let neutral = 0
  const visited = new Set<Point>()

  board.forEach((stone, point) => {
    if (stone === 'black') blackStones += 1
    else if (stone === 'white') whiteStones += 1
    else if (!visited.has(point)) {
      const region: Point[] = []
      const borders = new Set<Stone>()
      const pending = [point]
      while (pending.length > 0) {
        const empty = pending.pop()!
        if (visited.has(empty)) continue
        visited.add(empty)
        region.push(empty)
        neighbors(empty, size).forEach((neighbor) => {
          const neighborStone = board[neighbor]
          if (neighborStone) borders.add(neighborStone)
          else if (!visited.has(neighbor)) pending.push(neighbor)
        })
      }

      if (borders.size === 1 && borders.has('black')) blackTerritory += region.length
      else if (borders.size === 1 && borders.has('white')) whiteTerritory += region.length
      else neutral += region.length
    }
  })

  const black = blackStones + blackTerritory
  const white = whiteStones + whiteTerritory + game.komi
  return {
    black,
    white,
    blackTerritory,
    whiteTerritory,
    neutral,
    winner: black > white ? 'black' : 'white',
    margin: Math.abs(black - white),
  }
}

export function formatPoint(point: Point | null, size: number): string {
  if (point === null) return '停一手'
  const x = point % size
  const y = Math.floor(point / size)
  const columns = 'ABCDEFGHJKLMNOPQRST'
  return `${columns[x]}${size - y}`
}

function failure(game: GameState, reason: string): MoveResult {
  return { ok: false, game, captured: 0, reason }
}
