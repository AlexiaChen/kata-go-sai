import { useEffect, useMemo, useRef, useState } from 'react'

import GoBoard from './components/GoBoard'
import { InfoIcon, NewIcon, PassIcon, UndoIcon } from './components/Icons'
import type { AiLevel, AiResponse } from './engine/types'
import { createGame, formatPoint, hashBoard, other, passTurn, playMove, scoreChineseArea, undo } from './game/rules'
import type { GameState, Stone } from './game/types'

const levelLabels: Record<AiLevel, string> = {
  fast: '快速 · 约 3 秒',
  balanced: '均衡 · 约 8 秒',
  careful: '深入 · 约 15 秒',
}

const stoneLabels: Record<Stone, string> = { black: '黑', white: '白' }

type EngineStatus = 'loading' | 'optimizing' | 'ready' | 'error'

function App() {
  const [boardSize, setBoardSize] = useState(19)
  const [humanColor, setHumanColor] = useState<Stone>('black')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiLevel, setAiLevel] = useState<AiLevel>('careful')
  const [game, setGame] = useState<GameState>(() => createGame())
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState('黑方先行，请落子')
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('loading')
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
        return
      }

      if (response.type === 'optimized') {
        setEngineStatus('ready')
        return
      }

      if (response.type === 'error') {
        if (response.requestId !== undefined && response.requestId !== requestRef.current?.id) return
        requestRef.current = null
        setThinking(false)
        setNotice('AI 暂时不可用，已切换为双人模式')
        setEngineStatus('error')
        setAiEnabled(false)
        return
      }

      const active = requestRef.current
      if (!active || response.requestId !== active.id) return
      requestRef.current = null
      setThinking(false)
      setGame((current) => {
        if (hashBoard(current.position.board) !== active.hash || current.finished) return current
        const result = response.move === null ? passTurn(current) : playMove(current, response.move)
        if (!result.ok) {
          setNotice(result.reason ?? 'AI 返回了非法着法')
          return current
        }
        setNotice(response.move === null ? 'AI 选择停一手' : `AI 落子 ${formatPoint(response.move, current.position.size)}`)
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
    setNotice(`AI 正在思考（${levelLabels[aiLevel]}）…`)
    workerRef.current.postMessage({ type: 'search', requestId, game, level: aiLevel })
  }, [aiEnabled, aiLevel, engineStatus, game, isHumanTurn, thinking])

  function reset(nextSize = boardSize, nextHuman = humanColor) {
    requestRef.current = null
    setThinking(false)
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
    const steps = aiEnabled && !thinking ? Math.min(2, game.history.length) : 1
    setGame((current) => undo(current, steps))
    setNotice(steps === 2 ? '已撤回上一回合' : '已撤回上一手')
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
  const canUndo = game.history.length > 0 && (!aiEnabled || thinking || game.history.length >= 2)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href={import.meta.env.BASE_URL} className="brand" aria-label="弈境首页">
          <span className="brand-mark"><span /><span /></span>
          <span><strong>弈境</strong><small>KATA GO SAI</small></span>
        </a>
        <div className="top-status">
          <span className={`status-dot ${thinking || engineStatus === 'loading' || engineStatus === 'optimizing' ? 'animate-pulse' : ''}`} />
          {engineStatus === 'loading' || engineStatus === 'optimizing'
            ? 'AI 准备中'
            : engineStatus === 'error'
              ? 'AI 暂时不可用'
              : thinking
                ? 'AI 思考中'
                : '等待落子'}
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
              <div><p className="eyebrow">对弈者</p><h2>AI 对手</h2></div>
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
            <label className="field-label" htmlFor="ai-level">思考时间</label>
            <select id="ai-level" value={aiLevel} onChange={(event) => setAiLevel(event.target.value as AiLevel)} disabled={!aiEnabled}>
              {Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
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
            <button
              type="button"
              className="undo-button"
              onClick={handleUndo}
              disabled={!canUndo}
              title={aiEnabled ? '撤回你和 AI 的上一回合' : '撤回上一手'}
            ><UndoIcon />悔棋</button>
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

        </aside>
      </main>
    </div>
  )
}

export default App
