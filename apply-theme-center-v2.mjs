import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const appPath = path.join(root, 'src', 'App.vue')
const componentDir = path.join(root, 'src', 'components')
const workspaceSourcePath = path.join(root, 'ObservationWorkspace.vue')
const detailSourcePath = path.join(root, 'ThemeDetailSpace.vue')
const workspaceTargetPath = path.join(componentDir, 'ObservationWorkspace.vue')
const detailTargetPath = path.join(componentDir, 'ThemeDetailSpace.vue')

for (const [file, label] of [
  [appPath, 'src/App.vue'],
  [workspaceTargetPath, 'src/components/ObservationWorkspace.vue'],
  [detailTargetPath, 'src/components/ThemeDetailSpace.vue'],
  [workspaceSourcePath, '包内 ObservationWorkspace.vue'],
  [detailSourcePath, '包内 ThemeDetailSpace.vue'],
]) {
  if (!fs.existsSync(file)) throw new Error(`未找到${label}。请在项目根目录放置完整代码包文件；没有修改任何项目文件。`)
}

const originalApp = fs.readFileSync(appPath, 'utf8')
const originalWorkspace = fs.readFileSync(workspaceTargetPath, 'utf8')
const originalDetail = fs.readFileSync(detailTargetPath, 'utf8')
const workspaceContent = fs.readFileSync(workspaceSourcePath, 'utf8')
const detailContent = fs.readFileSync(detailSourcePath, 'utf8')
const newline = originalApp.includes('\r\n') ? '\r\n' : '\n'
let app = originalApp.replace(/\r\n/g, '\n')

if (!app.includes("import ThemeDetailSpace from './components/ThemeDetailSpace.vue'")) {
  throw new Error('当前 App.vue 未检测到 ThemeDetailSpace 导入；请确认 Phase 5/6 已安装。没有修改任何项目文件。')
}
if (!app.includes('function openThemeSpace(')) {
  throw new Error('当前 App.vue 未检测到 openThemeSpace()；无法打开主题详情。没有修改任何项目文件。')
}
if (!workspaceContent.includes('IDEA-BOOM-THEME-CENTER-V2')) {
  throw new Error('包内 ObservationWorkspace.vue 缺少 V2 标识。没有修改任何项目文件。')
}
if (!detailContent.includes('IDEA-BOOM-PHASE6-THEME-ACTIONS')) {
  throw new Error('包内 ThemeDetailSpace.vue 不是 Phase 6 兼容版本。没有修改任何项目文件。')
}

const workspaceOpen = [...app.matchAll(/<ObservationWorkspace\b/g)]
if (workspaceOpen.length !== 1) {
  throw new Error(`App.vue 中应有且只有一个 ObservationWorkspace，当前找到 ${workspaceOpen.length} 个。没有修改任何项目文件。`)
}
const start = workspaceOpen[0].index
const end = app.indexOf('/>', start)
if (end < 0) throw new Error('ObservationWorkspace 标签不完整。没有修改任何项目文件。')
let workspaceTag = app.slice(start, end + 2)
if (!workspaceTag.includes('@open-theme=')) {
  workspaceTag = workspaceTag.replace(/\s*\/>$/, `${newline}      @open-theme="openThemeSpace"${newline}    />`)
  if (!workspaceTag.includes('@open-theme="openThemeSpace"')) {
    throw new Error('无法安全添加主题打开事件。没有修改任何项目文件。')
  }
  app = app.slice(0, start) + workspaceTag + app.slice(end + 2)
}

const backupDir = path.join(root, '.ideaboom-theme-center-v2-backup')
if (fs.existsSync(backupDir)) {
  throw new Error(`备份目录已存在：${backupDir}。请检查或改名旧备份后再安装。没有修改任何项目文件。`)
}
fs.mkdirSync(backupDir, { recursive: true })
fs.writeFileSync(path.join(backupDir, 'App.vue'), originalApp, 'utf8')
fs.writeFileSync(path.join(backupDir, 'ObservationWorkspace.vue'), originalWorkspace, 'utf8')
fs.writeFileSync(path.join(backupDir, 'ThemeDetailSpace.vue'), originalDetail, 'utf8')

try {
  fs.writeFileSync(workspaceTargetPath, workspaceContent.replace(/\r\n/g, '\n').replace(/\n/g, newline), 'utf8')
  fs.writeFileSync(detailTargetPath, detailContent.replace(/\r\n/g, '\n').replace(/\n/g, newline), 'utf8')
  fs.writeFileSync(appPath, app.replace(/\n/g, newline), 'utf8')
} catch (error) {
  fs.writeFileSync(appPath, originalApp, 'utf8')
  fs.writeFileSync(workspaceTargetPath, originalWorkspace, 'utf8')
  fs.writeFileSync(detailTargetPath, originalDetail, 'utf8')
  throw error
}

console.log('IdeaBoom 主题中心 V2 已应用。')
console.log('已更新：src/components/ObservationWorkspace.vue')
console.log('已更新：src/components/ThemeDetailSpace.vue')
console.log('已连接：ObservationWorkspace @open-theme -> openThemeSpace')
console.log(`三个原文件均已备份至：${path.relative(root, backupDir)}`)
