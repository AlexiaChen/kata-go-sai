/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs'

import { createGame } from '../game/rules'
import type { GameState } from '../game/types'
import { encodeKataFeatures, GLOBAL_FEATURES, NN_BOARD_SIZE, SPATIAL_FEATURES } from './kataFeatures'
import { MctsSession, type MctsConfig, type NetworkEvaluation } from './mcts'
import type { AiLevel, AiRequest, AiResponse } from './types'

const MODEL_NAME = 'kata1-b10c128-s1141046784-d204142634'
const POLICY_OUTPUT = 'swa_model/policy_output'
const MISC_OUTPUT = 'swa_model/miscvalues_output'
const VALUE_OUTPUT = 'swa_model/value_output'
const POLICY_STRIDE = 2 * (NN_BOARD_SIZE * NN_BOARD_SIZE + 1)
const MISC_STRIDE = 10
const VALUE_STRIDE = 3
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

const SEARCH_CONFIGS: Record<AiLevel, MctsConfig> = {
  fast: {
    maxVisits: 4,
    maxTimeMs: 4_000,
    batchSize: 4,
    cpuct: 1,
    fpuReduction: 0.1,
    scoreUtilityWeight: 0.08,
    rootSymmetryPruning: true,
  },
  balanced: {
    maxVisits: 12,
    maxTimeMs: 8_000,
    batchSize: 4,
    cpuct: 1,
    fpuReduction: 0.1,
    scoreUtilityWeight: 0.08,
    rootSymmetryPruning: true,
  },
  careful: {
    maxVisits: 24,
    maxTimeMs: 16_000,
    batchSize: 4,
    cpuct: 1,
    fpuReduction: 0.1,
    scoreUtilityWeight: 0.08,
    rootSymmetryPruning: true,
  },
}

let model: tf.GraphModel | null = null
let backend = 'uninitialized'
let initializing: Promise<void> | null = null
const searchSession = new MctsSession(evaluateGames)

scope.onmessage = (event: MessageEvent<AiRequest>) => {
  const request = event.data
  if (request.type === 'init') {
    initializing = initialize(request.modelUrl)
    void initializing.catch((error) => postError(error))
    return
  }

  void search(request.requestId, request.game, request.level)
}

async function initialize(modelUrl: string): Promise<void> {
  const startedAt = performance.now()
  backend = await selectBackend()
  model = await tf.loadGraphModel(modelUrl)

  // Compile the single-position root evaluation before the first move.
  await executeNetworkBatch([encodeKataFeatures(createGame(19))])

  const response: AiResponse = {
    type: 'ready',
    backend,
    loadMs: performance.now() - startedAt,
    modelName: MODEL_NAME,
  }
  scope.postMessage(response)

  const warmupStartedAt = performance.now()
  const emptyFeatures = encodeKataFeatures(createGame(19))
  await executeNetworkBatch([emptyFeatures, emptyFeatures, emptyFeatures, emptyFeatures])
  scope.postMessage({
    type: 'optimized',
    batchSize: 4,
    warmupMs: performance.now() - warmupStartedAt,
  } satisfies AiResponse)
}

async function selectBackend(): Promise<string> {
  try {
    const selected = await tf.setBackend('webgl')
    if (selected) {
      await tf.ready()
      return tf.getBackend()
    }
  } catch {
    // Offscreen WebGL is not available in every browser/worker combination.
  }

  await tf.setBackend('cpu')
  await tf.ready()
  return tf.getBackend()
}

async function search(requestId: number, game: GameState, level: AiLevel): Promise<void> {
  const startedAt = performance.now()
  try {
    if (initializing) await initializing
    if (!model) throw new Error('KataGo 小网络尚未加载')

    const result = await searchSession.search(game, SEARCH_CONFIGS[level])
    const response: AiResponse = {
      type: 'result',
      requestId,
      move: result.move,
      candidates: result.legalMoves,
      elapsedMs: performance.now() - startedAt,
      backend,
      scoreLead: result.scoreLead,
      visits: result.visits,
      batches: result.batches,
      treeReused: result.treeReused,
      retainedVisits: result.retainedVisits,
      principalVariation: result.principalVariation,
      rootCandidates: result.candidates,
    }
    scope.postMessage(response)
  } catch (error) {
    postError(error, requestId)
  }
}

async function evaluateGames(games: GameState[]): Promise<NetworkEvaluation[]> {
  return executeNetworkBatch(games.map(encodeKataFeatures))
}

async function executeNetworkBatch(
  featureBatch: Array<ReturnType<typeof encodeKataFeatures>>,
): Promise<NetworkEvaluation[]> {
  if (!model) throw new Error('KataGo 小网络尚未加载')
  const batchSize = featureBatch.length
  const spatialLength = NN_BOARD_SIZE * NN_BOARD_SIZE * SPATIAL_FEATURES
  const binInputs = new Float32Array(batchSize * spatialLength)
  const globalInputs = new Float32Array(batchSize * GLOBAL_FEATURES)
  featureBatch.forEach((features, index) => {
    binInputs.set(features.binInputs, index * spatialLength)
    globalInputs.set(features.globalInputs, index * GLOBAL_FEATURES)
  })

  const binTensor = tf.tensor(
    binInputs,
    [batchSize, NN_BOARD_SIZE * NN_BOARD_SIZE, SPATIAL_FEATURES],
    'float32',
  )
  const globalTensor = tf.tensor(globalInputs, [batchSize, GLOBAL_FEATURES], 'float32')
  let outputs: tf.Tensor[] = []
  try {
    const result = await model.executeAsync(
      {
        'swa_model/bin_inputs': binTensor,
        'swa_model/global_inputs': globalTensor,
      },
      [POLICY_OUTPUT, MISC_OUTPUT, VALUE_OUTPUT],
    )
    outputs = result as tf.Tensor[]
    const policyData = Float32Array.from(await outputs[0].data())
    const miscData = Float32Array.from(await outputs[1].data())
    const valueData = Float32Array.from(await outputs[2].data())

    return featureBatch.map((_, index) => ({
      policyLogits: policyData.slice(
        index * POLICY_STRIDE,
        index * POLICY_STRIDE + NN_BOARD_SIZE * NN_BOARD_SIZE + 1,
      ),
      value: winLossValue(valueData, index * VALUE_STRIDE),
      scoreLead: Number.isFinite(miscData[index * MISC_STRIDE + 2])
        ? miscData[index * MISC_STRIDE + 2] * 20
        : 0,
    }))
  } finally {
    binTensor.dispose()
    globalTensor.dispose()
    tf.dispose(outputs)
  }
}

function winLossValue(values: Float32Array, offset: number): number {
  // With positional superko and area scoring KataGo suppresses no-result,
  // so normalize the current-player win and loss logits directly.
  const maximum = Math.max(values[offset], values[offset + 1])
  const win = Math.exp(values[offset] - maximum)
  const loss = Math.exp(values[offset + 1] - maximum)
  return (win - loss) / (win + loss)
}

function postError(error: unknown, requestId?: number): void {
  const response: AiResponse = {
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : 'KataGo 小网络推理失败',
  }
  scope.postMessage(response)
}

export {}
