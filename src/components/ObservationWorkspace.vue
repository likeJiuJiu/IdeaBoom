<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  LocalRelationCandidate,
  ObservationAnalysis,
  ObservationRelation,
  ObservationSource,
  ObservationWorkspaceState,
  RelationStatus,
} from '../types/observation'
import { analyzeObservationLocally, findLocalRelationCandidates } from '../lib/observation-engine'
import { requestObservationAnalysis } from '../lib/observation-ai'
import {
  addProblemTheme,
  loadObservationWorkspace,
  relationId,
  saveObservationWorkspace,
  updateRelationStatus,
  upsertRelation,
} from '../lib/observation-store'

const props = defineProps<{ ideas: ObservationSource[] }>()
const emit = defineEmits<{
  create: [text: string]
  'relations-change': [relations: Array<{ sourceId: number; targetId: number; type: ObservationRelation['type'] }>]
  'themes-change': [themes: Array<{ id: string; title: string; observationIds: number[]; status: 'observing' | 'exploring' | 'paused' }>]
}>()

const isOpen = ref(false)
const isComposerOpen = ref(false)
const isAnalyzing = ref(false)
const draftText = ref('')
const themeTitle = ref('')
const statusMessage = ref('')
const selectedId = ref<number | null>(null)
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

const visibleThemes = computed(() => workspace.value.themes.slice(0, 5))

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
  workspace.value = addProblemTheme(workspace.value, {
    title,
    description: '由用户确认关联的观察记录组成。主题描述仍需继续补充，不代表已经验证为普遍问题。',
    observationIds,
  })
  persist()
  themeTitle.value = ''
  statusMessage.value = '问题主题已创建。它仍处于观察阶段。'
}

function selectObservation(id: number): void {
  selectedId.value = id
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

          <div class="obw-body">
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

                <section v-if="visibleThemes.length" class="obw-saved-themes">
                  <div class="obw-section-heading">
                    <div>
                      <span class="obw-overline">YOUR PROBLEM THEMES</span>
                      <h3>已整理的问题主题</h3>
                    </div>
                    <span class="obw-count">{{ visibleThemes.length }}</span>
                  </div>
                  <article v-for="theme in visibleThemes" :key="theme.id" class="obw-saved-theme">
                    <div><strong>{{ theme.title }}</strong><span>{{ theme.observationIds.length }} 条观察 · {{ theme.status === 'observing' ? '持续观察' : theme.status === 'exploring' ? '探索中' : '暂时搁置' }}</span></div>
                    <p>{{ theme.description }}</p>
                  </article>
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

          <footer class="obw-footer">
            <div class="obw-status-message" aria-live="polite">{{ statusMessage || 'AI 的分析是线索，不是事实；观察之间的联系由你确认。' }}</div>
            <div class="obw-footer-right">
              <span>本地记录 {{ orderedIdeas.length }} 条</span>
              <span>问题主题 {{ visibleThemes.length }} 个</span>
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
</style>
