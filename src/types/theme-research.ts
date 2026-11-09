export type ThemeResearchMode =
  | 'solutions'
  | 'user-feedback'
  | 'alternatives'
  | 'opportunities'

export type ResearchRunStatus = 'analyzed' | 'sources-only' | 'no-results'

export type ResearchFindingKind =
  | 'external-fact'
  | 'user-feedback'
  | 'market-pattern'
  | 'ai-inference'

export interface ResearchThemeContext {
  id: string
  title: string
  description: string
  observationIds: number[]
}

export interface ResearchObservationContext {
  id: number
  text: string
  createdAt?: string
}

export interface ExternalResearchSource {
  id: string
  title: string
  url: string
  domain: string
  snippet: string
  rawContent?: string
  publishedAt?: string
  retrievedAt: string
  relevanceScore?: number
  extracted: boolean
}

export interface ResearchFinding {
  id: string
  kind: ResearchFindingKind
  statement: string
  sourceUrls: string[]
  caveat: string
}

export interface ResearchOpportunity {
  id: string
  hypothesis: string
  whyWorthExploring: string
  supportingUrls: string[]
  validationQuestion: string
}

export interface ResearchSynthesis {
  summary: string
  findings: ResearchFinding[]
  opportunities: ResearchOpportunity[]
  unknowns: string[]
}

export interface ThemeResearchRun {
  id: string
  themeId: string
  themeTitle: string
  mode: ThemeResearchMode
  question: string
  query: string
  createdAt: string
  status: ResearchRunStatus
  deepRead: boolean
  sources: ExternalResearchSource[]
  synthesis: ResearchSynthesis | null
  analysisNotice?: string
}

export interface ThemeResearchState {
  version: 1
  runs: ThemeResearchRun[]
}

export interface ThemeResearchRequest {
  theme: ResearchThemeContext
  observations: ResearchObservationContext[]
  mode: ThemeResearchMode
  question: string
  query?: string
  deepRead: boolean
  consentConfirmed: boolean
}

export interface ThemeResearchApiErrorBody {
  error?: string
}
