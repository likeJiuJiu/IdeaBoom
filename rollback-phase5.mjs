import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const appPath = path.join(root, 'src', 'App.vue')
const backupPath = path.join(root, '.ideaboom-phase5-backup', 'App.vue')
const componentPath = path.join(root, 'src', 'components', 'ThemeDetailSpace.vue')

if (!fs.existsSync(backupPath)) {
  throw new Error('没有找到 Phase 5 的 App.vue 备份，无法自动回滚。')
}
if (!fs.existsSync(appPath)) {
  throw new Error('没有找到当前 src/App.vue，未执行回滚。')
}

const current = fs.readFileSync(appPath, 'utf8')
if (!current.includes("import ThemeDetailSpace from './components/ThemeDetailSpace.vue'")) {
  throw new Error('当前 App.vue 未检测到 Phase 5 标记，为避免误覆盖，已停止。')
}

const backup = fs.readFileSync(backupPath)
fs.writeFileSync(appPath, backup)
if (fs.existsSync(componentPath)) {
  const component = fs.readFileSync(componentPath, 'utf8')
  if (component.includes('IDEA-BOOM-PHASE5-THEME-DETAIL-SPACE')) fs.rmSync(componentPath)
}
console.log('Phase 5 已回滚：App.vue 已恢复备份，ThemeDetailSpace.vue 已移除。')
console.log('备份仍保留在 .ideaboom-phase5-backup/App.vue。')
