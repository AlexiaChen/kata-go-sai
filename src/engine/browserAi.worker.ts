/// <reference lib="webworker" />

import { collectGroup, neighbors, playMove } from '../game/rules'
import type { Point } from '../game/types'
import type { AiRequest, AiResponse } from './types'

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<AiRequest>) => {
  const request = event.data
  if (request.type !== 'search') return

  const startedAt = performance.now()
  try {
    const { game, level } = request
    const { board, size, moveNumber, toPlay } = game.position
    const candidates: Array<{ point: Point; score: number }> = []
    const opponent = toPlay === 'black' ? 'white' : 'black'
    const center = (size - 1) / 2

    for (let point = 0; point < board.length; point += 1) {
      if (board[point] !== null) continue
      const result = playMove(game, point)
      if (!result.ok) continue

      const nextBoard = result.game.position.board
      const group = collectGroup(nextBoard, point, size)
      const x = point % size
      const y = Math.floor(point / size)
      const distanceToCenter = Math.abs(x - center) + Math.abs(y - center)
      const ownNeighbors = neighbors(point, size).filter((neighbor) => board[neighbor] === toPlay).length
      const enemyNeighbors = neighbors(point, size).filter((neighbor) => board[neighbor] === opponent).length
      const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y)

      let score = result.captured * 120
      score += Math.min(group.liberties.size, 6) * 5
      score += ownNeighbors * 4 + enemyNeighbors * 7
      score += Math.max(0, 7 - distanceToCenter) * (moveNumber < size ? 2.5 : 0.2)
      if (group.liberties.size === 1 && result.captured === 0) score -= 90
      if (edgeDistance === 0 && moveNumber < size * 2) score -= 22
      if (edgeDistance === 1 && moveNumber < size) score -= 6
      score += Math.random() * (level === 'fast' ? 26 : level === 'balanced' ? 12 : 5)

      candidates.push({ point, score })
    }

    candidates.sort((a, b) => b.score - a.score)
    const occupancy = board.filter(Boolean).length / board.length
    const shouldPass = candidates.length === 0 || (occupancy > 0.72 && (candidates[0]?.score ?? 0) < 12)
    const breadth = level === 'fast' ? 8 : level === 'balanced' ? 4 : 2
    const selected = candidates[Math.floor(Math.random() * Math.min(breadth, candidates.length))]
    const response: AiResponse = {
      type: 'result',
      requestId: request.requestId,
      move: shouldPass ? null : (selected?.point ?? null),
      candidates: candidates.length,
      elapsedMs: performance.now() - startedAt,
    }
    scope.postMessage(response)
  } catch (error) {
    const response: AiResponse = {
      type: 'error',
      requestId: request.requestId,
      move: null,
      candidates: 0,
      elapsedMs: performance.now() - startedAt,
      message: error instanceof Error ? error.message : '浏览器 AI 计算失败',
    }
    scope.postMessage(response)
  }
}

export {}
