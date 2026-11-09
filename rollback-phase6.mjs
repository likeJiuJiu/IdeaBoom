import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const appPath = path.join(root, 'src', 'App.vue')
const componentPath = path.join(root, 'src', 'components', 'ThemeDetailSpace.vue')
const backupDir = path.join(root, '.ideaboom-phase6-backup')
const backupPath = path.join(backupDir, 'App.vue')
const componentBackupPath = path.join(backupDir, 'ThemeDetailSpace.vue')
if (!fs.existsSync(backupPath)) throw new Error('未找到 Phase 6 的 App.vue 备份，无法自动回滚。')
const current = fs.readFileSync(appPath, 'utf8')
if (!current.includes('function extendObservationIntoTheme') || !current.includes('@create-observation=\"createObservationFromTheme\"')) {
  throw new Error('当前 App.vue 未检测到完整 Phase 6 标识。为避免误删其他修改，已停止。')
}
fs.copyFileSync(backupPath, appPath)
if (fs.existsSync(componentBackupPath)) {
  fs.copyFileSync(componentBackupPath, componentPath)
  console.log('已恢复 Phase 5 的 ThemeDetailSpace.vue。')
} else if (fs.existsSync(componentPath)) {
  const content = fs.readFileSync(componentPath, 'utf8')
  if (content.includes('IDEA-BOOM-PHASE6-THEME-ACTIONS')) fs.rmSync(componentPath)
}
console.log('Phase 6 App.vue 已恢复。')
console.log('注意：observation.ts 与 observation-store.ts 请手动恢复你安装前的备份。')
