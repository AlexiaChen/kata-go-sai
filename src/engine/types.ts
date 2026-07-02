import type { GameState, Point } from '../game/types'

export type AiLevel = 'fast' | 'balanced' | 'careful'

export interface AiInitRequest {
  type: 'init'
  modelUrl: string
}

export interface AiSearchRequest {
  type: 'search'
  requestId: number
  game: GameState
  level: AiLevel
}

export type AiRequest = AiInitRequest | AiSearchRequest

export interface AiReadyResponse {
  type: 'ready'
  backend: string
  loadMs: number
  modelName: string
}

export interface AiResultResponse {
  type: 'result'
  requestId: number
  move: Point | null
  candidates: number
  elapsedMs: number
  backend: string
  scoreLead: number
}

export interface AiErrorResponse {
  type: 'error'
  requestId?: number
  message: string
}

export type AiResponse = AiReadyResponse | AiResultResponse | AiErrorResponse
