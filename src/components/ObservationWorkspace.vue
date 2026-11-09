<!-- IDEA-BOOM-THEME-CENTER-V2 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  LocalRelationCandidate,
  ObservationAnalysis,
  ObservationRelation,
  ObservationSource,
  ObservationWorkspaceState,
  ProblemTheme,
  RelationStatus,
  ThemeStatus,
} from '../types/observation'
import { analyzeObservationLocally, findLocalRelationCandidates } from '../lib/observation-engine'
import { requestObservationAnalysis } from '../lib/observation-ai'
import {
  addProblemTheme,
  extendProblemTheme,
  loadObservationWorkspace,
  relationId,
  saveObservationWorkspace,
  updateProblemThemeDetails,
  updateProblemThemeStatus,
  updateRelationStatus,
  upsertRelation,
} from '../lib/observation-store'

const props = defineProps<{ ideas: ObservationSource[] }>()
const emit = defineEmits<{
  create: [text: string]
  'relations-change': [relations: Array<{ sourceId: number; targetId: number; type: ObservationRelation['type'] }>]
  'themes-change': [themes: Array<{ id: string; title: string; observationIds: number[]; status: 'observing' | 'exploring' | 'paused' }>]
  'open-theme': [themeId: string]
}>()

const isOpen = ref(false)
const isComposerOpen = ref(false)
const isAnalyzing = ref(false)
const draftText = ref('')
const themeTitle = ref('')
const statusMessage = ref('')
type ThemeActionNoticeKind = 'created' | 'existing' | 'added'
type ThemeActionNotice = {
  themeId: string
  title: string
  kind: ThemeActionNoticeKind
  message: string
}
const themeActionNotice = ref<ThemeActionNotice | null>(null)
const selectedId = ref<number | null>(null)
const activeTab = ref<'observations' | 'themes'>('observations')
const themeSearchQuery = ref('')
const themeStatusFilter = ref<'all' | ThemeStatus>('all')
const editingThemeId = ref<string | null>(null)
const themeTitleDraft = ref('')
const themeDescriptionDraft = ref('')
const workspace = ref<ObservationWorkspaceState>(loadObservationWorkspace())

const orderedIdeas = computed(() => [...props.ideas].sort((a, b) => {
  const timeA = Date.parse(a.createdAt) || 0
  const timeB = Date.parse(b.createdAt) || 0
  return timeB - timeA
}))

watch(orderedIdeas, (items) => {
  if (items.length === 0) {
    selectedId.value = null
    return
  }
  if (!selectedId.value || !items.some((item) => item.id === selectedId.value)) {
    selectedId.value = items[0].id
  }
}, { immediate: true })

const selectedObservation = computed(() =>
  orderedIdeas.value.find((item) => item.id === selectedId.value) ?? null,
)

const selectedAnalysis = computed<ObservationAnalysis | null>(() => {
  if (!selectedId.value) return null
  return workspace.value.analyses[String(selectedId.value)] ?? null
})

const localCandidates = computed(() => {
  if (!selectedObservation.value) return []
  return findLocalRelationCandidates(selectedObservation.value, orderedIdeas.value, 5)
})

function findStoredRelation(aId: number, bId: number): ObservationRelation | undefined {
  const key = relationId(aId, bId)
  return workspace.value.relations.find((item) => relationId(item.sourceId, item.targetId) === key)
}

const relationCards = computed(() => {
  const selected = selectedObservation.value
  if (!selected) return []
  const map = new Map<number, {
    target: ObservationSource
    reason: string
    sharedTerms: string[]
    type: ObservationRelation['type']
    status: RelationStatus
    engine: 'llm' | 'local-rules'
    relation: ObservationRelation | null
  }>()

  for (const candidate of localCandidates.value) {
    const target = orderedIdeas.value.find((item) => item.id === candidate.targetId)
    if (!target) continue
    const stored = findStoredRelation(selected.id, target.id)
    if (stored?.status === 'rejected') continue
    // 兼容第一批旧数据：无法归类的“其他联系”不再作为待判断建议展示。
    if (stored?.status === 'suggested' && stored.type === 'other') continue
    map.set(target.id, {
      target,
      reason: stored?.reason || candidate.reason,
      sharedTerms: stored?.sharedTerms.length ? stored.sharedTerms : candidate.sharedTerms,
      type: stored?.type ?? candidate.type,
      status: stored?.status ?? 'suggested',
      engine: stored?.engine ?? 'local-rules',
      relation: stored ?? null,
    })
  }

  for (const stored of workspace.value.relations) {
    if (stored.sourceId !== selected.id && stored.targetId !== selected.id) continue
    const targetId = stored.sourceId === selected.id ? stored.targetId : stored.sourceId
    if (stored.status === 'rejected') {
      map.delete(targetId)
      continue
    }
    if (stored.status === 'suggested' && stored.type === 'other') {
      map.delete(targetId)
      continue
    }
    const target = orderedIdeas.value.find((item) => item.id === targetId)
    if (!target) continue
    map.set(targetId, {
      target,
      reason: stored.reason,
      sharedTerms: stored.sharedTerms,
      type: stored.type,
      status: stored.status,
      engine: stored.engine,
      relation: stored,
    })
  }

  return [...map.values()].sort((a, b) => {
    const rank = { confirmed: 3, suggested: 2, rejected: 1 }
    return rank[b.status] - rank[a.status]
  })
})

const confirmedRelatedIds = computed(() => {
  if (!selectedId.value) return []
  return workspace.value.relations
    .filter((item) => item.status === 'confirmed' && (item.sourceId === selectedId.value || item.targetId === selectedId.value))
    .map((item) => item.sourceId === selectedId.value ? item.targetId : item.sourceId)
    .filter((id) => orderedIdeas.value.some((item) => item.id === id))
})

const themeCounts = computed(() => ({
  all: workspace.value.themes.length,
  observing: workspace.value.themes.filter((theme) => theme.status === 'observing').length,
  exploring: workspace.value.themes.filter((theme) => theme.status === 'exploring').length,
  paused: workspace.value.themes.filter((theme) => theme.status === 'paused').length,
}))

// 主题中心展示全部主题，不再依附于当前选中的观察，也不再截断数量。
const visibleThemes = computed(() => {
  const query = themeSearchQuery.value.trim().toLocaleLowerCase()
  return [...workspace.value.themes]
    .filter((theme) => themeStatusFilter.value === 'all' || theme.status === themeStatusFilter.value)
    .filter((theme) => !query || `${theme.title} ${theme.description}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
})

function openThemeSpace(themeId: string): void {
  emit('open-theme', themeId)
}

function showThemeActionNotice(
  theme: ProblemTheme,
  kind: ThemeActionNoticeKind,
  message: string,
): void {
  themeActionNotice.value = {
    themeId: theme.id,
    title: theme.title,
    kind,
    message,
  }
}

function goToThemeCenterFromNotice(): void {
  const notice = themeActionNotice.value
  if (!notice) return
  const theme = workspace.value.themes.find((item) => item.id === notice.themeId)
  if (!theme) {
    themeActionNotice.value = null
    statusMessage.value = '这个主题当前已不存在，请在主题中心重新查找。'
    return
  }
  activeTab.value = 'themes'
  themeStatusFilter.value = 'all'
  themeSearchQuery.value = theme.title
  statusMessage.value = `已在主题中心定位到「${theme.title}」。`
  themeActionNotice.value = null
}

function openNoticedThemeSpace(): void {
  const notice = themeActionNotice.value
  if (!notice) return
  openThemeSpace(notice.themeId)
}

function dismissThemeActionNotice(): void {
  themeActionNotice.value = null
}

function startEditTheme(theme: ProblemTheme): void {
  editingThemeId.value = theme.id
  themeTitleDraft.value = theme.title
  themeDescriptionDraft.value = theme.description
}

function cancelEditTheme(): void {
  editingThemeId.value = null
  themeTitleDraft.value = ''
  themeDescriptionDraft.value = ''
}

function saveThemeFromCenter(themeId: string): void {
  const title = themeTitleDraft.value.trim()
  if (!title) {
    statusMessage.value = '主题名称不能为空。'
    return
  }
  const next = updateProblemThemeDetails(workspace.value, themeId, {
    title,
    description: themeDescriptionDraft.value.trim(),
  })
  if (next === workspace.value) {
    statusMessage.value = '主题信息没有发生变化。'
    cancelEditTheme()
    return
  }
  workspace.value = next
  persist()
  cancelEditTheme()
  statusMessage.value = '主题标题和描述已更新。'
}

function themeMemberCount(theme: ProblemTheme): number {
  return theme.observationIds.filter((id) => orderedIdeas.value.some((idea) => idea.id === id)).length
}

function themeConfirmedRelationCount(theme: ProblemTheme): number {
  const ids = new Set(theme.observationIds)
  return workspace.value.relations.filter((relation) =>
    relation.status === 'confirmed' && ids.has(relation.sourceId) && ids.has(relation.targetId),
  ).length
}

function themeUpdatedLabel(theme: ProblemTheme): string {
  return `更新于 ${displayDate(theme.updatedAt)}`
}

// 当前选中的观察如果与某个主题成员存在已确认关系，才提供主题回响建议。
const themeEchoSuggestions = computed(() => {
  const selected = selectedObservation.value
  if (!selected) return []

  const suggestions: Array<{ theme: ProblemTheme; relation: ObservationRelation; linkedObservation: ObservationSource }> = []
  for (const theme of workspace.value.themes) {
    if (theme.observationIds.includes(selected.id)) continue

    const relation = workspace.value.relations.find((item) => {
      if (item.status !== 'confirmed') return false
      return (
        (item.sourceId === selected.id && theme.observationIds.includes(item.targetId)) ||
        (item.targetId === selected.id && theme.observationIds.includes(item.sourceId))
      )
    })
    if (!relation) continue

    const linkedId = relation.sourceId === selected.id ? relation.targetId : relation.sourceId
    const linkedObservation = orderedIdeas.value.find((item) => item.id === linkedId)
    if (!linkedObservation) continue

    suggestions.push({ theme, relation, linkedObservation })
  }
  return suggestions
})

// 把工作台已确认的关系同步给父级；建议态和已否定关系不会进入画布。
const confirmedRelationsForCanvas = computed(() =>
  workspace.value.relations
    .filter((item) => item.status === 'confirmed')
    .map((item) => ({ sourceId: item.sourceId, targetId: item.targetId, type: item.type })),
)
watch(confirmedRelationsForCanvas, (relations) => {
  emit('relations-change', relations)
}, { immediate: true })

// 主题由用户在工作台中明确创建；只把主题成员和状态同步给星云引擎。
const themesForCanvas = computed(() => workspace.value.themes.map((theme) => ({
  id: theme.id,
  title: theme.title,
  observationIds: [...theme.observationIds],
  status: theme.status,
})))
watch(themesForCanvas, (themes) => {
  emit('themes-change', themes)
}, { immediate: true })

function persist(): void {
  saveObservationWorkspace(workspace.value)
}

function submitObservation(): void {
  const text = draftText.value.trim()
  if (!text) {
    statusMessage.value = '先写下一件你注意到的事情。'
    return
  }
  emit('create', text)
  draftText.value = ''
  isComposerOpen.value = false
  statusMessage.value = '观察已收入星云。你可以稍后再理解它。'
}

function applyLocalAnalysis(message?: string): void {
  const selected = selectedObservation.value
  if (!selected) return
  const analysis = analyzeObservationLocally(selected)
  workspace.value.analyses[String(selected.id)] = analysis

  for (const candidate of localCandidates.value) {
    const target = orderedIdeas.value.find((item) => item.id === candidate.targetId)
    if (!target) continue
    const now = new Date().toISOString()
    const relation: ObservationRelation = {
      id: relationId(selected.id, target.id),
      sourceId: selected.id,
      targetId: target.id,
      type: candidate.type,
      reason: candidate.reason,
      evidenceFromSource: selected.text.slice(0, 100),
      evidenceFromTarget: target.text.slice(0, 100),
      sharedTerms: candidate.sharedTerms,
      status: 'suggested',
      engine: 'local-rules',
      createdAt: now,
      updatedAt: now,
    }
    workspace.value = upsertRelation(workspace.value, relation)
  }

  persist()
  statusMessage.value = message || '已完成本地初步整理。它不是大模型判断，也不代表问题已经成立。'
}

async function analyzeSelected(): Promise<void> {
  const selected = selectedObservation.value
  if (!selected || isAnalyzing.value) return
  isAnalyzing.value = true
  statusMessage.value = '正在理解这条观察……'

  const candidates = orderedIdeas.value
    .filter((item) => item.id !== selected.id)
    .slice(0, 20)

  try {
    const result = await requestObservationAnalysis({ observation: selected, candidates })
    const analysis: ObservationAnalysis = {
      observationId: selected.id,
      generatedAt: new Date().toISOString(),
      engine: 'llm',
      ...result.analysis,
    }
    workspace.value.analyses[String(selected.id)] = analysis

    const now = new Date().toISOString()
    for (const item of result.relations) {
      const target = candidates.find((candidate) => candidate.id === item.targetId)
      if (!target) continue
      const relation: ObservationRelation = {
        id: relationId(selected.id, target.id),
        sourceId: selected.id,
        targetId: target.id,
        type: item.type,
        reason: item.reason,
        evidenceFromSource: item.evidenceFromSource,
        evidenceFromTarget: item.evidenceFromTarget,
        sharedTerms: item.sharedTerms,
        status: 'suggested',
        engine: 'llm',
        createdAt: now,
        updatedAt: now,
      }
      workspace.value = upsertRelation(workspace.value, relation)
    }
    persist()
    statusMessage.value = result.relations.length
      ? `分析完成，找到 ${result.relations.length} 条待你判断的关联线索。`
      : '分析完成。目前没有足够依据推荐历史关联，这也是正常结果。'
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'AI 服务暂时不可用。'
    applyLocalAnalysis(`大模型暂不可用：${reason} 已使用本地规则提供基础线索；这些结果不是 AI 结论。`)
  } finally {
    isAnalyzing.value = false
  }
}

function changeRelationStatus(target: ObservationSource, status: RelationStatus): void {
  const selected = selectedObservation.value
  if (!selected) return
  const existing = findStoredRelation(selected.id, target.id)
  if (!existing) {
    const local = localCandidates.value.find((item) => item.targetId === target.id)
    if (!local) return
    const now = new Date().toISOString()
    const relation: ObservationRelation = {
      id: relationId(selected.id, target.id),
      sourceId: selected.id,
      targetId: target.id,
      type: local.type,
      reason: local.reason,
      evidenceFromSource: selected.text.slice(0, 100),
      evidenceFromTarget: target.text.slice(0, 100),
      sharedTerms: local.sharedTerms,
      status,
      engine: 'local-rules',
      createdAt: now,
      updatedAt: now,
    }
    workspace.value = upsertRelation(workspace.value, relation)
  }
  workspace.value = updateRelationStatus(workspace.value, selected.id, target.id, status)
  persist()
  statusMessage.value = status === 'confirmed' ? '已确认这两条记录存在联系。' : '已记录你的判断，后续不再推荐这组关联。'
}

function createTheme(): void {
  const selected = selectedObservation.value
  const title = themeTitle.value.trim()
  const observationIds = selected ? [selected.id, ...confirmedRelatedIds.value] : []
  if (!title) {
    statusMessage.value = '请先给这个问题主题起一个名称。'
    return
  }
  if (observationIds.length < 2) {
    statusMessage.value = '至少需要两条已确认关联的观察，才能整理成主题。'
    return
  }
  const previousState = workspace.value
  const nextState = addProblemTheme(workspace.value, {
    title,
    description: '由用户确认关联的观察记录组成。主题描述仍需继续补充，不代表已经验证为普遍问题。',
    observationIds,
  })
  const memberKey = [...new Set(observationIds)].sort((a, b) => a - b).join(':')
  const matchingTheme = nextState.themes.find((theme) =>
    [...new Set(theme.observationIds)].sort((a, b) => a - b).join(':') === memberKey,
  )
  if (nextState === previousState) {
    if (matchingTheme) {
      showThemeActionNotice(
        matchingTheme,
        'existing',
        `这组观察已经归入主题「${matchingTheme.title}」，无需重复创建。你可以直接进入主题空间继续整理。`,
      )
      statusMessage.value = `已找到已有主题「${matchingTheme.title}」。`
    } else {
      statusMessage.value = '这组观察已经整理过主题。请到主题中心查看已有主题。'
    }
    return
  }
  workspace.value = nextState
  persist()
  themeTitle.value = ''
  const createdTheme = matchingTheme ?? nextState.themes[0]
  if (createdTheme) {
    showThemeActionNotice(
      createdTheme,
      'created',
      `主题「${createdTheme.title}」已创建，并已保存到主题中心。之后可以继续补充观察、修改描述和调整状态。`,
    )
    statusMessage.value = `主题「${createdTheme.title}」已创建，可在主题中心查看。`
  } else {
    statusMessage.value = '问题主题已创建。它仍处于持续观察阶段。'
  }
}

function addSelectedObservationToTheme(themeId: string): void {
  const selected = selectedObservation.value
  if (!selected) return
  const nextState = extendProblemTheme(
    workspace.value,
    themeId,
    selected.id,
    workspace.value.relations,
    selected.text,
  )
  if (nextState === workspace.value) {
    statusMessage.value = '暂时无法加入：需要先确认这条观察与主题成员之间的关联。'
    return
  }
  workspace.value = nextState
  persist()
  const updatedTheme = workspace.value.themes.find((theme) => theme.id === themeId)
  if (updatedTheme) {
    showThemeActionNotice(
      updatedTheme,
      'added',
      `当前观察已加入主题「${updatedTheme.title}」。这个主题现在包含 ${updatedTheme.observationIds.length} 条观察，可以继续在主题中心查看和管理。`,
    )
    statusMessage.value = `观察已加入主题「${updatedTheme.title}」。`
  } else {
    statusMessage.value = '新观察已加入主题，主题星群已更新。'
  }
}

function changeThemeStatus(themeId: string, status: ThemeStatus): void {
  const nextState = updateProblemThemeStatus(workspace.value, themeId, status)
  if (nextState === workspace.value) return
  workspace.value = nextState
  persist()
  statusMessage.value = `主题状态已更新为「${themeStatusLabel(status)}」。`
}

function themeStatusLabel(status: ThemeStatus): string {
  const labels: Record<ThemeStatus, string> = {
    observing: '持续观察',
    exploring: '探索中',
    paused: '暂时搁置',
  }
  return labels[status]
}

function themeEventLabel(type: ProblemTheme['events'][number]['type']): string {
  const labels: Record<ProblemTheme['events'][number]['type'], string> = {
    created: '主题创建',
    'observation-added': '新增观察',
    'status-changed': '状态变化',
    'duplicate-merged': '重复主题整理',
    'details-updated': '主题信息调整',
  }
  return labels[type]
}

function selectObservation(id: number): void {
  selectedId.value = id
  themeActionNotice.value = null
  statusMessage.value = ''
}

function displayDate(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString() : '时间未知'
}

function truncate(value: string, max = 54): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function relationTypeLabel(type: ObservationRelation['type'] | LocalRelationCandidate['type']): string {
  const labels: Record<ObservationRelation['type'], string> = {
    'same-scene': '相似场景',
    'shared-friction': '共同阻碍',
    'cross-scene': '跨场景线索',
    'possible-contradiction': '可能存在矛盾',
    other: '其他联系',
  }
  return labels[type]
}
</script>

<template>
  <button
    class="obw-launcher"
    type="button"
    :aria-expanded="isOpen"
    aria-label="打开观察工作台"
    @click="isOpen = true"
  >
    <span class="obw-launcher-icon">✧</span>
    <span>观察工作台</span>
    <span class="obw-launcher-count">{{ ideas.length }}</span>
  </button>

  <Teleport to="body">
    <Transition name="obw-fade">
      <div v-if="isOpen" class="obw-backdrop" @click.self="isOpen = false">
        <section class="obw-panel" role="dialog" aria-modal="true" aria-label="灵感星云观察工作台" @pointerdown.stop>
          <header class="obw-header">
            <div class="obw-brand">
              <span class="obw-brand-mark">✧</span>
              <div>
                <div class="obw-eyebrow">IDEABOOM / OBSERVATION SPACE</div>
                <h2>观察工作台</h2>
                <p>把日常观察，连成新的发现。</p>
              </div>
            </div>
            <div class="obw-header-actions">
              <button class="obw-secondary-button" type="button" @click="isComposerOpen = !isComposerOpen">
                <span>＋</span> 记录观察
              </button>
              <button class="obw-close" type="button" aria-label="关闭观察工作台" @click="isOpen = false">×</button>
            </div>
          </header>

          <nav class="obw-main-tabs" aria-label="工作台视图切换">
            <button
              type="button"
              class="obw-main-tab"
              :class="{ active: activeTab === 'observations' }"
              :aria-selected="activeTab === 'observations'"
              @click="activeTab = 'observations'"
            >
              <span class="obw-main-tab-icon">✧</span>
              观察库
              <span class="obw-main-tab-count">{{ orderedIdeas.length }}</span>
            </button>
            <button
              type="button"
              class="obw-main-tab"
              :class="{ active: activeTab === 'themes' }"
              :aria-selected="activeTab === 'themes'"
              @click="activeTab = 'themes'"
            >
              <span class="obw-main-tab-icon">◉</span>
              主题中心
              <span class="obw-main-tab-count">{{ workspace.themes.length }}</span>
            </button>
          </nav>

          <section v-if="isComposerOpen" class="obw-capture">
            <div class="obw-capture-copy">
              <strong>捕捉一个刚刚注意到的瞬间</strong>
              <span>不必先判断它有没有价值，先保留原始观察。</span>
            </div>
            <textarea
              v-model="draftText"
              maxlength="500"
              rows="3"
              placeholder="例如：学校活动通知散落在不同群里，每次都要找半天……"
              @keydown.ctrl.enter.prevent="submitObservation"
            ></textarea>
            <div class="obw-capture-footer">
              <span>{{ draftText.length }} / 500 · Ctrl + Enter 保存</span>
              <button class="obw-primary-button" type="button" :disabled="!draftText.trim()" @click="submitObservation">保存到星云 <span>↗</span></button>
            </div>
          </section>

          <div v-if="activeTab === 'observations'" class="obw-body">
            <aside class="obw-list-column">
              <div class="obw-section-heading">
                <div>
                  <span class="obw-overline">YOUR COLLECTION</span>
                  <h3>观察与想法</h3>
                </div>
                <span class="obw-count">{{ orderedIdeas.length }}</span>
              </div>
              <div v-if="orderedIdeas.length" class="obw-observation-list">
                <button
                  v-for="item in orderedIdeas"
                  :key="item.id"
                  class="obw-observation-item"
                  :class="{ active: selectedId === item.id }"
                  type="button"
                  @click="selectObservation(item.id)"
                >
                  <span class="obw-item-orb" :style="{ '--item-color': item.color || '#a89bff' }"></span>
                  <span class="obw-item-content">
                    <span class="obw-item-text">{{ truncate(item.text, 72) }}</span>
                    <span class="obw-item-date">{{ displayDate(item.createdAt) }}</span>
                  </span>
                  <span class="obw-item-arrow">›</span>
                </button>
              </div>
              <div v-else class="obw-empty-list">
                <span class="obw-empty-star">✧</span>
                <strong>星云还很安静</strong>
                <span>记录第一条观察，让探索从这里开始。</span>
                <button class="obw-primary-button" type="button" @click="isComposerOpen = true">记录第一条观察</button>
              </div>
              <div class="obw-list-footnote">原始记录保存在当前浏览器，不会被 AI 自动改写。</div>
            </aside>

            <main class="obw-detail-column">
              <template v-if="selectedObservation">
                <div class="obw-detail-topline">
                  <span class="obw-overline">OBSERVATION DETAIL</span>
                  <span class="obw-date">记录于 {{ displayDate(selectedObservation.createdAt) }}</span>
                </div>

                <section class="obw-original-card">
                  <div class="obw-card-label"><span class="obw-card-dot"></span> 原始观察</div>
                  <p>{{ selectedObservation.text }}</p>
                  <div class="obw-original-note">这段内容来自你的原始记录，AI 分析只作为独立参考。</div>
                </section>

                <section class="obw-analysis-section">
                  <div class="obw-section-heading obw-analysis-heading">
                    <div>
                      <span class="obw-overline">AI UNDERSTANDING</span>
                      <h3>观察理解</h3>
                    </div>
                    <button class="obw-primary-button" type="button" :disabled="isAnalyzing" @click="analyzeSelected">
                      <span v-if="isAnalyzing" class="obw-spinner"></span>
                      {{ isAnalyzing ? '正在分析…' : '✦ 理解这条观察' }}
                    </button>
                  </div>

                  <div v-if="selectedAnalysis" class="obw-analysis-card">
                    <div class="obw-analysis-badge" :class="selectedAnalysis.engine === 'llm' ? 'llm' : 'local'">
                      {{ selectedAnalysis.engine === 'llm' ? '大模型分析' : '本地规则初筛' }}
                    </div>
                    <p class="obw-analysis-summary">{{ selectedAnalysis.summary }}</p>
                    <div class="obw-analysis-grid">
                      <div><span>发生场景</span><strong>{{ selectedAnalysis.scene }}</strong></div>
                      <div><span>现象描述</span><strong>{{ selectedAnalysis.phenomenon }}</strong></div>
                      <div><span>体验阻碍</span><strong>{{ selectedAnalysis.friction }}</strong></div>
                      <div><span>涉及人群</span><strong>{{ selectedAnalysis.affectedPeople }}</strong></div>
                      <div><span>当前替代方式</span><strong>{{ selectedAnalysis.currentWorkaround }}</strong></div>
                      <div><span>潜在问题</span><strong>{{ selectedAnalysis.potentialProblem }}</strong></div>
                    </div>
                    <div class="obw-question-box">
                      <span>可以继续思考</span>
                      <strong>{{ selectedAnalysis.questionToExplore }}</strong>
                    </div>
                    <div v-if="selectedAnalysis.keywords.length" class="obw-keywords">
                      <span v-for="keyword in selectedAnalysis.keywords" :key="keyword">{{ keyword }}</span>
                    </div>
                    <div v-if="selectedAnalysis.unknowns.length" class="obw-unknowns">
                      <strong>目前还不能确定</strong>
                      <ul><li v-for="item in selectedAnalysis.unknowns" :key="item">{{ item }}</li></ul>
                    </div>
                  </div>
                  <div v-else class="obw-analysis-placeholder">
                    <span class="obw-placeholder-orbit">✧</span>
                    <strong>先理解这条观察，再决定是否寻找联系。</strong>
                    <span>点击上方按钮。若模型服务尚未配置，会暂时使用本地规则给出基础线索。</span>
                  </div>
                  <p class="obw-privacy-note">点击大模型分析时，当前记录和最多 20 条近期历史记录会发送到你配置的模型服务。未点击前不会发送。</p>
                </section>

                <section class="obw-relations-section">
                  <div class="obw-section-heading">
                    <div>
                      <span class="obw-overline">POSSIBLE CONNECTIONS</span>
                      <h3>可能有关联的观察</h3>
                    </div>
                    <span class="obw-count">{{ relationCards.length }}</span>
                  </div>
                  <div v-if="relationCards.length" class="obw-relation-list">
                    <article v-for="item in relationCards" :key="item.target.id" class="obw-relation-card">
                      <div class="obw-relation-meta">
                        <span>{{ relationTypeLabel(item.type) }}</span>
                        <span :class="['obw-status', item.status]">{{ item.status === 'confirmed' ? '已确认' : '待判断' }}</span>
                      </div>
                      <p class="obw-relation-text">{{ item.target.text }}</p>
                      <p class="obw-relation-reason">{{ item.reason }}</p>
                      <div v-if="item.relation?.evidenceFromSource || item.relation?.evidenceFromTarget" class="obw-relation-evidence">
                        <div v-if="item.relation?.evidenceFromSource"><span>当前观察</span><q>{{ item.relation.evidenceFromSource }}</q></div>
                        <div v-if="item.relation?.evidenceFromTarget"><span>历史观察</span><q>{{ item.relation.evidenceFromTarget }}</q></div>
                      </div>
                      <div v-if="item.sharedTerms.length" class="obw-shared-terms">
                        <span v-for="term in item.sharedTerms.slice(0, 5)" :key="term">{{ term }}</span>
                      </div>
                      <div v-if="item.status !== 'confirmed'" class="obw-relation-actions">
                        <button type="button" class="obw-text-button" @click="changeRelationStatus(item.target, 'rejected')">不相关</button>
                        <button type="button" class="obw-confirm-button" @click="changeRelationStatus(item.target, 'confirmed')">确认关联</button>
                      </div>
                      <div v-else class="obw-confirmed-note">这条联系已由你确认。</div>
                    </article>
                  </div>
                  <div v-else class="obw-no-relations">
                    <span>✧</span>
                    <strong>暂时没有足够依据建立关联</strong>
                    <p>这很正常。星云不需要让每条观察都发生碰撞。</p>
                  </div>
                </section>

                <section v-if="confirmedRelatedIds.length" class="obw-theme-create">
                  <div>
                    <span class="obw-overline">TURN CONNECTIONS INTO A THEME</span>
                    <h3>整理成一个问题主题</h3>
                    <p>将当前观察与已确认关联的记录放在一起。主题仍是待探索线索，不代表问题已被外部验证。</p>
                  </div>
                  <div class="obw-theme-form">
                    <input v-model="themeTitle" maxlength="48" placeholder="例如：校园活动信息触达问题" />
                    <button class="obw-primary-button" type="button" @click="createTheme">创建主题</button>
                  </div>
                </section>

                <Transition name="obw-theme-notice">
                  <section v-if="themeActionNotice" class="obw-theme-action-notice" aria-live="polite">
                    <div class="obw-theme-notice-icon" aria-hidden="true">✦</div>
                    <div class="obw-theme-notice-copy">
                      <span class="obw-theme-notice-kicker">
                        {{ themeActionNotice.kind === 'created' ? 'THEME CREATED' : themeActionNotice.kind === 'added' ? 'OBSERVATION ADDED' : 'EXISTING THEME FOUND' }}
                      </span>
                      <strong>{{ themeActionNotice.title }}</strong>
                      <p>{{ themeActionNotice.message }}</p>
                      <small>主题已保存在「主题中心」，以后可以从工作台顶部的主题中心入口找到它。</small>
                    </div>
                    <div class="obw-theme-notice-actions">
                      <button type="button" class="obw-theme-notice-primary" @click="goToThemeCenterFromNotice">在主题中心查看</button>
                      <button type="button" class="obw-theme-notice-secondary" @click="openNoticedThemeSpace">打开主题空间 <span>↗</span></button>
                    </div>
                    <button type="button" class="obw-theme-notice-dismiss" aria-label="关闭提示" @click="dismissThemeActionNotice">×</button>
                  </section>
                </Transition>

                <section v-if="themeEchoSuggestions.length" class="obw-theme-echoes">
                  <div class="obw-section-heading">
                    <div>
                      <span class="obw-overline">THEME ECHOES</span>
                      <h3>这条观察可能延续已有主题</h3>
                    </div>
                    <span class="obw-count">{{ themeEchoSuggestions.length }}</span>
                  </div>
                  <article v-for="suggestion in themeEchoSuggestions" :key="suggestion.theme.id" class="obw-theme-echo-card">
                    <div class="obw-theme-echo-heading">
                      <strong>{{ suggestion.theme.title }}</strong>
                      <span>{{ suggestion.theme.observationIds.length }} 条已有观察</span>
                    </div>
                    <p>{{ suggestion.relation.reason }}</p>
                    <div class="obw-theme-echo-evidence">
                      <span>已确认关联的主题成员</span>
                      <q>{{ truncate(suggestion.linkedObservation.text, 100) }}</q>
                    </div>
                    <button class="obw-confirm-button" type="button" @click="addSelectedObservationToTheme(suggestion.theme.id)">
                      ＋ 将当前观察加入主题
                    </button>
                  </article>
                  <p class="obw-privacy-note">只有与主题成员存在已确认关系的观察才会出现这里；加入主题仍由你决定。</p>
                </section>
              </template>
              <div v-else class="obw-no-selection">
                <span class="obw-empty-star">✧</span>
                <h3>先留下一条观察</h3>
                <p>你不需要提前判断它有没有价值。先记录，之后再慢慢理解。</p>
                <button class="obw-primary-button" type="button" @click="isComposerOpen = true">记录观察</button>
              </div>
            </main>
          </div>

          <section v-else class="obw-theme-center">
            <div class="obw-theme-center-heading">
              <div>
                <span class="obw-overline">YOUR PROBLEM THEMES</span>
                <h3>主题中心</h3>
                <p>把多次观察中逐渐显现的问题集中起来，持续管理和探索。</p>
              </div>
              <button type="button" class="obw-secondary-button" @click="activeTab = 'observations'; statusMessage = '选择一条观察，并确认它与其他观察的联系后，可以整理成新主题。'">
                <span>＋</span> 从观察创建主题
              </button>
            </div>

            <div class="obw-theme-toolbar">
              <label class="obw-theme-search">
                <span aria-hidden="true">⌕</span>
                <input v-model="themeSearchQuery" type="search" placeholder="搜索主题名称或描述…" aria-label="搜索主题" />
              </label>
              <div class="obw-theme-filters" role="group" aria-label="按主题状态筛选">
                <button type="button" :class="{ active: themeStatusFilter === 'all' }" @click="themeStatusFilter = 'all'">全部 <b>{{ themeCounts.all }}</b></button>
                <button type="button" :class="{ active: themeStatusFilter === 'observing' }" @click="themeStatusFilter = 'observing'">持续观察 <b>{{ themeCounts.observing }}</b></button>
                <button type="button" :class="{ active: themeStatusFilter === 'exploring' }" @click="themeStatusFilter = 'exploring'">探索中 <b>{{ themeCounts.exploring }}</b></button>
                <button type="button" :class="{ active: themeStatusFilter === 'paused' }" @click="themeStatusFilter = 'paused'">暂时搁置 <b>{{ themeCounts.paused }}</b></button>
              </div>
            </div>

            <div v-if="visibleThemes.length" class="obw-theme-grid">
              <article v-for="theme in visibleThemes" :key="theme.id" class="obw-theme-center-card">
                <div class="obw-theme-card-topline">
                  <span class="obw-theme-card-kicker">PROBLEM THEME</span>
                  <span class="obw-theme-status-pill" :class="`status-${theme.status}`">{{ themeStatusLabel(theme.status) }}</span>
                </div>

                <template v-if="editingThemeId === theme.id">
                  <form class="obw-theme-edit-form" @submit.prevent="saveThemeFromCenter(theme.id)">
                    <label>
                      主题名称
                      <input v-model="themeTitleDraft" maxlength="48" autofocus placeholder="为这个主题起一个清晰的名称" />
                    </label>
                    <label>
                      主题描述
                      <textarea v-model="themeDescriptionDraft" rows="3" maxlength="240" placeholder="描述这个主题持续关注的现象、问题边界或目前的理解…" />
                    </label>
                    <div class="obw-theme-edit-actions">
                      <button type="button" class="obw-quiet-action" @click="cancelEditTheme">取消</button>
                      <button type="submit" class="obw-primary-button">保存主题信息</button>
                    </div>
                  </form>
                </template>
                <template v-else>
                  <h4>{{ theme.title }}</h4>
                  <p class="obw-theme-card-description">{{ theme.description || '还没有补充描述。编辑主题，记录你目前对这个问题的理解。' }}</p>
                  <div class="obw-theme-metrics">
                    <span><strong>{{ themeMemberCount(theme) }}</strong> 条观察</span>
                    <span><strong>{{ themeConfirmedRelationCount(theme) }}</strong> 条确认关系</span>
                    <span>{{ themeUpdatedLabel(theme) }}</span>
                  </div>
                  <div v-if="theme.events?.length" class="obw-theme-last-event">
                    <span>{{ themeEventLabel(theme.events[theme.events.length - 1].type) }}</span>
                    <p>{{ theme.events[theme.events.length - 1].message }}</p>
                  </div>
                  <div class="obw-theme-card-actions">
                    <button type="button" class="obw-theme-open-button" @click="openThemeSpace(theme.id)">进入主题空间 <span>↗</span></button>
                    <button type="button" class="obw-theme-edit-button" @click="startEditTheme(theme)">编辑名称与描述</button>
                  </div>
                  <div class="obw-theme-card-status-actions" aria-label="快速调整主题状态">
                    <button type="button" :class="{ active: theme.status === 'observing' }" @click="changeThemeStatus(theme.id, 'observing')">持续观察</button>
                    <button type="button" :class="{ active: theme.status === 'exploring' }" @click="changeThemeStatus(theme.id, 'exploring')">探索中</button>
                    <button type="button" :class="{ active: theme.status === 'paused' }" @click="changeThemeStatus(theme.id, 'paused')">暂时搁置</button>
                  </div>
                </template>
              </article>
            </div>
            <div v-else class="obw-theme-empty-state">
              <span class="obw-empty-star">✧</span>
              <h4>{{ workspace.themes.length ? '没有找到匹配的主题' : '还没有整理出问题主题' }}</h4>
              <p>{{ workspace.themes.length ? '试试其他关键词或切换筛选条件。' : '当你确认两条或更多观察之间存在联系后，可以把它们整理成一个长期关注的主题。' }}</p>
              <button v-if="!workspace.themes.length" type="button" class="obw-primary-button" @click="activeTab = 'observations'">前往观察库</button>
              <button v-else type="button" class="obw-quiet-action" @click="themeSearchQuery = ''; themeStatusFilter = 'all'">清除筛选</button>
            </div>
          </section>

          <footer class="obw-footer">
            <div class="obw-status-message" aria-live="polite">{{ statusMessage || (activeTab === 'themes' ? '主题是从观察中整理出的长期问题线索，仍可持续修订。' : 'AI 的分析是线索，不是事实；观察之间的联系由你确认。') }}</div>
            <div class="obw-footer-right">
              <span>本地记录 {{ orderedIdeas.length }} 条</span>
              <span>全部主题 {{ workspace.themes.length }} 个</span>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.obw-launcher {
  position: fixed;
  z-index: 5000;
  top: 76px;
  right: clamp(16px, 3vw, 38px);
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 10px 15px;
  border: 1px solid rgba(175, 161, 255, 0.28);
  border-radius: 999px;
  color: rgba(244, 242, 255, 0.92);
  background: rgba(12, 16, 39, 0.78);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.26), inset 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.03em;
  transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
}
.obw-launcher:hover { transform: translateY(-2px); border-color: rgba(181, 164, 255, 0.62); background: rgba(30, 29, 68, 0.9); }
.obw-launcher-icon { color: #c6b8ff; font-size: 17px; text-shadow: 0 0 13px rgba(177, 147, 255, 0.85); }
.obw-launcher-count { min-width: 19px; padding: 2px 6px; border-radius: 999px; color: #d7d2ff; background: rgba(160, 143, 255, 0.16); font-size: 10px; text-align: center; }
.obw-backdrop { position: fixed; z-index: 6000; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(2, 4, 14, 0.76); backdrop-filter: blur(12px); }
.obw-panel {
  display: flex;
  flex-direction: column;
  width: min(1320px, 100%);
  height: min(900px, 100%);
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(184, 173, 255, 0.22);
  border-radius: 24px;
  color: #f3f1ff;
  background: radial-gradient(ellipse at 84% 0%, rgba(64, 57, 129, 0.28), transparent 38%), linear-gradient(145deg, rgba(10, 13, 33, 0.985), rgba(5, 8, 22, 0.99));
  box-shadow: 0 35px 120px rgba(0, 0, 0, 0.62), inset 0 1px rgba(255, 255, 255, 0.07);
}
.obw-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 23px 28px 20px; border-bottom: 1px solid rgba(194, 185, 255, 0.11); }
.obw-brand { display: flex; align-items: center; gap: 15px; }
.obw-brand-mark { display: grid; width: 43px; height: 43px; place-items: center; border: 1px solid rgba(182, 165, 255, 0.28); border-radius: 14px; color: #c7b9ff; background: radial-gradient(circle, rgba(156, 126, 255, 0.24), rgba(97, 95, 181, 0.08)); box-shadow: 0 0 28px rgba(145, 117, 255, 0.13); font-size: 22px; }
.obw-eyebrow, .obw-overline { color: rgba(173, 177, 222, 0.52); font-size: 9px; letter-spacing: 0.2em; }
.obw-brand h2 { margin: 4px 0 2px; font-size: 22px; font-weight: 450; letter-spacing: 0.04em; }
.obw-brand p { margin: 0; color: rgba(200, 201, 231, 0.58); font-size: 11px; }
.obw-header-actions { display: flex; align-items: center; gap: 12px; }
.obw-secondary-button, .obw-primary-button, .obw-close, .obw-confirm-button, .obw-text-button { font: inherit; cursor: pointer; }
.obw-secondary-button { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid rgba(175, 161, 255, 0.25); border-radius: 10px; color: #e3ddff; background: rgba(144, 125, 255, 0.09); font-size: 11px; }
.obw-secondary-button span { font-size: 17px; line-height: 10px; }
.obw-close { width: 34px; height: 34px; border: 1px solid rgba(197, 190, 255, 0.16); border-radius: 50%; color: rgba(229, 226, 255, 0.8); background: rgba(255, 255, 255, 0.035); font-size: 22px; line-height: 1; }
.obw-capture { display: grid; grid-template-columns: 1fr auto; gap: 10px 18px; padding: 17px 28px; border-bottom: 1px solid rgba(194, 185, 255, 0.1); background: rgba(130, 117, 255, 0.045); }
.obw-capture-copy { display: flex; flex-direction: column; gap: 5px; align-self: center; }
.obw-capture-copy strong { color: #edeaff; font-size: 12px; font-weight: 550; }
.obw-capture-copy span { color: rgba(196, 197, 227, 0.56); font-size: 10px; }
.obw-capture textarea { grid-column: 1 / -1; width: 100%; min-height: 70px; padding: 11px 13px; border: 1px solid rgba(179, 166, 255, 0.18); border-radius: 11px; outline: none; color: #f0edff; background: rgba(2, 5, 19, 0.62); font-size: 12px; line-height: 1.7; resize: vertical; }
.obw-capture textarea:focus { border-color: rgba(170, 152, 255, 0.55); }
.obw-capture-footer { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; color: rgba(167, 168, 207, 0.52); font-size: 10px; }
.obw-primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 9px 13px; border: 1px solid rgba(199, 183, 255, 0.36); border-radius: 10px; color: #fff; background: linear-gradient(115deg, rgba(125, 96, 220, 0.72), rgba(63, 116, 169, 0.6)); box-shadow: inset 0 1px rgba(255, 255, 255, 0.1); font-size: 11px; transition: opacity 160ms ease, transform 160ms ease; }
.obw-primary-button:hover:not(:disabled) { transform: translateY(-1px); }
.obw-primary-button:disabled { opacity: 0.42; cursor: not-allowed; }
.obw-body { display: grid; grid-template-columns: minmax(250px, 310px) minmax(0, 1fr); flex: 1; min-height: 0; }
.obw-list-column { display: flex; flex-direction: column; min-height: 0; padding: 23px 18px 15px 23px; border-right: 1px solid rgba(194, 185, 255, 0.1); background: rgba(1, 4, 16, 0.18); }
.obw-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.obw-section-heading h3 { margin: 5px 0 0; color: #f0edff; font-size: 15px; font-weight: 500; }
.obw-count { display: inline-grid; min-width: 24px; height: 24px; place-items: center; padding: 0 6px; border: 1px solid rgba(179, 163, 255, 0.17); border-radius: 999px; color: #c7bdff; background: rgba(145, 127, 255, 0.1); font-size: 10px; }
.obw-observation-list { flex: 1; min-height: 0; overflow: auto; padding-right: 4px; }
.obw-observation-item { display: flex; align-items: flex-start; width: 100%; gap: 10px; padding: 12px 10px; border: 1px solid transparent; border-radius: 12px; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: border-color 160ms ease, background 160ms ease; }
.obw-observation-item:hover { background: rgba(255, 255, 255, 0.035); }
.obw-observation-item.active { border-color: rgba(174, 158, 255, 0.25); background: linear-gradient(115deg, rgba(139, 117, 255, 0.13), rgba(83, 139, 190, 0.06)); }
.obw-item-orb { width: 8px; height: 8px; flex: 0 0 8px; margin-top: 5px; border-radius: 50%; background: var(--item-color); box-shadow: 0 0 12px var(--item-color); }
.obw-item-content { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 7px; }
.obw-item-text { color: rgba(231, 229, 250, 0.86); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.obw-item-date { color: rgba(165, 168, 208, 0.48); font-size: 9px; }
.obw-item-arrow { color: rgba(192, 181, 255, 0.42); font-size: 20px; line-height: 1; }
.obw-list-footnote { padding-top: 13px; border-top: 1px solid rgba(194, 185, 255, 0.09); color: rgba(163, 166, 205, 0.44); font-size: 9px; line-height: 1.6; }
.obw-empty-list, .obw-no-selection { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 12px; color: rgba(208, 207, 237, 0.6); text-align: center; }
.obw-empty-list strong, .obw-no-selection h3 { margin: 0; color: #e7e3ff; font-size: 15px; font-weight: 500; }
.obw-empty-list span:not(.obw-empty-star), .obw-no-selection p { max-width: 300px; margin: 0; font-size: 11px; line-height: 1.8; }
.obw-empty-star { color: #b7a4ff; font-size: 36px; text-shadow: 0 0 22px rgba(167, 143, 255, 0.7); }
.obw-detail-column { min-height: 0; overflow: auto; padding: 23px 28px 28px; }
.obw-detail-topline { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 13px; }
.obw-date { color: rgba(165, 168, 208, 0.48); font-size: 10px; }
.obw-original-card { padding: 17px 19px; border: 1px solid rgba(172, 157, 255, 0.17); border-radius: 15px; background: linear-gradient(135deg, rgba(91, 76, 166, 0.12), rgba(43, 94, 130, 0.07)); }
.obw-card-label { display: flex; align-items: center; gap: 8px; color: rgba(200, 192, 255, 0.76); font-size: 10px; letter-spacing: 0.08em; }
.obw-card-dot { width: 6px; height: 6px; border-radius: 50%; background: #b5a0ff; box-shadow: 0 0 10px #a58cff; }
.obw-original-card p { margin: 12px 0 9px; color: #f2efff; font-size: 14px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.obw-original-note { color: rgba(175, 177, 215, 0.46); font-size: 9px; }
.obw-analysis-section, .obw-relations-section { margin-top: 23px; }
.obw-analysis-heading { margin-bottom: 12px; }
.obw-spinner { width: 11px; height: 11px; border: 1.5px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: obw-spin 0.7s linear infinite; }
@keyframes obw-spin { to { transform: rotate(360deg); } }
.obw-analysis-card { position: relative; padding: 16px 17px; border: 1px solid rgba(170, 158, 255, 0.15); border-radius: 15px; background: rgba(11, 15, 37, 0.62); }
.obw-analysis-badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 9px; letter-spacing: 0.04em; }
.obw-analysis-badge.llm { color: #b7f0df; background: rgba(87, 193, 159, 0.12); }
.obw-analysis-badge.local { color: #e4d2a5; background: rgba(207, 172, 91, 0.12); }
.obw-analysis-summary { margin: 12px 0 15px; color: #e8e5ff; font-size: 12px; line-height: 1.8; }
.obw-analysis-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
.obw-analysis-grid > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.obw-analysis-grid span, .obw-question-box span { color: rgba(173, 174, 213, 0.55); font-size: 9px; }
.obw-analysis-grid strong { color: rgba(229, 227, 250, 0.88); font-size: 10px; font-weight: 450; line-height: 1.7; overflow-wrap: anywhere; }
.obw-question-box { display: flex; flex-direction: column; gap: 7px; margin-top: 15px; padding: 12px 13px; border-left: 2px solid rgba(157, 143, 255, 0.7); border-radius: 0 9px 9px 0; background: rgba(141, 123, 255, 0.07); }
.obw-question-box strong { color: #e2dcff; font-size: 11px; font-weight: 450; line-height: 1.7; }
.obw-keywords, .obw-shared-terms { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.obw-keywords span, .obw-shared-terms span { padding: 4px 7px; border: 1px solid rgba(169, 156, 255, 0.15); border-radius: 999px; color: rgba(202, 194, 255, 0.75); background: rgba(145, 128, 255, 0.07); font-size: 9px; }
.obw-unknowns { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(191, 183, 255, 0.09); }
.obw-unknowns strong { color: rgba(211, 207, 240, 0.7); font-size: 10px; font-weight: 500; }
.obw-unknowns ul { margin: 7px 0 0; padding-left: 17px; color: rgba(177, 180, 216, 0.57); font-size: 10px; line-height: 1.8; }
.obw-analysis-placeholder { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 26px 15px; border: 1px dashed rgba(169, 157, 255, 0.2); border-radius: 14px; color: rgba(181, 181, 218, 0.62); text-align: center; }
.obw-placeholder-orbit { color: #b5a4ff; font-size: 25px; }
.obw-analysis-placeholder strong { color: #e4e0ff; font-size: 11px; font-weight: 500; }
.obw-analysis-placeholder span:last-child { max-width: 390px; font-size: 10px; line-height: 1.8; }
.obw-privacy-note { margin: 9px 2px 0; color: rgba(162, 166, 205, 0.43); font-size: 9px; line-height: 1.6; }
.obw-relation-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.obw-relation-card { min-width: 0; padding: 13px; border: 1px solid rgba(167, 157, 255, 0.14); border-radius: 12px; background: rgba(255, 255, 255, 0.025); }
.obw-relation-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: rgba(193, 183, 255, 0.7); font-size: 9px; }
.obw-status { padding: 3px 6px; border-radius: 999px; color: #ddcb9c; background: rgba(202, 168, 91, 0.1); }
.obw-status.confirmed { color: #9de0c5; background: rgba(78, 183, 143, 0.11); }
.obw-relation-text { margin: 10px 0 7px; color: rgba(235, 232, 255, 0.92); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.obw-relation-evidence { display: grid; gap: 6px; margin-top: 9px; padding: 9px 10px; border: 1px solid rgba(169, 157, 255, .11); border-radius: 9px; background: rgba(119, 102, 190, .055); }
.obw-relation-evidence div { display: flex; flex-wrap: wrap; gap: 7px; align-items: baseline; }
.obw-relation-evidence span { color: rgba(170, 173, 210, .55); font-size: 10px; flex: 0 0 auto; }
.obw-relation-evidence q { color: rgba(214, 207, 250, .82); font-size: 11px; line-height: 1.6; }
.obw-relation-reason { margin: 0; color: rgba(177, 181, 216, 0.58); font-size: 9px; line-height: 1.7; }
.obw-relation-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 11px; padding-top: 9px; border-top: 1px solid rgba(191, 183, 255, 0.08); }
.obw-text-button { padding: 5px 0; border: 0; color: rgba(174, 178, 213, 0.57); background: transparent; font-size: 9px; }
.obw-confirm-button { padding: 6px 9px; border: 1px solid rgba(104, 198, 161, 0.22); border-radius: 8px; color: #a9e7ce; background: rgba(69, 166, 128, 0.09); font-size: 9px; }
.obw-confirmed-note { margin-top: 10px; color: rgba(135, 213, 180, 0.72); font-size: 9px; }
.obw-no-relations { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 20px 12px; border: 1px dashed rgba(169, 157, 255, 0.15); border-radius: 12px; text-align: center; }
.obw-no-relations span { color: #b7a5ff; font-size: 20px; }
.obw-no-relations strong { color: rgba(226, 222, 250, 0.76); font-size: 10px; font-weight: 500; }
.obw-no-relations p { margin: 0; color: rgba(170, 173, 210, 0.5); font-size: 9px; }
.obw-theme-create { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-top: 20px; padding: 14px; border: 1px solid rgba(172, 157, 255, 0.16); border-radius: 13px; background: rgba(132, 113, 255, 0.05); }
.obw-theme-create h3 { margin: 6px 0; color: #eeeaff; font-size: 12px; font-weight: 500; }
.obw-theme-create p { max-width: 500px; margin: 0; color: rgba(171, 174, 211, 0.54); font-size: 9px; line-height: 1.6; }
.obw-theme-form { display: flex; gap: 8px; min-width: min(390px, 45%); }
.obw-theme-form input { flex: 1; min-width: 0; padding: 9px 10px; border: 1px solid rgba(174, 160, 255, 0.18); border-radius: 9px; outline: none; color: #f0edff; background: rgba(1, 5, 18, 0.62); font-size: 10px; }
.obw-theme-form input:focus { border-color: rgba(171, 150, 255, 0.55); }
.obw-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 11px 23px; border-top: 1px solid rgba(194, 185, 255, 0.1); color: rgba(166, 169, 208, 0.5); font-size: 9px; }
.obw-status-message { max-width: 72%; line-height: 1.6; }
.obw-footer-right { display: flex; gap: 14px; white-space: nowrap; }
.obw-fade-enter-active, .obw-fade-leave-active { transition: opacity 180ms ease; }
.obw-fade-enter-active .obw-panel, .obw-fade-leave-active .obw-panel { transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 220ms ease; }
.obw-fade-enter-from, .obw-fade-leave-to { opacity: 0; }
.obw-fade-enter-from .obw-panel, .obw-fade-leave-to .obw-panel { opacity: 0.7; transform: translateY(12px) scale(0.99); }

.obw-saved-themes { margin-top: 20px; }
.obw-saved-theme { margin-top: 8px; padding: 12px 14px; border: 1px solid rgba(172, 157, 255, 0.13); border-radius: 11px; background: rgba(132, 113, 255, 0.045); }
.obw-saved-theme > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.obw-saved-theme strong { color: rgba(231, 227, 255, 0.9); font-size: 10px; font-weight: 500; }
.obw-saved-theme span { color: rgba(165, 168, 208, 0.5); font-size: 9px; }
.obw-saved-theme p { margin: 7px 0 0; color: rgba(170, 173, 210, 0.55); font-size: 9px; line-height: 1.6; }
@media (max-width: 900px) {
  .obw-panel { height: min(900px, calc(100% - 6px)); }
  .obw-body { grid-template-columns: 230px minmax(0, 1fr); }
  .obw-header { padding: 18px 20px; }
  .obw-list-column { padding: 18px 12px; }
  .obw-detail-column { padding: 18px 20px; }
  .obw-relation-list { grid-template-columns: 1fr; }
  .obw-theme-create { align-items: stretch; flex-direction: column; }
  .obw-theme-form { min-width: 0; }
}
@media (max-width: 620px) {
  .obw-launcher { top: auto; right: 14px; bottom: 83px; }
  .obw-backdrop { padding: 0; }
  .obw-panel { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; }
  .obw-header { padding: 15px 14px; }
  .obw-brand-mark { width: 36px; height: 36px; }
  .obw-brand h2 { font-size: 18px; }
  .obw-brand p { display: none; }
  .obw-secondary-button { padding: 9px 10px; font-size: 10px; }
  .obw-body { grid-template-columns: 1fr; grid-template-rows: minmax(150px, 31%) minmax(0, 1fr); }
  .obw-list-column { padding: 12px 13px 9px; border-right: 0; border-bottom: 1px solid rgba(194, 185, 255, 0.1); }
  .obw-section-heading { margin-bottom: 7px; }
  .obw-section-heading h3 { font-size: 13px; }
  .obw-observation-list { display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden; }
  .obw-observation-item { min-width: 190px; max-width: 230px; align-self: stretch; padding: 8px; }
  .obw-item-text { font-size: 10px; }
  .obw-list-footnote { display: none; }
  .obw-detail-column { padding: 14px; }
  .obw-analysis-grid { grid-template-columns: 1fr; }
  .obw-footer { align-items: flex-start; flex-direction: column; gap: 5px; padding: 9px 13px; }
  .obw-status-message { max-width: 100%; }
  .obw-capture { padding: 12px 14px; }
  .obw-capture-footer { align-items: flex-start; flex-direction: column; gap: 8px; }
  .obw-capture-footer .obw-primary-button { align-self: flex-end; }
}

.obw-theme-echoes { margin-top: 20px; padding: 14px; border: 1px solid rgba(111, 204, 180, 0.2); border-radius: 13px; background: linear-gradient(120deg, rgba(61, 139, 126, 0.075), rgba(112, 99, 191, 0.045)); }
.obw-theme-echo-card { margin-top: 9px; padding: 12px; border: 1px solid rgba(122, 207, 182, 0.15); border-radius: 10px; background: rgba(4, 20, 29, 0.32); }
.obw-theme-echo-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.obw-theme-echo-heading strong { color: rgba(222, 249, 240, 0.92); font-size: 11px; font-weight: 550; }
.obw-theme-echo-heading span { color: rgba(166, 208, 196, 0.58); font-size: 9px; }
.obw-theme-echo-card > p { margin: 8px 0; color: rgba(190, 205, 220, 0.7); font-size: 10px; line-height: 1.7; }
.obw-theme-echo-evidence { display: grid; gap: 5px; margin: 9px 0; padding: 9px 10px; border-radius: 8px; background: rgba(105, 188, 161, 0.06); }
.obw-theme-echo-evidence span { color: rgba(154, 203, 187, 0.58); font-size: 9px; }
.obw-theme-echo-evidence q { color: rgba(216, 230, 229, 0.82); font-size: 10px; line-height: 1.6; }
.obw-saved-theme-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.obw-theme-title-button { display: flex; min-width: 0; flex: 1; flex-direction: column; align-items: flex-start; gap: 5px; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.obw-theme-title-button strong { color: rgba(231, 227, 255, 0.92); font-size: 11px; font-weight: 550; }
.obw-theme-title-button span { color: rgba(165, 168, 208, 0.58); font-size: 9px; }
.obw-theme-title-button small { color: rgba(174, 164, 235, 0.62); font-size: 9px; }
.obw-theme-status-actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.obw-theme-status-actions button { padding: 4px 6px; border: 1px solid rgba(171, 162, 222, 0.13); border-radius: 7px; color: rgba(184, 184, 216, 0.62); background: rgba(255,255,255,0.025); font: inherit; font-size: 8px; cursor: pointer; }
.obw-theme-status-actions button.active { border-color: rgba(128, 206, 178, 0.28); color: #a9e5cd; background: rgba(75, 171, 133, 0.1); }
.obw-theme-expanded { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(191, 183, 255, 0.09); }
.obw-theme-members, .obw-theme-history { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.obw-theme-members > strong, .obw-theme-history > strong { color: rgba(206, 201, 240, 0.76); font-size: 9px; font-weight: 550; }
.obw-theme-members button { padding: 7px 8px; border: 1px solid rgba(170, 158, 255, 0.1); border-radius: 7px; color: rgba(210, 208, 236, 0.73); background: rgba(255,255,255,0.025); font: inherit; font-size: 9px; line-height: 1.6; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.obw-theme-members button:disabled { opacity: .45; cursor: not-allowed; }
.obw-theme-history ol { display: grid; gap: 8px; margin: 0; padding: 0 0 0 16px; }
.obw-theme-history li { padding-left: 2px; color: rgba(176, 171, 223, 0.75); }
.obw-theme-history li span { font-size: 8px; color: rgba(165, 168, 208, 0.53); }
.obw-theme-history li p, .obw-theme-history-empty { margin: 3px 0 0; color: rgba(198, 195, 225, 0.7); font-size: 9px; line-height: 1.6; }
@media (max-width: 900px) {
  .obw-saved-theme-head { flex-direction: column; }
  .obw-theme-status-actions { justify-content: flex-start; }
}
@media (max-width: 620px) {
  .obw-theme-expanded { grid-template-columns: 1fr; }
}



/* Theme Center V2 — clear hierarchy, full theme inventory and readable typography. */
.obw-panel { width: min(1460px, 100%); height: min(940px, 100%); }
.obw-header { padding: 22px 30px 18px; }
.obw-brand h2 { font-size: 24px; }
.obw-brand p { font-size: 13px; }
.obw-eyebrow, .obw-overline { font-size: 11px; letter-spacing: .14em; }
.obw-launcher { font-size: 14px; padding: 11px 17px; }
.obw-secondary-button, .obw-primary-button { font-size: 13px; padding: 10px 15px; }
.obw-main-tabs { display:flex; align-items:center; gap:8px; padding: 12px 30px 0; border-bottom:1px solid rgba(194,185,255,.11); }
.obw-main-tab { display:inline-flex; align-items:center; gap:9px; padding:12px 17px 13px; border:0; border-bottom:2px solid transparent; color:rgba(185,187,220,.66); background:transparent; font:inherit; font-size:14px; cursor:pointer; transition:color 160ms ease,border-color 160ms ease,background 160ms ease; }
.obw-main-tab:hover { color:#eeeaff; background:rgba(255,255,255,.025); }
.obw-main-tab.active { border-bottom-color:#a99aff; color:#f0edff; }
.obw-main-tab-icon { color:#c7b9ff; font-size:17px; }
.obw-main-tab-count { min-width:23px; padding:2px 7px; border-radius:99px; color:#d7d0ff; background:rgba(151,132,255,.14); font-size:11px; text-align:center; }
.obw-body { min-height:0; }
.obw-list-column { padding:24px 20px 17px 25px; }
.obw-section-heading h3 { font-size:17px; }
.obw-count { min-width:28px; height:28px; font-size:12px; }
.obw-observation-item { gap:12px; padding:14px 12px; }
.obw-item-text { font-size:13px; line-height:1.65; }
.obw-item-date { font-size:11px; }
.obw-list-footnote, .obw-privacy-note { font-size:11px; line-height:1.65; }
.obw-detail-column { padding:25px 30px; }
.obw-date { font-size:12px; }
.obw-card-label { font-size:13px; }
.obw-original-card p { font-size:16px; line-height:1.85; }
.obw-original-note { font-size:11px; }
.obw-analysis-summary { font-size:14px; line-height:1.8; }
.obw-analysis-grid span, .obw-question-box span { font-size:11px; }
.obw-analysis-grid strong, .obw-question-box strong { font-size:13px; line-height:1.7; }
.obw-analysis-placeholder strong { font-size:14px; }
.obw-analysis-placeholder span:last-child { font-size:12px; }
.obw-relation-meta, .obw-relation-evidence span { font-size:11px; }
.obw-relation-text { font-size:13px; }
.obw-relation-reason { font-size:12px; }
.obw-relation-evidence q { font-size:12px; }
.obw-text-button, .obw-confirm-button { font-size:12px; }
.obw-theme-create h3 { font-size:16px; }
.obw-theme-create p { font-size:12px; }
.obw-theme-form input { font-size:13px; }
.obw-footer { font-size:11px; padding:13px 25px; }
.obw-theme-center { flex:1; min-height:0; overflow:auto; padding:27px 32px 34px; }
.obw-theme-center-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:24px; }
.obw-theme-center-heading h3 { margin:8px 0 7px; color:#f2efff; font-size:27px; font-weight:560; letter-spacing:.01em; }
.obw-theme-center-heading p { margin:0; color:rgba(195,196,226,.68); font-size:14px; line-height:1.7; }
.obw-theme-toolbar { display:grid; gap:15px; margin-bottom:22px; }
.obw-theme-search { display:flex; align-items:center; gap:11px; width:min(560px,100%); padding:0 15px; border:1px solid rgba(173,160,255,.19); border-radius:12px; background:rgba(5,8,24,.5); }
.obw-theme-search span { color:#bfb1ff; font-size:22px; }
.obw-theme-search input { width:100%; min-width:0; padding:13px 0; border:0; outline:0; color:#f1efff; background:transparent; font:inherit; font-size:14px; }
.obw-theme-search input::placeholder { color:rgba(173,176,210,.42); }
.obw-theme-filters { display:flex; flex-wrap:wrap; gap:8px; }
.obw-theme-filters button { display:inline-flex; align-items:center; gap:8px; padding:8px 13px; border:1px solid rgba(171,161,221,.14); border-radius:999px; color:rgba(197,196,225,.72); background:rgba(255,255,255,.025); font:inherit; font-size:12px; cursor:pointer; }
.obw-theme-filters button.active { border-color:rgba(173,156,255,.42); color:#eeeaff; background:rgba(142,119,255,.13); }
.obw-theme-filters b { color:#c9bdff; font-size:11px; font-weight:600; }
.obw-theme-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:15px; align-items:start; }
.obw-theme-center-card { min-width:0; padding:21px 22px 18px; border:1px solid rgba(173,159,255,.17); border-radius:16px; background:linear-gradient(145deg,rgba(117,99,193,.09),rgba(255,255,255,.025) 60%),rgba(6,10,28,.64); box-shadow:inset 0 1px rgba(255,255,255,.04); }
.obw-theme-card-topline { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.obw-theme-card-kicker { color:rgba(179,173,225,.47); font-size:10px; letter-spacing:.16em; }
.obw-theme-status-pill { padding:5px 10px; border:1px solid rgba(169,154,255,.18); border-radius:999px; color:#cfc5ff; background:rgba(153,132,255,.09); font-size:11px; white-space:nowrap; }
.obw-theme-status-pill.status-exploring { border-color:rgba(104,207,173,.24); color:#a8e8d2; background:rgba(72,174,141,.09); }
.obw-theme-status-pill.status-paused { border-color:rgba(168,174,205,.18); color:#b9bfd6; background:rgba(132,141,174,.08); }
.obw-theme-center-card h4 { margin:17px 0 9px; color:#f1edff; font-size:20px; line-height:1.4; font-weight:560; overflow-wrap:anywhere; }
.obw-theme-card-description { min-height:48px; margin:0; color:rgba(205,202,232,.72); font-size:14px; line-height:1.8; overflow-wrap:anywhere; }
.obw-theme-metrics { display:flex; flex-wrap:wrap; gap:9px 17px; margin-top:17px; padding-top:13px; border-top:1px solid rgba(187,177,239,.1); color:rgba(177,180,213,.58); font-size:11px; }
.obw-theme-metrics strong { color:#d9d0ff; font-size:13px; font-weight:650; }
.obw-theme-last-event { margin-top:13px; padding:10px 12px; border-left:2px solid rgba(139,204,207,.3); border-radius:0 8px 8px 0; background:rgba(90,157,170,.045); }
.obw-theme-last-event span { color:rgba(161,199,207,.65); font-size:10px; }
.obw-theme-last-event p { margin:5px 0 0; color:rgba(190,204,222,.66); font-size:12px; line-height:1.6; }
.obw-theme-card-actions { display:flex; flex-wrap:wrap; align-items:center; gap:9px; margin-top:16px; }
.obw-theme-open-button, .obw-theme-edit-button { padding:10px 13px; border-radius:9px; font:inherit; font-size:13px; cursor:pointer; }
.obw-theme-open-button { border:1px solid rgba(174,155,255,.32); color:#f0eaff; background:linear-gradient(115deg,rgba(133,106,220,.34),rgba(67,125,167,.22)); }
.obw-theme-open-button span { margin-left:9px; }
.obw-theme-edit-button { border:1px solid rgba(174,166,222,.15); color:rgba(213,209,238,.83); background:rgba(255,255,255,.035); }
.obw-theme-card-status-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
.obw-theme-card-status-actions button { padding:6px 9px; border:1px solid rgba(171,162,222,.13); border-radius:8px; color:rgba(184,184,216,.68); background:rgba(255,255,255,.025); font:inherit; font-size:11px; cursor:pointer; }
.obw-theme-card-status-actions button.active { border-color:rgba(128,206,178,.28); color:#a9e5cd; background:rgba(75,171,133,.1); }
.obw-theme-edit-form { display:grid; gap:13px; margin-top:17px; }
.obw-theme-edit-form label { display:grid; gap:7px; color:rgba(201,198,230,.76); font-size:13px; }
.obw-theme-edit-form input, .obw-theme-edit-form textarea { width:100%; box-sizing:border-box; padding:12px 13px; border:1px solid rgba(173,160,255,.2); border-radius:10px; outline:none; color:#f0edff; background:rgba(2,5,19,.6); font:inherit; font-size:14px; line-height:1.7; resize:vertical; }
.obw-theme-edit-form input:focus, .obw-theme-edit-form textarea:focus { border-color:rgba(174,158,255,.55); }
.obw-theme-edit-actions { display:flex; justify-content:flex-end; align-items:center; gap:9px; }
.obw-quiet-action { padding:9px 12px; border:1px solid rgba(171,162,222,.16); border-radius:9px; color:rgba(208,205,235,.82); background:rgba(255,255,255,.035); font:inherit; font-size:12px; cursor:pointer; }
.obw-theme-empty-state { display:grid; justify-items:center; gap:10px; max-width:620px; margin:50px auto; padding:40px 24px; border:1px dashed rgba(172,158,255,.22); border-radius:18px; text-align:center; background:rgba(255,255,255,.02); }
.obw-theme-empty-state h4 { margin:0; color:#eeeaff; font-size:20px; font-weight:550; }
.obw-theme-empty-state p { max-width:500px; margin:0 0 8px; color:rgba(191,193,221,.66); font-size:14px; line-height:1.8; }
@media (max-width: 900px) { .obw-theme-center { padding:22px 20px; } .obw-theme-grid { grid-template-columns:1fr; } }
@media (max-width: 620px) { .obw-main-tabs { padding:8px 13px 0; } .obw-main-tab { flex:1; justify-content:center; padding:11px 7px; font-size:13px; } .obw-theme-center { padding:18px 14px 26px; } .obw-theme-center-heading { align-items:flex-start; flex-direction:column; gap:13px; } .obw-theme-center-heading h3 { font-size:23px; } .obw-theme-center-heading p { font-size:13px; } .obw-theme-filters { gap:6px; } .obw-theme-filters button { padding:7px 10px; font-size:11px; } .obw-theme-center-card { padding:17px; } .obw-theme-center-card h4 { font-size:18px; } .obw-theme-card-description { font-size:13px; } }

/* After creating or extending a theme, expose its exact name and a direct route to it. */
.obw-theme-action-notice {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  margin: 18px 0 20px;
  padding: 17px 48px 17px 17px;
  border: 1px solid rgba(151, 214, 194, .28);
  border-radius: 15px;
  background: linear-gradient(115deg, rgba(68, 142, 128, .15), rgba(117, 99, 193, .11) 60%, rgba(255,255,255,.025));
  box-shadow: inset 0 1px rgba(255,255,255,.055), 0 12px 34px rgba(0,0,0,.12);
}
.obw-theme-notice-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid rgba(156, 224, 201, .26);
  border-radius: 12px;
  color: #b8f2dc;
  background: rgba(113, 199, 169, .12);
  font-size: 20px;
  text-shadow: 0 0 16px rgba(148, 240, 204, .5);
}
.obw-theme-notice-copy { min-width: 0; }
.obw-theme-notice-kicker { display: block; margin-bottom: 5px; color: rgba(164, 224, 205, .75); font-size: 10px; font-weight: 650; letter-spacing: .14em; }
.obw-theme-notice-copy strong { display: block; color: #f1edff; font-size: 18px; line-height: 1.45; overflow-wrap: anywhere; }
.obw-theme-notice-copy p { margin: 6px 0 5px; color: rgba(222, 224, 240, .86); font-size: 13px; line-height: 1.7; }
.obw-theme-notice-copy small { color: rgba(184, 193, 216, .58); font-size: 11px; line-height: 1.6; }
.obw-theme-notice-actions { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 142px; }
.obw-theme-notice-primary, .obw-theme-notice-secondary { padding: 9px 12px; border-radius: 9px; font: inherit; font-size: 12px; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
.obw-theme-notice-primary { border: 1px solid rgba(162, 221, 199, .34); color: #eafff5; background: linear-gradient(115deg, rgba(76, 158, 132, .32), rgba(90, 119, 174, .22)); }
.obw-theme-notice-secondary { border: 1px solid rgba(174, 160, 229, .2); color: rgba(225, 220, 250, .88); background: rgba(255,255,255,.035); }
.obw-theme-notice-primary:hover, .obw-theme-notice-secondary:hover { transform: translateY(-1px); }
.obw-theme-notice-primary:hover { border-color: rgba(172, 236, 211, .58); background: rgba(87, 174, 146, .28); }
.obw-theme-notice-secondary:hover { border-color: rgba(185, 169, 255, .46); background: rgba(142, 119, 255, .1); }
.obw-theme-notice-dismiss { position: absolute; top: 9px; right: 10px; width: 28px; height: 28px; border: 0; border-radius: 8px; color: rgba(211, 215, 235, .58); background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
.obw-theme-notice-dismiss:hover { color: #fff; background: rgba(255,255,255,.07); }
.obw-theme-notice-enter-active, .obw-theme-notice-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.obw-theme-notice-enter-from, .obw-theme-notice-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 760px) {
  .obw-theme-action-notice { grid-template-columns: 36px minmax(0, 1fr); gap: 11px; padding: 14px 42px 14px 13px; }
  .obw-theme-notice-icon { width: 36px; height: 36px; }
  .obw-theme-notice-copy strong { font-size: 16px; }
  .obw-theme-notice-actions { grid-column: 2; flex-direction: row; flex-wrap: wrap; min-width: 0; }
  .obw-theme-notice-primary, .obw-theme-notice-secondary { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
  .obw-theme-notice-enter-active, .obw-theme-notice-leave-active, .obw-theme-notice-primary, .obw-theme-notice-secondary { transition: none !important; }
}

</style>
