export interface ObservationSource {
  id: number
  text: string
  createdAt: string
  color?: string
  parentIdeaIds?: number[]
}

export type AnalysisEngine = 'llm' | 'local-rules'

export interface ObservationAnalysis {
  observationId: number
  generatedAt: string
  engine: AnalysisEngine
  summary: string
  scene: string
  phenomenon: string
  friction: string
  affectedPeople: string
  currentWorkaround: string
  potentialProblem: string
  questionToExplore: string
  keywords: string[]
  unknowns: string[]
}

export type RelationType =
  | 'same-scene'
  | 'shared-friction'
  | 'cross-scene'
  | 'possible-contradiction'
  | 'other'

export type RelationStatus = 'suggested' | 'confirmed' | 'rejected'

export interface ObservationRelation {
  id: string
  sourceId: number
  targetId: number
  type: RelationType
  reason: string
  evidenceFromSource: string
  evidenceFromTarget: string
  sharedTerms: string[]
  status: RelationStatus
  engine: AnalysisEngine
  createdAt: string
  updatedAt: string
}

export type ThemeStatus = 'observing' | 'exploring' | 'paused'

export interface ProblemTheme {
  id: string
  title: string
  description: string
  observationIds: number[]
  status: ThemeStatus
  createdAt: string
  updatedAt: string
}

export interface ObservationWorkspaceState {
  version: 1
  analyses: Record<string, ObservationAnalysis>
  relations: ObservationRelation[]
  themes: ProblemTheme[]
}

export interface LocalRelationCandidate {
  sourceId: number
  targetId: number
  type: RelationType
  reason: string
  sharedTerms: string[]
  strength: 'weak' | 'moderate' | 'strong'
}

export interface ObservationAIResponse {
  analysis: Omit<ObservationAnalysis, 'observationId' | 'generatedAt' | 'engine'>
  relations: Array<{
    targetId: number
    type: RelationType
    reason: string
    evidenceFromSource: string
    evidenceFromTarget: string
    sharedTerms: string[]
  }>
}
