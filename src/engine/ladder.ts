import { collectGroup, neighbors, other } from '../game/rules'
import type { Point, Stone } from '../game/types'

export interface LadderGroup {
  stones: Point[]
  workingMoves: Point[]
}

interface SearchBudget {
  nodes: number
  exhausted: boolean
}

const MAX_LADDER_NODES = 4_000

/**
 * Finds groups that KataGo's input encoder describes as ladder-captured.
 *
 * Ladder reading intentionally ignores superko. Repeating branches are treated
 * as escapes, matching KataGo's conservative handling of ko-dependent ladders.
 */
export function findLadderGroups(
  board: Array<Stone | null>,
  size: number,
): LadderGroup[] {
  const groups: LadderGroup[] = []
  const visited = new Set<Point>()

  board.forEach((stone, point) => {
    if (!stone || visited.has(point)) return
    const group = collectGroup(board, point, size)
    group.stones.forEach((groupPoint) => visited.add(groupPoint))
    if (group.liberties.size < 1 || group.liberties.size > 2) return

    const budget: SearchBudget = { nodes: MAX_LADDER_NODES, exhausted: false }
    const workingMoves = group.liberties.size === 1
      ? (isLadderCaptured(board, size, point, true, budget) ? [] : null)
      : attackerWorkingMoves(board, size, point, budget)

    if (workingMoves !== null && !budget.exhausted) {
      groups.push({ stones: group.stones, workingMoves })
    }
  })

  return groups
}

function attackerWorkingMoves(
  board: Array<Stone | null>,
  size: number,
  target: Point,
  budget: SearchBudget,
): Point[] | null {
  const targetStone = board[target]
  if (!targetStone) return null
  const workingMoves: Point[] = []
  const liberties = [...collectGroup(board, target, size).liberties]

  for (const move of liberties) {
    const next = playLocal(board, size, move, other(targetStone))
    if (!next) continue
    if (isLadderCaptured(next, size, target, true, budget)) workingMoves.push(move)
    if (budget.exhausted) return null
  }
  return workingMoves.length > 0 ? workingMoves : null
}

function isLadderCaptured(
  board: Array<Stone | null>,
  size: number,
  target: Point,
  defenderFirst: boolean,
  budget: SearchBudget,
): boolean {
  const targetStone = board[target]
  if (!targetStone) return true
  const initialLiberties = collectGroup(board, target, size).liberties.size
  if (initialLiberties > 2 || (defenderFirst && initialLiberties > 1)) return false

  const seen = new Set<string>()
  return readLadder(board, size, target, targetStone, defenderFirst, budget, seen, 0)
}

function readLadder(
  board: Array<Stone | null>,
  size: number,
  target: Point,
  defender: Stone,
  defenderTurn: boolean,
  budget: SearchBudget,
  seen: Set<string>,
  depth: number,
): boolean {
  budget.nodes -= 1
  if (budget.nodes < 0) {
    budget.exhausted = true
    return false
  }
  if (board[target] !== defender) return true

  const group = collectGroup(board, target, size)
  const liberties = [...group.liberties]
  if (!defenderTurn && liberties.length <= 1) return true
  if (!defenderTurn && liberties.length >= 3) return false
  if (defenderTurn && liberties.length >= 2) return false
  if (depth >= Math.floor(size * size * 1.5)) return false

  const key = `${defenderTurn ? 'd' : 'a'}:${boardKey(board)}`
  if (seen.has(key)) return false
  seen.add(key)

  const moves = defenderTurn
    ? [...libertyGainingCaptures(board, size, group.stones, defender), ...liberties]
    : liberties
  const uniqueMoves = [...new Set(moves)]

  if (defenderTurn) {
    // Every legal defense must still be caught for this to be a ladder.
    for (const move of uniqueMoves) {
      const next = playLocal(board, size, move, defender)
      if (!next) continue
      if (!readLadder(next, size, target, defender, false, budget, seen, depth + 1)) {
        seen.delete(key)
        return false
      }
    }
    seen.delete(key)
    return true
  }

  // The attacker needs only one continuation that forces capture.
  const attacker = other(defender)
  for (const move of uniqueMoves) {
    const next = playLocal(board, size, move, attacker)
    if (!next) continue
    if (readLadder(next, size, target, defender, true, budget, seen, depth + 1)) {
      seen.delete(key)
      return true
    }
  }
  seen.delete(key)
  return false
}

function libertyGainingCaptures(
  board: Array<Stone | null>,
  size: number,
  targetStones: Point[],
  defender: Stone,
): Point[] {
  const attacker = other(defender)
  const checked = new Set<Point>()
  const captures: Point[] = []

  for (const stone of targetStones) {
    for (const neighbor of neighbors(stone, size)) {
      if (board[neighbor] !== attacker || checked.has(neighbor)) continue
      const group = collectGroup(board, neighbor, size)
      group.stones.forEach((point) => checked.add(point))
      if (group.liberties.size === 1) captures.push([...group.liberties][0])
    }
  }
  return captures
}

function playLocal(
  board: Array<Stone | null>,
  size: number,
  move: Point,
  color: Stone,
): Array<Stone | null> | null {
  if (board[move] !== null) return null
  const next = [...board]
  next[move] = color
  const opponent = other(color)
  const checked = new Set<Point>()

  for (const neighbor of neighbors(move, size)) {
    if (next[neighbor] !== opponent || checked.has(neighbor)) continue
    const group = collectGroup(next, neighbor, size)
    group.stones.forEach((point) => checked.add(point))
    if (group.liberties.size === 0) group.stones.forEach((point) => { next[point] = null })
  }

  return collectGroup(next, move, size).liberties.size > 0 ? next : null
}

function boardKey(board: Array<Stone | null>): string {
  return board.map((stone) => stone?.[0] ?? '.').join('')
}
