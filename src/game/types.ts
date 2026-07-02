export type Stone = 'black' | 'white'
export type Point = number

export interface Captures {
  black: number
  white: number
}

export interface Position {
  size: number
  board: Array<Stone | null>
  toPlay: Stone
  captures: Captures
  moveNumber: number
  consecutivePasses: number
  lastMove: Point | null
  lastMoveWasPass: boolean
}

export interface GameState {
  position: Position
  history: Position[]
  boardHashes: string[]
  komi: number
  finished: boolean
}

export interface MoveResult {
  ok: boolean
  game: GameState
  captured: number
  reason?: string
}

export interface ScoreResult {
  black: number
  white: number
  blackTerritory: number
  whiteTerritory: number
  neutral: number
  winner: Stone
  margin: number
}
