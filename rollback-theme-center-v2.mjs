import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const backupDir = path.join(root, '.ideaboom-theme-center-v2-backup')
const files = [
  ['App.vue', path.join(root, 'src', 'App.vue')],
  ['ObservationWorkspace.vue', path.join(root, 'src', 'components', 'ObservationWorkspace.vue')],
  ['ThemeDetailSpace.vue', path.join(root, 'src', 'components', 'ThemeDetailSpace.vue')],
]
for (const [name] of files) {
  if (!fs.existsSync(path.join(backupDir, name))) throw new Error(`缺少备份文件 ${name}，为避免部分回滚，未修改任何文件。`)
}
for (const [name, target] of files) fs.copyFileSync(path.join(backupDir, name), target)
console.log('主题中心 V2 已完整回滚，App.vue 与两个组件均已恢复。')
