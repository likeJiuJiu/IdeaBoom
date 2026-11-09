import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const backupDir = path.join(root, '.ideaboom-phase3-backup')

function readFile(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) throw new Error(`找不到 ${relativePath}。请在 IdeaBoom 项目根目录运行本脚本。`)
  const raw = fs.readFileSync(fullPath, 'utf8')
  return { relativePath, fullPath, eol: raw.includes('\r\n') ? '\r\n' : '\n', original: raw, content: raw.replace(/\r\n/g, '\n') }
}

function replaceOnce(content, oldText, newText, file, label) {
  const first = content.indexOf(oldText)
  if (first < 0) throw new Error(`${file}：找不到「${label}」锚点。当前文件可能不是已完成 Phase 2 的版本，已停止且未修改任何文件。`)
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${file}：「${label}」锚点出现多次，无法安全自动修改。已停止且未修改任何文件。`)
  }
  return content.slice(0, first) + newText + content.slice(first + oldText.length)
}

function ensureNotApplied(content, marker, file) {
  if (content.includes(marker)) throw new Error(`${file}：检测到 Phase 3 代码已经存在，请勿重复运行。`)
}

const patchers = {
  'src/lib/nebula.ts': (source) => {
    let content = source
    ensureNotApplied(content, 'export interface NebulaTheme', 'src/lib/nebula.ts')
    ensureNotApplied(content, 'drawProblemThemes(ctx:', 'src/lib/nebula.ts')

    content = replaceOnce(
      content,
      [
        'export interface NebulaRelation {',
        '  sourceId: number',
        '  targetId: number',
        '  type: string',
        '}',
      ].join('\n'),
      [
        'export interface NebulaRelation {',
        '  sourceId: number',
        '  targetId: number',
        '  type: string',
        '}',
        '',
        '/** 用户手动整理的问题主题；仅用于画布呈现，不承载业务存储。 */',
        'export interface NebulaTheme {',
        '  id: string',
        '  title: string',
        '  observationIds: number[]',
        "  status: 'observing' | 'exploring' | 'paused'",
        '}',
      ].join('\n'),
      'src/lib/nebula.ts',
      'Phase 2 NebulaRelation interface',
    )

    content = replaceOnce(
      content,
      '  private confirmedRelations: NebulaRelation[] = []\n',
      '  private confirmedRelations: NebulaRelation[] = []\n  private problemThemes: NebulaTheme[] = []\n',
      'src/lib/nebula.ts',
      'Phase 2 confirmedRelations field',
    )

    const themeSetter = [
      '  /** 接收观察工作台已保存的问题主题；少于两条有效观察的主题不绘制。 */',
      '  setProblemThemes(themes: NebulaTheme[]): void {',
      '    const validIds = new Set(this.ideas.map((idea) => idea.id))',
      '    this.problemThemes = themes',
      '      .map((theme) => ({',
      '        ...theme,',
      '        observationIds: [...new Set(theme.observationIds.filter((id) => validIds.has(id)))],',
      '      }))',
      '      .filter((theme) => theme.title.trim().length > 0 && theme.observationIds.length >= 2)',
      '    this.start()',
      '  }',
      '',
    ].join('\n')

    content = replaceOnce(
      content,
      '  /** 接收工作台已确认的关系；建议态和已否定关系不会进入画布。 */',
      themeSetter + '  /** 接收工作台已确认的关系；建议态和已否定关系不会进入画布。 */',
      'src/lib/nebula.ts',
      'Phase 2 confirmed relation setter',
    )

    content = replaceOnce(
      content,
      '    this.useCamera(ctx, 1)\n    this.drawConfirmedRelations(ctx)',
      '    this.useCamera(ctx, 1)\n    this.drawProblemThemes(ctx)\n    this.drawConfirmedRelations(ctx)',
      'src/lib/nebula.ts',
      'Phase 2 drawWorld relation call',
    )

    const drawThemesMethod = [
      '  /**',
      '   * 将用户整理的问题主题绘制为柔和星群区域。',
      '   * 主题来自用户确认的观察集合，不会因为空间距离或文本相似自动生成。',
      '   */',
      '  private drawProblemThemes(ctx: CanvasRenderingContext2D): void {',
      '    if (this.problemThemes.length === 0) return',
      '    const zoom = Math.max(0.01, this.cam.zoom)',
      '    const ideaMap = new Map<number, NebulaIdea>()',
      '    for (const idea of this.ideas) ideaMap.set(idea.id, idea)',
      '    const palette: Record<NebulaTheme[\'status\'], string> = {',
      "      observing: '#A99AFF',",
      "      exploring: '#77E8D8',",
      "      paused: '#9AA0BD',",
      '    }',
      '    for (const theme of this.problemThemes.slice(0, 10)) {',
      '      const members = theme.observationIds',
      '        .map((id) => ideaMap.get(id))',
      '        .filter((idea): idea is NebulaIdea => Boolean(idea))',
      '      if (members.length < 2) continue',
      '      const points = members.map((idea) => {',
      '        const base = this.worldOf(idea)',
      '        const offset = this.offsets.get(idea.id)',
      '        return { x: base.x + (offset?.x ?? 0), y: base.y + (offset?.y ?? 0) }',
      '      })',
      '      const xs = points.map((point) => point.x)',
      '      const ys = points.map((point) => point.y)',
      '      const minX = Math.min(...xs)',
      '      const maxX = Math.max(...xs)',
      '      const minY = Math.min(...ys)',
      '      const maxY = Math.max(...ys)',
      '      const centerX = (minX + maxX) / 2',
      '      const centerY = (minY + maxY) / 2',
      '      const radiusX = Math.max(116, (maxX - minX) / 2 + 84)',
      '      const radiusY = Math.max(88, (maxY - minY) / 2 + 64)',
      '      const hasFocus = this.focusId === null || members.some((idea) => idea.id === this.focusId)',
      '      const alpha = this.focusId === null ? 0.9 : hasFocus ? 1 : 0.16',
      '      const color = palette[theme.status] ?? palette.observing',
      '      ctx.save()',
      '      ctx.globalAlpha = alpha',
      '      ctx.shadowColor = withAlpha(color, 0.34)',
      '      ctx.shadowBlur = (34 + Math.min(24, members.length * 3)) / zoom',
      '      const gradient = ctx.createRadialGradient(centerX, centerY, 8 / zoom, centerX, centerY, Math.max(radiusX, radiusY))',
      '      gradient.addColorStop(0, withAlpha(color, 0.105))',
      '      gradient.addColorStop(0.62, withAlpha(color, 0.052))',
      '      gradient.addColorStop(1, withAlpha(color, 0.008))',
      '      ctx.fillStyle = gradient',
      '      ctx.beginPath()',
      '      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU)',
      '      ctx.fill()',
      '      ctx.shadowBlur = 0',
      '      ctx.strokeStyle = withAlpha(color, hasFocus ? 0.26 : 0.08)',
      '      ctx.lineWidth = 1.05 / zoom',
      '      ctx.setLineDash([12 / zoom, 15 / zoom])',
      '      ctx.beginPath()',
      '      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU)',
      '      ctx.stroke()',
      '      ctx.setLineDash([])',
      '      // 主题标签保持接近屏幕固定尺寸，缩放时不至于过大或过小。',
      '      const titleChars = [...theme.title.trim()]',
      '      const label = titleChars.length > 18 ? `${titleChars.slice(0, 18).join(\'\')}…` : titleChars.join(\'\')',
      '      ctx.font = `600 ${12 / zoom}px "Microsoft YaHei", "PingFang SC", sans-serif`',
      '      ctx.textBaseline = \'middle\'',
      '      const labelWidth = ctx.measureText(label).width + 22 / zoom',
      '      const labelHeight = 25 / zoom',
      '      const labelX = centerX - labelWidth / 2',
      '      const labelY = centerY - radiusY - labelHeight - 10 / zoom',
      '      ctx.fillStyle = withAlpha(color, 0.16)',
      '      ctx.strokeStyle = withAlpha(color, 0.34)',
      '      ctx.lineWidth = 1 / zoom',
      '      ctx.beginPath()',
      '      ctx.rect(labelX, labelY, labelWidth, labelHeight)',
      '      ctx.fill()',
      '      ctx.stroke()',
      '      ctx.fillStyle = withAlpha(color, hasFocus ? 0.96 : 0.58)',
      '      ctx.fillText(label, labelX + 11 / zoom, labelY + labelHeight / 2)',
      '      ctx.restore()',
      '    }',
      '  }',
      '',
    ].join('\n')

    content = replaceOnce(
      content,
      '  /** 只绘制用户确认的关系；空间距离不再被误认为语义联系。 */',
      drawThemesMethod + '  /** 只绘制用户确认的关系；空间距离不再被误认为语义联系。 */',
      'src/lib/nebula.ts',
      'Phase 2 drawConfirmedRelations method',
    )

    return content
  },

  'src/components/ObservationWorkspace.vue': (source) => {
    let content = source
    ensureNotApplied(content, "'themes-change'", 'src/components/ObservationWorkspace.vue')

    content = replaceOnce(
      content,
      "  'relations-change': [relations: Array<{ sourceId: number; targetId: number; type: ObservationRelation['type'] }>]\n}>()",
      [
        "  'relations-change': [relations: Array<{ sourceId: number; targetId: number; type: ObservationRelation['type'] }>]",
        "  'themes-change': [themes: Array<{ id: string; title: string; observationIds: number[]; status: 'observing' | 'exploring' | 'paused' }>]",
        '}>()',
      ].join('\n'),
      'src/components/ObservationWorkspace.vue',
      'Phase 2 defineEmits relation event',
    )

    content = replaceOnce(
      content,
      [
        "watch(confirmedRelationsForCanvas, (relations) => {",
        "  emit('relations-change', relations)",
        '}, { immediate: true })',
      ].join('\n'),
      [
        "watch(confirmedRelationsForCanvas, (relations) => {",
        "  emit('relations-change', relations)",
        '}, { immediate: true })',
        '',
        '// 主题由用户在工作台中明确创建；只把主题成员和状态同步给星云引擎。',
        'const themesForCanvas = computed(() => workspace.value.themes.map((theme) => ({',
        '  id: theme.id,',
        '  title: theme.title,',
        '  observationIds: [...theme.observationIds],',
        '  status: theme.status,',
        '})))',
        'watch(themesForCanvas, (themes) => {',
        "  emit('themes-change', themes)",
        '}, { immediate: true })',
      ].join('\n'),
      'src/components/ObservationWorkspace.vue',
      'Phase 2 confirmed relations watcher',
    )
    return content
  },

  'src/App.vue': (source) => {
    let content = source
    ensureNotApplied(content, 'problemThemeBridge', 'src/App.vue')

    content = replaceOnce(
      content,
      'const confirmedRelationBridge = ref<Array<{ sourceId: number; targetId: number; type: string }>>([])\n',
      'const confirmedRelationBridge = ref<Array<{ sourceId: number; targetId: number; type: string }>>([])\nconst problemThemeBridge = ref<Array<{ id: string; title: string; observationIds: number[]; status: \'observing\' | \'exploring\' | \'paused\' }>>([])\n',
      'src/App.vue',
      'Phase 2 confirmedRelationBridge declaration',
    )

    content = replaceOnce(
      content,
      [
        'function syncConfirmedObservationRelations(relations: Array<{ sourceId: number; targetId: number; type: string }>): void {',
        '  confirmedRelationBridge.value = relations',
        '  engine?.setConfirmedRelations(relations)',
        '}',
      ].join('\n'),
      [
        'function syncConfirmedObservationRelations(relations: Array<{ sourceId: number; targetId: number; type: string }>): void {',
        '  confirmedRelationBridge.value = relations',
        '  engine?.setConfirmedRelations(relations)',
        '}',
        '',
        'function syncProblemThemes(themes: Array<{ id: string; title: string; observationIds: number[]; status: \'observing\' | \'exploring\' | \'paused\' }>): void {',
        '  problemThemeBridge.value = themes',
        '  engine?.setProblemThemes(themes)',
        '}',
      ].join('\n'),
      'src/App.vue',
      'Phase 2 relation bridge function',
    )

    content = replaceOnce(
      content,
      '    engine.setConfirmedRelations(confirmedRelationBridge.value)\n',
      '    engine.setConfirmedRelations(confirmedRelationBridge.value)\n    engine.setProblemThemes(problemThemeBridge.value)\n',
      'src/App.vue',
      'Phase 2 engine initialization relation sync',
    )

    content = replaceOnce(
      content,
      '@relations-change="syncConfirmedObservationRelations"',
      '@relations-change="syncConfirmedObservationRelations"\n  @themes-change="syncProblemThemes"',
      'src/App.vue',
      'Phase 2 component relation event',
    )
    return content
  },
}

// 先在内存中完成全部锚点检查，任意一处不匹配都不会写入源文件。
const prepared = []
for (const [relativePath, patch] of Object.entries(patchers)) {
  const file = readFile(relativePath)
  prepared.push({ ...file, next: patch(file.content) })
}

fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const manifest = []
for (const file of prepared) {
  const backupPath = path.join(backupDir, `${file.relativePath.replaceAll('/', '__')}.${stamp}.bak`)
  fs.writeFileSync(backupPath, file.original)
  manifest.push({ relativePath: file.relativePath, backupPath: path.relative(root, backupPath) })
}
for (const file of prepared) {
  fs.writeFileSync(file.fullPath, file.next.replace(/\n/g, file.eol), 'utf8')
}
fs.writeFileSync(path.join(backupDir, `manifest.${stamp}.json`), JSON.stringify(manifest, null, 2), 'utf8')

console.log('IdeaBoom Phase 3 已应用：问题主题星群聚合。')
console.log('已修改：')
for (const file of prepared) console.log(`  - ${file.relativePath}`)
console.log(`原文件备份位于：${path.relative(root, backupDir)}`)
console.log('\n下一步请运行：npm run build')
