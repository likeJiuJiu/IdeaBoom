import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const appPath = path.join(root, 'src', 'App.vue')
const componentPath = path.join(root, 'src', 'components', 'ThemeDetailSpace.vue')
const componentSourcePath = path.join(root, 'ThemeDetailSpace.vue')

if (!fs.existsSync(appPath)) throw new Error('未找到 src/App.vue。请在 IdeaBoom 项目根目录运行此脚本。')
if (!fs.existsSync(path.dirname(componentPath))) throw new Error('未找到 src/components 目录。')
if (!fs.existsSync(componentSourcePath)) throw new Error('未找到包内的 ThemeDetailSpace.vue。请把它与 apply-phase5.mjs 一起放在项目根目录。')
if (fs.existsSync(componentPath)) throw new Error('src/components/ThemeDetailSpace.vue 已存在。请检查是否已经安装过 Phase 5，脚本未修改任何文件。')

const original = fs.readFileSync(appPath, 'utf8')
const newline = original.includes('\r\n') ? '\r\n' : '\n'
let source = original.replace(/\r\n/g, '\n')

function replaceOnce(input, anchor, replacement, label) {
  const first = input.indexOf(anchor)
  if (first < 0) throw new Error(`${label}：没有找到对应代码位置。你的 App.vue 可能与提供版本不同；尚未写入任何文件。`)
  if (input.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${label}：匹配到多个位置，为避免误改已停止。尚未写入任何文件。`)
  return input.slice(0, first) + replacement + input.slice(first + anchor.length)
}

// 1. imports
const importAnchor = "import ObservationWorkspace from './components/ObservationWorkspace.vue'"
source = replaceOnce(
  source,
  importAnchor,
  `${importAnchor}\nimport ThemeDetailSpace from './components/ThemeDetailSpace.vue'\nimport type { ObservationAnalysis, ObservationRelation, ObservationSource, ProblemTheme } from './types/observation'\nimport { loadObservationWorkspace } from './lib/observation-store'`,
  'Phase 5 导入',
)

// 2. local types before constants
const typeAnchor = '\nconst STORAGE_KEY = \'idea-nebula-ideas-v1\''
const typeInsert = `\ntype ThemeDetailPayload = {\n  theme: ProblemTheme\n  ideas: ObservationSource[]\n  relations: ObservationRelation[]\n  analyses: Record<string, ObservationAnalysis>\n}\n\nconst STORAGE_KEY = 'idea-nebula-ideas-v1'`
source = replaceOnce(source, typeAnchor, typeInsert, '主题详情数据类型')

// 3. reactive hit targets and selected theme state
const bridgeAnchor = `const problemThemeBridge = ref<Array<{ id: string; title: string; observationIds: number[]; status: 'observing' | 'exploring' | 'paused' }>>([])`
const bridgeInsert = `${bridgeAnchor}\nconst themeDetail = ref<ThemeDetailPayload | null>(null)\n\n// Canvas 的主题椭圆由透明 DOM 命中层承接点击。尺寸与 nebula.ts 中的椭圆边界规则保持一致。\nconst themeHitTargets = computed(() => problemThemeBridge.value.flatMap((theme) => {\n  const members = ideas.value.filter((idea) => theme.observationIds.includes(idea.id))\n  if (members.length < 2) return []\n  const xs = members.map((idea) => idea.x)\n  const ys = members.map((idea) => idea.y)\n  const minX = Math.min(...xs)\n  const maxX = Math.max(...xs)\n  const minY = Math.min(...ys)\n  const maxY = Math.max(...ys)\n  return [{\n    id: theme.id,\n    title: theme.title,\n    style: {\n      left: String((minX + maxX) / 2) + '%',\n      top: String((minY + maxY) / 2) + '%',\n      width: 'max(232px, calc(' + (maxX - minX) + '% + 168px))',\n      height: 'max(176px, calc(' + (maxY - minY) + '% + 128px))',\n    },\n  }]\n}))`
source = replaceOnce(source, bridgeAnchor, bridgeInsert, '主题点击区域状态')

// 4. theme open/close functions after syncProblemThemes
const syncAnchor = `function syncProblemThemes(themes: Array<{ id: string; title: string; observationIds: number[]; status: 'observing' | 'exploring' | 'paused' }>): void {\n  problemThemeBridge.value = themes\n  engine?.setProblemThemes(themes)\n}`
const syncInsert = `${syncAnchor}\n\nfunction openThemeSpace(themeId: string): void {\n  const state = loadObservationWorkspace()\n  const theme = state.themes.find((item) => item.id === themeId)\n  if (!theme) {\n    notify('这个主题暂时无法读取，请关闭后重新打开观察工作台。')\n    return\n  }\n  const memberIds = new Set(theme.observationIds)\n  const themeIdeas = ideas.value.filter((idea) => memberIds.has(idea.id))\n  const relations = state.relations.filter((relation) =>\n    relation.status === 'confirmed'\n    && memberIds.has(relation.sourceId)\n    && memberIds.has(relation.targetId),\n  )\n  const analyses: Record<string, ObservationAnalysis> = {}\n  for (const id of theme.observationIds) {\n    const analysis = state.analyses[String(id)]\n    if (analysis) analyses[String(id)] = analysis\n  }\n  themeDetail.value = { theme, ideas: themeIdeas, relations, analyses }\n}\n\nfunction closeThemeSpace(): void {\n  themeDetail.value = null\n}\n\nfunction openIdeaFromTheme(id: number): void {\n  const idea = ideas.value.find((item) => item.id === id)\n  closeThemeSpace()\n  if (idea) openIdea(idea)\n}`
source = replaceOnce(source, syncAnchor, syncInsert, '主题详情打开逻辑')

// 5. theme hit target buttons inside world, before idea nodes
const worldAnchor = `<section ref="worldEl" class="idea-field" aria-label="想法星云">\n      <button\n        v-for="(idea, index) in ideas`
const worldInsert = `<section ref="worldEl" class="idea-field" aria-label="想法星云">\n      <button\n        v-for="theme in themeHitTargets"\n        :key="\`theme-hit-\${theme.id}\`"\n        class="theme-hit-target"\n        :style="theme.style"\n        :aria-label="\`打开问题主题：\${theme.title}\`"\n        :title="\`打开主题：\${theme.title}\`"\n        type="button"\n        @click.stop="openThemeSpace(theme.id)"\n      ></button>\n      <button\n        v-for="(idea, index) in ideas`
source = replaceOnce(source, worldAnchor, worldInsert, '星云主题点击层')

// 6. detail space mount before main close
const overlayAnchor = `    <ObservationWorkspace\n  :ideas="ideas"\n  @create="addObservationFromWorkspace"\n  @relations-change="syncConfirmedObservationRelations"\n  @themes-change="syncProblemThemes"\n/>\n  </main>`
const overlayInsert = `    <ObservationWorkspace\n  :ideas="ideas"\n  @create="addObservationFromWorkspace"\n  @relations-change="syncConfirmedObservationRelations"\n  @themes-change="syncProblemThemes"\n/>\n    <ThemeDetailSpace\n      v-if="themeDetail"\n      :theme="themeDetail.theme"\n      :ideas="themeDetail.ideas"\n      :relations="themeDetail.relations"\n      :analyses="themeDetail.analyses"\n      @close="closeThemeSpace"\n      @open-idea="openIdeaFromTheme"\n    />\n  </main>`
source = replaceOnce(source, overlayAnchor, overlayInsert, '主题详情组件挂载')

// 7. include theme detail in modal pause state
const modalAnchor = `const anyModalOpen = computed(() => composerOpen.value || encounterOpen.value || echoOpen.value || Boolean(activeIdea.value))`
source = replaceOnce(
  source,
  modalAnchor,
  `const anyModalOpen = computed(() => composerOpen.value || encounterOpen.value || echoOpen.value || Boolean(activeIdea.value) || Boolean(themeDetail.value))`,
  '主题详情动画暂停状态',
)

// 8. Escape closes the theme detail too
const closeAnchor = `function closeOverlays() {\n  if (composerOpen.value) composerOpen.value = false\n  if (activeIdea.value) closeIdea()\n  if (encounterOpen.value) closeEncounter()\n  if (echoOpen.value) closeTimeEcho()\n  encounterMenuOpen.value = false\n}`
const closeInsert = `function closeOverlays() {\n  if (composerOpen.value) composerOpen.value = false\n  if (activeIdea.value) closeIdea()\n  if (encounterOpen.value) closeEncounter()\n  if (echoOpen.value) closeTimeEcho()\n  if (themeDetail.value) closeThemeSpace()\n  encounterMenuOpen.value = false\n}`
source = replaceOnce(source, closeAnchor, closeInsert, '主题详情 Escape 关闭逻辑')

// 9. scoped style for the transparent hit surface
const styleEnd = '\n</style>'
const styleInsert = `\n\n/* Phase 5：覆盖在 Canvas 主题椭圆上的透明命中区域。星点按钮在 DOM 顺序上位于其后，仍可正常点击。 */\n.theme-hit-target {\n  position: absolute;\n  z-index: 1;\n  display: block;\n  padding: 0;\n  border: 1px solid transparent;\n  border-radius: 50%;\n  background: transparent;\n  transform: translate(-50%, -50%);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.theme-hit-target:hover, .theme-hit-target:focus-visible {\n  border-color: rgba(183, 166, 255, 0.13);\n  background: radial-gradient(ellipse, rgba(159, 139, 255, 0.055), transparent 68%);\n  outline: none;\n}\n.theme-hit-target:focus-visible {\n  box-shadow: 0 0 0 2px rgba(184, 165, 255, 0.24);\n}\n.idea-field .idea-node { z-index: 2; }\n</style>`
source = replaceOnce(source, styleEnd, styleInsert, '主题命中区域样式')

// Ensure App has no accidental duplicate component import or state before writing.
if (source.includes("import ThemeDetailSpace from './components/ThemeDetailSpace.vue'\nimport ThemeDetailSpace")) {
  throw new Error('检测到重复 Phase 5 导入；未修改任何文件。')
}

const backupDir = path.join(root, '.ideaboom-phase5-backup')
fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, 'App.vue')
if (fs.existsSync(backupPath)) throw new Error(`备份文件已存在：${backupPath}。请先检查旧备份并手动改名，未修改任何文件。`)

// All anchors have been verified before any source file is written.
const componentContent = fs.readFileSync(componentSourcePath, 'utf8')
if (!componentContent.includes('IDEA-BOOM-PHASE5-THEME-DETAIL-SPACE')) {
  throw new Error('ThemeDetailSpace.vue 缺少版本标识，可能不是本次代码包中的文件；未修改任何源文件。')
}
fs.writeFileSync(backupPath, original, 'utf8')
try {
  fs.writeFileSync(componentPath, componentContent, 'utf8')
  fs.writeFileSync(appPath, source.replace(/\n/g, newline), 'utf8')
} catch (error) {
  if (fs.existsSync(componentPath)) fs.rmSync(componentPath, { force: true })
  fs.writeFileSync(appPath, original, 'utf8')
  throw error
}
console.log('IdeaBoom Phase 5 已应用。')
console.log('新增：src/components/ThemeDetailSpace.vue')
console.log('已修改：src/App.vue')
console.log(`原文件备份：${path.relative(root, backupPath)}`)
