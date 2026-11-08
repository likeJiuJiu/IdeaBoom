import type {
  ObservationAnalysis,
  ObservationRelation,
  ObservationWorkspaceState,
  ProblemTheme,
  RelationStatus,
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
  const allowedStatuses = new Set(['observing', 'exploring', 'paused'])
  const ids = Array.isArray(value.observationIds)
    ? value.observationIds.map(Number).filter(Number.isFinite)
    : []
  if (!safeString(value.title).trim() || ids.length < 2) return null
  const now = new Date().toISOString()
  return {
    id: safeString(value.id, createId()),
    title: safeString(value.title),
    description: safeString(value.description),
    observationIds: [...new Set(ids)],
    status: allowedStatuses.has(String(value.status)) ? value.status as ProblemTheme['status'] : 'observing',
    createdAt: safeString(value.createdAt, now),
    updatedAt: safeString(value.updatedAt, now),
  }
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
    const themes = Array.isArray(parsed.themes)
      ? parsed.themes.map(normalizeTheme).filter((item): item is ProblemTheme => item !== null)
      : []

    return { version: 1, analyses, relations, themes }
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
  const now = new Date().toISOString()
  const theme: ProblemTheme = {
    id: createId(),
    title: input.title.trim(),
    description: input.description.trim(),
    observationIds: [...new Set(input.observationIds)],
    status: 'observing',
    createdAt: now,
    updatedAt: now,
  }
  return { ...state, themes: [theme, ...state.themes] }
}
