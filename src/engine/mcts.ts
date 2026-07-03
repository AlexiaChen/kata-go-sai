import { hashBoard, passTurn, playMove, scoreChineseArea } from '../game/rules'
import type { GameState, Point } from '../game/types'
import { NN_BOARD_SIZE } from './kataFeatures'

export interface NetworkEvaluation {
  policyLogits: Float32Array
  value: number
  scoreLead: number
}

export type BatchEvaluator = (games: GameState[]) => Promise<NetworkEvaluation[]>

export interface MctsConfig {
  maxVisits: number
  maxTimeMs: number
  batchSize: number
  cpuct: number
  fpuReduction: number
  rootSymmetryPruning?: boolean
}

export interface MctsCandidate {
  move: Point | null
  visits: number
  value: number
  prior: number
}

export interface MctsResult {
  move: Point | null
  visits: number
  batches: number
  legalMoves: number
  treeReused: boolean
  retainedVisits: number
  rootValue: number
  scoreLead: number
  principalVariation: Array<Point | null>
  candidates: MctsCandidate[]
}

interface SearchNode {
  game: GameState
  expanded: boolean
  pending: boolean
  visits: number
  networkValue: number
  scoreLead: number
  legalMoveCount: number
  edges: SearchEdge[]
}

interface SearchEdge {
  move: Point | null
  prior: number
  visits: number
  valueSum: number
  virtualLoss: number
  child: SearchNode | null
}

interface SearchPath {
  leaf: SearchNode
  steps: Array<{ node: SearchNode; edge: SearchEdge }>
  terminalValue: number | null
}

export class MctsSession {
  private root: SearchNode | null = null

  constructor(private readonly evaluate: BatchEvaluator) {}

  reset(): void {
    this.root = null
  }

  async search(game: GameState, config: MctsConfig): Promise<MctsResult> {
    const startedAt = performance.now()
    const reusableRoot = this.root ? findMatchingNode(this.root, game) : null
    const root = reusableRoot ?? createNode(game)
    const treeReused = reusableRoot !== null
    const retainedVisits = root.visits
    if (!root.expanded) {
      const [rootEvaluation] = await this.evaluate([game])
      expand(root, rootEvaluation, config.rootSymmetryPruning !== false)
    }

    let completedVisits = 0
    let batches = 0
    while (completedVisits < config.maxVisits && performance.now() - startedAt < config.maxTimeMs) {
      const wanted = Math.min(config.batchSize, config.maxVisits - completedVisits)
      const paths: SearchPath[] = []
      for (let index = 0; index < wanted; index += 1) {
        const path = selectPath(root, config)
        if (!path) break
        paths.push(path)
      }
      if (paths.length === 0) break

      const networkPaths = paths.filter((path) => path.terminalValue === null)
      const evaluations = networkPaths.length > 0
        ? await this.evaluate(networkPaths.map((path) => path.leaf.game))
        : []
      batches += networkPaths.length > 0 ? 1 : 0

      let evaluationIndex = 0
      for (const path of paths) {
        let leafValue: number
        if (path.terminalValue !== null) {
          leafValue = path.terminalValue
        } else {
          const evaluation = evaluations[evaluationIndex]
          evaluationIndex += 1
          expand(path.leaf, evaluation, false)
          leafValue = evaluation.value
        }
        path.leaf.pending = false
        backpropagate(path, leafValue)
        completedVisits += 1
      }
    }

    const candidates = root.edges
      .map((edge) => ({
        move: edge.move,
        visits: edge.visits,
        value: edge.visits > 0 ? edge.valueSum / edge.visits : root.networkValue - config.fpuReduction,
        prior: edge.prior,
      }))
      .sort((left, right) => right.visits - left.visits || right.value - left.value || right.prior - left.prior)
    const move = candidates[0]?.move ?? null
    this.root = root

    return {
      move,
      visits: completedVisits,
      batches,
      legalMoves: root.legalMoveCount,
      treeReused,
      retainedVisits,
      rootValue: root.networkValue,
      scoreLead: root.scoreLead,
      principalVariation: principalVariation(root),
      candidates: candidates.slice(0, 8),
    }
  }
}

export async function runMcts(
  game: GameState,
  evaluate: BatchEvaluator,
  config: MctsConfig,
): Promise<MctsResult> {
  return new MctsSession(evaluate).search(game, config)
}

function createNode(game: GameState): SearchNode {
  return {
    game,
    expanded: false,
    pending: false,
    visits: 0,
    networkValue: 0,
    scoreLead: 0,
    legalMoveCount: 0,
    edges: [],
  }
}

function expand(node: SearchNode, evaluation: NetworkEvaluation, pruneSymmetries: boolean): void {
  node.expanded = true
  node.networkValue = evaluation.value
  node.scoreLead = evaluation.scoreLead

  const legalMoves: Array<{ move: Point | null; logit: number }> = []
  const { board, size } = node.game.position
  board.forEach((stone, point) => {
    if (stone !== null || !playMove(node.game, point).ok) return
    const x = point % size
    const y = Math.floor(point / size)
    legalMoves.push({ move: point, logit: evaluation.policyLogits[y * NN_BOARD_SIZE + x] })
  })
  legalMoves.push({
    move: null,
    logit: evaluation.policyLogits[NN_BOARD_SIZE * NN_BOARD_SIZE],
  })

  node.legalMoveCount = Math.max(0, legalMoves.length - 1)
  const searchMoves = pruneSymmetries
    ? mergeSymmetricMoves(node.game, legalMoves)
    : legalMoves

  const maxLogit = Math.max(...searchMoves.map((candidate) => candidate.logit))
  const weights = searchMoves.map((candidate) => Math.max(1e-8, Math.exp(candidate.logit - maxLogit)))
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  node.edges = searchMoves.map((candidate, index) => ({
    move: candidate.move,
    prior: weights[index] / weightSum,
    visits: 0,
    valueSum: 0,
    virtualLoss: 0,
    child: null,
  }))
}

function mergeSymmetricMoves(
  game: GameState,
  moves: Array<{ move: Point | null; logit: number }>,
): Array<{ move: Point | null; logit: number }> {
  const size = game.position.size
  const symmetries = BOARD_SYMMETRIES.filter((symmetry) => isGameSymmetric(game, symmetry))
  if (symmetries.length <= 1) return moves

  const byPoint = new Map(moves.map((candidate) => [candidate.move, candidate]))
  const handled = new Set<Point | null>()
  const merged: Array<{ move: Point | null; logit: number }> = []
  for (const candidate of moves) {
    if (handled.has(candidate.move)) continue
    const orbit = candidate.move === null
      ? [candidate]
      : [...new Set(symmetries.map((symmetry) => symmetry(candidate.move!, size)))]
          .map((point) => byPoint.get(point))
          .filter((item): item is { move: Point; logit: number } => item !== undefined)
    orbit.forEach((item) => handled.add(item.move))
    const representative = orbit.reduce((best, item) => item.logit > best.logit ? item : best)
    merged.push({
      move: representative.move,
      logit: logSumExp(orbit.map((item) => item.logit)),
    })
  }
  return merged
}

type BoardSymmetry = (point: Point, size: number) => Point

const BOARD_SYMMETRIES: BoardSymmetry[] = [
  (point) => point,
  (point, size) => (point % size) * size + (size - 1 - Math.floor(point / size)),
  (point, size) => size * size - 1 - point,
  (point, size) => (size - 1 - (point % size)) * size + Math.floor(point / size),
  (point, size) => Math.floor(point / size) * size + (size - 1 - (point % size)),
  (point, size) => (size - 1 - Math.floor(point / size)) * size + (point % size),
  (point, size) => (point % size) * size + Math.floor(point / size),
  (point, size) => (size - 1 - (point % size)) * size + (size - 1 - Math.floor(point / size)),
]

function isGameSymmetric(game: GameState, symmetry: BoardSymmetry): boolean {
  return [...game.history, game.position].every((position) => {
    if (position.lastMove !== null && symmetry(position.lastMove, position.size) !== position.lastMove) return false
    return position.board.every((stone, point) => position.board[symmetry(point, position.size)] === stone)
  })
}

function logSumExp(values: number[]): number {
  const maximum = Math.max(...values)
  return maximum + Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0))
}

function selectPath(root: SearchNode, config: MctsConfig): SearchPath | null {
  const steps: SearchPath['steps'] = []
  let node = root

  while (node.expanded && !node.game.finished) {
    const edge = selectEdge(node, config)
    if (!edge) {
      releaseVirtualLosses(steps)
      return null
    }
    edge.virtualLoss += 1
    steps.push({ node, edge })
    if (!edge.child) edge.child = createChild(node.game, edge.move)
    node = edge.child
  }

  if (node.pending) {
    releaseVirtualLosses(steps)
    return null
  }
  node.pending = true
  return {
    leaf: node,
    steps,
    terminalValue: node.game.finished ? terminalValue(node.game) : null,
  }
}

function selectEdge(node: SearchNode, config: MctsConfig): SearchEdge | null {
  let best: SearchEdge | null = null
  let bestScore = -Infinity
  const exploreScale = (
    config.cpuct + 0.45 * Math.log((node.visits + 500) / 500)
  ) * Math.sqrt(node.visits + 0.01)

  for (const edge of node.edges) {
    if (edge.child?.pending) continue
    const effectiveVisits = edge.visits + edge.virtualLoss
    const q = effectiveVisits > 0
      ? (edge.valueSum - edge.virtualLoss) / effectiveVisits
      : node.networkValue - config.fpuReduction
    const u = exploreScale * edge.prior / (1 + effectiveVisits)
    const score = q + u
    if (score > bestScore) {
      best = edge
      bestScore = score
    }
  }
  return best
}

function createChild(game: GameState, move: Point | null): SearchNode {
  const result = move === null ? passTurn(game) : playMove(game, move)
  if (!result.ok) throw new Error(`MCTS selected an illegal move: ${result.reason ?? move}`)
  return createNode(result.game)
}

function terminalValue(game: GameState): number {
  const score = scoreChineseArea(game)
  return score.winner === game.position.toPlay ? 1 : -1
}

function backpropagate(path: SearchPath, leafValue: number): void {
  let value = leafValue
  for (let index = path.steps.length - 1; index >= 0; index -= 1) {
    const { node, edge } = path.steps[index]
    value = -value
    edge.virtualLoss = Math.max(0, edge.virtualLoss - 1)
    edge.visits += 1
    edge.valueSum += value
    node.visits += 1
  }
}

function releaseVirtualLosses(steps: SearchPath['steps']): void {
  steps.forEach(({ edge }) => {
    edge.virtualLoss = Math.max(0, edge.virtualLoss - 1)
  })
}

function principalVariation(root: SearchNode): Array<Point | null> {
  const variation: Array<Point | null> = []
  let node: SearchNode | null = root
  for (let depth = 0; depth < 12 && node?.expanded; depth += 1) {
    const edge: SearchEdge | undefined = node.edges
      .filter((candidate) => candidate.visits > 0)
      .sort((left, right) => right.visits - left.visits || right.valueSum - left.valueSum)[0]
    if (!edge) break
    variation.push(edge.move)
    node = edge.child
  }
  return variation
}

function findMatchingNode(root: SearchNode, game: GameState): SearchNode | null {
  const pending: SearchNode[] = [root]
  while (pending.length > 0) {
    const node = pending.shift()!
    if (samePosition(node.game, game)) return node
    node.edges.forEach((edge) => {
      if (edge.child) pending.push(edge.child)
    })
  }
  return null
}

function samePosition(left: GameState, right: GameState): boolean {
  return left.position.size === right.position.size
    && left.position.toPlay === right.position.toPlay
    && left.position.moveNumber === right.position.moveNumber
    && left.position.consecutivePasses === right.position.consecutivePasses
    && left.position.captures.black === right.position.captures.black
    && left.position.captures.white === right.position.captures.white
    && hashBoard(left.position.board) === hashBoard(right.position.board)
    && left.boardHashes.length === right.boardHashes.length
    && left.boardHashes.every((hash, index) => hash === right.boardHashes[index])
}
