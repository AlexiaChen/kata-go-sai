import type { GameState, Point } from '../game/types'

export type AiLevel = 'fast' | 'balanced' | 'careful'

export interface AiRequest {
  type: 'search'
  requestId: number
  game: GameState
  level: AiLevel
}

export interface AiResponse {
  type: 'result' | 'error'
  requestId: number
  move: Point | null
  candidates: number
  elapsedMs: number
  message?: string
}
