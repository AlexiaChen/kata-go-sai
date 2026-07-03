import { useEffect, useMemo, useRef, useState } from 'react'

import GoBoard from './components/GoBoard'
import { InfoIcon, NewIcon, PassIcon, SparkIcon, UndoIcon } from './components/Icons'
import type { AiLevel, AiResponse } from './engine/types'
import { createGame, formatPoint, hashBoard, other, passTurn, playMove, scoreChineseArea, undo } from './game/rules'
import type { GameState, Stone } from './game/types'

const levelLabels: Record<AiLevel, string> = {
  fast: '快速 · 约 3 秒',
  balanced: '均衡 · 约 8 秒',
  careful: '深入 · 约 15 秒',
}

const stoneLabels: Record<Stone, string> = { black: '黑', white: '白' }

interface SearchMeta {
  elapsedMs: number
  candidates: number
  backend: string
  scoreLead: number
  visits: number
  batches: number
  treeReused: boolean
  retainedVisits: number
  principalVariation: Array<number | null>
}

type EngineStatus = 'loading' | 'optimizing' | 'ready' | 'error'

function App() {
  const [boardSize, setBoardSize] = useState(19)
  const [humanColor, setHumanColor] = useState<Stone>('black')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiLevel, setAiLevel] = useState<AiLevel>('careful')
  const [game, setGame] = useState<GameState>(() => createGame())
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState('黑方先行，请落子')
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null)
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('loading')
  const [engineInfo, setEngineInfo] = useState<{ backend: string; loadMs: number } | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef<{ id: number; hash: string } | null>(null)
  const nextRequestId = useRef(0)

  const score = useMemo(() => scoreChineseArea(game), [game])
  const isHumanTurn = !aiEnabled || game.position.toPlay === humanColor
  const movePositions = useMemo(
    () => [...game.history.slice(1), game.position].filter((position) => position.moveNumber > 0),
    [game],
  )

  useEffect(() => {
    const worker = new Worker(new URL('./engine/browserAi.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<AiResponse>) => {
      const response = event.data

      if (response.type === 'ready') {
        setEngineStatus('optimizing')
        setEngineInfo({ backend: response.backend, loadMs: response.loadMs })
        setNotice(`10-block 网络已加载，正在优化批量搜索内核…`)
        return
      }

      if (response.type === 'optimized') {
        setEngineStatus('ready')
        setNotice(`小网络与 batch=${response.batchSize} 搜索内核已就绪`)
        return
      }

      if (response.type === 'error') {
        if (response.requestId !== undefined && response.requestId !== requestRef.current?.id) return
        requestRef.current = null
        setThinking(false)
        setNotice(`小网络错误：${response.message}`)
        setEngineStatus('error')
        setAiEnabled(false)
        return
      }

      const active = requestRef.current
      if (!active || response.requestId !== active.id) return
      requestRef.current = null
      setThinking(false)
      setSearchMeta({
        elapsedMs: response.elapsedMs,
        candidates: response.candidates,
        backend: response.backend,
        scoreLead: response.scoreLead,
        visits: response.visits,
        batches: response.batches,
        treeReused: response.treeReused,
        retainedVisits: response.retainedVisits,
        principalVariation: response.principalVariation,
      })
      setGame((current) => {
        if (hashBoard(current.position.board) !== active.hash || current.finished) return current
        const result = response.move === null ? passTurn(current) : playMove(current, response.move)
        if (!result.ok) {
          setNotice(result.reason ?? 'AI 返回了非法着法')
          return current
        }
        setNotice(response.move === null ? 'MCTS 选择停一手' : `MCTS 搜索落子 ${formatPoint(response.move, current.position.size)}`)
        return result.game
      })
    }
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    const modelUrl = new URL('models/dan/model.json', baseUrl).href
    worker.postMessage({ type: 'init', modelUrl })

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (engineStatus !== 'ready' || !aiEnabled || game.finished || isHumanTurn || thinking || !workerRef.current) return
    const requestId = ++nextRequestId.current
    const hash = hashBoard(game.position.board)
    requestRef.current = { id: requestId, hash }
    setThinking(true)
    setNotice(`KataGo 小网络正在搜索（${levelLabels[aiLevel]}）…`)
    workerRef.current.postMessage({ type: 'search', requestId, game, level: aiLevel })
  }, [aiEnabled, aiLevel, engineStatus, game, isHumanTurn, thinking])

  function reset(nextSize = boardSize, nextHuman = humanColor) {
    requestRef.current = null
    setThinking(false)
    setSearchMeta(null)
    setGame(createGame(nextSize))
    setNotice(nextHuman === 'black' || !aiEnabled ? '黑方先行，请落子' : 'AI 将执黑先行')
  }

  function handlePlay(point: number) {
    if (thinking || !isHumanTurn || game.finished) return
    const result = playMove(game, point)
    if (!result.ok) {
      setNotice(result.reason ?? '不能在这里落子')
      return
    }
    setGame(result.game)
    setNotice(result.captured > 0 ? `提掉 ${result.captured} 子` : `${formatPoint(point, game.position.size)}，轮到${stoneLabels[result.game.position.toPlay]}方`)
  }

  function handlePass() {
    if (thinking || !isHumanTurn || game.finished) return
    const result = passTurn(game)
    setGame(result.game)
    setNotice(result.game.finished ? '双方连续停一手，对局结束' : `${stoneLabels[game.position.toPlay]}方停一手`)
  }

  function handleUndo() {
    if (game.history.length === 0) return
    requestRef.current = null
    setThinking(false)
    const steps = aiEnabled && game.history.length >= 2 ? 2 : 1
    setGame((current) => undo(current, steps))
    setNotice(`已悔 ${steps} 手`)
  }

  function changeBoardSize(size: number) {
    setBoardSize(size)
    reset(size, humanColor)
  }

  function changeHumanColor(color: Stone) {
    setHumanColor(color)
    reset(boardSize, color)
  }

  const resultText = game.finished
    ? `${stoneLabels[score.winner]}胜 ${score.margin.toFixed(1)} 目`
    : `${stoneLabels[game.position.toPlay]}方行棋`

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href={import.meta.env.BASE_URL} className="brand" aria-label="弈境首页">
          <span className="brand-mark"><span /><span /></span>
          <span><strong>弈境</strong><small>KATA GO SAI</small></span>
        </a>
        <div className="top-status">
          <span className={`status-dot ${thinking || engineStatus === 'loading' ? 'animate-pulse' : ''}`} />
          {engineStatus === 'loading'
            ? '正在加载 10-block 网络'
            : engineStatus === 'optimizing'
              ? '正在优化 MCTS 搜索内核'
            : engineStatus === 'error'
              ? 'KataGo 小网不可用'
              : thinking
                ? '小网络推理中'
                : 'KataGo 小网已就绪'}
        </div>
        <button className="new-game-button" type="button" onClick={() => reset()}>
          <NewIcon /> 新对局
        </button>
      </header>

      <main className="main-layout">
        <aside className="left-panel panel">
          <section>
            <p className="eyebrow">对局设置</p>
            <h2>棋局</h2>
            <label className="field-label" htmlFor="board-size">棋盘路数</label>
            <div className="segmented three">
              {[9, 13, 19].map((size) => (
                <button key={size} type="button" className={boardSize === size ? 'active' : ''} onClick={() => changeBoardSize(size)}>{size} 路</button>
              ))}
            </div>

            <label className="field-label">执子</label>
            <div className="segmented">
              <button type="button" className={humanColor === 'black' ? 'active' : ''} onClick={() => changeHumanColor('black')}><i className="mini-stone black" /> 执黑</button>
              <button type="button" className={humanColor === 'white' ? 'active' : ''} onClick={() => changeHumanColor('white')}><i className="mini-stone white" /> 执白</button>
            </div>
          </section>

          <section className="setting-section">
            <div className="setting-heading">
              <div><p className="eyebrow">对弈者</p><h2>KataGo 小网络</h2></div>
              <button
                type="button"
                role="switch"
                aria-checked={aiEnabled}
                className={`switch ${aiEnabled ? 'on' : ''}`}
                onClick={() => {
                  setAiEnabled((enabled) => !enabled)
                  requestRef.current = null
                  setThinking(false)
                }}
              ><span /></button>
            </div>
            <label className="field-label" htmlFor="ai-level">搜索预算</label>
            <select id="ai-level" value={aiLevel} onChange={(event) => setAiLevel(event.target.value as AiLevel)} disabled={!aiEnabled}>
              {Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="engine-note">
              <SparkIcon />
              <p><strong>10-block · 批量 PUCT/MCTS</strong><span>官方 KataGo 网络提供 policy 与 value，搜索在 Worker 内批量评估叶节点；更高 visits 更强，也需要更久。</span></p>
            </div>
          </section>

          <section className="score-card">
            <div><span className="score-stone black" /><p>黑方<small>提子 {game.position.captures.black}</small></p><strong>{score.black.toFixed(1)}</strong></div>
            <div><span className="score-stone white" /><p>白方<small>贴目 {game.komi}</small></p><strong>{score.white.toFixed(1)}</strong></div>
          </section>
        </aside>

        <section className="board-column">
          <div className="turn-strip">
            <div><span className={`turn-stone ${game.position.toPlay}`} /><p><small>第 {game.position.moveNumber + 1} 手</small><strong>{resultText}</strong></p></div>
            <span>{notice}</span>
          </div>
          <GoBoard position={game.position} disabled={thinking || !isHumanTurn || game.finished} onPlay={handlePlay} />
          <div className="board-actions">
            <button type="button" onClick={handleUndo} disabled={game.history.length === 0}><UndoIcon />悔棋</button>
            <div className="move-caption">{game.position.lastMoveWasPass ? '上一手：停一手' : game.position.lastMove !== null ? `上一手：${formatPoint(game.position.lastMove, boardSize)}` : '等待第一手'}</div>
            <button type="button" onClick={handlePass} disabled={thinking || !isHumanTurn || game.finished}><PassIcon />停一手</button>
          </div>
        </section>

        <aside className="right-panel panel">
          <section className="analysis-card">
            <p className="eyebrow">局面概览</p>
            <div className="analysis-title"><h2>{game.finished ? '终局数子' : '实时估算'}</h2><InfoIcon /></div>
            <div className="win-bar"><span style={{ width: `${Math.max(8, Math.min(92, (score.black / (score.black + score.white || 1)) * 100))}%` }} /></div>
            <div className="bar-labels"><span>黑 {score.black.toFixed(1)}</span><span>白 {score.white.toFixed(1)}</span></div>
            <p className="analysis-disclaimer">中国规则面积计分。对局中未标记死子，因此实时结果仅供参考。</p>
          </section>

          <section className="history-card">
            <div className="history-heading"><div><p className="eyebrow">棋谱</p><h2>着法记录</h2></div><span>{game.position.moveNumber} 手</span></div>
            <div className="move-list">
              {movePositions.length === 0 && <p className="empty-history">落下第一颗棋子，棋谱会显示在这里。</p>}
              {movePositions.slice(-18).map((position) => {
                const playedBy = other(position.toPlay)
                return (
                  <div className="move-row" key={position.moveNumber}>
                    <span>{position.moveNumber}</span>
                    <i className={`mini-stone ${playedBy}`} />
                    <strong>{position.lastMoveWasPass ? '停一手' : formatPoint(position.lastMove, position.size)}</strong>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="runtime-card">
            <span className="runtime-icon"><SparkIcon /></span>
            <div>
              <small>神经网络运行时</small>
              <strong>{engineStatus === 'loading' ? '模型加载中…' : engineStatus === 'optimizing' ? 'batch=4 搜索内核预热中…' : engineStatus === 'error' ? '模型不可用' : `TensorFlow.js · ${engineInfo?.backend ?? 'ready'}`}</strong>
              <p>{searchMeta
                ? `搜索 ${searchMeta.elapsedMs.toFixed(0)}ms · ${searchMeta.visits} 新 visits/${searchMeta.batches} batches${searchMeta.treeReused ? ` · 复用 ${searchMeta.retainedVisits} visits` : ''} · ${searchMeta.scoreLead >= 0 ? 'AI 侧' : '人类侧'}预估领先 ${Math.abs(searchMeta.scoreLead).toFixed(1)} 目 · PV ${searchMeta.principalVariation.map((move) => formatPoint(move, boardSize)).join(' ') || '—'}`
                : engineInfo
                  ? `模型加载和预热用时 ${(engineInfo.loadMs / 1000).toFixed(1)}s`
                  : '首次加载约 11 MB 权重，之后由浏览器缓存'}</p>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
