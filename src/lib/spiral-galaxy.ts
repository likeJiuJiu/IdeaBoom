type DustParticle = {
  arm: number
  radius: number
  offset: number
  spread: number
  size: number
  alpha: number
  hue: number
  speed: number
  phase: number
  streak: number
}

type FieldStar = {
  x: number
  y: number
  size: number
  alpha: number
  phase: number
  speed: number
  hue: number
  depth: number
}

const TAU = Math.PI * 2
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const random = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Procedural spiral galaxy layer for IdeaBoom.
 * This is a visual layer only: it does not read, rank, or connect idea data.
 */
export class SpiralGalaxyLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly stage: HTMLElement
  private readonly ctx: CanvasRenderingContext2D | null
  private observer: ResizeObserver | null = null
  private raf = 0
  private running = false
  private lastTs = 0
  private elapsed = 0
  private width = 0
  private height = 0
  private dpr = 1
  private lowPower = false
  private reducedMotion = false
  private motionEnabled = true
  private dust: DustParticle[] = []
  private stars: FieldStar[] = []
  private pointer = { x: 0, y: 0, active: false }
  private pointerSmooth = { x: 0, y: 0 }

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.stage.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.active = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
  }

  private readonly onPointerLeave = () => {
    this.pointer.active = false
  }

  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      window.cancelAnimationFrame(this.raf)
      this.raf = 0
    } else if (this.running && !this.raf) {
      this.lastTs = 0
      this.raf = window.requestAnimationFrame(this.frame)
    }
  }

  constructor(canvas: HTMLCanvasElement, stage: HTMLElement) {
    this.canvas = canvas
    this.stage = stage
    this.ctx = canvas.getContext('2d', { alpha: true })
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.motionEnabled = !this.reducedMotion

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(stage)
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    stage.addEventListener('pointerleave', this.onPointerLeave)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.resize()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTs = 0
    this.raf = window.requestAnimationFrame(this.frame)
  }

  setMotionEnabled(enabled: boolean): void {
    const wasEnabled = this.motionEnabled
    this.motionEnabled = enabled && !this.reducedMotion
    if (this.motionEnabled && !wasEnabled) {
      // 从暂停恢复：重启循环
      this.start()
    } else if (!this.motionEnabled && wasEnabled) {
      // 暂停：渲染一帧静态画面后，循环会自行停止
      this.render()
    }
  }

  dispose(): void {
    this.running = false
    window.cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    this.observer = null
    window.removeEventListener('pointermove', this.onPointerMove)
    this.stage.removeEventListener('pointerleave', this.onPointerLeave)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.dust = []
    this.stars = []
  }

  private resize(): void {
    const rect = this.stage.getBoundingClientRect()
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    this.lowPower = this.width < 900 || (navigator.hardwareConcurrency ?? 8) <= 4
    this.dpr = Math.min(this.lowPower ? 1.15 : 1.35, window.devicePixelRatio || 1)
    this.canvas.width = Math.floor(this.width * this.dpr)
    this.canvas.height = Math.floor(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.buildParticles()
  }

  private buildParticles(): void {
    const dustCount = this.lowPower ? 400 : 900
    const starCount = this.lowPower ? 100 : 220
    this.dust = Array.from({ length: dustCount }, (_, index) => {
      const arm = index % 3
      const radius = Math.pow(Math.random(), 0.72)
      const spread = random(-1, 1) * (0.045 + radius * 0.12)
      let hue: number
      if (arm === 0) hue = Math.random() < 0.68 ? random(34, 48) : random(205, 220)
      else if (arm === 1) hue = Math.random() < 0.8 ? random(202, 220) : random(38, 52)
      else hue = Math.random() < 0.78 ? random(184, 204) : random(250, 278)

      return {
        arm,
        radius,
        offset: spread,
        spread: random(0.004, 0.028),
        size: random(0.35, 1.55) + (radius < 0.14 ? random(0.15, 0.85) : 0),
        alpha: random(0.22, 0.8),
        hue,
        speed: random(0.003, 0.012) * (0.65 + radius),
        phase: random(0, TAU),
        streak: random(1.5, 8),
      }
    })

    this.stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      size: random(0.35, 1.25),
      alpha: random(0.12, 0.62),
      phase: random(0, TAU),
      speed: random(0.5, 1.8),
      hue: Math.random() < 0.72 ? random(205, 228) : random(35, 48),
      depth: random(0.25, 1),
    }))
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return
    const dt = this.lastTs ? Math.min(0.04, (timestamp - this.lastTs) / 1000) : 0.016
    this.lastTs = timestamp
    if (this.motionEnabled) this.elapsed += dt

    const targetX = this.pointer.active ? this.pointer.x : this.width * 0.5
    const targetY = this.pointer.active ? this.pointer.y : this.height * 0.5
    const ease = 1 - Math.exp(-dt * 3.8)
    this.pointerSmooth.x += (targetX - this.pointerSmooth.x) * ease
    this.pointerSmooth.y += (targetY - this.pointerSmooth.y) * ease
    this.render()

    // 动效关闭时停止循环，释放 CPU
    if (this.motionEnabled) {
      this.raf = window.requestAnimationFrame(this.frame)
    } else {
      this.running = false
    }
  }

  private render(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'lighter'

    const nx = this.pointerSmooth.x / this.width - 0.5
    const ny = this.pointerSmooth.y / this.height - 0.5
    const pointerStrength = this.motionEnabled && this.pointer.active ? 1 : 0.28
    const cx = this.width * 0.55 + nx * -54 * pointerStrength
    const cy = this.height * 0.49 + ny * -36 * pointerStrength
    const radiusX = Math.min(this.width * 0.49, this.height * 0.94)
    const radiusY = Math.min(this.height * 0.39, this.width * 0.28)
    const rotation = this.elapsed * 0.009 + nx * 0.055 * pointerStrength

    this.drawArmHaze(ctx, cx, cy, radiusX, radiusY, rotation)
    this.drawSpiralRibbons(ctx, cx, cy, radiusX, radiusY, rotation)
    this.drawDust(ctx, cx, cy, radiusX, radiusY, rotation)
    this.drawNucleus(ctx, cx, cy, radiusX, radiusY)
    this.drawFieldStars(ctx, nx, ny)

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  private drawArmHaze(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
  ): void {
    // Soft gas clouds distributed along three logarithmic spiral arms.
    const cloudCount = this.lowPower ? 8 : 14
    for (let i = 0; i < cloudCount; i += 1) {
      const arm = i % 3
      const step = Math.floor(i / 3)
      const radius = 0.16 + step * (0.76 / Math.max(1, Math.ceil(cloudCount / 3) - 1))
      const angle = arm * (TAU / 3) + radius * 6.05 - this.elapsed * (0.012 + arm * 0.001) + rotation
      const x = cx + Math.cos(angle) * radius * radiusX
      const y = cy + Math.sin(angle) * radius * radiusY
      const size = (0.055 + radius * 0.035) * Math.min(this.width, this.height)
      const hue = arm === 0 ? 40 : arm === 1 ? 211 : 192
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size)
      gradient.addColorStop(0, `hsla(${hue}, 96%, 78%, 0.10)`)
      gradient.addColorStop(0.25, `hsla(${hue}, 90%, 66%, 0.055)`)
      gradient.addColorStop(1, `hsla(${hue}, 90%, 55%, 0)`)
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.ellipse(x, y, size * 1.55, size * 0.52, angle + 0.7, 0, TAU)
      ctx.fill()
    }

    // A broad, cool halo gives the galaxy a visible disk instead of isolated dots.
    const haloRadius = Math.min(this.width, this.height) * 0.48
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius)
    halo.addColorStop(0, 'rgba(255, 226, 183, 0.09)')
    halo.addColorStop(0.12, 'rgba(83, 153, 227, 0.12)')
    halo.addColorStop(0.42, 'rgba(46, 103, 181, 0.075)')
    halo.addColorStop(0.75, 'rgba(30, 57, 123, 0.026)')
    halo.addColorStop(1, 'rgba(20, 30, 72, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.ellipse(cx, cy, haloRadius, haloRadius * 0.58, 0, 0, TAU)
    ctx.fill()
  }

  private drawSpiralRibbons(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
  ): void {
    for (let arm = 0; arm < 3; arm += 1) {
      const hue = arm === 0 ? 42 : arm === 1 ? 211 : 192
      ctx.beginPath()
      for (let i = 0; i <= 70; i += 1) {
        const r = 0.025 + (i / 70) * 0.95
        const angle = arm * (TAU / 3) + r * 6.05 - this.elapsed * 0.012 + rotation
        const x = cx + Math.cos(angle) * r * radiusX
        const y = cy + Math.sin(angle) * r * radiusY
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.055)`
      ctx.lineWidth = Math.max(10, Math.min(this.width, this.height) * 0.035)
      ctx.stroke()
      ctx.strokeStyle = `hsla(${hue}, 100%, 82%, 0.12)`
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }

  private drawDust(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
  ): void {
    const mouseX = this.pointerSmooth.x
    const mouseY = this.pointerSmooth.y
    const interact = this.motionEnabled && this.pointer.active

    for (const particle of this.dust) {
      const angle = particle.arm * (TAU / 3)
        + particle.radius * 6.05
        + particle.offset
        + rotation
        + (this.motionEnabled ? this.elapsed * particle.speed : 0)
      const wave = this.motionEnabled ? Math.sin(this.elapsed * 0.8 + particle.phase) * particle.spread : 0
      let x = cx + Math.cos(angle) * particle.radius * radiusX
      let y = cy + Math.sin(angle) * particle.radius * radiusY + wave * this.height

      if (interact) {
        const dx = x - mouseX
        const dy = y - mouseY
        // 先用廉价的包围盒判断过滤掉远处粒子，避免每帧 900 次 Math.hypot
        if (dx > -260 && dx < 260 && dy > -260 && dy < 260) {
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy))
          if (distance < 260) {
            const influence = (1 - distance / 260) * (1 - distance / 260)
            const swirl = influence * (12 + particle.radius * 22)
            const repel = influence * 7
            x += (-dy / distance) * swirl + (dx / distance) * repel
            y += (dx / distance) * swirl + (dy / distance) * repel
          }
        }
      }

      const twinkle = this.motionEnabled
        ? 0.68 + Math.sin(this.elapsed * 1.7 * particle.speed * 80 + particle.phase) * 0.24
        : 0.78
      const alpha = particle.alpha * twinkle

      ctx.fillStyle = `hsla(${particle.hue}, 94%, ${particle.hue < 80 ? 76 : 82}%, ${alpha})`
      ctx.beginPath()
      ctx.arc(x, y, particle.size, 0, TAU)
      ctx.fill()
    }
  }

  private drawNucleus(ctx: CanvasRenderingContext2D, cx: number, cy: number, radiusX: number, radiusY: number): void {
    const coreRadius = Math.min(this.width, this.height) * 0.19
    const outer = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 1.8)
    outer.addColorStop(0, 'rgba(255, 250, 230, 0.26)')
    outer.addColorStop(0.08, 'rgba(255, 219, 158, 0.20)')
    outer.addColorStop(0.25, 'rgba(255, 177, 86, 0.10)')
    outer.addColorStop(0.52, 'rgba(94, 170, 238, 0.08)')
    outer.addColorStop(1, 'rgba(47, 96, 180, 0)')
    ctx.fillStyle = outer
    ctx.beginPath()
    ctx.ellipse(cx, cy, coreRadius * 1.8, coreRadius * 1.8 * clamp(radiusY / Math.max(1, radiusX), 0.42, 0.72), 0, 0, TAU)
    ctx.fill()

    const innerRadius = Math.min(this.width, this.height) * 0.064
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius)
    inner.addColorStop(0, 'rgba(255, 255, 250, 0.98)')
    inner.addColorStop(0.12, 'rgba(255, 245, 216, 0.92)')
    inner.addColorStop(0.34, 'rgba(255, 202, 129, 0.42)')
    inner.addColorStop(0.72, 'rgba(255, 163, 76, 0.10)')
    inner.addColorStop(1, 'rgba(255, 163, 76, 0)')
    ctx.fillStyle = inner
    ctx.beginPath()
    ctx.arc(cx, cy, innerRadius, 0, TAU)
    ctx.fill()

    ctx.fillStyle = 'rgba(255, 255, 245, 0.95)'
    ctx.shadowColor = 'rgba(255, 221, 164, 0.95)'
    ctx.shadowBlur = this.lowPower ? 8 : 14
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(2, Math.min(this.width, this.height) * 0.006), 0, TAU)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  private drawFieldStars(ctx: CanvasRenderingContext2D, nx: number, ny: number): void {
    for (const star of this.stars) {
      const twinkle = this.motionEnabled ? 0.58 + Math.sin(this.elapsed * star.speed + star.phase) * 0.32 : 0.72
      const px = star.x + nx * -22 * star.depth
      const py = star.y + ny * -16 * star.depth
      ctx.fillStyle = `hsla(${star.hue}, 90%, 84%, ${star.alpha * twinkle})`
      ctx.beginPath()
      ctx.arc(px, py, star.size, 0, TAU)
      ctx.fill()
    }
  }
}