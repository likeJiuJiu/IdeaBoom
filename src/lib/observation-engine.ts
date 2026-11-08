import type { LocalRelationCandidate, ObservationAnalysis, ObservationSource, RelationType } from '../types/observation'

const SCENE_RULES: Array<{ label: string; words: string[] }> = [
  { label: '校园与学习', words: ['学校', '校园', '宿舍', '社团', '课程', '作业', '考试', '老师', '同学', '图书馆'] },
  { label: '数字产品与软件', words: ['软件', 'app', '应用', '网站', '系统', '页面', '按钮', '界面', '功能', '操作'] },
  { label: '工作与协作', words: ['工作', '同事', '团队', '项目', '任务', '会议', '协作', '流程', '客户'] },
  { label: '消费与服务', words: ['购物', '商品', '买', '卖', '订单', '配送', '商家', '售后', '服务'] },
  { label: '出行与交通', words: ['公交', '地铁', '出行', '打车', '等车', '停车', '道路', '排队'] },
  { label: '阅读与信息', words: ['阅读', '文章', '视频', '资料', '信息', '通知', '消息', '搜索', '知识'] },
  { label: '家庭与日常生活', words: ['家里', '家庭', '父母', '做饭', '家务', '生活', '朋友'] },
]

const FRICTION_CUES = [
  '不方便', '不顺手', '不好用', '找不到', '很难', '难以', '太多', '太少', '重复', '浪费',
  '等待', '排队', '花时间', '耗时', '容易忘', '经常', '混乱', '分散', '不清楚', '卡住',
  '出错', '流程复杂', '麻烦', '来回', '低效', '不合理', '不明确', '无法', '费劲',
]

const WORKAROUND_CUES = ['微信群', 'qq群', '表格', 'excel', '手动', '人工', '备忘录', '截图', '收藏', '反复搜索', '问别人']
const PEOPLE_CUES = ['学生', '老师', '家长', '用户', '顾客', '员工', '同事', '商家', '老人', '志愿者', '开发者']

// 只用于候选关联的具体短语。宁可少推荐，也不拿泛化词语凑关系。
const SPECIFIC_RELATION_TERMS = [
  '通知分散', '信息分散', '消息分散', '活动通知', '活动报名', '报名入口', '活动信息', '信息获取',
  '信息查找', '消息查找', '查找入口', '入口难找', '微信群通知', '群消息', '重复操作', '流程复杂',
  '任务分工', '职责不清', '进度跟踪', '学习计划', '时间管理', '排队时间', '等待时间', '预约流程',
  '库存不足', '库存管理', '配送延迟', '售后响应', '搜索效率', '操作步骤', '信息不对称',
  '沟通成本', '沟通不畅', '数据不一致', '资料分散', '内容难找', '通知遗漏', '报名困难',
]

const GENERIC_TERMS = new Set([
  '用户', '生活', '问题', '想法', '事情', '东西', '记录', '内容', '信息', '方便', '感觉',
  '可能', '需要', '希望', '应该', '可以', '一个', '一些', '自己', '现在', '时候', '情况',
  '比较', '相关', '不同', '很多', '没有', '就是', '这样', '那样', '出现', '发生',
])

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function findMatches(text: string, words: string[]): string[] {
  return words.filter((word) => text.toLowerCase().includes(word.toLowerCase()))
}

function extractSpecificTerms(text: string): string[] {
  const normalized = text.toLowerCase()
  return unique(findMatches(normalized, SPECIFIC_RELATION_TERMS))
    .filter((term) => !GENERIC_TERMS.has(term))
}

function detectScene(text: string): string | undefined {
  return SCENE_RULES.find((rule) => rule.words.some((word) => text.toLowerCase().includes(word.toLowerCase())))?.label
}

export function analyzeObservationLocally(observation: ObservationSource): ObservationAnalysis {
  const text = observation.text.trim()
  const scene = detectScene(text) ?? '尚未明确'
  const friction = findMatches(text, FRICTION_CUES).slice(0, 4)
  const people = findMatches(text, PEOPLE_CUES).slice(0, 3)
  const workarounds = findMatches(text, WORKAROUND_CUES).slice(0, 3)
  const keywords = unique([
    ...extractSpecificTerms(text),
    ...findMatches(text, ['通知', '报名', '分散', '排队', '等待', '搜索', '协作', '操作', '流程']),
  ]).slice(0, 10)
  const phenomenon = text.length > 120 ? `${text.slice(0, 117)}…` : text
  const frictionText = friction.length ? friction.join('、') : ''

  return {
    observationId: observation.id,
    generatedAt: new Date().toISOString(),
    engine: 'local-rules',
    summary: scene === '尚未明确'
      ? '这条记录已经保存，但目前还不足以准确判断它属于哪个场景。'
      : `这条记录主要发生在「${scene}」场景。`,
    scene,
    phenomenon,
    friction: frictionText || '原文暂未明确表达具体的不便或阻碍',
    affectedPeople: people.length ? people.join('、') : '原文暂未明确涉及的人群',
    currentWorkaround: workarounds.length ? workarounds.join('、') : '原文暂未提及当前替代方式',
    potentialProblem: frictionText
      ? `记录中出现了「${frictionText}」等体验线索，可能存在值得继续了解的阻碍，但目前只有个人观察，尚不能判断是否普遍存在。`
      : '目前更接近现象描述，暂时不推断具体问题。可以先补充发生地点、涉及对象或造成的影响。',
    questionToExplore: frictionText
      ? `这种「${frictionText}」的情况是否会在其他时间或类似场景重复出现？`
      : '这件事具体影响了谁？它为什么让你注意到？',
    keywords,
    unknowns: [
      '是否有其他人遇到相同情况？',
      '这种情况发生的频率和影响有多大？',
      '目前人们通常如何处理？',
    ],
  }
}

function inferRelationType(a: ObservationSource, b: ObservationSource, sharedTerms: string[]): RelationType {
  const aScene = detectScene(a.text)
  const bScene = detectScene(b.text)
  const frictionTerms = ['通知分散', '信息分散', '消息分散', '入口难找', '重复操作', '流程复杂', '职责不清', '沟通不畅']
  const sharedFriction = sharedTerms.some((term) => frictionTerms.includes(term))
  if (aScene && bScene && aScene !== bScene) return 'cross-scene'
  if (sharedFriction) return 'shared-friction'
  return 'same-scene'
}

export function findLocalRelationCandidates(
  selected: ObservationSource,
  observations: ObservationSource[],
  limit = 3,
): LocalRelationCandidate[] {
  const selectedTerms = new Set(extractSpecificTerms(selected.text))
  if (selectedTerms.size === 0) return []

  const results: LocalRelationCandidate[] = []
  for (const candidate of observations) {
    if (candidate.id === selected.id) continue
    const candidateTerms = new Set(extractSpecificTerms(candidate.text))
    const sharedTerms = [...selectedTerms].filter((term) => candidateTerms.has(term))

    // 至少两个具体共同短语；单个宽泛词不能形成关联建议。
    if (sharedTerms.length < 2) continue

    const aScene = detectScene(selected.text)
    const bScene = detectScene(candidate.text)
    if (aScene && bScene && aScene !== bScene) {
      // 跨场景关联门槛更高，避免仅因字面相同而强行连接。
      if (sharedTerms.length < 3) continue
    }

    const type = inferRelationType(selected, candidate, sharedTerms)
    const strength: LocalRelationCandidate['strength'] = sharedTerms.length >= 3 ? 'strong' : 'moderate'
    results.push({
      sourceId: selected.id,
      targetId: candidate.id,
      type,
      reason: `两条原始记录都明确出现了「${sharedTerms.slice(0, 4).join('、')}」等具体线索，可能值得放在一起检查。该关联仍需你判断。`,
      sharedTerms: sharedTerms.slice(0, 5),
      strength,
    })
  }

  return results
    .sort((a, b) => {
      const strengthRank = { strong: 2, moderate: 1, weak: 0 }
      return strengthRank[b.strength] - strengthRank[a.strength] || b.sharedTerms.length - a.sharedTerms.length
    })
    .slice(0, limit)
}
