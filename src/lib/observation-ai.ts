import type { ObservationAIResponse, ObservationSource } from '../types/observation'

export interface AnalyzeObservationInput {
  observation: ObservationSource
  candidates: ObservationSource[]
}

export async function requestObservationAnalysis(input: AnalyzeObservationInput): Promise<ObservationAIResponse> {
  const response = await fetch('/api/observation/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `AI 服务请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object' || !('analysis' in payload) || !('relations' in payload)) {
    throw new Error('AI 服务返回的数据格式不正确。')
  }
  return payload as ObservationAIResponse
}
