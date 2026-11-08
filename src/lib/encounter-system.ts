/**
 * IdeaBoom · 时间回响 / 双星共振候选系统
 *
 * 只负责：筛选候选、频率限制、去重历史与本地持久化。
 * 不负责解释两条想法之间的关系；最终关联始终由用户确认。
 */

export interface EncounterIdea {
  id: number
  text: string
  createdAt: string
}

export type ResonanceKind = 'evolution' | 'cross-domain'

export interface TimeEchoCandidate {
  idea: EncounterIdea
  ageDays: number
  ageMinutes: number
}

export interface ResonanceCandidate {
  first: EncounterIdea
  second: EncounterIdea
  kind: ResonanceKind
  gapDays: number
  gapMinutes: number
  /** 仅供内部排序，不建议展示给用户，避免把分数误解为思想价值。 */
  lexicalSimilarity: number
  score: number
  pairKey: string
}

export type EchoUnavailableReason =
  | 'daily-limit'
  | 'weekly-limit'
  | 'not-mature'
  | 'cooldown'

export type ResonanceUnavailableReason =
  | 'weekly-limit'
  | 'not-enough-mature-ideas'
  | 'not-enough-time-gap'
  | 'no-quality-pair'

export interface EchoEvent {
  ideaId: number
  at: string
}

export interface ResonanceEvent {
  firstId: number
  secondId: number
  pairKey: string
  kind: ResonanceKind
  at: string
  gapDays: number
}

export interface EncounterHistory {
  version: 1
  echoEvents: EchoEvent[]
  resonanceEvents: ResonanceEvent[]
  /** 任意一种特殊呈现后，记录该想法最近一次出现时间。 */
  lastEventAtByIdea: Record<string, string>
}

export type EchoResult =
  | { candidate: TimeEchoCandidate; reason: null }
  | { candidate: null; reason: EchoUnavailableReason }

export type ResonanceResult =
  | { candidate: ResonanceCandidate; reason: null }
  | { candidate: null; reason: ResonanceUnavailableReason }

export const ENCOUNTER_STORAGE_KEY = 'idea-nebula-encounter-history-v1'

/**
 * 当前默认使用 demo 配置，方便首次运行时快速验证整条交互链路。
 * 验收完成后，把 ENCOUNTER_PROFILE 改为 'standard' 即可切回正式周期。
 */
export const ENCOUNTER_PROFILE: 'demo' | 'standard' = 'demo'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const DAY_MS = 24 * 60 * 60 * 1000

const ENCOUNTER_PROFILES = {
  demo: {
    // 15 秒沉淀即可进入时间回响；同一想法 30 秒内不重复出现。
    echoMinAgeMs: 15 * SECOND_MS,
    echoIdeaCooldownMs: 30 * SECOND_MS,
    echoWindowMs: 5 * MINUTE_MS,
    echoWindowLimit: 3,
    echoDailyLimit: 3,
    // 双星：两颗想法都至少 15 秒，创建时间至少相隔 30 秒。
    resonanceMinIdeaAgeMs: 15 * SECOND_MS,
    resonanceMinCreationGapMs: 30 * SECOND_MS,
    resonanceTargetGapMs: 60 * SECOND_MS,
    resonanceIdeaCooldownMs: 30 * SECOND_MS,
    resonanceWindowMs: 5 * MINUTE_MS,
    resonanceWindowLimit: 2,
  },
  standard: {
    echoMinAgeMs: 7 * DAY_MS,
    echoIdeaCooldownMs: 21 * DAY_MS,
    echoWindowMs: 7 * DAY_MS,
    echoWindowLimit: 3,
    echoDailyLimit: 1,
    resonanceMinIdeaAgeMs: 7 * DAY_MS,
    resonanceMinCreationGapMs: 14 * DAY_MS,
    resonanceTargetGapMs: 45 * DAY_MS,
    resonanceIdeaCooldownMs: 21 * DAY_MS,
    resonanceWindowMs: 7 * DAY_MS,
    resonanceWindowLimit: 1,
  },
} as const

/** 可在 demo / standard 之间切换的规则。相似度阈值两种模式共用。 */
export const ENCOUNTER_RULES = {
  ...ENCOUNTER_PROFILES[ENCOUNTER_PROFILE],
  minTextLength: 8,
  /** 太像视为重复，太远则不强行制造联系。 */
  evolutionSimilarityMin: 0.16,
  evolutionSimilarityMax: 0.68,
  crossSimilarityMin: 0.045,
  crossSimilarityMax: 0.16,
} as const

const STOP_NGRAMS = new Set([
  '为什么', '是不是', '有没有', '怎么样', '怎么会', '有时候', '有一些', '有些',
  '一个', '这个', '那个', '什么', '如果', '因为', '所以', '但是', '而且', '其实',
  '可能', '感觉', '觉得', '自己', '我们', '他们', '你们', '现在', '以前', '时候',
  '事情', '东西', '可以', '应该', '需要', '已经', '还是', '不是', '没有', '一种',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'you',
])

function emptyHistory(): EncounterHistory {
  return {
    version: 1,
    echoEvents: [],
    resonanceEvents: [],
    lastEventAtByIdea: {},
  }
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isKind(value: unknown): value is ResonanceKind {
  return value === 'evolution' || value === 'cross-domain'
}

export function loadEncounterHistory(storage: Storage = localStorage): EncounterHistory {
  try {
    const raw = storage.getItem(ENCOUNTER_STORAGE_KEY)
    if (!raw) return emptyHistory()
    const parsed = JSON.parse(raw) as Partial<EncounterHistory>
    if (!parsed || parsed.version !== 1) return emptyHistory()

    const echoEvents: EchoEvent[] = Array.isArray(parsed.echoEvents)
      ? parsed.echoEvents.filter((event): event is EchoEvent =>
          Boolean(event) && Number.isFinite(event.ideaId) && isValidDate(event.at),
        )
      : []

    const resonanceEvents: ResonanceEvent[] = Array.isArray(parsed.resonanceEvents)
      ? parsed.resonanceEvents.filter((event): event is ResonanceEvent =>
          Boolean(event)
          && Number.isFinite(event.firstId)
          && Number.isFinite(event.secondId)
          && typeof event.pairKey === 'string'
          && isKind(event.kind)
          && isValidDate(event.at)
          && Number.isFinite(event.gapDays),
        )
      : []

    const lastEventAtByIdea: Record<string, string> = {}
    if (parsed.lastEventAtByIdea && typeof parsed.lastEventAtByIdea === 'object') {
      for (const [id, at] of Object.entries(parsed.lastEventAtByIdea)) {
        if (isValidDate(at)) lastEventAtByIdea[id] = at
      }
    }

    return { version: 1, echoEvents, resonanceEvents, lastEventAtByIdea }
  } catch {
    return emptyHistory()
  }
}

export function saveEncounterHistory(
  history: EncounterHistory,
  storage: Storage = localStorage,
): boolean {
  try {
    storage.setItem(ENCOUNTER_STORAGE_KEY, JSON.stringify(history))
    return true
  } catch {
    return false
  }
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function wasUsedRecently(history: EncounterHistory, ideaId: number, now: number, cooldownMs: number): boolean {
  const last = history.lastEventAtByIdea[String(ideaId)]
  if (!last) return false
  const time = Date.parse(last)
  return Number.isFinite(time) && now - time < cooldownMs
}

function countEventsWithin(events: Array<{ at: string }>, now: number, windowMs: number): number {
  return events.filter((event) => {
    const at = Date.parse(event.at)
    return Number.isFinite(at) && now - at >= 0 && now - at < windowMs
  }).length
}

export function findTimeEcho(
  ideas: EncounterIdea[],
  history: EncounterHistory,
  now = Date.now(),
): EchoResult {
  const recentCount = countEventsWithin(history.echoEvents, now, ENCOUNTER_RULES.echoWindowMs)
  if (recentCount >= ENCOUNTER_RULES.echoWindowLimit) {
    return { candidate: null, reason: 'weekly-limit' }
  }

  const todayCount = history.echoEvents.filter((event) => {
    const at = Date.parse(event.at)
    return Number.isFinite(at) && localDateKey(at) === localDateKey(now)
  }).length
  if (todayCount >= ENCOUNTER_RULES.echoDailyLimit) {
    return { candidate: null, reason: 'daily-limit' }
  }

  const mature = ideas.filter((idea) => {
    const created = Date.parse(idea.createdAt)
    return Number.isFinite(created) && created <= now
      && now - created >= ENCOUNTER_RULES.echoMinAgeMs
  })
  if (mature.length === 0) return { candidate: null, reason: 'not-mature' }

  const available = mature.filter((idea) =>
    !wasUsedRecently(history, idea.id, now, ENCOUNTER_RULES.echoIdeaCooldownMs),
  )
  if (available.length === 0) return { candidate: null, reason: 'cooldown' }

  // 优先让最久没有重新出现的想法回来；从未回响过的想法排在前面。
  available.sort((a, b) => {
    const lastA = Date.parse(history.lastEventAtByIdea[String(a.id)] ?? '') || 0
    const lastB = Date.parse(history.lastEventAtByIdea[String(b.id)] ?? '') || 0
    if (lastA !== lastB) return lastA - lastB
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  })

  const idea = available[0]
  const ageMs = now - Date.parse(idea.createdAt)
  return { candidate: { idea, ageDays: ageMs / DAY_MS, ageMinutes: ageMs / MINUTE_MS }, reason: null }
}

/**
 * 轻量本地文本向量：中文用 2/3 字符片段，英文用词；按本批想法的 IDF 降低常见词影响。
 * 这只是候选过滤器，不是语义理解模型，也不判断两条想法是否真的有关联。
 */
function extractTerms(text: string): Map<string, number> {
  const normalized = text.toLocaleLowerCase().replace(/[\r\n\t]+/g, ' ')
  const chunks = normalized.match(/[\u3400-\u9fff]+|[a-z0-9]+/g) ?? []
  const counts = new Map<string, number>()

  const add = (term: string) => {
    if (term.length < 2 || STOP_NGRAMS.has(term)) return
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  for (const chunk of chunks) {
    if (/^[\u3400-\u9fff]+$/.test(chunk)) {
      const chars = Array.from(chunk)
      for (const size of [2, 3]) {
        for (let i = 0; i <= chars.length - size; i += 1) {
          add(chars.slice(i, i + size).join(''))
        }
      }
    } else if (chunk.length >= 3) {
      add(`en:${chunk}`)
    }
  }
  return counts
}

function buildTfidfVectors(ideas: EncounterIdea[]): Map<number, Map<string, number>> {
  const raw = new Map<number, Map<string, number>>()
  const documentFrequency = new Map<string, number>()

  for (const idea of ideas) {
    const terms = extractTerms(idea.text)
    raw.set(idea.id, terms)
    for (const term of terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const total = Math.max(1, ideas.length)
  const vectors = new Map<number, Map<string, number>>()
  for (const [id, terms] of raw) {
    const vector = new Map<string, number>()
    let normSquared = 0
    for (const [term, count] of terms) {
      const df = documentFrequency.get(term) ?? 1
      const idf = Math.log(1 + total / (1 + df)) + 1
      const weight = (1 + Math.log(count)) * idf
      vector.set(term, weight)
      normSquared += weight * weight
    }
    const norm = Math.sqrt(normSquared) || 1
    for (const [term, weight] of vector) vector.set(term, weight / norm)
    vectors.set(id, vector)
  }
  return vectors
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): { score: number; sharedTerms: number } {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  let sharedTerms = 0
  for (const [term, weight] of small) {
    const other = large.get(term)
    if (other !== undefined) {
      dot += weight * other
      sharedTerms += 1
    }
  }
  return { score: Math.max(0, Math.min(1, dot)), sharedTerms }
}

function pairKey(aId: number, bId: number): string {
  return [aId, bId].sort((a, b) => a - b).join(':')
}

export function findResonanceCandidate(
  ideas: EncounterIdea[],
  history: EncounterHistory,
  now = Date.now(),
): ResonanceResult {
  const recentCount = countEventsWithin(history.resonanceEvents, now, ENCOUNTER_RULES.resonanceWindowMs)
  if (recentCount >= ENCOUNTER_RULES.resonanceWindowLimit) {
    return { candidate: null, reason: 'weekly-limit' }
  }

  const mature = ideas.filter((idea) => {
    const created = Date.parse(idea.createdAt)
    return Number.isFinite(created) && created <= now
      && now - created >= ENCOUNTER_RULES.resonanceMinIdeaAgeMs
      && idea.text.trim().length >= ENCOUNTER_RULES.minTextLength
      && !wasUsedRecently(history, idea.id, now, ENCOUNTER_RULES.resonanceIdeaCooldownMs)
  })
  if (mature.length < 2) return { candidate: null, reason: 'not-enough-mature-ideas' }

  const seenPairs = new Set(history.resonanceEvents.map((event) => event.pairKey))
  const vectors = buildTfidfVectors(mature)
  const candidates: ResonanceCandidate[] = []
  let hadEnoughTimeGap = false

  for (let i = 0; i < mature.length; i += 1) {
    for (let j = i + 1; j < mature.length; j += 1) {
      const first = mature[i]
      const second = mature[j]
      const key = pairKey(first.id, second.id)
      if (seenPairs.has(key)) continue

      const gapMs = Math.abs(Date.parse(first.createdAt) - Date.parse(second.createdAt))
      if (gapMs < ENCOUNTER_RULES.resonanceMinCreationGapMs) continue
      hadEnoughTimeGap = true

      const firstVector = vectors.get(first.id)
      const secondVector = vectors.get(second.id)
      if (!firstVector || !secondVector || firstVector.size < 3 || secondVector.size < 3) continue

      const { score: similarity, sharedTerms } = cosineSimilarity(firstVector, secondVector)
      if (sharedTerms === 0) continue

      let kind: ResonanceKind
      let target: number
      let range: number
      if (similarity >= ENCOUNTER_RULES.evolutionSimilarityMin
        && similarity <= ENCOUNTER_RULES.evolutionSimilarityMax) {
        kind = 'evolution'
        target = 0.36
        range = 0.36
      } else if (similarity >= ENCOUNTER_RULES.crossSimilarityMin
        && similarity < ENCOUNTER_RULES.crossSimilarityMax) {
        kind = 'cross-domain'
        target = 0.105
        range = 0.105
      } else {
        continue
      }

      const gapMinutes = gapMs / MINUTE_MS
      const similarityFit = 1 - Math.min(1, Math.abs(similarity - target) / range)
      const timeFit = 1 - Math.min(1, Math.abs(gapMs - ENCOUNTER_RULES.resonanceTargetGapMs) / (ENCOUNTER_RULES.resonanceTargetGapMs * 3))
      const score = similarityFit * 0.78 + timeFit * 0.22
      candidates.push({
        first, second, kind, gapDays: gapMs / DAY_MS, gapMinutes,
        lexicalSimilarity: similarity, score, pairKey: key,
      })
    }
  }

  if (candidates.length === 0) {
    return { candidate: null, reason: hadEnoughTimeGap ? 'no-quality-pair' : 'not-enough-time-gap' }
  }

  candidates.sort((a, b) =>
    b.score - a.score
      || b.gapMinutes - a.gapMinutes
      || a.pairKey.localeCompare(b.pairKey),
  )

  return { candidate: candidates[0], reason: null }
}

export function recordTimeEcho(
  history: EncounterHistory,
  ideaId: number,
  now = Date.now(),
): EncounterHistory {
  const at = new Date(now).toISOString()
  return {
    ...history,
    echoEvents: [...history.echoEvents, { ideaId, at }].slice(-500),
    lastEventAtByIdea: { ...history.lastEventAtByIdea, [String(ideaId)]: at },
  }
}

export function recordResonance(
  history: EncounterHistory,
  candidate: ResonanceCandidate,
  now = Date.now(),
): EncounterHistory {
  const at = new Date(now).toISOString()
  return {
    ...history,
    resonanceEvents: [
      ...history.resonanceEvents,
      {
        firstId: candidate.first.id,
        secondId: candidate.second.id,
        pairKey: candidate.pairKey,
        kind: candidate.kind,
        at,
        gapDays: candidate.gapDays,
      },
    ].slice(-1000),
    lastEventAtByIdea: {
      ...history.lastEventAtByIdea,
      [String(candidate.first.id)]: at,
      [String(candidate.second.id)]: at,
    },
  }
}

export function getEchoUnavailableMessage(reason: EchoUnavailableReason): string {
  switch (reason) {
    case 'daily-limit': return '今天已经有一颗旧念回来了。让它先留在这里吧。'
    case 'weekly-limit': return ENCOUNTER_PROFILE === 'demo' ? '最近 5 分钟的回响次数已达到测试上限。' : '这一周的回响次数已经够了。给星云一点安静的时间。'
    case 'not-mature': return ENCOUNTER_PROFILE === 'demo' ? '想法还需要沉淀 15 秒，再来看看。' : '还没有想法沉淀满 7 天。新的念头先在星云里生长。'
    case 'cooldown': return ENCOUNTER_PROFILE === 'demo' ? '这颗想法刚刚出现过，稍等 30 秒再回来。' : '最近出现过的旧念正在沉淀，过些日子再相遇。'
  }
}

export function getResonanceUnavailableMessage(reason: ResonanceUnavailableReason): string {
  switch (reason) {
    case 'weekly-limit': return ENCOUNTER_PROFILE === 'demo' ? '最近 5 分钟已经完成足够多次共振，稍后再试。' : '本周已经发生过一次双星共振。让下一次相遇更值得期待。'
    case 'not-enough-mature-ideas': return ENCOUNTER_PROFILE === 'demo' ? '至少需要两条各自沉淀 15 秒的想法。' : '还没有足够成熟的想法。至少两颗想法需要先沉淀 7 天。'
    case 'not-enough-time-gap': return ENCOUNTER_PROFILE === 'demo' ? '两条想法的创建时间至少需要相隔 30 秒。' : '目前还没有相隔至少 14 天的想法组合。再给它们一些时间。'
    case 'no-quality-pair': return '目前没有找到值得展示的组合。星云可以继续保持安静。'
  }
}
