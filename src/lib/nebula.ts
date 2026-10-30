/**
 * 星云渲染引擎
 *
 * 世界坐标 + 相机（平移 / 缩放）
 * 三层视差星尘 · 呼吸光雾 · 想法光点力学 · 碰撞涟漪与流星拖尾
 *
 * 只负责 Canvas 视觉与相机数学，不持有任何业务数据：
 * 想法内容仍由 App.vue 与 localStorage 管理。
 */

export interface NebulaIdea {
  id: number
  x: number
  y: number
  color: string
}

interface Star {
  x: number
  y: number
  r: number
  a: number
  phase: number
  twinkle: number
  hue: number
  layer: number
  vx: number
  vy: number
}

interface Filament {
  baseY: number
  amp: number
  cycles: number
  phase: number
  speed: number
  width: number
  alpha: number
  hueA: number
  hueB: number
}

interface Ripple {
  x: number
  y: number
  life: number
  duration: number
  radius: number
  color: string
  strength: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  duration: number
  size: number
  hue: number
}

interface Comet {
  from: { x: number; y: number }
  ctrl: { x: number; y: number }
  to: { x: number; y: number }
  t: number
  duration: number
  hue: number
  trail: { x: number; y: number }[]
  arrived: boolean
}

type GuidePhase = 'approach' | 'hold' | 'release'

interface Guide {
  aId: number
  bId: number
  ax: number
  ay: number
  bx: number
  by: number
  mx: number
  my: number
  t: number
  phase: GuidePhase
  fired: boolean
}

interface NodeOffset {
  x: number
  y: number
  near: boolean
}

interface Vec {
  x: number
  y: number
}

const TAU = Math.PI * 2
const STAR_PARALLAX = [0.42, 0.7, 1]
const STAR_LIMITS = [0.2, 0.34]

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

const rgbCache = new Map<string, string>()

function rgbOf(hex: string): string {
  const cached = rgbCache.get(hex)
  if (cached) return cached
  let value = hex.replace('#', '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('')
  }
  const num = Number.parseInt(value, 16)
  const rgb = Number.isNaN(num) ? '200, 190, 255' : `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`
  rgbCache.set(hex, rgb)
  return rgb
}

function withAlpha(hex: string, alpha: number): string {
  return `rgba(${rgbOf(hex)}, ${alpha})`
}

/** 预渲染星尘辉光贴图，避免每帧创建径向渐变 */
const spriteCache = new Map<number, HTMLCanvasElement>()

function glowSprite(hue: number): HTMLCanvasElement {
  const key = Math.round(hue / 8) * 8
  const cached = spriteCache.get(key)
  if (cached) return cached
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
    grad.addColorStop(0.14, `hsla(${key}, 100%, 88%, 0.9)`)
    grad.addColorStop(0.34, `hsla(${key}, 96%, 76%, 0.32)`)
    grad.addColorStop(0.62, `hsla(${key}, 92%, 68%, 0.08)`)
    grad.addColorStop(1, `hsla(${key}, 90%, 66%, 0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  }
  spriteCache.set(key, canvas)
  return canvas
}

export class NebulaEngine {
  /** 偶遇的两个光点真正靠近（视觉碰撞发生）时触发 */
  onEncounterArrived: (() => void) | null = null
  /** 相机缩放变化，用于界面上的缩放读数 */
  onZoomChange: ((zoom: number) => void) | null = null

  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private stage: HTMLElement | null = null
  private worldEl: HTMLElement | null = null
  private parallaxEl: HTMLElement | null = null
  private observer: ResizeObserver | null = null
  private raf = 0
  private running = false
  private lastTs = 0
  private time = 0

  private dpr = 1
  private viewW = 0
  private viewH = 0
  private worldW = 0
  private worldH = 0
  private minZoom = 0.8

  private stars: Star[] = []
  private filaments: Filament[] = []
  private filamentGradients: CanvasGradient[] = []
  private ripples: Ripple[] = []
  private sparks: Spark[] = []
  private comets: Comet[] = []
  private guide: Guide | null = null

  private ideas: NebulaIdea[] = []
  private nodeEls = new Map<number, HTMLElement>()
  private offsets = new Map<number, NodeOffset>()
  private focusId: number | null = null

  private motion = true
  private reduced = false
  private lowPower = false

  private cam = { x: 0, y: 0, zoom: 1 }
  private camTarget = { x: 0, y: 0, zoom: 1 }
  private panState: { sx: number; sy: number; cx: number; cy: number } | null = null
  private panVel = { x: 0, y: 0 }

  private pointer = { x: -10000, y: -10000, active: false }
  private pointerSmooth = { x: -10000, y: -10000 }
  private trail: Vec[] = []
  private parallax = { x: 0, y: 0 }

  private firstResize = true
  private reportedZoom = 1
  private visible = true

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.motion = !this.reduced
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  mount(stage: HTMLElement, world: HTMLElement, parallax: HTMLElement | null): void {
    this.stage = stage
    this.worldEl = world
    this.parallaxEl = parallax
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(stage)
    this.resize()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTs = 0
    this.raf = window.requestAnimationFrame(this.frame)
  }

  dispose(): void {
    this.running = false
    window.cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    this.observer = null
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.nodeEls.clear()
    this.stars = []
    this.ripples = []
    this.sparks = []
    this.comets = []
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      this.visible = false
      this.running = false
      window.cancelAnimationFrame(this.raf)
    } else if (!this.visible) {
      this.visible = true
      this.start()
    }
  }

  // ---------------------------------------------------------------- 数据

  setIdeas(ideas: NebulaIdea[]): void {
    this.ideas = ideas
    this.refreshNodes()
  }

  /** 想法列表变化后同步 DOM 引用，引擎需要写光点的引力偏移变量 */
  refreshNodes(): void {
    this.nodeEls.clear()
    if (!this.worldEl) return
    this.worldEl.querySelectorAll<HTMLElement>('[data-idea-id]').forEach((el) => {
      const id = Number(el.dataset.ideaId)
      if (!Number.isNaN(id)) this.nodeEls.set(id, el)
    })
  }

  setFocus(id: number | null): void {
    this.focusId = id
  }

  setMotionEnabled(enabled: boolean): void {
    this.motion = enabled && !this.reduced
    if (this.motion) this.start()
  }

  // -------------------------------------------------------------- 坐标转换

  private worldOf(idea: NebulaIdea): Vec {
    return { x: (idea.x / 100) * this.worldW, y: (idea.y / 100) * this.worldH }
  }

  private screenToWorld(sx: number, sy: number): Vec {
    return {
      x: (sx - this.viewW / 2) / this.camTarget.zoom + this.camTarget.x,
      y: (sy - this.viewH / 2) / this.camTarget.zoom + this.camTarget.y,
    }
  }

  // ---------------------------------------------------------------- 相机

  private clampTarget(zoom = this.camTarget.zoom): void {
    const halfW = this.viewW / (2 * zoom)
    const halfH = this.viewH / (2 * zoom)
    if (this.worldW <= halfW * 2) this.camTarget.x = this.worldW / 2
    else this.camTarget.x = clamp(this.camTarget.x, halfW, this.worldW - halfW)
    if (this.worldH <= halfH * 2) this.camTarget.y = this.worldH / 2
    else this.camTarget.y = clamp(this.camTarget.y, halfH, this.worldH - halfH)
  }

  beginPan(sx: number, sy: number): void {
    this.panState = { sx, sy, cx: this.camTarget.x, cy: this.camTarget.y }
    this.panVel = { x: 0, y: 0 }
  }

  panTo(sx: number, sy: number): void {
    if (!this.panState) return
    const zoom = this.camTarget.zoom
    const nx = this.panState.cx - (sx - this.panState.sx) / zoom
    const ny = this.panState.cy - (sy - this.panState.sy) / zoom
    this.panVel = { x: (nx - this.camTarget.x) * 5, y: (ny - this.camTarget.y) * 5 }
    this.camTarget.x = nx
    this.camTarget.y = ny
    this.clampTarget()
  }

  endPan(): void {
    this.panState = null
  }

  isPanning(): boolean {
    return Boolean(this.panState)
  }

  /** 以屏幕某点为锚点缩放，滚轮与双指都走这条路径 */
  zoomAt(sx: number, sy: number, factor: number): void {
    const anchor = this.screenToWorld(sx, sy)
    const zoom = clamp(this.camTarget.zoom * factor, this.minZoom, 2.4)
    if (Math.abs(zoom - this.camTarget.zoom) < 0.0005) return
    this.camTarget.zoom = zoom
    this.camTarget.x = anchor.x - (sx - this.viewW / 2) / zoom
    this.camTarget.y = anchor.y - (sy - this.viewH / 2) / zoom
    this.clampTarget()
  }

  zoomBy(factor: number): void {
    this.zoomAt(this.viewW / 2, this.viewH / 2, factor)
  }

  resetView(): void {
    this.camTarget.zoom = 1
    this.camTarget.x = this.worldW / 2
    this.camTarget.y = this.worldH / 2
    this.clampTarget()
  }

  // ------------------------------------------------------------ 指针输入

  setPointer(x: number, y: number, active: boolean): void {
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.active = active
    if (!active) {
      this.trail.length = 0
    } else if (this.pointerSmooth.x < -5000) {
      this.pointerSmooth.x = x
      this.pointerSmooth.y = y
      this.trail = Array.from({ length: 14 }, () => ({ x, y }))
    }
  }

  /** 在空白处轻点，泛起一圈很淡的水波 */
  pulseAtScreen(sx: number, sy: number): void {
    if (!this.motion) return
    const point = this.screenToWorld(sx, sy)
    this.ripples.push({
      x: point.x,
      y: point.y,
      life: 0,
      duration: 1.5,
      radius: 120 / this.camTarget.zoom,
      color: '#9b8cff',
      strength: 0.22,
    })
  }

  /** 新想法进入星云：一束光从界面下方凝聚，落点绽放 */
  spawn(id: number): void {
    const idea = this.ideas.find((item) => item.id === id)
    if (!idea) return
    const to = this.worldOf(idea)
    const from = this.screenToWorld(this.viewW / 2, this.viewH * 0.72)
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2 - 90
    this.comets.push({
      from,
      ctrl: { x: mx, y: my },
      to,
      t: 0,
      duration: this.reduced ? 0.05 : 0.95,
      hue: 252,
      trail: [],
      arrived: false,
    })
  }

  /** 让两颗光点沿轨迹靠近，视觉碰撞后回调 */
  beginEncounter(aId: number, bId: number): void {
    const a = this.ideas.find((item) => item.id === aId)
    const b = this.ideas.find((item) => item.id === bId)
    if (!a || !b) return
    const pa = this.worldOf(a)
    const pb = this.worldOf(b)
    this.guide = {
      aId,
      bId,
      ax: pa.x,
      ay: pa.y,
      bx: pb.x,
      by: pb.y,
      mx: (pa.x + pb.x) / 2,
      my: (pa.y + pb.y) / 2,
      t: 0,
      phase: 'approach',
      fired: false,
    }
    this.ripples.push({
      x: this.guide.mx,
      y: this.guide.my,
      life: 0,
      duration: 2,
      radius: 150,
      color: '#b9a4ff',
      strength: 0.2,
    })
  }

  cancelEncounter(): void {
    this.guide = null
  }

  getEncounterPhase(): GuidePhase | null {
    return this.guide ? this.guide.phase : null
  }

  // ---------------------------------------------------------------- 尺寸

  private resize(): void {
    if (!this.stage) return
    const rect = this.stage.getBoundingClientRect()
    const viewW = Math.max(1, Math.round(rect.width))
    const viewH = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const prevW = this.worldW || viewW
    const prevH = this.worldH || viewH

    this.viewW = viewW
    this.viewH = viewH
    this.dpr = dpr
    this.canvas.width = Math.floor(viewW * dpr)
    this.canvas.height = Math.floor(viewH * dpr)
    this.canvas.style.width = `${viewW}px`
    this.canvas.style.height = `${viewH}px`

    this.worldW = Math.max(viewW * 1.34, viewW + 240)
    this.worldH = Math.max(viewH * 1.26, viewH + 200)
    this.minZoom = Math.max(viewW / this.worldW, viewH / this.worldH) * 1.01
    this.lowPower = viewW < 820 || (navigator.hardwareConcurrency ?? 8) <= 4

    if (this.firstResize) {
      this.cam = { x: this.worldW / 2, y: this.worldH / 2, zoom: 1 }
      this.camTarget = { ...this.cam }
      this.firstResize = false
    } else {
      this.cam.x *= this.worldW / prevW
      this.cam.y *= this.worldH / prevH
      this.camTarget.x *= this.worldW / prevW
      this.camTarget.y *= this.worldH / prevH
      this.camTarget.zoom = clamp(this.camTarget.zoom, this.minZoom, 2.4)
      this.clampTarget()
    }

    if (!this.stars.length) {
      this.buildStars()
    } else {
      const ratioX = this.worldW / prevW
      const ratioY = this.worldH / prevH
      for (const star of this.stars) {
        star.x *= ratioX
        star.y *= ratioY
      }
    }
    this.buildFilaments()

    if (this.worldEl) {
      this.worldEl.style.width = `${this.worldW}px`
      this.worldEl.style.height = `${this.worldH}px`
    }
    this.applyCamera()
  }

  private buildStars(): void {
    const quality = this.lowPower ? 0.62 : 1
    const count = Math.round(clamp((this.viewW * this.viewH) / 6800, 90, 300) * quality)
    this.stars = []
    for (let i = 0; i < count; i += 1) {
      const layer = i % 3
      const near = layer === 2
      const mid = layer === 1
      const huePool = [236, 250, 262, 198, 214, 178]
      this.stars.push({
        x: (Math.random() * 1.5 - 0.25) * this.worldW,
        y: (Math.random() * 1.5 - 0.25) * this.worldH,
        r: near ? 0.9 + Math.random() * 1.7 : mid ? 0.6 + Math.random() * 1.1 : 0.4 + Math.random() * 0.7,
        a: near ? 0.34 + Math.random() * 0.4 : mid ? 0.24 + Math.random() * 0.32 : 0.14 + Math.random() * 0.26,
        phase: Math.random() * TAU,
        twinkle: 0.25 + Math.random() * 0.55,
        hue: huePool[Math.floor(Math.random() * huePool.length)],
        layer,
        vx: (Math.random() - 0.5) * (near ? 9 : mid ? 5 : 2.4),
        vy: (Math.random() - 0.5) * (near ? 9 : mid ? 5 : 2.4),
      })
    }
  }

  private buildFilaments(): void {
    if (this.lowPower) {
      this.filaments = []
      this.filamentGradients = []
      return
    }
    const count = 6
    this.filaments = []
    for (let i = 0; i < count; i += 1) {
      this.filaments.push({
        baseY: 0.18 + (i / count) * 0.68 + Math.random() * 0.05,
        amp: 16 + Math.random() * 34,
        cycles: 0.7 + Math.random() * 1.4,
        phase: Math.random() * TAU,
        speed: 0.06 + Math.random() * 0.16,
        width: 0.7 + Math.random() * 0.9,
        alpha: 0.05 + Math.random() * 0.07,
        hueA: 250 + Math.random() * 14,
        hueB: 186 + Math.random() * 22,
      })
    }
    this.filamentGradients = this.filaments.map((item) => {
      const grad = this.ctx ? this.ctx.createLinearGradient(0, 0, this.viewW, 0) : ({} as CanvasGradient)
      if (this.ctx) {
        grad.addColorStop(0, `hsla(${item.hueA}, 92%, 70%, 0)`)
        grad.addColorStop(0.28, `hsla(${item.hueA}, 92%, 74%, ${item.alpha})`)
        grad.addColorStop(0.72, `hsla(${item.hueB}, 90%, 78%, ${item.alpha})`)
        grad.addColorStop(1, `hsla(${item.hueB}, 88%, 72%, 0)`)
      }
      return grad
    })
  }

  // ---------------------------------------------------------------- 主循环

  private frame = (ts: number): void => {
    if (!this.running) return
    this.raf = window.requestAnimationFrame(this.frame)
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0.016
    this.lastTs = ts
    this.time = ts
    this.update(dt)
    this.render()
  }

  private update(dt: number): void {
    const motion = this.motion

    // 相机缓动
    const ease = 1 - Math.exp(-dt * 8)
    this.cam.x += (this.camTarget.x - this.cam.x) * ease
    this.cam.y += (this.camTarget.y - this.cam.y) * ease
    this.cam.zoom += (this.camTarget.zoom - this.cam.zoom) * ease

    // 拖拽惯性
    if (!this.panState && (Math.abs(this.panVel.x) > 0.01 || Math.abs(this.panVel.y) > 0.01)) {
      this.camTarget.x += this.panVel.x * dt
      this.camTarget.y += this.panVel.y * dt
      this.clampTarget()
      const decay = Math.exp(-dt * 3.4)
      this.panVel.x *= decay
      this.panVel.y *= decay
      if (Math.abs(this.panVel.x) < 0.02) this.panVel.x = 0
      if (Math.abs(this.panVel.y) < 0.02) this.panVel.y = 0
    }

    // 指针平滑 + 视差
    const px = this.pointer.active ? this.pointer.x : this.viewW / 2
    const py = this.pointer.active ? this.pointer.y : this.viewH / 2
    if (this.pointerSmooth.x < -5000) {
      this.pointerSmooth.x = px
      this.pointerSmooth.y = py
    }
    const pEase = 1 - Math.exp(-dt * 7)
    this.pointerSmooth.x += (px - this.pointerSmooth.x) * pEase
    this.pointerSmooth.y += (py - this.pointerSmooth.y) * pEase
    if (motion) {
      const targetX = (this.pointerSmooth.x / this.viewW - 0.5) * -26
      const targetY = (this.pointerSmooth.y / this.viewH - 0.5) * -18
      this.parallax.x += (targetX - this.parallax.x) * pEase
      this.parallax.y += (targetY - this.parallax.y) * pEase
    }

    // 流体拖尾
    if (motion && !this.lowPower && this.pointer.active) {
      if (!this.trail.length) {
        this.trail = Array.from({ length: 14 }, () => ({ x: this.pointer.x, y: this.pointer.y }))
      }
      this.trail[0].x += (this.pointer.x - this.trail[0].x) * 0.6
      this.trail[0].y += (this.pointer.y - this.trail[0].y) * 0.6
      for (let i = 1; i < this.trail.length; i += 1) {
        const follow = 0.42 - i * 0.017
        this.trail[i].x += (this.trail[i - 1].x - this.trail[i].x) * follow
        this.trail[i].y += (this.trail[i - 1].y - this.trail[i].y) * follow
      }
    }

    // 星尘漂移
    if (motion) {
      for (const star of this.stars) {
        star.x += star.vx * dt
        star.y += star.vy * dt
        const padX = this.worldW * STAR_LIMITS[0]
        const padY = this.worldH * STAR_LIMITS[0]
        if (star.x < -padX) star.x = this.worldW + padX
        if (star.x > this.worldW + padX) star.x = -padX
        if (star.y < -padY) star.y = this.worldH + padY
        if (star.y > this.worldH + padY) star.y = -padY
      }
    }

    this.updateOffsets()
    if (motion) {
      this.updateEffects(dt)
    }
    this.applyCamera()
  }

  private updateOffsets(): void {
    this.offsets.clear()
    for (const idea of this.ideas) {
      this.offsets.set(idea.id, { x: 0, y: 0, near: false })
    }

    const limit = 268
    const list = this.ideas
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]
      const pa = this.worldOf(a)
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]
        const pb = this.worldOf(b)
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const dist = Math.hypot(dx, dy)
        if (dist < 8 || dist > limit) continue
        const falloff = 1 - dist / limit
        const pull = falloff * falloff * 6
        const offA = this.offsets.get(a.id)
        const offB = this.offsets.get(b.id)
        if (offA) {
          offA.x += (dx / dist) * pull
          offA.y += (dy / dist) * pull
        }
        if (offB) {
          offB.x -= (dx / dist) * pull
          offB.y -= (dy / dist) * pull
        }
        if (dist < 176) {
          if (offA) offA.near = true
          if (offB) offB.near = true
        }
      }
    }

    const guide = this.guide
    if (guide) {
      const dx = guide.bx - guide.ax
      const dy = guide.by - guide.ay
      const dist = Math.hypot(dx, dy) || 1
      const ux = dx / dist
      const uy = dy / dist
      const gap = Math.min(46, dist * 0.32)
      const targetA = { x: guide.mx - ux * gap - guide.ax, y: guide.my - uy * gap - guide.ay }
      const targetB = { x: guide.mx + ux * gap - guide.bx, y: guide.my + uy * gap - guide.by }
      let progress = 0
      if (guide.phase === 'approach') progress = easeInOutCubic(clamp(guide.t / 1.15, 0, 1))
      else if (guide.phase === 'hold') progress = 1
      else progress = 1 - easeInOutCubic(clamp(guide.t / 0.9, 0, 1))
      const offA = this.offsets.get(guide.aId)
      const offB = this.offsets.get(guide.bId)
      if (offA) {
        offA.x += targetA.x * progress
        offA.y += targetA.y * progress
        offA.near = progress > 0.4
      }
      if (offB) {
        offB.x += targetB.x * progress
        offB.y += targetB.y * progress
        offB.near = progress > 0.4
      }
    }

    for (const [id, el] of this.nodeEls) {
      const off = this.offsets.get(id)
      const x = off ? off.x : 0
      const y = off ? off.y : 0
      el.style.setProperty('--gx', `${x.toFixed(2)}px`)
      el.style.setProperty('--gy', `${y.toFixed(2)}px`)
      const near = off ? off.near : false
      if ((el.dataset.near === '1') !== near) {
        el.dataset.near = near ? '1' : '0'
        el.classList.toggle('is-near', near)
      }
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i -= 1) {
      const item = this.ripples[i]
      item.life += dt
      if (item.life >= item.duration) this.ripples.splice(i, 1)
    }
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]
      spark.life += dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      spark.vx *= Math.exp(-dt * 1.6)
      spark.vy *= Math.exp(-dt * 1.6)
      if (spark.life >= spark.duration) this.sparks.splice(i, 1)
    }

    const guide = this.guide
    if (guide) {
      guide.t += dt
      if (guide.phase === 'approach' && guide.t >= 1.15) {
        guide.phase = 'hold'
        guide.t = 0
        if (!guide.fired) {
          guide.fired = true
          this.burst(guide.mx, guide.my, 22, 1.2)
          this.ripples.push({
            x: guide.mx,
            y: guide.my,
            life: 0,
            duration: 1.6,
            radius: 190,
            color: '#d3c0ff',
            strength: 0.5,
          })
          this.onEncounterArrived?.()
        }
      } else if (guide.phase === 'hold' && guide.t >= 0.55) {
        guide.phase = 'release'
        guide.t = 0
      } else if (guide.phase === 'release' && guide.t >= 0.9) {
        this.guide = null
      }
    }

    for (let i = this.comets.length - 1; i >= 0; i -= 1) {
      const comet = this.comets[i]
      comet.t += dt / comet.duration
      const p = easeInOutCubic(clamp(comet.t, 0, 1))
      const inv = 1 - p
      const x = inv * inv * comet.from.x + 2 * inv * p * comet.ctrl.x + p * p * comet.to.x
      const y = inv * inv * comet.from.y + 2 * inv * p * comet.ctrl.y + p * p * comet.to.y
      comet.trail.unshift({ x, y })
      if (comet.trail.length > 18) comet.trail.length = 18
      if (comet.t >= 1 && !comet.arrived) {
        comet.arrived = true
        this.burst(comet.to.x, comet.to.y, 16, 0.9)
        this.ripples.push({
          x: comet.to.x,
          y: comet.to.y,
          life: 0,
          duration: 1.4,
          radius: 96,
          color: '#a99bff',
          strength: 0.55,
        })
      }
      if (comet.t > 1.25) this.comets.splice(i, 1)
    }
  }

  private burst(x: number, y: number, count: number, power: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU
      const speed = (40 + Math.random() * 150) * power
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        duration: 0.7 + Math.random() * 0.9,
        size: 0.8 + Math.random() * 1.6,
        hue: 236 + Math.random() * 34,
      })
    }
  }

  // ---------------------------------------------------------------- 渲染

  private useCamera(ctx: CanvasRenderingContext2D, factor = 1): void {
    const zoom = this.cam.zoom
    const tx = this.viewW / 2 - this.cam.x * zoom
    const ty = this.viewH / 2 - this.cam.y * zoom
    ctx.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, this.dpr * tx * factor, this.dpr * ty * factor)
  }

  private render(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.globalCompositeOperation = 'lighter'

    this.drawFilaments(ctx)
    this.drawStars(ctx)
    this.drawWorld(ctx)
    this.drawTrail(ctx)

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  private drawFilaments(ctx: CanvasRenderingContext2D): void {
    if (!this.filaments.length || !this.motion) return
    const zoom = this.cam.zoom
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    for (let f = 0; f < this.filaments.length; f += 1) {
      const item = this.filaments[f]
      const baseY = item.baseY * this.viewH - (this.cam.y - this.worldH / 2) * zoom * 0.18
      ctx.beginPath()
      const step = 26
      for (let x = 0; x <= this.viewW + step; x += step) {
        const wave = Math.sin((x / this.viewW) * TAU * item.cycles + this.time * item.speed * 0.001 + item.phase) * item.amp
        let bend = 0
        if (this.pointer.active) {
          const dx = x - this.pointerSmooth.x
          bend = -Math.exp(-(dx * dx) / (2 * 150 * 150)) * 52
        }
        const y = baseY + wave + bend
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = this.filamentGradients[f] ?? 'rgba(140,140,255,0.06)'
      ctx.lineWidth = item.width
      ctx.stroke()
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    const sizeK = this.lowPower ? 5.0 : 6.2
    for (let layer = 0; layer < 3; layer += 1) {
      this.useCamera(ctx, STAR_PARALLAX[layer])
      for (const star of this.stars) {
        if (star.layer !== layer) continue
        const twinkle = this.motion ? 0.76 + Math.sin(this.time * 0.0008 * star.twinkle * 4 + star.phase) * 0.24 : 0.86
        const size = star.r * sizeK
        ctx.globalAlpha = clamp(star.a * twinkle, 0, 1)
        ctx.drawImage(glowSprite(star.hue), star.x - size / 2, star.y - size / 2, size, size)
      }
    }
    ctx.globalAlpha = 1
  }

  private drawWorld(ctx: CanvasRenderingContext2D): void {
    this.useCamera(ctx, 1)
    const zoom = this.cam.zoom
    const focus = this.focusId

    // 想法之间若有若无的连线：靠近才出现，不做语义判断
    const linkLimit = 285
    for (let i = 0; i < this.ideas.length; i += 1) {
      const a = this.ideas[i]
      const pa = this.worldOf(a)
      for (let j = i + 1; j < this.ideas.length; j += 1) {
        const b = this.ideas[j]
        const pb = this.worldOf(b)
        const d = Math.hypot(pb.x - pa.x, pb.y - pa.y)
        if (d > linkLimit) continue
        const faded = focus !== null && a.id !== focus && b.id !== focus
        const alpha = (1 - d / linkLimit) ** 1.7 * (faded ? 0.04 : 0.16)
        ctx.strokeStyle = `rgba(158, 150, 255, ${alpha})`
        ctx.lineWidth = 0.7 / zoom
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.stroke()
      }
    }

    this.drawGuide(ctx)
    this.drawRipples(ctx)
    this.drawSparks(ctx)
    this.drawComets(ctx)
  }

  private drawGuide(ctx: CanvasRenderingContext2D): void {
    const guide = this.guide
    if (!guide) return
    const offA = this.offsets.get(guide.aId) ?? { x: 0, y: 0, near: false }
    const offB = this.offsets.get(guide.bId) ?? { x: 0, y: 0, near: false }
    const ax = guide.ax + offA.x
    const ay = guide.ay + offA.y
    const bx = guide.bx + offB.x
    const by = guide.by + offB.y
    const cxp = (ax + bx) / 2 + (ay - by) * 0.22
    const cyp = (ay + by) / 2 + (bx - ax) * 0.22
    const zoom = this.cam.zoom

    const grad = ctx.createLinearGradient(ax, ay, bx, by)
    grad.addColorStop(0, 'rgba(186, 168, 255, 0.06)')
    grad.addColorStop(0.5, 'rgba(206, 190, 255, 0.55)')
    grad.addColorStop(1, 'rgba(186, 168, 255, 0.06)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1.1 / zoom
    ctx.setLineDash([6 / zoom, 10 / zoom])
    ctx.lineDashOffset = -this.time * 0.01
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.quadraticCurveTo(cxp, cyp, bx, by)
    ctx.stroke()
    ctx.setLineDash([])

    // 沿轨迹流动的光点
    const travel = (this.time * 0.00035) % 1
    const inv = 1 - travel
    const px = inv * inv * ax + 2 * inv * travel * cxp + travel * travel * bx
    const py = inv * inv * ay + 2 * inv * travel * cyp + travel * travel * by
    const glow = 5 / zoom
    const sprite = glowSprite(258)
    ctx.globalAlpha = 0.9
    ctx.drawImage(sprite, px - glow * 2, py - glow * 2, glow * 4, glow * 4)
    ctx.globalAlpha = 1
  }

  private drawRipples(ctx: CanvasRenderingContext2D): void {
    const zoom = this.cam.zoom
    for (const item of this.ripples) {
      const progress = item.life / item.duration
      const radius = item.radius * easeOutCubic(progress)
      const alpha = Math.max(0, (1 - progress) ** 2) * item.strength
      ctx.strokeStyle = withAlpha(item.color, alpha)
      ctx.lineWidth = (2.2 - progress * 1.6) / zoom
      ctx.beginPath()
      ctx.arc(item.x, item.y, radius, 0, TAU)
      ctx.stroke()

      ctx.strokeStyle = withAlpha(item.color, alpha * 0.4)
      ctx.lineWidth = 5 / zoom
      ctx.beginPath()
      ctx.arc(item.x, item.y, radius * 0.82, 0, TAU)
      ctx.stroke()
    }
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    const zoom = this.cam.zoom
    for (const spark of this.sparks) {
      const progress = spark.life / spark.duration
      const alpha = Math.max(0, 1 - progress) * 0.85
      const size = spark.size / zoom
      ctx.fillStyle = `hsla(${spark.hue}, 96%, 84%, ${alpha})`
      ctx.beginPath()
      ctx.arc(spark.x, spark.y, size, 0, TAU)
      ctx.fill()
    }
  }

  private drawComets(ctx: CanvasRenderingContext2D): void {
    const zoom = this.cam.zoom
    for (const comet of this.comets) {
      const points = comet.trail
      for (let i = points.length - 1; i > 0; i -= 1) {
        const p = points[i]
        const prev = points[i - 1]
        const ratio = 1 - i / points.length
        const alpha = ratio * ratio * 0.55
        ctx.strokeStyle = withAlpha('#b3a2ff', alpha)
        ctx.lineWidth = (0.6 + ratio * 2.4) / zoom
        ctx.beginPath()
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      if (points.length) {
        const head = points[0]
        const size = 13 / zoom
        ctx.globalAlpha = 0.85
        ctx.drawImage(glowSprite(250), head.x - size / 2, head.y - size / 2, size, size)
        ctx.globalAlpha = 1
      }
    }
  }

  /** 指针拖尾：细长、渐隐，只在高质量模式下出现 */
  private drawTrail(ctx: CanvasRenderingContext2D): void {
    if (!this.motion || this.lowPower || !this.pointer.active || this.trail.length < 3) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    for (let i = this.trail.length - 1; i > 0; i -= 1) {
      const current = this.trail[i]
      const prev = this.trail[i - 1]
      const ratio = 1 - i / this.trail.length
      const hue = 252 - ratio * 56
      ctx.strokeStyle = `hsla(${hue}, 92%, 78%, ${ratio * 0.2})`
      ctx.lineWidth = 0.6 + ratio * 2.1
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(current.x, current.y)
      ctx.stroke()
    }
  }

  private applyCamera(): void {
    if (!this.worldEl) return
    const zoom = this.cam.zoom
    const tx = this.viewW / 2 - this.cam.x * zoom
    const ty = this.viewH / 2 - this.cam.y * zoom
    this.worldEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${zoom.toFixed(4)})`
    if (Math.abs(zoom - this.reportedZoom) > 0.015) {
      this.reportedZoom = zoom
      this.worldEl.style.setProperty('--zoom', zoom.toFixed(3))
      this.onZoomChange?.(zoom)
    }
    if (this.parallaxEl) {
      this.parallaxEl.style.setProperty('--px', `${this.parallax.x.toFixed(1)}px`)
      this.parallaxEl.style.setProperty('--py', `${this.parallax.y.toFixed(1)}px`)
    }
  }
}
