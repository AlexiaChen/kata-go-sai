import Phaser from 'phaser'

import type { Point, Position, Stone } from './types'

const BOARD = {
  width: 800,
  height: 800,
  padding: 50,
} as const

const COLORS = {
  surround: 0x493727,
  wood: 0xc99a5e,
  woodLight: 0xdfb777,
  woodDark: 0x7a512c,
  line: 0x322217,
  black: 0x111614,
  blackEdge: 0x020303,
  white: 0xf5f2e8,
  whiteEdge: 0xb5b4ad,
  marker: 0xbd493b,
} as const

function starPoints(size: number): Array<[number, number]> {
  if (size === 9) return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]]
  const low = 3
  const high = size - 4
  const middle = (size - 1) / 2
  return [
    [low, low], [middle, low], [high, low],
    [low, middle], [middle, middle], [high, middle],
    [low, high], [middle, high], [high, high],
  ]
}

class GoBoardScene extends Phaser.Scene {
  private position: Position
  private disabled: boolean
  private onPlay: (point: Point) => void
  private boardLayer: Phaser.GameObjects.Container | null = null
  private stoneLayer: Phaser.GameObjects.Container | null = null
  private inputLayer: Phaser.GameObjects.Container | null = null
  private hoverLayer: Phaser.GameObjects.Graphics | null = null

  constructor(position: Position, disabled: boolean, onPlay: (point: Point) => void) {
    super('go-board')
    this.position = position
    this.disabled = disabled
    this.onPlay = onPlay
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.surround)
    this.boardLayer = this.add.container(0, 0)
    this.stoneLayer = this.add.container(0, 0)
    this.inputLayer = this.add.container(0, 0)
    this.hoverLayer = this.add.graphics()
    this.drawBoard()
    this.renderStones()
    this.createHitAreas()
  }

  setPosition(position: Position): void {
    const sizeChanged = position.size !== this.position.size
    this.position = position
    if (!this.scene.isActive()) return
    if (sizeChanged) {
      this.drawBoard()
      this.createHitAreas()
    }
    this.renderStones()
    this.hoverLayer?.clear()
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled
    if (disabled) this.hoverLayer?.clear()
  }

  setOnPlay(onPlay: (point: Point) => void): void {
    this.onPlay = onPlay
  }

  private gridMetrics() {
    const span = BOARD.width - BOARD.padding * 2
    return { span, cell: span / (this.position.size - 1) }
  }

  private pointFor(point: Point): { x: number; y: number } {
    const { cell } = this.gridMetrics()
    return {
      x: BOARD.padding + (point % this.position.size) * cell,
      y: BOARD.padding + Math.floor(point / this.position.size) * cell,
    }
  }

  private drawBoard(): void {
    if (!this.boardLayer) return
    this.boardLayer.removeAll(true)
    const { span, cell } = this.gridMetrics()

    const wood = this.add.graphics()
    wood.fillStyle(COLORS.wood, 1)
    wood.fillRect(8, 8, BOARD.width - 16, BOARD.height - 16)
    wood.lineStyle(2, COLORS.woodLight, 0.22)
    for (let y = 17; y < BOARD.height; y += 23) {
      wood.beginPath()
      wood.moveTo(8, y)
      for (let x = 24; x < BOARD.width - 8; x += 16) {
        wood.lineTo(x, y + Math.sin(x * 0.025 + y * 0.07) * 2.2)
      }
      wood.strokePath()
    }
    this.boardLayer.add(wood)

    const grid = this.add.graphics()
    grid.lineStyle(this.position.size === 19 ? 1.35 : 1.8, COLORS.line, 0.94)
    for (let index = 0; index < this.position.size; index += 1) {
      const offset = BOARD.padding + index * cell
      grid.beginPath()
      grid.moveTo(BOARD.padding, offset)
      grid.lineTo(BOARD.padding + span, offset)
      grid.strokePath()
      grid.beginPath()
      grid.moveTo(offset, BOARD.padding)
      grid.lineTo(offset, BOARD.padding + span)
      grid.strokePath()
    }
    this.boardLayer.add(grid)

    const stars = this.add.graphics()
    stars.fillStyle(COLORS.line, 1)
    const radius = this.position.size === 19 ? 4.5 : 5.5
    starPoints(this.position.size).forEach(([x, y]) => {
      stars.fillCircle(BOARD.padding + x * cell, BOARD.padding + y * cell, radius)
    })
    this.boardLayer.add(stars)
  }

  private createHitAreas(): void {
    if (!this.inputLayer) return
    this.inputLayer.removeAll(true)
    const { cell } = this.gridMetrics()
    const hitSize = Math.max(24, cell * 0.88)

    this.position.board.forEach((_, point) => {
      const coordinate = this.pointFor(point)
      const zone = this.add.zone(coordinate.x, coordinate.y, hitSize, hitSize)
      zone.setInteractive({ useHandCursor: true })
      zone.on('pointerover', () => this.showHover(point))
      zone.on('pointerout', () => this.hoverLayer?.clear())
      zone.on('pointerdown', () => {
        if (!this.disabled && this.position.board[point] === null) this.onPlay(point)
      })
      this.inputLayer?.add(zone)
    })
  }

  private showHover(point: Point): void {
    if (!this.hoverLayer || this.disabled || this.position.board[point] !== null) return
    const { cell } = this.gridMetrics()
    const coordinate = this.pointFor(point)
    const color = this.position.toPlay === 'black' ? COLORS.black : COLORS.white
    this.hoverLayer.clear()
    this.hoverLayer.fillStyle(color, 0.38)
    this.hoverLayer.fillCircle(coordinate.x, coordinate.y, cell * 0.44)
  }

  private renderStones(): void {
    if (!this.stoneLayer) return
    this.stoneLayer.removeAll(true)
    const { cell } = this.gridMetrics()
    const radius = cell * 0.455

    this.position.board.forEach((stone, point) => {
      if (!stone) return
      const coordinate = this.pointFor(point)
      const container = this.createStone(coordinate.x, coordinate.y, radius, stone)
      if (this.position.lastMove === point) {
        const marker = this.add.circle(0, 0, Math.max(2.5, radius * 0.14), COLORS.marker, 1)
        marker.setStrokeStyle(Math.max(1, radius * 0.05), 0xffffff, 0.35)
        container.add(marker)
        container.setScale(0.78)
        this.tweens.add({ targets: container, scale: 1, duration: 180, ease: 'Back.Out' })
      }
      this.stoneLayer?.add(container)
    })
  }

  private createStone(x: number, y: number, radius: number, stone: Stone): Phaser.GameObjects.Container {
    const container = this.add.container(x, y)
    const shadow = this.add.circle(radius * 0.09, radius * 0.13, radius, 0x1b120b, 0.38)
    const baseColor = stone === 'black' ? COLORS.black : COLORS.white
    const edgeColor = stone === 'black' ? COLORS.blackEdge : COLORS.whiteEdge
    const disc = this.add.circle(0, 0, radius, baseColor, 1)
    disc.setStrokeStyle(Math.max(1, radius * 0.075), edgeColor, 0.9)
    const shine = this.add.ellipse(-radius * 0.28, -radius * 0.32, radius * 0.56, radius * 0.34, 0xffffff, stone === 'black' ? 0.2 : 0.48)
    shine.setRotation(-0.38)
    container.add([shadow, disc, shine])
    return container
  }
}

export interface GoBoardGameHandle {
  destroy: () => void
  setPosition: (position: Position) => void
  setDisabled: (disabled: boolean) => void
  setOnPlay: (onPlay: (point: Point) => void) => void
}

interface CreateGoBoardOptions {
  position: Position
  disabled: boolean
  onPlay: (point: Point) => void
}

export function createGoBoardGame(container: HTMLElement, options: CreateGoBoardOptions): GoBoardGameHandle {
  const scene = new GoBoardScene(options.position, options.disabled, options.onPlay)
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: BOARD.width,
    height: BOARD.height,
    backgroundColor: '#493727',
    transparent: false,
    antialias: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: BOARD.width,
      height: BOARD.height,
    },
    scene,
  })

  return {
    destroy: () => game.destroy(true),
    setPosition: (position) => scene.setPosition(position),
    setDisabled: (disabled) => scene.setDisabled(disabled),
    setOnPlay: (onPlay) => scene.setOnPlay(onPlay),
  }
}
