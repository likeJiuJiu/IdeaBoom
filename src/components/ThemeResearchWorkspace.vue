<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  ResearchThemeContext,
  ResearchObservationContext,
  ThemeResearchMode,
  ThemeResearchRun,
} from '../types/theme-research'
import { runThemeResearch } from '../lib/theme-research-api'
import { listThemeResearchRuns, saveThemeResearchRun } from '../lib/theme-research-store'

const props = defineProps<{
  theme: ResearchThemeContext
  observations: ResearchObservationContext[]
}>()

const modes: Array<{ id: ThemeResearchMode; title: string; description: string }> = [
  { id: 'solutions', title: '现有解决方案', description: '有哪些产品、平台、服务或案例正在解决类似问题？' },
  { id: 'user-feedback', title: '用户反馈', description: '公开讨论和评价中，用户表达了哪些真实体验？' },
  { id: 'alternatives', title: '竞品与替代方式', description: '用户现在还有哪些直接、间接或人工替代方案？' },
  { id: 'opportunities', title: '潜在机会', description: '现有方案还留下哪些值得验证的问题？' },
]

const selectedMode = ref<ThemeResearchMode>('solutions')
const question = ref('')
const searchQuery = ref('')
const deepRead = ref(false)
const consent = ref(false)
const isSearching = ref(false)
const statusMessage = ref('')
const currentRun = ref<ThemeResearchRun | null>(null)
const savedRuns = ref<ThemeResearchRun[]>([])
const isCurrentSaved = ref(false)
let restoringHistory = false

const selectedModeInfo = computed(() => modes.find((mode) => mode.id === selectedMode.value) ?? modes[0])
const usableObservations = computed(() => {
  const idSet = new Set(props.theme.observationIds)
  return props.observations.filter((item) => idSet.has(item.id)).slice(0, 6)
})
const sourcesCount = computed(() => currentRun.value?.sources.length ?? 0)

function defaultQuestion(mode: ThemeResearchMode): string {
  const map: Record<ThemeResearchMode, string> = {
    solutions: `目前有哪些方案正在解决“${props.theme.title}”所涉及的问题？`,
    'user-feedback': `公开用户讨论和评价中，是否有人提到“${props.theme.title}”相关体验？`,
    alternatives: `围绕“${props.theme.title}”，用户目前有哪些直接、间接或人工替代方式？`,
    opportunities: `现有方案在“${props.theme.title}”相关场景中还留下哪些待验证的问题？`,
  }
  return map[mode]
}

function refreshHistory(): void {
  savedRuns.value = listThemeResearchRuns(props.theme.id)
}

watch(() => props.theme.id, () => {
  currentRun.value = null
  question.value = defaultQuestion(selectedMode.value)
  searchQuery.value = ''
  isCurrentSaved.value = false
  refreshHistory()
}, { immediate: true })

watch(selectedMode, (mode) => {
  if (restoringHistory) return
  question.value = defaultQuestion(mode)
  searchQuery.value = ''
})

onMounted(refreshHistory)

async function startResearch(): Promise<void> {
  if (!consent.value) {
    statusMessage.value = '请先确认本次研究会将主题内容发送给外部搜索和模型服务。'
    return
  }
  if (!question.value.trim()) {
    statusMessage.value = '请先写下本次希望研究的问题。'
    return
  }
  isSearching.value = true
  statusMessage.value = '正在检索公开资料并整理来源……'
  currentRun.value = null
  isCurrentSaved.value = false
  try {
    const run = await runThemeResearch({
      theme: {
        id: props.theme.id,
        title: props.theme.title,
        description: props.theme.description,
        observationIds: [...props.theme.observationIds],
      },
      observations: usableObservations.value.map((item) => ({
        id: item.id,
        text: item.text.slice(0, 280),
        createdAt: item.createdAt,
      })),
      mode: selectedMode.value,
      question: question.value.trim(),
      query: searchQuery.value.trim() || undefined,
      deepRead: deepRead.value,
      consentConfirmed: true,
    })
    currentRun.value = run
    statusMessage.value = run.sources.length
      ? `检索完成，找到 ${run.sources.length} 条公开来源。请检查原文后再采用结论。`
      : '本次没有找到可用来源，可以调整关键词后重试。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : '研究请求失败，请稍后重试。'
  } finally {
    isSearching.value = false
  }
}

function saveCurrentRun(): void {
  if (!currentRun.value) return
  try {
    saveThemeResearchRun(currentRun.value)
    isCurrentSaved.value = true
    refreshHistory()
    statusMessage.value = '本次研究已保存到当前主题。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : '研究记录保存失败。'
  }
}

function openHistory(run: ThemeResearchRun): void {
  currentRun.value = run
  restoringHistory = true
  selectedMode.value = run.mode
  question.value = run.question
  searchQuery.value = run.query
  deepRead.value = run.deepRead
  Promise.resolve().then(() => { restoringHistory = false })
  isCurrentSaved.value = true
  statusMessage.value = `已打开 ${new Date(run.createdAt).toLocaleString()} 的研究记录。`
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    'external-fact': '外部资料',
    'user-feedback': '公开用户反馈',
    'market-pattern': '资料中的共同模式',
    'ai-inference': 'AI 推断',
  }
  return labels[kind] ?? '研究发现'
}

function formatDate(value?: string): string {
  if (!value) return '未识别发布日期'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <section class="research-workspace">
    <header class="research-header">
      <div>
        <div class="research-eyebrow">IDEABOOM / EXTERNAL EXPLORATION</div>
        <h2>把个人观察，放到现实世界中继续研究。</h2>
        <p>围绕「{{ theme.title }}」检索公开方案、用户反馈和相关案例。研究结果会保留来源，AI 推断不会冒充事实。</p>
      </div>
      <div class="research-count">
        <strong>{{ savedRuns.length }}</strong>
        <span>次已保存研究</span>
      </div>
    </header>

    <div class="research-context">
      <span class="context-label">当前主题</span>
      <strong>{{ theme.title }}</strong>
      <p>{{ theme.description || '尚未补充主题描述。' }}</p>
      <span class="context-footnote">本次将携带 {{ usableObservations.length }} 条主题观察摘要作为检索上下文。</span>
    </div>

    <div class="research-section-heading">
      <h3>选择研究方向</h3>
      <span>按主题选择，不需要一次完成全部研究</span>
    </div>
    <div class="research-mode-grid" role="group" aria-label="研究方向">
      <button
        v-for="mode in modes"
        :key="mode.id"
        class="research-mode-card"
        :aria-pressed="selectedMode === mode.id"
        :class="{ active: selectedMode === mode.id }"
        type="button"
        @click="selectedMode = mode.id"
      >
        <span class="mode-dot"></span>
        <strong>{{ mode.title }}</strong>
        <small>{{ mode.description }}</small>
      </button>
    </div>

    <div class="research-query-panel">
      <label for="research-question">本次研究问题</label>
      <textarea id="research-question" v-model="question" rows="3" maxlength="500"></textarea>
      <label for="research-query">搜索关键词（可选，留空时自动组合）</label>
      <input id="research-query" v-model="searchQuery" maxlength="500" placeholder="例如：校园活动信息聚合平台 学生 使用反馈" />
      <label class="deep-read-option">
        <input v-model="deepRead" type="checkbox" />
        <span><strong>深读前 5 条来源</strong><small>额外提取网页正文片段，通常能让 AI 归纳更准确；会增加搜索服务用量。</small></span>
      </label>
      <label class="research-consent">
        <input v-model="consent" type="checkbox" />
        <span>我已了解数据发送范围：搜索服务会收到本次检索关键词；模型服务会收到主题名称、描述、最多 6 条观察摘要，以及检索到的公开网页摘要/正文，用于生成研究结果。不会发送完整观察库。研究结果仅在我点击保存后写入本地浏览器。</span>
      </label>
      <div class="research-submit-row">
        <p>{{ selectedModeInfo.description }}<br />外部事实与用户反馈必须有来源链接；AI 推断会单独标记。</p>
        <button type="button" :disabled="isSearching" @click="startResearch">
          <span v-if="isSearching" class="button-spinner"></span>
          {{ isSearching ? '正在研究…' : '开始外部探索 ↗' }}
        </button>
      </div>
    </div>

    <p v-if="statusMessage" class="research-status" role="status" aria-live="polite">{{ statusMessage }}</p>

    <section v-if="currentRun" class="research-results">
      <header class="results-header">
        <div>
          <div class="research-eyebrow">RESEARCH RESULTS</div>
          <h3>{{ currentRun.question }}</h3>
          <p>{{ formatDate(currentRun.createdAt) }} · {{ sourcesCount }} 条来源 · {{ currentRun.deepRead ? '已尝试深读' : '搜索摘要模式' }}</p>
        </div>
        <button v-if="!isCurrentSaved" class="save-research-button" type="button" @click="saveCurrentRun">保存到主题</button>
        <span v-else class="saved-pill">已保存到主题</span>
      </header>

      <div v-if="currentRun.synthesis" class="synthesis-card">
        <h4>AI 综合摘要</h4>
        <p>{{ currentRun.synthesis.summary }}</p>
        <div v-if="currentRun.synthesis.findings.length" class="findings-list">
          <article v-for="finding in currentRun.synthesis.findings" :key="finding.id" class="finding-item">
            <div class="finding-meta">
              <span :class="['finding-kind', finding.kind]">{{ kindLabel(finding.kind) }}</span>
              <span v-if="finding.sourceUrls.length" class="finding-source-count">{{ finding.sourceUrls.length }} 个来源</span>
            </div>
            <p>{{ finding.statement }}</p>
            <small v-if="finding.caveat">说明：{{ finding.caveat }}</small>
            <div v-if="finding.sourceUrls.length" class="inline-source-links">
              <a v-for="url in finding.sourceUrls" :key="url" :href="url" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>
            </div>
          </article>
        </div>
        <div v-if="currentRun.synthesis.opportunities.length" class="opportunities-block">
          <h4>值得继续验证的假设</h4>
          <article v-for="item in currentRun.synthesis.opportunities" :key="item.id" class="opportunity-item">
            <strong>{{ item.hypothesis }}</strong>
            <p>{{ item.whyWorthExploring }}</p>
            <small>下一步可以验证：{{ item.validationQuestion }}</small>
            <div v-if="item.supportingUrls.length" class="inline-source-links">
              <a v-for="url in item.supportingUrls" :key="url" :href="url" target="_blank" rel="noopener noreferrer">依据来源 ↗</a>
            </div>
          </article>
        </div>
        <div v-if="currentRun.synthesis.unknowns.length" class="unknowns-block">
          <h4>目前仍未知</h4>
          <ul><li v-for="unknown in currentRun.synthesis.unknowns" :key="unknown">{{ unknown }}</li></ul>
        </div>
      </div>
      <div v-else-if="currentRun.analysisNotice" class="research-notice">{{ currentRun.analysisNotice }}</div>
      <div v-else class="research-notice">暂时没有足够的公开资料形成摘要。可以调整关键词重新检索。</div>

      <div class="sources-heading">
        <h4>检索来源</h4>
        <span>检索来源不等于事实已核实；点击原文查看上下文。</span>
      </div>
      <div v-if="currentRun.sources.length" class="source-list">
        <article v-for="(source, index) in currentRun.sources" :key="source.id" class="source-card">
          <div class="source-topline"><span>来源 {{ String(index + 1).padStart(2, '0') }}</span><span>{{ source.domain }}</span></div>
          <a class="source-title" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a>
          <p>{{ source.snippet || '搜索服务未返回摘要。' }}</p>
          <div class="source-footline">
            <span>发布日期：{{ formatDate(source.publishedAt) }}</span>
            <span>{{ source.extracted ? '已提取正文片段' : '仅有搜索摘要' }}</span>
            <span>检索于 {{ formatDate(source.retrievedAt) }}</span>
          </div>
        </article>
      </div>
      <div v-else class="empty-sources">本次没有返回可用来源。</div>
    </section>

    <section v-if="savedRuns.length" class="research-history">
      <div class="research-section-heading">
        <h3>本主题的研究历史</h3>
        <span>研究结果独立保存，不会覆盖原始观察。</span>
      </div>
      <button v-for="run in savedRuns" :key="run.id" class="history-row" type="button" @click="openHistory(run)">
        <span class="history-mode">{{ modes.find((item) => item.id === run.mode)?.title || '外部研究' }}</span>
        <strong>{{ run.question }}</strong>
        <small>{{ formatDate(run.createdAt) }} · {{ run.sources.length }} 条来源</small>
        <span class="history-arrow">↗</span>
      </button>
    </section>
  </section>
</template>

<style scoped>
.research-workspace { display:grid; gap:22px; color:rgba(244,245,255,.93); font-size:14px; }
.research-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
.research-eyebrow { color:rgba(183,169,255,.72); font-size:11px; letter-spacing:.16em; font-weight:700; }
.research-header h2 { margin:8px 0 8px; font-size:24px; line-height:1.38; font-weight:700; }
.research-header p { max-width:760px; margin:0; color:rgba(218,221,245,.66); font-size:14px; line-height:1.8; }
.research-count { min-width:92px; padding:12px 15px; border:1px solid rgba(174,160,255,.2); border-radius:15px; background:rgba(150,132,255,.07); text-align:center; }
.research-count strong { display:block; font-size:25px; }
.research-count span { color:rgba(215,216,241,.62); font-size:11px; }
.research-context,.research-query-panel,.synthesis-card,.research-notice { padding:19px; border:1px solid rgba(169,157,255,.16); border-radius:17px; background:rgba(16,20,49,.54); }
.context-label { display:block; margin-bottom:7px; color:rgba(183,169,255,.72); font-size:11px; letter-spacing:.08em; }
.research-context strong { font-size:17px; }
.research-context p { margin:8px 0; color:rgba(222,224,245,.72); font-size:14px; line-height:1.75; }
.context-footnote { color:rgba(189,195,225,.48); font-size:12px; }
.research-section-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
.research-section-heading h3 { margin:0; font-size:18px; }
.research-section-heading span { color:rgba(193,198,227,.5); font-size:12px; }
.research-mode-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:11px; }
.research-mode-card { min-height:105px; padding:15px 16px; border:1px solid rgba(160,160,220,.15); border-radius:15px; color:inherit; text-align:left; background:rgba(255,255,255,.035); cursor:pointer; transition:border-color .18s ease,background .18s ease,transform .18s ease; }
.research-mode-card:hover { transform:translateY(-1px); border-color:rgba(183,169,255,.36); }
.research-mode-card.active { border-color:rgba(181,163,255,.58); background:rgba(145,125,255,.12); box-shadow:0 0 24px rgba(125,103,255,.09); }
.mode-dot { display:inline-block; width:7px; height:7px; margin-right:8px; border-radius:50%; background:#9c8cff; box-shadow:0 0 10px #9c8cff; }
.research-mode-card strong { font-size:15px; }
.research-mode-card small { display:block; margin-top:9px; color:rgba(209,214,241,.58); font-size:12px; line-height:1.55; }
.research-query-panel { display:grid; gap:10px; }
.research-query-panel > label:not(.deep-read-option):not(.research-consent) { margin-top:2px; color:rgba(222,223,245,.82); font-size:13px; font-weight:650; }
.research-query-panel textarea,.research-query-panel input:not([type=checkbox]) { width:100%; padding:12px 13px; border:1px solid rgba(175,168,230,.2); border-radius:11px; outline:none; color:rgba(246,246,255,.93); background:rgba(5,10,30,.56); font:inherit; font-size:14px; line-height:1.65; }
.research-query-panel textarea:focus,.research-query-panel input:focus { border-color:rgba(180,164,255,.66); box-shadow:0 0 0 3px rgba(153,132,255,.1); }
.deep-read-option,.research-consent { display:flex; align-items:flex-start; gap:9px; color:rgba(222,224,244,.78); font-size:12px; line-height:1.6; cursor:pointer; }
.deep-read-option input,.research-consent input { margin-top:4px; accent-color:#a997ff; }
.deep-read-option span { display:grid; gap:2px; }
.deep-read-option strong { font-size:13px; }
.deep-read-option small { color:rgba(190,197,226,.55); font-size:11px; }
.research-consent { padding-top:11px; border-top:1px solid rgba(160,160,220,.1); }
.research-submit-row { display:flex; align-items:center; justify-content:space-between; gap:15px; margin-top:5px; }
.research-submit-row p { margin:0; color:rgba(191,198,225,.5); font-size:12px; }
.research-submit-row button,.save-research-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:42px; padding:0 18px; border:1px solid rgba(182,164,255,.48); border-radius:12px; color:#fff; background:linear-gradient(135deg,rgba(130,111,255,.86),rgba(71,91,173,.82)); font-size:14px; font-weight:650; cursor:pointer; }
.research-submit-row button:disabled { opacity:.55; cursor:wait; }
.button-spinner { width:13px; height:13px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:research-spin .8s linear infinite; }
@keyframes research-spin { to { transform:rotate(360deg); } }
.research-status { margin:0; color:rgba(190,202,239,.78); font-size:13px; line-height:1.6; }
.results-header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
.results-header h3 { margin:6px 0; font-size:19px; line-height:1.5; }
.results-header p { margin:0; color:rgba(192,198,226,.52); font-size:12px; }
.saved-pill { padding:8px 12px; border:1px solid rgba(104,220,176,.28); border-radius:999px; color:#a6ebd1; font-size:12px; white-space:nowrap; }
.synthesis-card { display:grid; gap:14px; }
.synthesis-card h4,.opportunities-block h4,.unknowns-block h4,.sources-heading h4 { margin:0; font-size:16px; }
.synthesis-card > p { margin:0; color:rgba(231,232,249,.85); font-size:14px; line-height:1.85; }
.findings-list { display:grid; gap:11px; }
.finding-item,.opportunity-item { padding:14px; border:1px solid rgba(163,159,222,.13); border-radius:13px; background:rgba(255,255,255,.025); }
.finding-meta { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.finding-kind { padding:4px 8px; border-radius:999px; color:#d5ccff; background:rgba(153,132,255,.13); font-size:11px; }
.finding-kind.user-feedback { color:#aee5dc; background:rgba(96,202,177,.12); }
.finding-kind.ai-inference { color:#f0d49d; background:rgba(226,176,85,.12); }
.finding-source-count,.finding-item small,.opportunity-item small { color:rgba(190,197,226,.55); font-size:11px; }
.finding-item p,.opportunity-item p { margin:0 0 8px; font-size:14px; line-height:1.75; }
.inline-source-links { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; }
.inline-source-links a { color:#bfb2ff; font-size:12px; text-decoration:none; }
.inline-source-links a:hover { text-decoration:underline; }
.opportunities-block,.unknowns-block { display:grid; gap:10px; }
.opportunity-item strong { display:block; margin-bottom:7px; color:#f2e8ca; font-size:14px; }
.unknowns-block ul { margin:0; padding-left:20px; color:rgba(216,220,240,.68); font-size:13px; line-height:1.8; }
.research-notice { color:rgba(219,224,246,.7); font-size:13px; line-height:1.7; }
.sources-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:5px; }
.sources-heading span { color:rgba(191,197,224,.48); font-size:11px; }
.source-list { display:grid; gap:10px; }
.source-card { padding:15px; border:1px solid rgba(160,160,220,.14); border-radius:14px; background:rgba(255,255,255,.03); }
.source-topline,.source-footline { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; color:rgba(184,192,222,.47); font-size:11px; }
.source-title { display:block; margin:9px 0 7px; color:#d9d0ff; font-size:15px; font-weight:650; line-height:1.5; text-decoration:none; }
.source-title:hover { color:#fff; }
.source-card p { margin:0 0 10px; color:rgba(216,220,242,.72); font-size:13px; line-height:1.7; }
.empty-sources { padding:20px; border:1px dashed rgba(169,164,221,.2); border-radius:13px; color:rgba(194,199,225,.54); text-align:center; font-size:13px; }
.research-history { display:grid; gap:12px; }
.history-row { display:grid; grid-template-columns:115px 1fr auto 18px; align-items:center; gap:12px; padding:13px 15px; border:1px solid rgba(163,160,220,.13); border-radius:13px; color:inherit; text-align:left; background:rgba(255,255,255,.025); cursor:pointer; }
.history-row:hover { border-color:rgba(172,159,255,.4); background:rgba(145,125,255,.07); }
.history-mode { color:#c9bfff; font-size:12px; }
.history-row strong { overflow:hidden; font-size:13px; font-weight:550; text-overflow:ellipsis; white-space:nowrap; }
.history-row small { color:rgba(187,195,222,.48); font-size:11px; }
.history-arrow { color:#b8aaff; }
@media (max-width:760px) {
  .research-header { display:grid; }
  .research-count { display:flex; align-items:baseline; justify-content:flex-start; gap:8px; width:max-content; }
  .research-mode-grid { grid-template-columns:1fr; }
  .research-submit-row { align-items:stretch; flex-direction:column; }
  .research-submit-row button { width:100%; }
  .results-header { flex-direction:column; }
  .sources-heading { align-items:flex-start; flex-direction:column; }
  .history-row { grid-template-columns:1fr 18px; }
  .history-row > strong { white-space:normal; }
  .history-mode,.history-row small { grid-column:1; }
  .history-arrow { grid-column:2; grid-row:1 / span 3; }
}
</style>
