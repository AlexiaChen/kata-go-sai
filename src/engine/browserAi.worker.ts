/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs'

import { createGame, playMove } from '../game/rules'
import type { GameState, Point } from '../game/types'
import { encodeKataFeatures, GLOBAL_FEATURES, NN_BOARD_SIZE, SPATIAL_FEATURES } from './kataFeatures'
import type { AiLevel, AiRequest, AiResponse } from './types'

const MODEL_NAME = 'kata1-b10c128-s1141046784-d204142634'
const POLICY_OUTPUT = 'swa_model/policy_output'
const MISC_OUTPUT = 'swa_model/miscvalues_output'
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

let model: tf.GraphModel | null = null
let backend = 'uninitialized'
let initializing: Promise<void> | null = null

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

  // Compile shaders and allocate reusable backend resources before the first move.
  await executeNetwork(encodeKataFeatures(createGame(19)))

  const response: AiResponse = {
    type: 'ready',
    backend,
    loadMs: performance.now() - startedAt,
    modelName: MODEL_NAME,
  }
  scope.postMessage(response)
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

    const { policy, misc } = await executeNetwork(encodeKataFeatures(game))
    const ranked: Array<{ move: Point | null; score: number }> = []
    const { size, board } = game.position
    for (let point = 0; point < board.length; point += 1) {
      if (board[point] !== null || !playMove(game, point).ok) continue
      const x = point % size
      const y = Math.floor(point / size)
      ranked.push({ move: point, score: policy[y * NN_BOARD_SIZE + x] })
    }
    ranked.push({ move: null, score: policy[NN_BOARD_SIZE * NN_BOARD_SIZE] })
    ranked.sort((left, right) => right.score - left.score)

    const move = selectMove(ranked, level, game.position.moveNumber)
    const response: AiResponse = {
      type: 'result',
      requestId,
      move,
      candidates: Math.max(0, ranked.length - 1),
      elapsedMs: performance.now() - startedAt,
      backend,
      scoreLead: Number.isFinite(misc[2]) ? misc[2] * 20 : 0,
    }
    scope.postMessage(response)
  } catch (error) {
    postError(error, requestId)
  }
}

function selectMove(
  ranked: Array<{ move: Point | null; score: number }>,
  level: AiLevel,
  moveNumber: number,
): Point | null {
  if (ranked.length === 0) return null
  if (level === 'careful') return ranked[0].move
  const breadth = level === 'fast' ? 5 : moveNumber < 12 ? 3 : 2
  return ranked[Math.floor(Math.random() * Math.min(breadth, ranked.length))].move
}

async function executeNetwork(features: ReturnType<typeof encodeKataFeatures>): Promise<{
  policy: Float32Array
  misc: Float32Array
}> {
  if (!model) throw new Error('KataGo 小网络尚未加载')
  const binTensor = tf.tensor(
    features.binInputs,
    [1, NN_BOARD_SIZE * NN_BOARD_SIZE, SPATIAL_FEATURES],
    'float32',
  )
  const globalTensor = tf.tensor(features.globalInputs, [1, GLOBAL_FEATURES], 'float32')
  let outputs: tf.Tensor[] = []
  try {
    const result = await model.executeAsync(
      {
        'swa_model/bin_inputs': binTensor,
        'swa_model/global_inputs': globalTensor,
      },
      [POLICY_OUTPUT, MISC_OUTPUT],
    )
    outputs = result as tf.Tensor[]
    const policy = Float32Array.from(await outputs[0].data())
    const misc = Float32Array.from(await outputs[1].data())
    return { policy: policy.slice(0, 362), misc }
  } finally {
    binTensor.dispose()
    globalTensor.dispose()
    tf.dispose(outputs)
  }
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
