<!-- IDEA-BOOM-PHASE6-THEME-ACTIONS -->
<!-- IDEA-BOOM-PHASE5-THEME-DETAIL-SPACE -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThemeResearchWorkspace from './ThemeResearchWorkspace.vue'
import type {
  ObservationAnalysis,
  ObservationRelation,
  ObservationSource,
  ProblemTheme,
  ThemeEvent,
  ThemeStatus,
} from '../types/observation'

const props = defineProps<{
  theme: ProblemTheme
  ideas: ObservationSource[]
  relations: ObservationRelation[]
  analyses: Record<string, ObservationAnalysis>
  allIdeas: ObservationSource[]
}>()

const emit = defineEmits<{
  close: []
  'open-idea': [id: number]
  'create-observation': [text: string]
  'extend-observation': [id: number]
  'change-status': [status: ThemeStatus]
  'update-details': [payload: { title: string; description: string }]
}>()

type ThemeDetailTab = 'overview' | 'observations' | 'relations' | 'research' | 'timeline'
const activeTab = ref<ThemeDetailTab>('overview')

watch(() => props.theme.id, () => { activeTab.value = 'overview' })

const researchTheme = computed(() => ({
  id: props.theme.id,
  title: props.theme.title,
  description: props.theme.description,
  observationIds: [...props.theme.observationIds],
}))

const statusLabels: Record<ThemeStatus, string> = {
  observing: '持续观察',
  exploring: '探索中',
  paused: '暂时搁置',
}

const statusDescriptions: Record<ThemeStatus, string> = {
  observing: '这个主题仍在积累观察，暂时不急着下结论。',
  exploring: '你正在主动研究这个问题，后续观察可以继续补充。',
  paused: '这个主题暂时搁置，已有观察和关系会继续保留。',
}

const members = computed(() => [...props.ideas].sort((a, b) => {
  const ta = Date.parse(a.createdAt) || 0
  const tb = Date.parse(b.createdAt) || 0
  return ta - tb
}))

const memberMap = computed(() => new Map(members.value.map((idea) => [idea.id, idea])))
const memberIds = computed(() => new Set(members.value.map((idea) => idea.id)))
const relations = computed(() => props.relations.filter((relation) =>
  relation.status === 'confirmed'
  && memberIds.value.has(relation.sourceId)
  && memberIds.value.has(relation.targetId),
))

// 主题外的观察只有在与主题成员存在用户已确认关系时，才会出现在可加入列表。
const externalCandidates = computed(() => {
  const ids = new Set(props.theme.observationIds)
  const byCandidate = new Map<number, ObservationRelation[]>()
  for (const relation of props.relations) {
    if (relation.status !== 'confirmed') continue
    const candidateId = ids.has(relation.sourceId) && !ids.has(relation.targetId)
      ? relation.targetId
      : ids.has(relation.targetId) && !ids.has(relation.sourceId)
        ? relation.sourceId
        : null
    if (candidateId === null) continue
    const list = byCandidate.get(candidateId) ?? []
    list.push(relation)
    byCandidate.set(candidateId, list)
  }

  return [...byCandidate.entries()].flatMap(([id, links]) => {
    const idea = props.allIdeas.find((item) => item.id === id)
    return idea ? [{ idea, links }] : []
  }).sort((a, b) => (Date.parse(b.idea.createdAt) || 0) - (Date.parse(a.idea.createdAt) || 0))
})

const editingDetails = ref(false)
const titleDraft = ref(props.theme.title)
const descriptionDraft = ref(props.theme.description)
const newObservationText = ref('')
const localMessage = ref('')

watch(() => props.theme.updatedAt, () => {
  titleDraft.value = props.theme.title
  descriptionDraft.value = props.theme.description
})

function saveThemeDetails(): void {
  const title = titleDraft.value.trim()
  if (!title) {
    localMessage.value = '主题名称不能为空。'
    return
  }
  emit('update-details', { title, description: descriptionDraft.value.trim() })
  editingDetails.value = false
  localMessage.value = '主题信息已提交保存。'
}

function submitNewObservation(): void {
  const text = newObservationText.value.trim()
  if (!text) {
    localMessage.value = '先写下一条观察，再保存到星云。'
    return
  }
  emit('create-observation', text)
  newObservationText.value = ''
  localMessage.value = '新观察已保存到星云；确认与主题成员的关系后，才能加入当前主题。'
}

const graphNodes = computed(() => {
  const list = members.value
  const count = list.length
  if (!count) return []
  const cx = 360
  const cy = 132
  const rx = count === 2 ? 205 : Math.min(270, 130 + count * 19)
  const ry = count === 2 ? 42 : Math.min(92, 38 + count * 7)
  return list.map((idea, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count
    return {
      id: idea.id,
      index: index + 1,
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      color: idea.color || '#A99AFF',
      text: idea.text,
    }
  })
})

const graphEdges = computed(() => {
  const positions = new Map(graphNodes.value.map((node) => [node.id, node]))
  return relations.value.flatMap((relation) => {
    const a = positions.get(relation.sourceId)
    const b = positions.get(relation.targetId)
    if (!a || !b) return []
    const dx = b.x - a.x
    const bend = Math.max(-34, Math.min(34, dx * 0.08))
    return [{
      id: relation.id,
      d: `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - bend} ${b.x} ${b.y}`,
    }]
  })
})

const timeline = computed(() => [...props.theme.events].sort((a, b) =>
  (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
))

const themeAge = computed(() => {
  const created = Date.parse(props.theme.createdAt)
  if (!Number.isFinite(created)) return '时间未知'
  const days = Math.max(0, Math.floor((Date.now() - created) / 86_400_000))
  return days === 0 ? '今天形成' : `已沉淀 ${days} 天`
})

function formatDate(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time)
    ? new Date(time).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '时间未知'
}

function relationLabel(type: ObservationRelation['type']): string {
  const labels: Record<ObservationRelation['type'], string> = {
    'same-scene': '相似场景',
    'shared-friction': '共同阻碍',
    'cross-scene': '跨场景线索',
    'possible-contradiction': '可能存在矛盾',
    other: '其他联系',
  }
  return labels[type]
}

function eventLabel(event: ThemeEvent): string {
  const labels: Record<ThemeEvent['type'], string> = {
    created: '主题创建',
    'observation-added': '新增观察',
    'status-changed': '状态变化',
    'duplicate-merged': '重复主题整理',
    'details-updated': '主题信息调整',
  }
  return labels[event.type]
}

function findIdeaText(id: number): string {
  return memberMap.value.get(id)?.text ?? `观察 #${id}`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="theme-space-fade">
      <div class="theme-space-backdrop" @click.self="emit('close')">
        <section class="theme-space-panel" role="dialog" aria-modal="true" aria-label="问题主题详情">
          <header class="theme-space-header">
            <div class="theme-space-heading">
              <div class="theme-space-kicker"><span class="theme-space-kicker-dot"></span> IDEABOOM / THEME SPACE</div>
              <div class="theme-space-title-row">
                <h2>{{ theme.title }}</h2>
                <span class="theme-space-status" :class="`status-${theme.status}`">{{ statusLabels[theme.status] }}</span>
              </div>
              <p>{{ theme.description || '这个主题由你确认关联的观察记录组成。' }}</p>
              <div class="theme-space-heading-actions">
                <button type="button" class="theme-space-edit-toggle" @click="editingDetails = !editingDetails">{{ editingDetails ? '收起编辑' : '编辑标题与描述' }}</button>
              </div>
              <form v-if="editingDetails" class="theme-space-edit-form" @submit.prevent="saveThemeDetails">
                <label>主题名称<input v-model="titleDraft" maxlength="48" /></label>
                <label>主题描述<textarea v-model="descriptionDraft" rows="2" maxlength="240" placeholder="补充这个主题目前关注的现象或问题边界（可选）" /></label>
                <div class="theme-space-form-actions">
                  <span>{{ localMessage }}</span>
                  <button type="submit">保存主题信息</button>
                </div>
              </form>
            </div>
            <button class="theme-space-close" type="button" aria-label="关闭主题详情" @click="emit('close')">×</button>
          </header>

          <div class="theme-space-scroll">
            <nav class="theme-space-tabs" aria-label="主题详情导航">
              <button type="button" :class="{ active: activeTab === 'overview' }" :aria-pressed="activeTab === 'overview'" @click="activeTab = 'overview'"><span>✧</span> 主题概览</button>
              <button type="button" :class="{ active: activeTab === 'observations' }" :aria-pressed="activeTab === 'observations'" @click="activeTab = 'observations'"><span>◉</span> 观察成员 <em>{{ members.length }}</em></button>
              <button type="button" :class="{ active: activeTab === 'relations' }" :aria-pressed="activeTab === 'relations'" @click="activeTab = 'relations'"><span>⌁</span> 关系依据 <em>{{ relations.length }}</em></button>
              <button type="button" :class="{ active: activeTab === 'research' }" :aria-pressed="activeTab === 'research'" @click="activeTab = 'research'"><span>◎</span> 外部探索</button>
              <button type="button" :class="{ active: activeTab === 'timeline' }" :aria-pressed="activeTab === 'timeline'" @click="activeTab = 'timeline'"><span>↗</span> 成长记录 <em>{{ timeline.length }}</em></button>
            </nav>
            <template v-if="activeTab === 'overview'">
            <section class="theme-space-hero-grid">
              <div class="theme-space-network-card">
                <div class="theme-space-section-topline">
                  <div>
                    <span class="theme-space-overline">OBSERVATION CONSTELLATION</span>
                    <h3>主题关系网络</h3>
                  </div>
                  <span class="theme-space-count">{{ members.length }} 个观察 · {{ relations.length }} 条确认关系</span>
                </div>
                <div class="theme-space-network">
                  <div class="theme-space-network-glow glow-a"></div>
                  <div class="theme-space-network-glow glow-b"></div>
                  <svg viewBox="0 0 720 264" role="img" aria-label="主题内观察关系示意图">
                    <defs>
                      <linearGradient id="theme-edge-gradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stop-color="#80DFFF" stop-opacity="0.35"/>
                        <stop offset="50%" stop-color="#C2A7FF" stop-opacity="0.95"/>
                        <stop offset="100%" stop-color="#80DFFF" stop-opacity="0.35"/>
                      </linearGradient>
                      <radialGradient id="theme-node-gradient">
                        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
                        <stop offset="35%" stop-color="#A8E8FF" stop-opacity="0.9"/>
                        <stop offset="100%" stop-color="#8C8BFF" stop-opacity="0.05"/>
                      </radialGradient>
                    </defs>
                    <path v-for="edge in graphEdges" :key="edge.id" :d="edge.d" fill="none" stroke="url(#theme-edge-gradient)" stroke-width="2.2" stroke-dasharray="7 9" stroke-linecap="round"/>
                    <g v-for="node in graphNodes" :key="node.id">
                      <circle :cx="node.x" :cy="node.y" r="25" :fill="node.color" opacity="0.11"/>
                      <circle :cx="node.x" :cy="node.y" r="11" fill="url(#theme-node-gradient)"/>
                      <circle :cx="node.x" :cy="node.y" r="4.2" :fill="node.color"/>
                      <text :x="node.x" :y="node.y + 38" text-anchor="middle" fill="rgba(225,225,255,.72)" font-size="11">观察 {{ node.index }}</text>
                    </g>
                  </svg>
                  <div v-if="!relations.length" class="theme-space-network-empty">当前主题尚无可展示的确认关系线。</div>
                </div>
              </div>

              <aside class="theme-space-summary-card">
                <span class="theme-space-overline">THEME STATUS</span>
                <div class="theme-space-summary-orb"><span></span></div>
                <strong>{{ statusLabels[theme.status] }}</strong>
                <p>{{ statusDescriptions[theme.status] }}</p>
                <div class="theme-space-stat-grid">
                  <div><strong>{{ members.length }}</strong><span>观察成员</span></div>
                  <div><strong>{{ relations.length }}</strong><span>确认关系</span></div>
                </div>
                <div class="theme-space-age">✦ {{ themeAge }}</div>
                <div class="theme-space-status-actions" aria-label="修改主题状态">
                  <button type="button" :class="{ active: theme.status === 'observing' }" @click="emit('change-status', 'observing')">持续观察</button>
                  <button type="button" :class="{ active: theme.status === 'exploring' }" @click="emit('change-status', 'exploring')">探索中</button>
                  <button type="button" :class="{ active: theme.status === 'paused' }" @click="emit('change-status', 'paused')">搁置</button>
                </div>
              </aside>
            </section>

            </template>
            <template v-else-if="activeTab === 'observations'">
              <section class="theme-space-content-grid">
              <div class="theme-space-content-card">
                <div class="theme-space-section-topline">
                  <div>
                    <span class="theme-space-overline">MEMBERS</span>
                    <h3>观察成员</h3>
                  </div>
                  <span class="theme-space-count">{{ members.length }} 条</span>
                </div>
                <div v-if="members.length" class="theme-space-member-list">
                  <article v-for="(idea, index) in members" :key="idea.id" class="theme-space-member">
                    <div class="theme-space-member-head">
                      <span class="theme-space-member-index" :style="{ '--member-color': idea.color || '#A99AFF' }">{{ String(index + 1).padStart(2, '0') }}</span>
                      <span class="theme-space-member-date">{{ formatDate(idea.createdAt) }}</span>
                      <button type="button" class="theme-space-open-source" @click="emit('open-idea', idea.id)">查看原始光点 ↗</button>
                    </div>
                    <p class="theme-space-member-text">{{ idea.text }}</p>
                    <div v-if="analyses[String(idea.id)]" class="theme-space-analysis">
                      <span>AI 理解</span>
                      <p>{{ analyses[String(idea.id)].summary || analyses[String(idea.id)].potentialProblem || '已有分析记录。' }}</p>
                    </div>
                  </article>
                </div>
                <div v-else class="theme-space-empty">主题成员暂不可用，可能对应的原始观察已被删除。</div>
              </div>

              </section>
            <section class="theme-space-action-grid">
              <div class="theme-space-content-card">
                <div class="theme-space-section-topline">
                  <div>
                    <span class="theme-space-overline">CONFIRMED PATHS TO THIS THEME</span>
                    <h3>可加入的新观察</h3>
                  </div>
                  <span class="theme-space-count">{{ externalCandidates.length }} 条候选</span>
                </div>
                <div v-if="externalCandidates.length" class="theme-space-candidate-list">
                  <article v-for="candidate in externalCandidates" :key="candidate.idea.id" class="theme-space-candidate">
                    <p>{{ candidate.idea.text }}</p>
                    <span>与主题成员存在 {{ candidate.links.length }} 条已确认关系</span>
                    <button type="button" @click="emit('extend-observation', candidate.idea.id)">加入当前主题</button>
                  </article>
                </div>
                <div v-else class="theme-space-empty">还没有可加入的外部观察。新观察需要先在观察工作台中完成分析，并由你确认与主题成员的关系。</div>
              </div>

              <div class="theme-space-content-card">
                <div class="theme-space-section-topline">
                  <div>
                    <span class="theme-space-overline">CAPTURE FROM THIS THEME</span>
                    <h3>补充一条新观察</h3>
                  </div>
                </div>
                <form class="theme-space-capture-form" @submit.prevent="submitNewObservation">
                  <textarea v-model="newObservationText" maxlength="500" rows="4" placeholder="记录与这个主题有关的新经历、新现象或不同观点……" />
                  <div class="theme-space-capture-foot">
                    <span>新观察会先进入星云，不会自动成为主题成员。</span>
                    <button type="submit">保存新观察 ↗</button>
                  </div>
                  <p v-if="localMessage" class="theme-space-local-message" aria-live="polite">{{ localMessage }}</p>
                </form>
              </div>
            </section>            </template>
            <template v-else-if="activeTab === 'relations'">
              <section class="theme-space-content-grid theme-space-single-column">
              <div class="theme-space-content-card">
                <div class="theme-space-section-topline">
                  <div>
                    <span class="theme-space-overline">CONFIRMED CONNECTIONS</span>
                    <h3>关系依据</h3>
                  </div>
                  <span class="theme-space-count">{{ relations.length }} 条</span>
                </div>
                <div v-if="relations.length" class="theme-space-relation-list">
                  <article v-for="relation in relations" :key="relation.id" class="theme-space-relation">
                    <div class="theme-space-relation-head">
                      <span class="theme-space-relation-type">{{ relationLabel(relation.type) }}</span>
                      <span>{{ formatDate(relation.updatedAt) }}</span>
                    </div>
                    <p class="theme-space-relation-reason">{{ relation.reason || '用户已确认这两条观察存在联系。' }}</p>
                    <div class="theme-space-evidence">
                      <div><span>观察 A</span><p>“{{ relation.evidenceFromSource || findIdeaText(relation.sourceId) }}”</p></div>
                      <div><span>观察 B</span><p>“{{ relation.evidenceFromTarget || findIdeaText(relation.targetId) }}”</p></div>
                    </div>
                  </article>
                </div>
                <div v-else class="theme-space-empty">当前主题暂无可展示的关系依据。</div>
              </div>
              </section>
            </template>
            <template v-else-if="activeTab === 'research'">
              <ThemeResearchWorkspace :theme="researchTheme" :observations="members" />
            </template>
            <template v-else>
            <section class="theme-space-timeline-card">
              <div class="theme-space-section-topline">
                <div>
                  <span class="theme-space-overline">EVOLUTION TIMELINE</span>
                  <h3>主题成长时间线</h3>
                </div>
                <span class="theme-space-count">{{ timeline.length }} 条记录</span>
              </div>
              <ol v-if="timeline.length" class="theme-space-timeline">
                <li v-for="event in timeline" :key="event.id" class="theme-space-timeline-item">
                  <span class="theme-space-timeline-dot"></span>
                  <div class="theme-space-timeline-copy">
                    <div><strong>{{ eventLabel(event) }}</strong><time>{{ formatDate(event.at) }}</time></div>
                    <p>{{ event.message }}</p>
                    <blockquote v-if="event.observationId" class="theme-space-timeline-quote">{{ findIdeaText(event.observationId) }}</blockquote>
                  </div>
                </li>
              </ol>
              <div v-else class="theme-space-empty">当前主题没有可展示的成长记录。</div>
            </section>            </template>
            <footer class="theme-space-footer">
              <span>主题由你确认的观察关系组成；AI 分析和关联建议不会自动改变主题。</span>
              <button type="button" @click="emit('close')">返回星云 <span>↗</span></button>
            </footer>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.theme-space-backdrop{position:fixed;inset:0;z-index:10050;display:grid;place-items:center;padding:clamp(10px,2.5vw,32px);background:rgba(3,5,18,.76);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.theme-space-panel{position:relative;display:flex;width:min(1240px,100%);max-height:min(92vh,980px);flex-direction:column;overflow:hidden;border:1px solid rgba(178,164,255,.22);border-radius:24px;background:radial-gradient(ellipse at 78% 0%,rgba(73,65,151,.22),transparent 40%),linear-gradient(145deg,rgba(13,17,43,.98),rgba(6,10,27,.985));box-shadow:0 32px 120px rgba(0,0,0,.6),inset 0 1px rgba(255,255,255,.07);color:rgba(239,240,255,.92)}
.theme-space-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:clamp(20px,3vw,34px);border-bottom:1px solid rgba(177,168,255,.12);background:linear-gradient(110deg,rgba(130,113,222,.08),transparent 65%)}
.theme-space-heading{min-width:0}.theme-space-kicker,.theme-space-overline{color:rgba(177,170,235,.55);font-size:9px;font-weight:650;letter-spacing:.19em}.theme-space-kicker{display:flex;align-items:center;gap:9px;margin-bottom:12px}.theme-space-kicker-dot{width:6px;height:6px;border-radius:50%;background:#9d91ff;box-shadow:0 0 12px #9d91ff}.theme-space-title-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.theme-space-title-row h2{margin:0;color:#f0edff;font-size:clamp(22px,3vw,32px);font-weight:650;letter-spacing:.02em}.theme-space-heading>p{max-width:760px;margin:10px 0 0;color:rgba(199,198,230,.58);font-size:12px;line-height:1.8}.theme-space-status{padding:6px 10px;border:1px solid rgba(174,163,255,.18);border-radius:99px;font-size:10px}.theme-space-status.status-observing{color:#c7b9ff;background:rgba(157,137,255,.09)}.theme-space-status.status-exploring{color:#a9e9da;background:rgba(91,202,169,.09)}.theme-space-status.status-paused{color:#b8bfd7;background:rgba(151,160,190,.09)}
.theme-space-close{display:grid;width:38px;height:38px;flex:0 0 38px;place-items:center;border:1px solid rgba(190,181,255,.16);border-radius:50%;color:rgba(231,228,255,.72);background:rgba(255,255,255,.035);font-size:24px;cursor:pointer}.theme-space-close:hover{border-color:rgba(203,187,255,.42);background:rgba(160,140,255,.12)}.theme-space-scroll{min-height:0;overflow:auto;padding:clamp(16px,2.5vw,30px);scrollbar-color:rgba(161,149,232,.3) transparent;scrollbar-width:thin}
.theme-space-hero-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(220px,.75fr);gap:14px}.theme-space-network-card,.theme-space-summary-card,.theme-space-content-card,.theme-space-timeline-card{min-width:0;border:1px solid rgba(173,164,242,.13);border-radius:17px;background:rgba(255,255,255,.025);box-shadow:inset 0 1px rgba(255,255,255,.035)}.theme-space-network-card,.theme-space-content-card,.theme-space-timeline-card{padding:18px}.theme-space-section-topline{display:flex;align-items:center;justify-content:space-between;gap:12px}.theme-space-section-topline h3{margin:6px 0 0;color:rgba(232,230,255,.9);font-size:15px;font-weight:620}.theme-space-count{color:rgba(173,175,215,.49);font-size:10px;white-space:nowrap}.theme-space-network{position:relative;min-height:260px;margin-top:8px;overflow:hidden;border-radius:13px;background:radial-gradient(ellipse at 50% 50%,rgba(88,84,174,.16),transparent 62%),linear-gradient(180deg,rgba(7,12,33,.18),rgba(7,12,30,.42))}.theme-space-network:before{position:absolute;inset:12% 7%;border:1px solid rgba(157,148,235,.08);border-radius:50%;content:"";transform:rotate(-7deg)}.theme-space-network-glow{position:absolute;width:230px;height:160px;border-radius:50%;filter:blur(42px);opacity:.17;pointer-events:none}.theme-space-network-glow.glow-a{top:5%;left:16%;background:#6c83ff}.theme-space-network-glow.glow-b{right:8%;bottom:0;background:#3fd7de}.theme-space-network svg{position:relative;z-index:1;display:block;width:100%;height:260px}.theme-space-network-empty{position:absolute;right:12px;bottom:10px;color:rgba(190,190,220,.43);font-size:9px}
.theme-space-summary-card{display:flex;flex-direction:column;align-items:flex-start;padding:20px}.theme-space-summary-orb{display:grid;width:76px;height:76px;place-items:center;margin:20px auto 14px;align-self:center;border:1px solid rgba(172,157,255,.26);border-radius:50%;background:radial-gradient(circle,rgba(159,140,255,.25),rgba(91,81,164,.08) 48%,transparent 72%);box-shadow:0 0 42px rgba(142,120,255,.12),inset 0 0 24px rgba(149,130,255,.12)}.theme-space-summary-orb span{width:17px;height:17px;border-radius:50%;background:#e6e0ff;box-shadow:0 0 12px #fff,0 0 30px #a99aff,0 0 50px rgba(169,154,255,.7)}.theme-space-summary-card>strong{align-self:center;color:#e9e5ff;font-size:15px}.theme-space-summary-card>p{max-width:240px;margin:9px 0 18px;align-self:center;color:rgba(194,195,224,.57);font-size:10px;line-height:1.8;text-align:center}.theme-space-stat-grid{display:grid;width:100%;grid-template-columns:1fr 1fr;border-top:1px solid rgba(174,166,239,.1);border-bottom:1px solid rgba(174,166,239,.1)}.theme-space-stat-grid>div{display:grid;gap:4px;padding:13px 6px;text-align:center}.theme-space-stat-grid>div+div{border-left:1px solid rgba(174,166,239,.1)}.theme-space-stat-grid strong{color:#e5e0ff;font-size:22px;font-weight:600}.theme-space-stat-grid span{color:rgba(183,184,215,.48);font-size:9px}.theme-space-age{margin-top:14px;color:rgba(183,173,241,.56);font-size:10px}
.theme-space-content-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:14px;margin-top:14px}.theme-space-member-list,.theme-space-relation-list{display:grid;gap:10px;margin-top:15px}.theme-space-member,.theme-space-relation{padding:14px;border:1px solid rgba(175,164,242,.1);border-radius:12px;background:rgba(255,255,255,.022)}.theme-space-member-head,.theme-space-relation-head{display:flex;align-items:center;gap:9px}.theme-space-member-index{display:grid;width:26px;height:26px;flex:0 0 26px;place-items:center;border:1px solid color-mix(in srgb,var(--member-color) 42%,transparent);border-radius:50%;color:var(--member-color);background:color-mix(in srgb,var(--member-color) 9%,transparent);font-size:9px}.theme-space-member-date,.theme-space-relation-head>span:last-child{color:rgba(171,174,211,.43);font-size:9px}.theme-space-open-source{margin-left:auto;padding:5px 8px;border:1px solid rgba(173,161,255,.14);border-radius:7px;color:rgba(197,187,255,.75);background:rgba(143,126,255,.06);font:inherit;font-size:9px;cursor:pointer}.theme-space-open-source:hover{background:rgba(143,126,255,.15)}.theme-space-member-text{margin:12px 0 0;color:rgba(235,233,255,.87);font-size:13px;line-height:1.8;overflow-wrap:anywhere}.theme-space-analysis{margin-top:11px;padding:10px 11px;border-left:2px solid rgba(142,207,225,.48);border-radius:0 8px 8px 0;background:rgba(110,189,213,.045)}.theme-space-analysis>span,.theme-space-evidence>div>span{color:rgba(165,194,220,.62);font-size:9px}.theme-space-analysis p{margin:5px 0 0;color:rgba(194,202,226,.68);font-size:10px;line-height:1.7}.theme-space-relation-type{padding:5px 8px;border:1px solid rgba(159,146,244,.18);border-radius:99px;color:#c8baff;background:rgba(151,132,255,.08);font-size:9px}.theme-space-relation-head>span:last-child{margin-left:auto}.theme-space-relation-reason{margin:11px 0;color:rgba(226,224,247,.76);font-size:11px;line-height:1.7}.theme-space-evidence{display:grid;gap:7px}.theme-space-evidence>div{padding:9px 10px;border:1px solid rgba(171,163,227,.09);border-radius:8px;background:rgba(255,255,255,.025)}.theme-space-evidence p{margin:5px 0 0;color:rgba(204,200,231,.65);font-size:10px;line-height:1.7;overflow-wrap:anywhere}.theme-space-empty{padding:18px 10px;color:rgba(175,176,210,.45);font-size:10px;line-height:1.7;text-align:center}
.theme-space-timeline-card{margin-top:14px}.theme-space-timeline{display:grid;gap:0;margin:18px 0 0;padding:0;list-style:none}.theme-space-timeline-item{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr);gap:12px;padding-bottom:18px}.theme-space-timeline-item:not(:last-child):before{position:absolute;top:14px;bottom:-1px;left:5px;width:1px;background:linear-gradient(rgba(160,145,255,.38),rgba(160,145,255,.04));content:""}.theme-space-timeline-dot{position:relative;z-index:1;width:11px;height:11px;margin-top:3px;border:2px solid rgba(189,174,255,.8);border-radius:50%;background:#171733;box-shadow:0 0 12px rgba(157,135,255,.45)}.theme-space-timeline-copy>div{display:flex;align-items:center;gap:12px}.theme-space-timeline-copy strong{color:rgba(222,218,250,.83);font-size:11px;font-weight:600}.theme-space-timeline-copy time{color:rgba(160,164,204,.42);font-size:9px}.theme-space-timeline-copy>p{margin:6px 0 0;color:rgba(190,190,221,.62);font-size:10px;line-height:1.7}.theme-space-timeline-quote{margin:8px 0 0;padding:8px 11px;border-left:2px solid rgba(137,220,224,.38);border-radius:0 7px 7px 0;color:rgba(190,216,224,.66);background:rgba(89,169,178,.045);font-size:10px;line-height:1.65}.theme-space-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:15px;padding-top:15px;border-top:1px solid rgba(175,165,237,.1)}.theme-space-footer>span{color:rgba(157,163,204,.43);font-size:9px;line-height:1.6}.theme-space-footer button{padding:9px 13px;border:1px solid rgba(162,148,255,.25);border-radius:9px;color:#ddd6ff;background:linear-gradient(120deg,rgba(137,116,232,.25),rgba(83,151,192,.17));font:inherit;font-size:10px;cursor:pointer}.theme-space-footer button span{margin-left:8px}.theme-space-fade-enter-active,.theme-space-fade-leave-active{transition:opacity .22s ease,transform .22s ease}.theme-space-fade-enter-from,.theme-space-fade-leave-to{opacity:0}.theme-space-fade-enter-from .theme-space-panel,.theme-space-fade-leave-to .theme-space-panel{transform:translateY(12px) scale(.99)}

.theme-space-heading-actions{display:flex;gap:8px;margin-top:10px}
.theme-space-edit-toggle,.theme-space-edit-form button,.theme-space-candidate button,.theme-space-capture-foot button{border:1px solid rgba(171,157,255,.22);border-radius:9px;color:#dfd8ff;background:rgba(137,117,230,.12);font:inherit;font-size:10px;cursor:pointer}
.theme-space-edit-toggle{padding:7px 10px}
.theme-space-edit-form{display:grid;gap:10px;max-width:720px;margin-top:12px;padding:13px;border:1px solid rgba(171,157,255,.16);border-radius:12px;background:rgba(255,255,255,.025)}
.theme-space-edit-form label{display:grid;gap:6px;color:rgba(187,187,220,.65);font-size:10px}
.theme-space-edit-form input,.theme-space-edit-form textarea,.theme-space-capture-form textarea{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid rgba(171,157,255,.16);border-radius:9px;outline:none;color:#eeeaff;background:rgba(2,5,19,.55);font:inherit;font-size:11px;line-height:1.7;resize:vertical}
.theme-space-edit-form input:focus,.theme-space-edit-form textarea:focus,.theme-space-capture-form textarea:focus{border-color:rgba(174,158,255,.48)}
.theme-space-form-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
.theme-space-form-actions span,.theme-space-local-message{color:rgba(164,207,203,.66);font-size:9px}
.theme-space-form-actions button,.theme-space-candidate button,.theme-space-capture-foot button{padding:8px 11px}
.theme-space-status-actions{display:flex;flex-wrap:wrap;gap:5px;width:100%;margin-top:13px}
.theme-space-status-actions button{padding:6px 8px;border:1px solid rgba(171,162,222,.13);border-radius:8px;color:rgba(184,184,216,.62);background:rgba(255,255,255,.025);font:inherit;font-size:9px;cursor:pointer}
.theme-space-status-actions button.active{border-color:rgba(128,206,178,.28);color:#a9e5cd;background:rgba(75,171,133,.1)}
.theme-space-action-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-top:14px}
.theme-space-candidate-list{display:grid;gap:9px;margin-top:14px}
.theme-space-candidate{padding:12px;border:1px solid rgba(175,164,242,.1);border-radius:11px;background:rgba(255,255,255,.022)}
.theme-space-candidate p{margin:0;color:rgba(235,233,255,.84);font-size:11px;line-height:1.7;overflow-wrap:anywhere}
.theme-space-candidate>span{display:block;margin-top:7px;color:rgba(157,191,192,.55);font-size:9px}
.theme-space-candidate button{margin-top:10px}
.theme-space-capture-form{display:grid;gap:10px;margin-top:14px}
.theme-space-capture-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}
.theme-space-capture-foot>span{color:rgba(168,171,208,.48);font-size:9px;line-height:1.6}
.theme-space-local-message{margin:0}
@media(max-width:850px){.theme-space-hero-grid{grid-template-columns:1fr}.theme-space-summary-card{display:grid;grid-template-columns:70px 1fr;column-gap:14px;align-items:center}.theme-space-summary-card>.theme-space-overline{grid-column:1/-1}.theme-space-summary-orb{grid-row:2/5;width:62px;height:62px;margin:8px 0}.theme-space-summary-card>strong,.theme-space-summary-card>p{align-self:start;justify-self:start;text-align:left}.theme-space-summary-card>p{margin:4px 0 9px}.theme-space-stat-grid,.theme-space-age{grid-column:1/-1}.theme-space-content-grid{grid-template-columns:1fr}}
@media(max-width:560px){.theme-space-backdrop{padding:0}.theme-space-panel{max-height:100dvh;height:100dvh;border-radius:0;border-left:0;border-right:0}.theme-space-header{padding:18px 16px}.theme-space-scroll{padding:14px}.theme-space-network-card,.theme-space-content-card,.theme-space-timeline-card{padding:13px}.theme-space-network,.theme-space-network svg{min-height:210px;height:210px}.theme-space-section-topline{align-items:flex-start}.theme-space-count{white-space:normal;text-align:right}.theme-space-footer{align-items:flex-start;flex-direction:column}.theme-space-footer button{align-self:flex-end}}
@media(prefers-reduced-motion:reduce){.theme-space-fade-enter-active,.theme-space-fade-leave-active{transition:none}}


/* Phase 7 Theme Center V2: improve readability and make editing obvious. */
.theme-space-title-row h2 { font-size: clamp(25px, 2.7vw, 34px) !important; line-height: 1.3 !important; }
.theme-space-heading > p { font-size: 14px !important; line-height: 1.8 !important; }
.theme-space-edit-toggle { padding: 10px 15px !important; border-color: rgba(181,162,255,.42) !important; color: #f1eaff !important; background: linear-gradient(120deg,rgba(135,111,220,.3),rgba(65,125,172,.2)) !important; font-size: 13px !important; }
.theme-space-edit-form { padding: 17px !important; gap: 13px !important; }
.theme-space-edit-form label { font-size: 13px !important; }
.theme-space-edit-form input, .theme-space-edit-form textarea { padding: 12px 13px !important; font-size: 14px !important; }
.theme-space-form-actions span, .theme-space-local-message { font-size: 12px !important; }
.theme-space-form-actions button { padding: 10px 14px !important; font-size: 13px !important; }
.theme-space-section-topline h3 { font-size: 18px !important; }
.theme-space-member-text { font-size: 14px !important; }
.theme-space-relation-reason { font-size: 13px !important; }
.theme-space-evidence p { font-size: 12px !important; }
.theme-space-timeline-copy strong { font-size: 13px !important; }
.theme-space-timeline-copy > p { font-size: 12px !important; }



/* Phase 7.1 — 主题详情导航 */
.theme-space-tabs{position:sticky;top:0;z-index:12;display:flex;gap:7px;overflow-x:auto;margin:-2px 0 20px;padding:8px;border:1px solid rgba(172,160,244,.14);border-radius:14px;background:rgba(9,13,34,.9);backdrop-filter:blur(18px);scrollbar-width:thin}
.theme-space-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;flex:0 0 auto;padding:0 15px;border:1px solid transparent;border-radius:10px;color:rgba(210,211,239,.67);background:transparent;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .18s ease,border-color .18s ease,color .18s ease}
.theme-space-tabs button span{color:rgba(190,174,255,.8);font-size:16px}
.theme-space-tabs button em{display:inline-grid;min-width:20px;height:20px;place-items:center;border-radius:99px;color:rgba(210,205,255,.78);background:rgba(158,141,255,.12);font-size:10px;font-style:normal}
.theme-space-tabs button:hover{color:#f1edff;background:rgba(157,139,255,.08)}
.theme-space-tabs button.active{border-color:rgba(179,159,255,.3);color:#f3efff;background:linear-gradient(120deg,rgba(139,118,240,.24),rgba(86,147,190,.12));box-shadow:inset 0 1px rgba(255,255,255,.06),0 0 22px rgba(132,111,231,.08)}
.theme-space-single-column{grid-template-columns:minmax(0,1fr)}
@media(max-width:640px){.theme-space-tabs{margin:0 0 14px;padding:6px}.theme-space-tabs button{min-height:40px;padding:0 12px;font-size:12px}}

</style>
