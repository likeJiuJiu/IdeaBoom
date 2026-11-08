import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface AIRequestBody {
  observation?: { id?: number; text?: string; createdAt?: string }
  candidates?: Array<{ id?: number; text?: string; createdAt?: string }>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > 60_000) throw new Error('请求内容过大，请减少一次分析的历史记录数量。')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function extractJsonObject(content: string): unknown {
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('模型没有返回有效的 JSON 对象。')
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
}

function observationAiDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'ideaboom-observation-ai-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/observation/analyze', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: '仅支持 POST 请求。' })
          return
        }

        const baseUrl = (env.IDEABOOM_LLM_BASE_URL || '').trim().replace(/\/+$/, '')
        const apiKey = (env.IDEABOOM_LLM_API_KEY || '').trim()
        const model = (env.IDEABOOM_LLM_MODEL || '').trim()
        if (!baseUrl || !apiKey || !model) {
          sendJson(res, 503, {
            error: '尚未配置大模型服务。请在项目根目录创建 .env.local，并填写 IDEABOOM_LLM_BASE_URL、IDEABOOM_LLM_API_KEY 和 IDEABOOM_LLM_MODEL。',
          })
          return
        }

        try {
          const body = await readJsonBody(req) as AIRequestBody
          const observation = body?.observation
          if (!observation || !Number.isFinite(Number(observation.id)) || typeof observation.text !== 'string') {
            sendJson(res, 400, { error: '观察记录缺少有效的 id 或 text。' })
            return
          }

          const currentText = observation.text.trim().slice(0, 1200)
          const candidates = Array.isArray(body.candidates)
            ? body.candidates
                .filter((item) => Number.isFinite(Number(item?.id)) && typeof item?.text === 'string')
                .slice(0, 20)
                .map((item) => ({ id: Number(item.id), text: String(item.text).slice(0, 600), createdAt: item.createdAt || '' }))
            : []

          const systemPrompt = `你是 IdeaBoom 灵感星云的个人观察分析助手。你的任务是忠实理解当前观察，并谨慎判断它是否与历史观察存在值得用户检查的具体联系。
必须遵守：
1. 只根据原文分析，不得补造人物、频率、损失、市场需求或事实；未知字段写“原文未说明”。
2. 严格区分原始观察、合理推断和未知信息，不给想法打分，不宣布市场机会成立。
3. 历史关联最多返回 3 条；没有可靠关联时必须返回空数组。空数组是正常且优先的结果，不要为了凑数量而推荐。
4. 只有两条原文在具体场景、具体阻碍、共同问题、互补信息或明确冲突上存在可解释联系时才推荐。
5. 以下情况一律不算有效关联：都属于“想法/记录/生活/问题”；都表达“值得留下/需要记录”；只有抽象主题相似；只有一个泛化词相同；无法指出两条原文各自的具体证据。
6. 每条关联的 evidenceFromSource 和 evidenceFromTarget 必须分别是对应原文中连续、逐字出现的短语，不能改写或概括。每个证据短语至少 4 个汉字或 5 个英文字符。
7. sharedTerms 必须是两条原文中都实际出现的具体短语；至少提供 1 个，禁止使用“用户、生活、想法、问题、记录、内容”等泛词。
8. type 只能使用 same-scene、shared-friction、cross-scene、possible-contradiction。无法准确归类时不要返回该关联，不要使用 other。
9. 每条 reason 必须解释两段具体证据如何构成联系，不能只写“都涉及信息/想法/体验”。
10. 所有 targetId 必须来自用户提供的历史记录 ID。
11. 只返回合法 JSON，不要 Markdown 代码块，不要额外解释。` 

          const userPayload = {
            currentObservation: { id: Number(observation.id), text: currentText, createdAt: observation.createdAt || '' },
            historicalObservations: candidates,
            requiredJsonShape: {
              analysis: {
                summary: '用一句话描述这条观察，不增加事实',
                scene: '发生场景或原文未说明',
                phenomenon: '原文描述的现象',
                friction: '明确表达的不便或阻碍，没有则写原文未说明',
                affectedPeople: '原文明确提及的人群，没有则写原文未说明',
                currentWorkaround: '原文明确提及的替代方式，没有则写原文未说明',
                potentialProblem: '谨慎表述的潜在问题，不得当作事实',
                questionToExplore: '一个值得继续思考的问题',
                keywords: ['3到8个具体关键词'],
                unknowns: ['尚不能确认的信息，最多5项'],
              },
              relations: [{
                targetId: '历史观察的数字 ID',
                type: 'same-scene | shared-friction | cross-scene | possible-contradiction | other',
                reason: '具体解释两条观察为什么可能有关联',
                evidenceFromSource: '当前观察中的原文短语',
                evidenceFromTarget: '目标观察中的原文短语',
                sharedTerms: ['具体共同线索'],
              }],
            },
          }

          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 45_000)
          let upstream: Response
          try {
            upstream = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                temperature: 0.2,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: JSON.stringify(userPayload) },
                ],
              }),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timeout)
          }

          if (!upstream.ok) {
            const upstreamText = await upstream.text().catch(() => '')
            console.error('[IdeaBoom] LLM upstream error:', upstream.status, upstreamText.slice(0, 1000))
            sendJson(res, 502, { error: `大模型服务返回错误（HTTP ${upstream.status}），请检查模型名称、API 地址和密钥。` })
            return
          }

          const upstreamPayload = await upstream.json() as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const content = upstreamPayload.choices?.[0]?.message?.content
          if (typeof content !== 'string' || !content.trim()) {
            sendJson(res, 502, { error: '大模型没有返回分析内容，请稍后重试。' })
            return
          }

          const parsed = extractJsonObject(content) as {
            analysis?: Record<string, unknown>
            relations?: Array<Record<string, unknown>>
          }
          const rawAnalysis = parsed.analysis
          if (!rawAnalysis || typeof rawAnalysis !== 'object') {
            sendJson(res, 502, { error: '大模型返回结果缺少 analysis 字段。' })
            return
          }

          const textField = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback
          const stringArray = (value: unknown) => Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string').slice(0, 8)
            : []
          const genericTerms = new Set(['用户', '生活', '想法', '问题', '记录', '内容', '事情', '东西', '体验', '相关', '信息'])
          const relationCandidates = Array.isArray(parsed.relations)
            ? parsed.relations.slice(0, 10).flatMap((item) => {
                const targetId = Number(item.targetId)
                const target = candidates.find((candidate) => Number(candidate.id) === targetId)
                if (!target || targetId === Number(observation.id)) return []

                const allowedTypes = new Set(['same-scene', 'shared-friction', 'cross-scene', 'possible-contradiction'])
                const type = String(item.type)
                if (!allowedTypes.has(type)) return []

                const evidenceFromSource = textField(item.evidenceFromSource, '')
                const evidenceFromTarget = textField(item.evidenceFromTarget, '')
                // 证据必须能在两条原文中逐字找到，防止模型编造“共同点”。
                if (evidenceFromSource.length < 4 || evidenceFromTarget.length < 4) return []
                if (!currentText.includes(evidenceFromSource) || !String(target.text).includes(evidenceFromTarget)) return []

                const sharedTerms = stringArray(item.sharedTerms)
                  .map((term) => term.trim())
                  .filter((term) => term.length >= 2 && !genericTerms.has(term))
                  .filter((term) => currentText.includes(term) && String(target.text).includes(term))
                if (sharedTerms.length === 0) return []

                return [{
                  targetId,
                  type,
                  reason: textField(item.reason, '模型未提供足够的关联解释。'),
                  evidenceFromSource,
                  evidenceFromTarget,
                  sharedTerms: sharedTerms.slice(0, 5),
                }]
              })
            : []
          const relations = relationCandidates.slice(0, 3)

          sendJson(res, 200, {
            analysis: {
              summary: textField(rawAnalysis.summary, '模型未提供摘要。'),
              scene: textField(rawAnalysis.scene, '原文未说明'),
              phenomenon: textField(rawAnalysis.phenomenon, currentText),
              friction: textField(rawAnalysis.friction, '原文未说明'),
              affectedPeople: textField(rawAnalysis.affectedPeople, '原文未说明'),
              currentWorkaround: textField(rawAnalysis.currentWorkaround, '原文未说明'),
              potentialProblem: textField(rawAnalysis.potentialProblem, '暂时无法形成潜在问题判断。'),
              questionToExplore: textField(rawAnalysis.questionToExplore, '还可以补充哪些背景信息？'),
              keywords: stringArray(rawAnalysis.keywords),
              unknowns: stringArray(rawAnalysis.unknowns),
            },
            relations,
          })
        } catch (error) {
          console.error('[IdeaBoom] observation analysis failed:', error)
          const message = error instanceof Error && error.name === 'AbortError'
            ? '大模型请求超时，请稍后重试。'
            : error instanceof Error && error.message.includes('JSON')
              ? '请求内容不是有效 JSON，请检查输入后重试。'
              : 'AI 分析暂时失败，请检查网络和模型服务配置。'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), observationAiDevPlugin(env)],
  }
})
