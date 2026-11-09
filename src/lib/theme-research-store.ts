import type {
  ExternalResearchSource,
  ResearchFinding,
  ResearchOpportunity,
  ResearchSynthesis,
  ThemeResearchRun,
  ThemeResearchState,
} from '../types/theme-research'

const STORAGE_KEY = 'ideaboom-theme-research-v1'
const MAX_SAVED_RUNS = 40

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizeSource(value: unknown): ExternalResearchSource | null {
  if (!isRecord(value)) return null
  const url = stringValue(value.url).trim()
  const title = stringValue(value.title).trim()
  if (!url || !title || (!url.startsWith('https://') && !url.startsWith('http://'))) return null

  let domain = stringValue(value.domain)
  if (!domain) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      domain = '未知来源'
    }
  }

  return {
    id: stringValue(value.id, url),
    title,
    url,
    domain,
    snippet: stringValue(value.snippet),
    // 研究历史只保留短正文片段，避免长期使用后占满 localStorage。
    rawContent: stringValue(value.rawContent).slice(0, 2400) || undefined,
    publishedAt: stringValue(value.publishedAt) || undefined,
    retrievedAt: stringValue(value.retrievedAt, new Date().toISOString()),
    relevanceScore: Number.isFinite(Number(value.relevanceScore)) ? Number(value.relevanceScore) : undefined,
    extracted: value.extracted === true,
  }
}

function normalizeFinding(value: unknown): ResearchFinding | null {
  if (!isRecord(value)) return null
  const statement = stringValue(value.statement).trim()
  const kind = value.kind
  if (!statement || !['external-fact', 'user-feedback', 'market-pattern', 'ai-inference'].includes(String(kind))) return null
  return {
    id: stringValue(value.id, `finding-${Math.random().toString(36).slice(2, 9)}`),
    kind: kind as ResearchFinding['kind'],
    statement,
    sourceUrls: stringArray(value.sourceUrls),
    caveat: stringValue(value.caveat),
  }
}

function normalizeOpportunity(value: unknown): ResearchOpportunity | null {
  if (!isRecord(value)) return null
  const hypothesis = stringValue(value.hypothesis).trim()
  if (!hypothesis) return null
  return {
    id: stringValue(value.id, `opportunity-${Math.random().toString(36).slice(2, 9)}`),
    hypothesis,
    whyWorthExploring: stringValue(value.whyWorthExploring),
    supportingUrls: stringArray(value.supportingUrls),
    validationQuestion: stringValue(value.validationQuestion),
  }
}

function normalizeSynthesis(value: unknown): ResearchSynthesis | null {
  if (!isRecord(value)) return null
  const summary = stringValue(value.summary).trim()
  if (!summary) return null
  return {
    summary,
    findings: Array.isArray(value.findings)
      ? value.findings.map(normalizeFinding).filter((item): item is ResearchFinding => item !== null)
      : [],
    opportunities: Array.isArray(value.opportunities)
      ? value.opportunities.map(normalizeOpportunity).filter((item): item is ResearchOpportunity => item !== null)
      : [],
    unknowns: stringArray(value.unknowns),
  }
}

function normalizeRun(value: unknown): ThemeResearchRun | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const themeId = stringValue(value.themeId)
  const themeTitle = stringValue(value.themeTitle)
  if (!id || !themeId || !themeTitle) return null

  const mode = value.mode
  if (!['solutions', 'user-feedback', 'alternatives', 'opportunities'].includes(String(mode))) return null
  const sources = Array.isArray(value.sources)
    ? value.sources.map(normalizeSource).filter((item): item is ExternalResearchSource => item !== null)
    : []
  const synthesis = normalizeSynthesis(value.synthesis)
  const status = value.status === 'analyzed' || value.status === 'no-results' ? value.status : 'sources-only'

  return {
    id,
    themeId,
    themeTitle,
    mode: mode as ThemeResearchRun['mode'],
    question: stringValue(value.question),
    query: stringValue(value.query),
    createdAt: stringValue(value.createdAt, new Date().toISOString()),
    status,
    deepRead: value.deepRead === true,
    sources,
    synthesis,
    analysisNotice: stringValue(value.analysisNotice) || undefined,
  }
}

export function emptyThemeResearchState(): ThemeResearchState {
  return { version: 1, runs: [] }
}

export function loadThemeResearchState(): ThemeResearchState {
  if (typeof window === 'undefined') return emptyThemeResearchState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyThemeResearchState()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.runs)) return emptyThemeResearchState()
    const runs = parsed.runs
      .map(normalizeRun)
      .filter((item): item is ThemeResearchRun => item !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { version: 1, runs: runs.slice(0, MAX_SAVED_RUNS) }
  } catch {
    return emptyThemeResearchState()
  }
}

export function saveThemeResearchState(state: ThemeResearchState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      runs: [...state.runs]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, MAX_SAVED_RUNS),
    }))
  } catch (error) {
    console.error('[IdeaBoom] 保存主题研究记录失败：', error)
    throw new Error('浏览器无法保存研究记录，请检查存储空间。')
  }
}

export function saveThemeResearchRun(run: ThemeResearchRun): ThemeResearchState {
  const state = loadThemeResearchState()
  const nextRuns = [run, ...state.runs.filter((item) => item.id !== run.id)]
  const nextState = { version: 1 as const, runs: nextRuns.slice(0, MAX_SAVED_RUNS) }
  saveThemeResearchState(nextState)
  return nextState
}

export function listThemeResearchRuns(themeId: string): ThemeResearchRun[] {
  return loadThemeResearchState().runs.filter((run) => run.themeId === themeId)
}

export function deleteThemeResearchRun(runId: string): ThemeResearchState {
  const state = loadThemeResearchState()
  const nextState = { ...state, runs: state.runs.filter((run) => run.id !== runId) }
  saveThemeResearchState(nextState)
  return nextState
}
