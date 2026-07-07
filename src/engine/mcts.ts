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
  scoreUtilityWeight?: number
  scoreUtilityScale?: number
  rootSymmetryPruning?: boolean
}

export interface MctsCandidate {
  move: Point | null
  visits: number
  value: number
  utility: number
  scoreLead: number
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
  networkUtility: number
  scoreLead: number
  legalMoveCount: number
  edges: SearchEdge[]
}

interface SearchEdge {
  move: Point | null
  prior: number
  visits: number
  valueSum: number
  utilitySum: number
  scoreLeadSum: number
  virtualLoss: number
  child: SearchNode | null
}

interface SearchPath {
  leaf: SearchNode
  steps: Array<{ node: SearchNode; edge: SearchEdge }>
  terminalEvaluation: SearchEvaluation | null
}

interface SearchEvaluation {
  value: number
  utility: number
  scoreLead: number
}

const DEFAULT_SCORE_UTILITY_WEIGHT = 0.08

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
      expand(root, rootEvaluation, config, config.rootSymmetryPruning !== false)
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

      const networkPaths = paths.filter((path) => path.terminalEvaluation === null)
      const evaluations = networkPaths.length > 0
        ? await this.evaluate(networkPaths.map((path) => path.leaf.game))
        : []
      batches += networkPaths.length > 0 ? 1 : 0

      let evaluationIndex = 0
      for (const path of paths) {
        let leafEvaluation: SearchEvaluation
        if (path.terminalEvaluation !== null) {
          leafEvaluation = path.terminalEvaluation
        } else {
          const evaluation = evaluations[evaluationIndex]
          evaluationIndex += 1
          expand(path.leaf, evaluation, config, false)
          leafEvaluation = searchEvaluation(path.leaf.game, evaluation, config)
        }
        path.leaf.pending = false
        backpropagate(path, leafEvaluation)
        completedVisits += 1
      }
    }

    const candidates = root.edges
      .map((edge) => ({
        move: edge.move,
        visits: edge.visits,
        value: edge.visits > 0 ? edge.valueSum / edge.visits : root.networkValue - config.fpuReduction,
        utility: edge.visits > 0 ? edge.utilitySum / edge.visits : firstPlayUrgency(root, config),
        scoreLead: edge.visits > 0 ? edge.scoreLeadSum / edge.visits : root.scoreLead,
        prior: edge.prior,
      }))
      .sort((left, right) => right.visits - left.visits || right.utility - left.utility || right.prior - left.prior)
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
    networkUtility: 0,
    scoreLead: 0,
    legalMoveCount: 0,
    edges: [],
  }
}

function expand(
  node: SearchNode,
  evaluation: NetworkEvaluation,
  config: MctsConfig,
  pruneSymmetries: boolean,
): void {
  node.expanded = true
  node.networkValue = evaluation.value
  node.scoreLead = evaluation.scoreLead
  node.networkUtility = searchEvaluation(node.game, evaluation, config).utility

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
    utilitySum: 0,
    scoreLeadSum: 0,
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
    terminalEvaluation: node.game.finished ? terminalEvaluation(node.game, config) : null,
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
      ? (edge.utilitySum - edge.virtualLoss) / effectiveVisits
      : firstPlayUrgency(node, config)
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

function terminalEvaluation(game: GameState, config: MctsConfig): SearchEvaluation {
  const score = scoreChineseArea(game)
  const value = score.winner === game.position.toPlay ? 1 : -1
  const blackLead = score.black - score.white
  const scoreLead = game.position.toPlay === 'black' ? blackLead : -blackLead
  return {
    value,
    scoreLead,
    utility: value + scoreUtility(scoreLead, game, config),
  }
}

function backpropagate(path: SearchPath, leafEvaluation: SearchEvaluation): void {
  let value = leafEvaluation.value
  let utility = leafEvaluation.utility
  let scoreLead = leafEvaluation.scoreLead
  for (let index = path.steps.length - 1; index >= 0; index -= 1) {
    const { node, edge } = path.steps[index]
    value = -value
    utility = -utility
    scoreLead = -scoreLead
    edge.virtualLoss = Math.max(0, edge.virtualLoss - 1)
    edge.visits += 1
    edge.valueSum += value
    edge.utilitySum += utility
    edge.scoreLeadSum += scoreLead
    node.visits += 1
  }
}

function searchEvaluation(
  game: GameState,
  evaluation: NetworkEvaluation,
  config: MctsConfig,
): SearchEvaluation {
  return {
    value: evaluation.value,
    scoreLead: evaluation.scoreLead,
    utility: evaluation.value + scoreUtility(evaluation.scoreLead, game, config),
  }
}

function scoreUtility(scoreLead: number, game: GameState, config: MctsConfig): number {
  const weight = config.scoreUtilityWeight ?? DEFAULT_SCORE_UTILITY_WEIGHT
  if (weight <= 0) return 0
  const scale = config.scoreUtilityScale ?? game.position.size
  return weight * Math.tanh(scoreLead / Math.max(1, scale))
}

function firstPlayUrgency(node: SearchNode, config: MctsConfig): number {
  const exploredPolicy = node.edges.reduce(
    (sum, edge) => edge.visits + edge.virtualLoss > 0 ? sum + edge.prior : sum,
    0,
  )
  return node.networkUtility - config.fpuReduction * Math.sqrt(exploredPolicy)
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
    let edge: SearchEdge | undefined
    for (const candidate of node.edges) {
      if (candidate.visits <= 0) continue
      if (
        !edge ||
        candidate.visits > edge.visits ||
        (candidate.visits === edge.visits && candidate.utilitySum > edge.utilitySum)
      ) {
        edge = candidate
      }
    }
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
