import type {
  ObservationAnalysis,
  ObservationRelation,
  ObservationWorkspaceState,
  ProblemTheme,
  RelationStatus,
  ThemeEvent,
  ThemeEventType,
  ThemeStatus,
} from '../types/observation'

const STORAGE_KEY = 'ideaboom-observation-workspace-v1'

export function emptyObservationWorkspace(): ObservationWorkspaceState {
  return {
    version: 1,
    analyses: {},
    relations: [],
    themes: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function createThemeEvent(
  type: ThemeEventType,
  message: string,
  extra: Partial<Pick<ThemeEvent, 'observationId' | 'previousStatus' | 'nextStatus'>> = {},
): ThemeEvent {
  return {
    id: createId(),
    type,
    at: new Date().toISOString(),
    message,
    ...extra,
  }
}

function normalizeThemeEvent(value: unknown): ThemeEvent | null {
  if (!isRecord(value)) return null
  const allowedTypes = new Set<ThemeEventType>([
    'created',
    'observation-added',
    'status-changed',
    'duplicate-merged',
  ])
  const type = String(value.type) as ThemeEventType
  if (!allowedTypes.has(type)) return null

  const allowedStatuses = new Set<ThemeStatus>(['observing', 'exploring', 'paused'])
  const previousStatus = allowedStatuses.has(String(value.previousStatus) as ThemeStatus)
    ? value.previousStatus as ThemeStatus
    : undefined
  const nextStatus = allowedStatuses.has(String(value.nextStatus) as ThemeStatus)
    ? value.nextStatus as ThemeStatus
    : undefined
  const observationId = Number(value.observationId)

  return {
    id: safeString(value.id, createId()),
    type,
    at: safeString(value.at, new Date().toISOString()),
    message: safeString(value.message),
    ...(Number.isFinite(observationId) ? { observationId } : {}),
    ...(previousStatus ? { previousStatus } : {}),
    ...(nextStatus ? { nextStatus } : {}),
  }
}

function normalizeRelation(value: unknown): ObservationRelation | null {
  if (!isRecord(value)) return null
  const sourceId = Number(value.sourceId)
  const targetId = Number(value.targetId)
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId) || sourceId === targetId) return null

  const allowedTypes = new Set([
    'same-scene',
    'shared-friction',
    'cross-scene',
    'possible-contradiction',
    'other',
  ])
  const allowedStatuses = new Set(['suggested', 'confirmed', 'rejected'])
  const allowedEngines = new Set(['llm', 'local-rules'])
  const now = new Date().toISOString()

  return {
    id: safeString(value.id, relationId(sourceId, targetId)),
    sourceId,
    targetId,
    type: allowedTypes.has(String(value.type)) ? value.type as ObservationRelation['type'] : 'other',
    reason: safeString(value.reason),
    evidenceFromSource: safeString(value.evidenceFromSource),
    evidenceFromTarget: safeString(value.evidenceFromTarget),
    sharedTerms: safeStringArray(value.sharedTerms),
    status: allowedStatuses.has(String(value.status)) ? value.status as RelationStatus : 'suggested',
    engine: allowedEngines.has(String(value.engine)) ? value.engine as ObservationRelation['engine'] : 'local-rules',
    createdAt: safeString(value.createdAt, now),
    updatedAt: safeString(value.updatedAt, now),
  }
}

function normalizeAnalysis(key: string, value: unknown): ObservationAnalysis | null {
  if (!isRecord(value)) return null
  const engine = value.engine === 'llm' ? 'llm' : 'local-rules'
  return {
    observationId: Number.isFinite(Number(value.observationId)) ? Number(value.observationId) : Number(key),
    generatedAt: safeString(value.generatedAt, new Date().toISOString()),
    engine,
    summary: safeString(value.summary),
    scene: safeString(value.scene),
    phenomenon: safeString(value.phenomenon),
    friction: safeString(value.friction),
    affectedPeople: safeString(value.affectedPeople),
    currentWorkaround: safeString(value.currentWorkaround),
    potentialProblem: safeString(value.potentialProblem),
    questionToExplore: safeString(value.questionToExplore),
    keywords: safeStringArray(value.keywords),
    unknowns: safeStringArray(value.unknowns),
  }
}

function normalizeTheme(value: unknown): ProblemTheme | null {
  if (!isRecord(value)) return null
  const allowedStatuses = new Set<ThemeStatus>(['observing', 'exploring', 'paused'])
  const ids = Array.isArray(value.observationIds)
    ? value.observationIds.map(Number).filter(Number.isFinite)
    : []
  if (!safeString(value.title).trim() || new Set(ids).size < 2) return null

  const now = new Date().toISOString()
  const id = safeString(value.id, createId())
  const createdAt = safeString(value.createdAt, now)
  const events = Array.isArray(value.events)
    ? value.events.map(normalizeThemeEvent).filter((item): item is ThemeEvent => item !== null)
    : []

  // 旧版本主题没有事件日志；用 createdAt 建立一条明确标注为历史迁移的起点，不伪造后续操作。
  if (!events.some((event) => event.type === 'created')) {
    events.unshift({
      id: `legacy-created-${id}`,
      type: 'created',
      at: createdAt,
      message: '主题创建于历史版本；此前没有保存详细的演进记录。',
    })
  }

  return {
    id,
    title: safeString(value.title),
    description: safeString(value.description),
    observationIds: [...new Set(ids)],
    status: allowedStatuses.has(String(value.status) as ThemeStatus)
      ? value.status as ThemeStatus
      : 'observing',
    createdAt,
    updatedAt: safeString(value.updatedAt, now),
    events,
  }
}

function themeMemberKey(observationIds: number[]): string {
  return [...new Set(observationIds)].sort((a, b) => a - b).join(':')
}

/**
 * 仅合并成员 ID 完全相同的主题。
 * 有交集但成员不同的主题不合并，避免把不同问题错误归为一类。
 * 保留最早创建主题的 ID 和标题，并汇总所有演进记录。
 */
function deduplicateProblemThemes(input: ProblemTheme[]): ProblemTheme[] {
  const ordered = [...input].sort((a, b) => {
    const aTime = Date.parse(a.createdAt) || 0
    const bTime = Date.parse(b.createdAt) || 0
    return aTime - bTime
  })
  const byMembers = new Map<string, ProblemTheme>()

  for (const candidate of ordered) {
    const key = themeMemberKey(candidate.observationIds)
    const existing = byMembers.get(key)
    if (!existing) {
      byMembers.set(key, { ...candidate, events: [...candidate.events] })
      continue
    }

    const combinedEvents = [...existing.events, ...candidate.events]
    combinedEvents.push(createThemeEvent(
      'duplicate-merged',
      `与「${candidate.title}」包含相同的观察记录，已合并到「${existing.title}」。`,
    ))
    const latestUpdatedAt = [existing.updatedAt, candidate.updatedAt]
      .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0]

    const candidateIsNewer = (Date.parse(candidate.updatedAt) || 0) > (Date.parse(existing.updatedAt) || 0)
    byMembers.set(key, {
      ...existing,
      description: existing.description || candidate.description,
      status: candidateIsNewer ? candidate.status : existing.status,
      updatedAt: latestUpdatedAt,
      events: combinedEvents.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)),
    })
  }

  return [...byMembers.values()].sort((a, b) =>
    (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
  )
}

export function loadObservationWorkspace(): ObservationWorkspaceState {
  if (typeof window === 'undefined') return emptyObservationWorkspace()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyObservationWorkspace()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return emptyObservationWorkspace()

    const analyses: Record<string, ObservationAnalysis> = {}
    if (isRecord(parsed.analyses)) {
      for (const [key, value] of Object.entries(parsed.analyses)) {
        const normalized = normalizeAnalysis(key, value)
        if (normalized) analyses[key] = normalized
      }
    }

    const relations = Array.isArray(parsed.relations)
      ? parsed.relations.map(normalizeRelation).filter((item): item is ObservationRelation => item !== null)
      : []
    const rawThemes = Array.isArray(parsed.themes)
      ? parsed.themes.map(normalizeTheme).filter((item): item is ProblemTheme => item !== null)
      : []
    const themes = deduplicateProblemThemes(rawThemes)

    const state: ObservationWorkspaceState = { version: 1, analyses, relations, themes }
    // 兼容旧版主题数据，并在检测到重复成员组合时自动保存整理结果。
    if (themes.length !== rawThemes.length) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch (error) {
        console.warn('[IdeaBoom] 自动整理重复主题失败，内存中仍使用去重结果：', error)
      }
    }
    return state
  } catch {
    return emptyObservationWorkspace()
  }
}

export function saveObservationWorkspace(state: ObservationWorkspaceState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('[IdeaBoom] 保存观察工作台数据失败：', error)
    throw new Error('浏览器暂时无法保存观察分析数据，请检查存储空间。')
  }
}

export function relationId(aId: number, bId: number): string {
  return [aId, bId].sort((a, b) => a - b).join(':')
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ib-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function upsertRelation(
  state: ObservationWorkspaceState,
  relation: ObservationRelation,
): ObservationWorkspaceState {
  const key = relationId(relation.sourceId, relation.targetId)
  const index = state.relations.findIndex((item) => relationId(item.sourceId, item.targetId) === key)
  const next = [...state.relations]
  if (index >= 0) {
    const previous = next[index]
    // 保留用户已经做出的确认/否定，不让后续 AI 分析覆盖人工决定。
    if (previous.status === 'confirmed' || previous.status === 'rejected') return state
    next[index] = { ...previous, ...relation, id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() }
  } else {
    next.push(relation)
  }
  return { ...state, relations: next }
}

export function updateRelationStatus(
  state: ObservationWorkspaceState,
  sourceId: number,
  targetId: number,
  status: RelationStatus,
): ObservationWorkspaceState {
  const key = relationId(sourceId, targetId)
  const now = new Date().toISOString()
  const index = state.relations.findIndex((item) => relationId(item.sourceId, item.targetId) === key)
  if (index < 0) return state
  const relations = [...state.relations]
  relations[index] = { ...relations[index], status, updatedAt: now }
  return { ...state, relations }
}

export function addProblemTheme(
  state: ObservationWorkspaceState,
  input: Pick<ProblemTheme, 'title' | 'description' | 'observationIds'>,
): ObservationWorkspaceState {
  const title = input.title.trim()
  const observationIds = [...new Set(input.observationIds)]
  if (!title || observationIds.length < 2) return state

  const memberKey = themeMemberKey(observationIds)
  const duplicate = state.themes.some((theme) => themeMemberKey(theme.observationIds) === memberKey)
  if (duplicate) return state

  const now = new Date().toISOString()
  const theme: ProblemTheme = {
    id: createId(),
    title,
    description: input.description.trim(),
    observationIds,
    status: 'observing',
    createdAt: now,
    updatedAt: now,
    events: [createThemeEvent('created', `创建主题「${title}」，包含 ${observationIds.length} 条已确认关联的观察。`)],
  }
  return { ...state, themes: [theme, ...state.themes] }
}

export function extendProblemTheme(
  state: ObservationWorkspaceState,
  themeId: string,
  observationId: number,
  relations: ObservationRelation[],
  observationText = '',
): ObservationWorkspaceState {
  const themeIndex = state.themes.findIndex((item) => item.id === themeId)
  if (themeIndex < 0) return state

  const theme = state.themes[themeIndex]
  if (theme.observationIds.includes(observationId)) return state

  const hasConfirmedConnection = relations.some((relation) => {
    if (relation.status !== 'confirmed') return false
    const isTargetInTheme = theme.observationIds.includes(relation.targetId)
    const isSourceInTheme = theme.observationIds.includes(relation.sourceId)
    return (
      (relation.sourceId === observationId && isTargetInTheme) ||
      (relation.targetId === observationId && isSourceInTheme)
    )
  })
  if (!hasConfirmedConnection) return state

  const now = new Date().toISOString()
  const nextTheme: ProblemTheme = {
    ...theme,
    observationIds: [...theme.observationIds, observationId],
    updatedAt: now,
    events: [
      ...theme.events,
      createThemeEvent(
        'observation-added',
        `新增观察：${observationText.trim().slice(0, 72) || `观察 #${observationId}`}。该观察与主题成员存在已确认关联。`,
        { observationId },
      ),
    ],
  }
  const themes = [...state.themes]
  themes[themeIndex] = nextTheme
  return { ...state, themes }
}

export function updateProblemThemeStatus(
  state: ObservationWorkspaceState,
  themeId: string,
  status: ThemeStatus,
): ObservationWorkspaceState {
  const themeIndex = state.themes.findIndex((item) => item.id === themeId)
  if (themeIndex < 0) return state

  const theme = state.themes[themeIndex]
  if (theme.status === status) return state

  const now = new Date().toISOString()
  const statusLabels: Record<ThemeStatus, string> = {
    observing: '持续观察',
    exploring: '探索中',
    paused: '暂时搁置',
  }
  const nextTheme: ProblemTheme = {
    ...theme,
    status,
    updatedAt: now,
    events: [
      ...theme.events,
      createThemeEvent(
        'status-changed',
        `主题状态从「${statusLabels[theme.status]}」调整为「${statusLabels[status]}」。`,
        { previousStatus: theme.status, nextStatus: status },
      ),
    ],
  }
  const themes = [...state.themes]
  themes[themeIndex] = nextTheme
  return { ...state, themes }
}
