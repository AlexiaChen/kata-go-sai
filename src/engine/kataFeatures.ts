import { collectGroup, neighbors, other, playMove } from '../game/rules'
import type { GameState, Point, Stone } from '../game/types'

export const NN_BOARD_SIZE = 19
export const SPATIAL_FEATURES = 22
export const GLOBAL_FEATURES = 19

export interface KataFeatures {
  binInputs: Float32Array
  globalInputs: Float32Array
}

function nnPoint(point: Point, boardSize: number): Point {
  return Math.floor(point / boardSize) * NN_BOARD_SIZE + (point % boardSize)
}

function setSpatial(buffer: Float32Array, point: Point, feature: number, value = 1): void {
  buffer[point * SPATIAL_FEATURES + feature] = value
}

export function encodeKataFeatures(game: GameState): KataFeatures {
  const { position } = game
  const { board, size, toPlay } = position
  const opponent = other(toPlay)
  const binInputs = new Float32Array(NN_BOARD_SIZE * NN_BOARD_SIZE * SPATIAL_FEATURES)
  const globalInputs = new Float32Array(GLOBAL_FEATURES)

  // Features 0-5: board mask, current/opponent stones, and exact liberty counts.
  const visited = new Set<Point>()
  board.forEach((stone, point) => {
    const mapped = nnPoint(point, size)
    setSpatial(binInputs, mapped, 0)
    if (!stone) return
    setSpatial(binInputs, mapped, stone === toPlay ? 1 : 2)
    if (visited.has(point)) return
    const group = collectGroup(board, point, size)
    group.stones.forEach((groupPoint) => {
      visited.add(groupPoint)
      const liberties = group.liberties.size
      if (liberties >= 1 && liberties <= 3) {
        setSpatial(binInputs, nnPoint(groupPoint, size), liberties + 2)
      }
    })
  })

  // Feature 6: simple-ko and positional-superko forbidden points.
  board.forEach((stone, point) => {
    if (stone) return
    const result = playMove(game, point)
    if (!result.ok && result.reason?.includes('全局同形禁着')) {
      setSpatial(binInputs, nnPoint(point, size), 6)
    }
  })

  // Features 9-13 and globals 0-4: the last five moves or passes.
  const movePositions = [...game.history.slice(1), position].filter((item) => item.moveNumber > 0)
  for (let offset = 0; offset < Math.min(5, movePositions.length); offset += 1) {
    const previous = movePositions[movePositions.length - 1 - offset]
    if (previous.lastMoveWasPass) globalInputs[offset] = 1
    else if (previous.lastMove !== null) {
      setSpatial(binInputs, nnPoint(previous.lastMove, size), 9 + offset)
    }
  }

  // Features 18-19: current Chinese-area ownership estimate.
  const area = estimateArea(board, size)
  area.forEach((owner, point) => {
    if (owner === toPlay) setSpatial(binInputs, nnPoint(point, size), 18)
    else if (owner === opponent) setSpatial(binInputs, nnPoint(point, size), 19)
  })

  // Global features for positional ko, Chinese area scoring, komi and pass state.
  const selfKomi = toPlay === 'white' ? game.komi : -game.komi
  globalInputs[5] = Math.max(-size * size - 1, Math.min(size * size + 1, selfKomi)) / 20
  globalInputs[6] = 1
  globalInputs[7] = 0.5
  globalInputs[14] = position.consecutivePasses > 0 ? 1 : 0
  globalInputs[15] = komiParityWave(selfKomi, size * size)

  return { binInputs, globalInputs }
}

function estimateArea(board: Array<Stone | null>, size: number): Array<Stone | null> {
  const area: Array<Stone | null> = [...board]
  const visited = new Set<Point>()
  board.forEach((stone, point) => {
    if (stone || visited.has(point)) return
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
    const owner = borders.size === 1 ? [...borders][0] : null
    region.forEach((empty) => { area[empty] = owner })
  })
  return area
}

function komiParityWave(selfKomi: number, boardArea: number): number {
  const drawableKomisAreEven = boardArea % 2 === 0
  const komiFloor = drawableKomisAreEven
    ? Math.floor(selfKomi / 2) * 2
    : Math.floor((selfKomi - 1) / 2) * 2 + 1
  const delta = Math.max(0, Math.min(2, selfKomi - komiFloor))
  if (delta < 0.5) return delta
  if (delta < 1.5) return 1 - delta
  return delta - 2
}
