import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const backupDir = path.join(root, '.ideaboom-phase3-backup')
if (!fs.existsSync(backupDir)) throw new Error('没有找到 .ideaboom-phase3-backup，无法回滚。')
const manifests = fs.readdirSync(backupDir)
  .filter((name) => /^manifest\..+\.json$/.test(name))
  .sort()
if (!manifests.length) throw new Error('备份目录中没有有效 manifest，无法自动回滚。')
const manifestPath = path.join(backupDir, manifests[manifests.length - 1])
const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
for (const entry of entries) {
  const backupPath = path.join(root, entry.backupPath)
  const targetPath = path.join(root, entry.relativePath)
  if (!fs.existsSync(backupPath)) throw new Error(`缺少备份文件：${entry.backupPath}。为避免部分回滚，已停止。`)
}
for (const entry of entries) {
  fs.copyFileSync(path.join(root, entry.backupPath), path.join(root, entry.relativePath))
}
console.log(`已从 ${path.relative(root, manifestPath)} 恢复 Phase 3 修改前的文件：`)
for (const entry of entries) console.log(`  - ${entry.relativePath}`)
