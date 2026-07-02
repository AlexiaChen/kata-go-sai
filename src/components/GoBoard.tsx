import { useEffect, useRef, useState } from 'react'

import type { GoBoardGameHandle } from '../game/boardScene'
import type { Point, Position } from '../game/types'

interface GoBoardProps {
  position: Position
  disabled?: boolean
  onPlay: (point: Point) => void
}

export default function GoBoard({ position, disabled = false, onPlay }: GoBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<GoBoardGameHandle | null>(null)
  const latestProps = useRef({ position, disabled, onPlay })
  const [ready, setReady] = useState(false)
  latestProps.current = { position, disabled, onPlay }

  useEffect(() => {
    if (!containerRef.current) return
    let mounted = true
    const container = containerRef.current
    void import('../game/boardScene').then(({ createGoBoardGame }) => {
      if (!mounted) return
      gameRef.current = createGoBoardGame(container, latestProps.current)
      setReady(true)
    })
    return () => {
      mounted = false
      gameRef.current?.destroy()
      gameRef.current = null
    }
  }, [])

  useEffect(() => {
    gameRef.current?.setPosition(position)
  }, [position])

  useEffect(() => {
    gameRef.current?.setDisabled(disabled)
  }, [disabled])

  useEffect(() => {
    gameRef.current?.setOnPlay(onPlay)
  }, [onPlay])

  return (
    <div className="go-board-shell-frame">
      {!ready && <div className="board-loading">正在载入 Phaser 棋盘…</div>}
      <div
        ref={containerRef}
        className="go-board-shell"
        role="application"
        aria-label={`${position.size} 路围棋棋盘，当前轮到${position.toPlay === 'black' ? '黑方' : '白方'}`}
      />
    </div>
  )
}
