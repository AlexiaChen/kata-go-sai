import { describe, expect, it } from 'vitest'

import { createGame, passTurn, playMove } from '../game/rules'
import { MctsSession, runMcts, type BatchEvaluator, type NetworkEvaluation } from './mcts'

function evaluation(policyMoves: Array<[number, number]>, value = 0): NetworkEvaluation {
  const policyLogits = new Float32Array(362).fill(-12)
  policyMoves.forEach(([move, logit]) => { policyLogits[move] = logit })
  policyLogits[361] = -12
  return { policyLogits, value, scoreLead: value * 10 }
}

describe('batched PUCT search', () => {
  it('uses batched leaf evaluation and completes the visit budget', async () => {
    const batchSizes: number[] = []
    const evaluator: BatchEvaluator = async (games) => {
      batchSizes.push(games.length)
      return games.map(() => evaluation([[0, 3], [1, 2]], 0))
    }

    const result = await runMcts(createGame(9), evaluator, {
      maxVisits: 12,
      maxTimeMs: 10_000,
      batchSize: 4,
      cpuct: 1,
      fpuReduction: 0.1,
    })

    expect(result.visits).toBe(12)
    expect(batchSizes.some((size) => size > 1)).toBe(true)
    expect(result.candidates.reduce((sum, candidate) => sum + candidate.visits, 0)).toBeLessThanOrEqual(12)
  })

  it('can overturn a misleading raw policy using child values', async () => {
    const badPolicyMove = 0
    const goodSearchMove = 1
    const evaluator: BatchEvaluator = async (games) => games.map((game) => {
      if (game.position.moveNumber === 0) {
        return evaluation([[badPolicyMove, 5], [goodSearchMove, 2]], 0)
      }
      // Preserve a consistent game value at every depth, expressed from the
      // current side-to-play perspective as required by the network contract.
      const firstMove = game.position.moveNumber === 1
        ? game.position.lastMove
        : game.history[1]?.lastMove
      const rootValue = firstMove === badPolicyMove ? -0.9 : firstMove === goodSearchMove ? 0.8 : 0
      const sideToPlayValue = game.position.moveNumber % 2 === 0 ? rootValue : -rootValue
      return evaluation([], sideToPlayValue)
    })

    const result = await runMcts(createGame(9), evaluator, {
      maxVisits: 32,
      maxTimeMs: 10_000,
      batchSize: 4,
      cpuct: 1,
      fpuReduction: 0.1,
    })

    expect(result.move).toBe(goodSearchMove)
    expect(result.candidates[0].visits).toBeGreaterThan(0)
  })

  it('reuses a matching searched subtree on the next turn', async () => {
    const evaluator: BatchEvaluator = async (games) => games.map(() => evaluation([[0, 3], [1, 2]], 0))
    const session = new MctsSession(evaluator)
    const config = {
      maxVisits: 24,
      maxTimeMs: 10_000,
      batchSize: 4,
      cpuct: 1,
      fpuReduction: 0.1,
    }
    const first = await session.search(createGame(9), config)
    expect(first.principalVariation.length).toBeGreaterThanOrEqual(2)

    let nextGame = first.principalVariation[0] === null
      ? passTurn(createGame(9)).game
      : playMove(createGame(9), first.principalVariation[0]).game
    nextGame = first.principalVariation[1] === null
      ? passTurn(nextGame).game
      : playMove(nextGame, first.principalVariation[1]).game
    const second = await session.search(nextGame, config)

    expect(second.treeReused).toBe(true)
    expect(second.retainedVisits).toBeGreaterThan(0)
  })

  it('merges equivalent root moves only while the full history is symmetric', async () => {
    const evaluator: BatchEvaluator = async (games) => games.map(() => evaluation([[0, 3], [8, 3], [152, 3], [160, 3]], 0))
    const config = {
      maxVisits: 1,
      maxTimeMs: 10_000,
      batchSize: 1,
      cpuct: 1,
      fpuReduction: 0.1,
      rootSymmetryPruning: true,
    }
    const symmetric = await runMcts(createGame(9), evaluator, config)
    const asymmetric = await runMcts(playMove(createGame(9), 0).game, evaluator, config)

    expect(symmetric.legalMoves).toBe(81)
    expect(symmetric.candidates.filter((candidate) => [0, 8, 72, 80].includes(candidate.move ?? -1))).toHaveLength(1)
    expect(asymmetric.candidates.filter((candidate) => [8, 72, 80].includes(candidate.move ?? -1)).length).toBeGreaterThan(1)
  })
})
