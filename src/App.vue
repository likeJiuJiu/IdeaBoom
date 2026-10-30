<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NebulaEngine } from './lib/nebula'

type Idea = {
  id: number
  text: string
  x: number
  y: number
  color: string
  createdAt: string
}

const STORAGE_KEY = 'idea-nebula-ideas-v1'
const COLORS = ['#a89bff', '#77e6ff', '#d1a0ff', '#8fafff', '#8df1d3', '#f2b7ff']

const sampleIdeas: Idea[] = [
  { id: 101, text: '为什么有些工具越高效，人反而越焦虑？', x: 38, y: 33, color: '#a89bff', createdAt: '2026-10-20T09:00:00.000Z' },
  { id: 102, text: '模糊的念头，也值得被留下。', x: 55, y: 26, color: '#77e6ff', createdAt: '2026-10-21T13:30:00.000Z' },
  { id: 103, text: '如果不急着给答案，问题会发生什么变化？', x: 73, y: 36, color: '#d1a0ff', createdAt: '2026-10-22T17:15:00.000Z' },
  { id: 104, text: '有些灵感只在两个毫不相关的瞬间相遇时出现。', x: 46, y: 47, color: '#8fafff', createdAt: '2026-10-23T08:20:00.000Z' },
  { id: 105, text: '记录生活，是不是也是在训练自己如何观察？', x: 66, y: 51, color: '#8df1d3', createdAt: '2026-10-24T15:40:00.000Z' },
  { id: 106, text: '有时不是没有想法，只是它还没长成语言。', x: 82, y: 57, color: '#f2b7ff', createdAt: '2026-10-25T10:10:00.000Z' },
  { id: 107, text: '当所有事情都能被量化，什么还值得慢慢做？', x: 36, y: 64, color: '#77e6ff', createdAt: '2026-10-26T12:00:00.000Z' },
  { id: 108, text: '也许创意不是想出来的，而是等到它们相遇。', x: 58, y: 72, color: '#a89bff', createdAt: '2026-10-27T06:45:00.000Z' },
  { id: 109, text: '一个好问题，能陪人走多远？', x: 77, y: 74, color: '#8df1d3', createdAt: '2026-10-28T07:15:00.000Z' },
]

function loadIdeas(): Idea[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Idea[]
      if (Array.isArray(parsed) && parsed.every((item) => typeof item.text === 'string')) return parsed
    }
  } catch {
    // 本地存储不可用或数据损坏时，回落到示例星云
  }
  return sampleIdeas.map((idea) => ({ ...idea }))
}

function random(min: number, max: number) {
  return min + Math.random() * (max - min)
}

const ideas = ref<Idea[]>(loadIdeas())
const shell = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const worldEl = ref<HTMLElement | null>(null)
const parallaxEl = ref<HTMLElement | null>(null)

const motionEnabled = ref(!(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false))
const showLabels = ref(true)
const composerOpen = ref(false)
const encounterOpen = ref(false)
const draftIdea = ref('')
const encounterNote = ref('')
const activeIdea = ref<Idea | null>(null)
const editText = ref('')
const isEditing = ref(false)
const encounterPair = ref<[number, number] | null>(null)
const toastMessage = ref('')
const toastVisible = ref(false)
const panning = ref(false)
const zoomLabel = ref(100)
const bornIds = ref<number[]>([])

const ideaCount = computed(() => ideas.value.length)
const encounterIdeas = computed(() => {
  if (!encounterPair.value) return []
  return encounterPair.value
    .map((id) => ideas.value.find((idea) => idea.id === id))
    .filter((idea): idea is Idea => Boolean(idea))
})

let engine: NebulaEngine | null = null
let toastTimer: number | undefined
let encounterTimer: number | undefined
const bornTimers = new Map<number, number>()
const activePointers = new Map<number, { x: number; y: number }>()
let pinchDistance = 0

function localPoint(event: PointerEvent | WheelEvent) {
  const rect = shell.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

function syncEngine() {
  engine?.setIdeas(ideas.value.map((idea) => ({ id: idea.id, x: idea.x, y: idea.y, color: idea.color })))
}

function markBorn(id: number) {
  bornIds.value = [...bornIds.value, id]
  const timer = window.setTimeout(() => {
    bornIds.value = bornIds.value.filter((item) => item !== id)
    bornTimers.delete(id)
  }, 2400)
  bornTimers.set(id, timer)
}

function notify(message: string) {
  toastMessage.value = message
  toastVisible.value = true
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastVisible.value = false), 2600)
}

// ------------------------------------------------------------------ 相机交互

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, textarea, input, .glass-modal, .topbar, .bottom-bar, .view-hud')) return

  const point = localPoint(event)
  activePointers.set(event.pointerId, point)

  if (activePointers.size === 1) {
    engine?.beginPan(point.x, point.y)
    panning.value = true
  } else if (activePointers.size === 2) {
    engine?.endPan()
    panning.value = false
    pinchDistance = pointerSpread()
  }
  event.preventDefault()
}

function pointerSpread() {
  const points = Array.from(activePointers.values())
  if (points.length < 2) return 0
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

function onPointerMove(event: PointerEvent) {
  const point = localPoint(event)
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, point)
  engine?.setPointer(point.x, point.y, true)

  if (activePointers.size >= 2) {
    const center = Array.from(activePointers.values()).reduce(
      (acc, item) => ({ x: acc.x + item.x / activePointers.size, y: acc.y + item.y / activePointers.size }),
      { x: 0, y: 0 },
    )
    const spread = pointerSpread()
    if (pinchDistance > 0 && spread > 0) {
      engine?.zoomAt(center.x, center.y, Math.min(1.6, Math.max(0.62, spread / pinchDistance)))
    }
    pinchDistance = spread
    return
  }

  if (panning.value) engine?.panTo(point.x, point.y)
}

function onPointerUp(event: PointerEvent) {
  activePointers.delete(event.pointerId)
  if (activePointers.size === 0) {
    engine?.endPan()
    engine?.setPointer(-10000, -10000, false)
    panning.value = false
  }
}

function onPointerLeave() {
  if (panning.value) {
    engine?.endPan()
    panning.value = false
  }
  activePointers.clear()
  engine?.setPointer(-10000, -10000, false)
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey) return
  // 让面板内部的滚动保持原生行为
  if ((event.target as HTMLElement | null)?.closest('.glass-modal')) return
  event.preventDefault()
  const point = localPoint(event)
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1)
  engine?.zoomAt(point.x, point.y, Math.exp(-delta * 0.0016))
}

// ------------------------------------------------------------------ 想法操作

function openComposer() {
  draftIdea.value = ''
  composerOpen.value = true
}

function addIdea(text: string, x?: number, y?: number): Idea | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const idea: Idea = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    text: trimmed,
    x: x ?? random(30, 80),
    y: y ?? random(28, 78),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    createdAt: new Date().toISOString(),
  }
  ideas.value.push(idea)
  return idea
}

function submitIdea() {
  const idea = addIdea(draftIdea.value)
  if (!idea) {
    notify('先写下一点点想法就好。')
    return
  }
  composerOpen.value = false
  draftIdea.value = ''
  markBorn(idea.id)
  notify('一颗新的光点，正在凝聚。')
  nextTick(() => {
    syncEngine()
    engine?.spawn(idea.id)
  })
}

function openIdea(idea: Idea) {
  activeIdea.value = idea
  editText.value = idea.text
  isEditing.value = false
  engine?.setFocus(idea.id)
}

function closeIdea() {
  activeIdea.value = null
  isEditing.value = false
  engine?.setFocus(null)
}

function saveIdeaEdit() {
  if (!activeIdea.value) return
  const text = editText.value.trim()
  if (!text) {
    notify('想法暂时不能为空。')
    return
  }
  const target = ideas.value.find((item) => item.id === activeIdea.value?.id)
  if (target) target.text = text
  activeIdea.value = target ? { ...target } : null
  isEditing.value = false
  notify('已保存这颗光点。')
}

function deleteIdea() {
  if (!activeIdea.value) return
  const removedId = activeIdea.value.id
  ideas.value = ideas.value.filter((item) => item.id !== removedId)
  activeIdea.value = null
  isEditing.value = false
  engine?.setFocus(null)
  nextTick(() => syncEngine())
  notify('这颗光点已离开星云。')
}

// ------------------------------------------------------------------ 偶遇

function isInEncounter(id: number) {
  return Boolean(encounterPair.value?.includes(id))
}

function startEncounter() {
  if (ideas.value.length < 2) {
    notify('再留下一个想法，就可以让它们偶遇了。')
    openComposer()
    return
  }
  const shuffled = [...ideas.value].sort(() => Math.random() - 0.5)
  encounterPair.value = [shuffled[0].id, shuffled[1].id]
  encounterNote.value = ''
  encounterOpen.value = false

  if (!engine || !motionEnabled.value) {
    encounterOpen.value = true
    return
  }
  engine.beginEncounter(shuffled[0].id, shuffled[1].id)
  if (encounterTimer) window.clearTimeout(encounterTimer)
  // 兜底：即使动画被打断，也要让面板出现
  encounterTimer = window.setTimeout(() => {
    if (encounterPair.value && !encounterOpen.value) encounterOpen.value = true
  }, 2200)
}

function saveEncounterNote() {
  const text = encounterNote.value.trim()
  const pair = encounterPair.value
  if (!text) {
    notify('不用急着得出答案，也可以先让它们待在一起。')
    closeEncounter()
    return
  }
  const first = ideas.value.find((idea) => idea.id === pair?.[0])
  const second = ideas.value.find((idea) => idea.id === pair?.[1])
  const x = first && second ? (first.x + second.x) / 2 : random(30, 80)
  const y = first && second ? (first.y + second.y) / 2 : random(30, 75)
  const idea = addIdea(text, Math.max(18, Math.min(84, x + random(-4, 4))), Math.max(24, Math.min(82, y + random(-4, 4))))
  encounterOpen.value = false
  if (!idea) return
  markBorn(idea.id)
  notify('你的新念头已留下，关联由你自己决定。')
  nextTick(() => {
    syncEngine()
    engine?.spawn(idea.id)
  })
}

function closeEncounter() {
  encounterOpen.value = false
  engine?.cancelEncounter()
  if (encounterTimer) window.clearTimeout(encounterTimer)
  window.setTimeout(() => {
    if (!encounterOpen.value) encounterPair.value = null
  }, 700)
}

// ------------------------------------------------------------------ 视图控制

function toggleMotion() {
  motionEnabled.value = !motionEnabled.value
  notify(motionEnabled.value ? '星云重新流动了。' : '已暂停动态效果。')
}

function resetView() {
  engine?.resetView()
  notify('视角已回到星云中央。')
}

function closeOverlays() {
  if (composerOpen.value) composerOpen.value = false
  if (activeIdea.value) closeIdea()
  if (encounterOpen.value) closeEncounter()
}

function onKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    if (event.key === 'Escape') closeOverlays()
    return
  }
  if (event.key === 'n' || event.key === 'N') {
    event.preventDefault()
    openComposer()
  } else if (event.key === 'Escape') {
    closeOverlays()
  }
}

watch(ideas, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    notify('浏览器暂时无法保存数据，请导出备份或检查存储空间。')
  }
}, { deep: true })

watch(motionEnabled, (value) => {
  engine?.setMotionEnabled(value)
})

onMounted(() => {
  if (canvas.value && shell.value && worldEl.value) {
    engine = new NebulaEngine(canvas.value)
    engine.mount(shell.value, worldEl.value, parallaxEl.value)
    engine.onZoomChange = (zoom) => {
      zoomLabel.value = Math.round(zoom * 100)
    }
    engine.onEncounterArrived = () => {
      if (encounterPair.value) encounterOpen.value = true
    }
    syncEngine()
    engine.setMotionEnabled(motionEnabled.value)
    engine.start()
  }
  // 指针与滚轮需要挂在 window 上：拖拽时指针会移出画布，滚轮也要接管默认滚动
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  shell.value?.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  shell.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onKeydown)
  if (toastTimer) window.clearTimeout(toastTimer)
  if (encounterTimer) window.clearTimeout(encounterTimer)
  bornTimers.forEach((timer) => window.clearTimeout(timer))
  bornTimers.clear()
  engine?.dispose()
  engine = null
})
</script>

<template>
  <main
    ref="shell"
    class="app-shell"
    :class="{ 'motion-paused': !motionEnabled, 'focus-mode': Boolean(activeIdea), 'is-panning': panning }"
    @pointerdown="onPointerDown"
    @pointerleave="onPointerLeave"
  >
    <div class="cosmos-background" aria-hidden="true">
      <div ref="parallaxEl" class="nebula-parallax">
        <div class="nebula-cloud cloud-one"></div>
        <div class="nebula-cloud cloud-two"></div>
        <div class="nebula-cloud cloud-three"></div>
        <div class="nebula-cloud cloud-four"></div>
        <div class="nebula-haze haze-one"></div>
        <div class="nebula-haze haze-two"></div>
      </div>
      <div class="cosmic-vignette"></div>
      <canvas ref="canvas" class="particle-canvas"></canvas>
      <div class="cosmic-grain"></div>
    </div>

    <header class="topbar">
      <a class="brand" href="#top" aria-label="灵感星云首页" @click.prevent="resetView">
        <span class="brand-mark"><span></span><span></span><span></span></span>
        <span class="brand-copy">
          <strong>灵感星云</strong>
          <small>IDEA NEBULA</small>
        </span>
      </a>
      <div class="top-note"><span class="status-dot"></span> 给未完成的想法，一片宇宙</div>
      <div class="top-actions">
        <button class="quiet-button" type="button" @click="showLabels = !showLabels">
          <span class="button-glyph">✧</span>{{ showLabels ? '隐藏标题' : '显示标题' }}
        </button>
        <button class="quiet-button motion-button" type="button" @click="toggleMotion">
          <span class="button-glyph">{{ motionEnabled ? 'Ⅱ' : '▶' }}</span>{{ motionEnabled ? '暂停星云' : '继续流动' }}
        </button>
      </div>
    </header>

    <section class="hero-copy" aria-label="产品介绍">
      <div class="eyebrow"><span></span> A QUIET UNIVERSE FOR IDEAS</div>
      <h1>不急着有答案，<br /><em>让想法先发光。</em></h1>
      <p>有些念头还很微弱。<br />先把它们留下，剩下的交给时间。</p>
      <div class="hero-footnote"><span class="tiny-star">✦</span> 不必归类 · 不必完成 · 只需留下</div>
    </section>

    <div class="orbit-caption caption-a" aria-hidden="true"><span class="caption-line"></span><span>UNFINISHED THOUGHTS</span></div>
    <div class="orbit-caption caption-b" aria-hidden="true"><span>LET IDEAS DRIFT</span><span class="caption-line"></span></div>

    <section ref="worldEl" class="idea-field" aria-label="想法星云">
      <button
        v-for="(idea, index) in ideas"
        :key="idea.id"
        class="idea-node"
        :class="{
          'is-encountering': isInEncounter(idea.id),
          'is-focused': activeIdea?.id === idea.id,
          'is-born': bornIds.includes(idea.id),
          'node-large': index % 4 === 0,
        }"
        :data-idea-id="idea.id"
        :style="{
          left: `${idea.x}%`,
          top: `${idea.y}%`,
          '--node-color': idea.color,
          '--node-delay': `${(index % 7) * -0.8}s`,
        }"
        type="button"
        :aria-label="`打开想法：${idea.text}`"
        @click="openIdea(idea)"
      >
        <span class="node-aura"></span>
        <span class="node-ring ring-one"></span>
        <span class="node-ring ring-two"></span>
        <span class="node-core"></span>
        <span v-if="showLabels" class="node-label">{{ idea.text.length > 19 ? `${idea.text.slice(0, 19)}…` : idea.text }}</span>
      </button>
    </section>

    <div class="side-orbit" aria-hidden="true">
      <span class="side-orbit-ring"></span>
      <span class="side-orbit-dot"></span>
      <span class="side-orbit-label">THOUGHTS IN MOTION</span>
    </div>

    <div class="view-hud">
      <span class="hud-hint">拖拽平移 · 滚轮缩放</span>
      <div class="hud-controls">
        <button class="hud-button" type="button" aria-label="缩小视角" @click="engine?.zoomBy(0.86)">−</button>
        <button class="hud-zoom" type="button" aria-label="重置视角" @click="resetView">{{ zoomLabel }}%</button>
        <button class="hud-button" type="button" aria-label="放大视角" @click="engine?.zoomBy(1.16)">＋</button>
      </div>
    </div>

    <footer class="bottom-bar">
      <div class="bottom-stat">
        <div class="stat-orb"><span></span></div>
        <div><strong>{{ ideaCount }} <span>颗光点</span></strong><small>都还在生长中</small></div>
      </div>
      <div class="bottom-center">
        <button class="capture-button" type="button" @click="openComposer">
          <span class="capture-plus">＋</span>
          <span class="capture-text"><strong>捕捉一闪而过的念头</strong><small>CAPTURE A THOUGHT</small></span>
          <span class="capture-key">N</span>
        </button>
        <button class="encounter-button" type="button" @click="startEncounter"><span>✧</span> 让想法偶遇 <span class="encounter-arrow">↗</span></button>
      </div>
      <div class="bottom-right"><span class="save-indicator"></span><span>仅在此浏览器保存</span><small>YOUR PRIVATE NEBULA</small></div>
    </footer>

    <Transition name="modal-fade">
      <div v-if="composerOpen" class="modal-backdrop" @click.self="composerOpen = false">
        <section class="glass-modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title">
          <button class="modal-close" type="button" aria-label="关闭" @click="composerOpen = false">×</button>
          <div class="modal-kicker"><span class="mini-orb"></span> A NEW LIGHT</div>
          <h2 id="composer-title">留住这一瞬。</h2>
          <p class="modal-desc">不用完整，不用正确。现在想到什么，就留下什么。</p>
          <form @submit.prevent="submitIdea">
            <textarea
              v-model="draftIdea"
              autofocus
              maxlength="500"
              placeholder="一个疑问、一瞬观察，或者尚未成形的念头……"
              rows="4"
            ></textarea>
            <div class="composer-bottom">
              <span>{{ draftIdea.length }} / 500</span>
              <button class="primary-button" type="submit">让它成为光点 <span>↗</span></button>
            </div>
          </form>
          <div class="modal-whisper">✦ 不需要标题，也不需要现在就理解它。</div>
        </section>
      </div>
    </Transition>

    <Transition name="modal-fade">
      <div v-if="activeIdea" class="modal-backdrop" @click.self="closeIdea">
        <section class="glass-modal idea-modal" role="dialog" aria-modal="true" aria-labelledby="idea-modal-title">
          <button class="modal-close" type="button" aria-label="关闭" @click="closeIdea">×</button>
          <div class="modal-kicker">
            <span class="mini-orb" :style="{ background: activeIdea.color, boxShadow: `0 0 18px ${activeIdea.color}` }"></span>
            A THOUGHT IN YOUR NEBULA
          </div>
          <h2 id="idea-modal-title">一颗正在生长的光点</h2>
          <textarea v-if="isEditing" v-model="editText" class="idea-edit-area" maxlength="500" rows="5"></textarea>
          <blockquote v-else class="idea-quote">{{ activeIdea.text }}</blockquote>
          <div class="idea-date">留下于 {{ new Date(activeIdea.createdAt).toLocaleString() }}</div>
          <div class="idea-actions">
            <button class="text-button danger-button" type="button" @click="deleteIdea">让它离开星云</button>
            <div class="action-spacer"></div>
            <button v-if="isEditing" class="quiet-button modal-secondary" type="button" @click="isEditing = false; editText = activeIdea?.text || ''">取消</button>
            <button v-if="isEditing" class="primary-button" type="button" @click="saveIdeaEdit">保存修改</button>
            <button v-else class="primary-button" type="button" @click="isEditing = true">编辑这个念头 <span>✎</span></button>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="modal-fade">
      <div v-if="encounterOpen && encounterIdeas.length === 2" class="modal-backdrop encounter-backdrop" @click.self="closeEncounter">
        <section class="glass-modal encounter-modal" role="dialog" aria-modal="true" aria-labelledby="encounter-title">
          <button class="modal-close" type="button" aria-label="关闭" @click="closeEncounter">×</button>
          <div class="encounter-symbol">✧</div>
          <div class="modal-kicker centered-kicker">A SMALL COLLISION OF THOUGHTS</div>
          <h2 id="encounter-title">两颗光点，偶然相遇。</h2>
          <p class="modal-desc centered-desc">
            我们不替你解释它们的关系。<br />只留一点空间，看看你会想到什么。
          </p>
          <div class="encounter-pair">
            <div class="encounter-thought" :style="{ '--thought-color': encounterIdeas[0].color }">
              <span class="thought-index">01 / A THOUGHT</span>
              <p>{{ encounterIdeas[0].text }}</p>
            </div>
            <div class="collision-mark">✳</div>
            <div class="encounter-thought" :style="{ '--thought-color': encounterIdeas[1].color }">
              <span class="thought-index">02 / ANOTHER THOUGHT</span>
              <p>{{ encounterIdeas[1].text }}</p>
            </div>
          </div>
          <form @submit.prevent="saveEncounterNote">
            <label for="encounter-note">它们碰在一起，让你想到了什么？ <span>（可留空）</span></label>
            <textarea id="encounter-note" v-model="encounterNote" rows="3" maxlength="500" placeholder="不必急着得出结论……"></textarea>
            <div class="encounter-footer">
              <button class="text-button" type="button" @click="closeEncounter">先让它们待在这里</button>
              <button class="primary-button" type="submit">留下我的新念头 <span>↗</span></button>
            </div>
          </form>
          <div class="encounter-disclaimer">这次靠近只是空间的偶然，不代表它们真的相关。</div>
        </section>
      </div>
    </Transition>

    <Transition name="toast-rise">
      <div v-if="toastVisible" class="toast-message"><span>✦</span>{{ toastMessage }}</div>
    </Transition>
  </main>
</template>
