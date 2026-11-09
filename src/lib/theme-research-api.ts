import type {
  ThemeResearchApiErrorBody,
  ThemeResearchRequest,
  ThemeResearchRun,
} from '../types/theme-research'

export async function runThemeResearch(input: ThemeResearchRequest): Promise<ThemeResearchRun> {
  const response = await fetch('/api/theme-research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(95_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('外部研究请求超过 95 秒，请缩小研究范围或关闭深读后重试。')
    }
    throw error
  })

  const payload = await response.json().catch(() => ({})) as ThemeResearchRun & ThemeResearchApiErrorBody
  if (!response.ok) {
    throw new Error(payload.error || `外部研究请求失败（HTTP ${response.status}）。`)
  }
  if (!payload.id || !payload.themeId || !Array.isArray(payload.sources)) {
    throw new Error('研究服务返回的数据格式不正确，请稍后重试。')
  }
  return payload
}
