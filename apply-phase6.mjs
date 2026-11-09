import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const appPath = path.join(root, 'src', 'App.vue')
const componentPath = path.join(root, 'src', 'components', 'ThemeDetailSpace.vue')
const componentSourcePath = path.join(root, 'ThemeDetailSpace.vue')
if (!fs.existsSync(appPath)) throw new Error('未找到 src/App.vue，请在项目根目录运行。')
if (!fs.existsSync(componentSourcePath)) throw new Error('请将 ThemeDetailSpace.vue 放在项目根目录。')
if (!fs.existsSync(path.dirname(componentPath))) throw new Error('未找到 src/components 目录。')

const original = fs.readFileSync(appPath, 'utf8')
const newline = original.includes('\r\n') ? '\r\n' : '\n'
let source = original.replace(/\r\n/g, '\n')

function replaceOnce(input, anchor, replacement, label) {
  const first = input.indexOf(anchor)
  if (first < 0) throw new Error(`${label}：未找到匹配位置。未修改任何文件。`)
  if (input.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${label}：匹配到多个位置。未修改任何文件。`)
  return input.slice(0, first) + replacement + input.slice(first + anchor.length)
}

// 1. Store API imports
const importAnchor = "import { loadObservationWorkspace } from './lib/observation-store'"
const importReplacement = "import { extendProblemTheme, loadObservationWorkspace, saveObservationWorkspace, updateProblemThemeDetails, updateProblemThemeStatus } from './lib/observation-store'"
source = replaceOnce(source, importAnchor, importReplacement, 'Phase 6 存储方法导入')

// 2. Theme detail payload now includes all observations for eligible external candidates.
const payloadAnchor = `type ThemeDetailPayload = {
  theme: ProblemTheme
  ideas: ObservationSource[]
  relations: ObservationRelation[]
  analyses: Record<string, ObservationAnalysis>
}`
const payloadReplacement = `type ThemeDetailPayload = {
  theme: ProblemTheme
  ideas: ObservationSource[]
  allIdeas: ObservationSource[]
  relations: ObservationRelation[]
  analyses: Record<string, ObservationAnalysis>
}`
source = replaceOnce(source, payloadAnchor, payloadReplacement, '主题详情数据结构')

// 3. Replace openThemeSpace and add event handlers.
const openAnchor = `function openThemeSpace(themeId: string): void {
  const state = loadObservationWorkspace()
  const theme = state.themes.find((item) => item.id === themeId)
  if (!theme) {
    notify('这个主题暂时无法读取，请关闭后重新打开观察工作台。')
    return
  }
  const memberIds = new Set(theme.observationIds)
  const themeIdeas = ideas.value.filter((idea) => memberIds.has(idea.id))
  const relations = state.relations.filter((relation) =>
    relation.status === 'confirmed'
    && memberIds.has(relation.sourceId)
    && memberIds.has(relation.targetId),
  )
  const analyses: Record<string, ObservationAnalysis> = {}
  for (const id of theme.observationIds) {
    const analysis = state.analyses[String(id)]
    if (analysis) analyses[String(id)] = analysis
  }
  themeDetail.value = { theme, ideas: themeIdeas, relations, analyses }
}

function closeThemeSpace(): void {
  themeDetail.value = null
}

function openIdeaFromTheme(id: number): void {
  const idea = ideas.value.find((item) => item.id === id)
  closeThemeSpace()
  if (idea) openIdea(idea)
}`
const openReplacement = `function refreshThemeSpace(): void {
  const current = themeDetail.value
  if (!current) return
  const state = loadObservationWorkspace()
  const theme = state.themes.find((item) => item.id === current.theme.id)
  if (!theme) {
    closeThemeSpace()
    notify('主题已不存在，已返回星云。')
    return
  }
  const memberIds = new Set(theme.observationIds)
  const themeIdeas = ideas.value.filter((idea) => memberIds.has(idea.id))
  const analyses: Record<string, ObservationAnalysis> = {}
  for (const id of theme.observationIds) {
    const analysis = state.analyses[String(id)]
    if (analysis) analyses[String(id)] = analysis
  }
  themeDetail.value = {
    theme,
    ideas: themeIdeas,
    allIdeas: ideas.value,
    relations: state.relations.filter((relation) => relation.status === 'confirmed'),
    analyses,
  }
  syncProblemThemes(state.themes.map((item) => ({
    id: item.id, title: item.title, observationIds: [...item.observationIds], status: item.status,
  })))
}

function openThemeSpace(themeId: string): void {
  const state = loadObservationWorkspace()
  const theme = state.themes.find((item) => item.id === themeId)
  if (!theme) {
    notify('这个主题暂时无法读取，请关闭后重新打开观察工作台。')
    return
  }
  const memberIds = new Set(theme.observationIds)
  const themeIdeas = ideas.value.filter((idea) => memberIds.has(idea.id))
  const analyses: Record<string, ObservationAnalysis> = {}
  for (const id of theme.observationIds) {
    const analysis = state.analyses[String(id)]
    if (analysis) analyses[String(id)] = analysis
  }
  themeDetail.value = {
    theme,
    ideas: themeIdeas,
    allIdeas: ideas.value,
    relations: state.relations.filter((relation) => relation.status === 'confirmed'),
    analyses,
  }
}

function closeThemeSpace(): void {
  themeDetail.value = null
}

function openIdeaFromTheme(id: number): void {
  const idea = ideas.value.find((item) => item.id === id)
  closeThemeSpace()
  if (idea) openIdea(idea)
}

function createObservationFromTheme(text: string): void {
  const idea = addIdea(text)
  if (!idea) {
    notify('先写下一条观察，再保存到星云。')
    return
  }
  // 主题详情打开期间背景动效处于暂停状态；只同步星点数据，不启动流星动画。
  markBorn(idea.id)
  notify('新观察已保存到星云；确认关系后可以加入主题。')
  nextTick(() => {
    syncEngine()
    if (themeDetail.value) themeDetail.value = { ...themeDetail.value, allIdeas: [...ideas.value] }
  })
}

function extendObservationIntoTheme(observationId: number): void {
  const current = themeDetail.value
  const observation = ideas.value.find((item) => item.id === observationId)
  if (!current || !observation) return
  const state = loadObservationWorkspace()
  const next = extendProblemTheme(state, current.theme.id, observationId, state.relations, observation.text)
  if (next === state) {
    notify('暂时无法加入：需要先确认这条观察与主题成员之间的关联。')
    return
  }
  saveObservationWorkspace(next)
  refreshThemeSpace()
  notify('新观察已加入主题，星群已经更新。')
}

function updateThemeDetailsFromSpace(payload: { title: string; description: string }): void {
  const current = themeDetail.value
  if (!current) return
  const state = loadObservationWorkspace()
  const next = updateProblemThemeDetails(state, current.theme.id, payload)
  if (next === state) {
    notify(payload.title.trim() ? '主题信息没有发生变化。' : '主题名称不能为空。')
    return
  }
  saveObservationWorkspace(next)
  refreshThemeSpace()
  notify('主题信息已保存。')
}

function changeThemeStatusFromSpace(status: 'observing' | 'exploring' | 'paused'): void {
  const current = themeDetail.value
  if (!current) return
  const state = loadObservationWorkspace()
  const next = updateProblemThemeStatus(state, current.theme.id, status)
  if (next === state) return
  saveObservationWorkspace(next)
  refreshThemeSpace()
  notify('主题状态已更新。')
}`
source = replaceOnce(source, openAnchor, openReplacement, '主题详情业务操作')

// 4. Wire events from ThemeDetailSpace.
const overlayAnchor = `      @close="closeThemeSpace"
      @open-idea="openIdeaFromTheme"
    />`
const overlayReplacement = `      @close="closeThemeSpace"
      @open-idea="openIdeaFromTheme"
      @create-observation="createObservationFromTheme"
      @extend-observation="extendObservationIntoTheme"
      @change-status="changeThemeStatusFromSpace"
      @update-details="updateThemeDetailsFromSpace"
    />`
source = replaceOnce(source, overlayAnchor, overlayReplacement, '主题详情事件连接')

// Guard against accidental repeated installation.
if (source.includes('function extendObservationIntoTheme') && original.includes('function extendObservationIntoTheme')) {
  throw new Error('检测到 Phase 6 代码似乎已存在；请勿重复安装。')
}
if (fs.existsSync(componentPath)) {
  const existing = fs.readFileSync(componentPath, 'utf8')
  if (existing.includes('IDEA-BOOM-PHASE6-THEME-ACTIONS')) throw new Error('Phase 6 组件已安装。')
}
const componentContent = fs.readFileSync(componentSourcePath, 'utf8')
if (!componentContent.includes('IDEA-BOOM-PHASE6-THEME-ACTIONS')) throw new Error('包内组件缺少 Phase 6 标识，未修改任何项目文件。')

const backupDir = path.join(root, '.ideaboom-phase6-backup')
fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, 'App.vue')
const componentBackupPath = path.join(backupDir, 'ThemeDetailSpace.vue')
if (fs.existsSync(backupPath) || fs.existsSync(componentBackupPath)) {
  throw new Error(`Phase 6 备份已存在：${backupDir}。请先检查旧备份并改名，未修改任何文件。`)
}
const hadPreviousComponent = fs.existsSync(componentPath)
const previousComponent = hadPreviousComponent ? fs.readFileSync(componentPath, 'utf8') : null

// 所有锚点与组件版本均验证后再写入；同时备份原 Phase 5 组件，确保可完整回滚。
fs.writeFileSync(backupPath, original, 'utf8')
if (hadPreviousComponent && previousComponent !== null) fs.writeFileSync(componentBackupPath, previousComponent, 'utf8')
try {
  fs.writeFileSync(componentPath, componentContent.replace(/\n/g, newline), 'utf8')
  fs.writeFileSync(appPath, source.replace(/\n/g, newline), 'utf8')
} catch (error) {
  if (hadPreviousComponent && previousComponent !== null) fs.writeFileSync(componentPath, previousComponent, 'utf8')
  else if (fs.existsSync(componentPath)) fs.rmSync(componentPath, { force: true })
  fs.writeFileSync(appPath, original, 'utf8')
  throw error
}
console.log('IdeaBoom Phase 6 已应用。')
console.log('已修改：src/App.vue')
console.log('已更新：src/components/ThemeDetailSpace.vue（原文件已备份）')
console.log('请按安装说明覆盖：src/types/observation.ts、src/lib/observation-store.ts')
console.log(`备份目录：${path.relative(root, backupDir)}`)
