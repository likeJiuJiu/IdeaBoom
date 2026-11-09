import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const backupDir = path.join(root, '.ideaboom-phase2-backup')

function readFile(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) throw new Error(`找不到 ${relativePath}。请在 IdeaBoom 项目根目录运行本脚本。`)
  const raw = fs.readFileSync(fullPath, 'utf8')
  return { relativePath, fullPath, eol: raw.includes('\r\n') ? '\r\n' : '\n', content: raw.replace(/\r\n/g, '\n') }
}

function replaceOnce(content, oldText, newText, file, label) {
  const first = content.indexOf(oldText)
  if (first < 0) throw new Error(`${file}：找不到「${label}」锚点。已停止，尚未写入任何文件。`)
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${file}：「${label}」锚点出现多次，无法安全自动修改。已停止，尚未写入任何文件。`)
  }
  return content.slice(0, first) + newText + content.slice(first + oldText.length)
}

function replaceMethodBetween(content, startMarker, endMarker, replacement, file, label) {
  const start = content.indexOf(startMarker)
  if (start < 0) throw new Error(`${file}：找不到「${label}」起始位置。已停止，尚未写入任何文件。`)
  const end = content.indexOf(endMarker, start + startMarker.length)
  if (end < 0) throw new Error(`${file}：找不到「${label}」结束位置。已停止，尚未写入任何文件。`)
  if (content.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`${file}：「${label}」起始标记出现多次。已停止，尚未写入任何文件。`)
  }
  return content.slice(0, start) + replacement + content.slice(end)
}

const patchers = {
  'src/lib/nebula.ts': (source) => {
    let content = source
    if (content.includes('export interface NebulaRelation') || content.includes('setConfirmedRelations(') || content.includes('drawConfirmedRelations(')) {
      throw new Error('src/lib/nebula.ts：检测到 Phase 2 关系接口已经存在，请勿重复运行。')
    }

    content = replaceOnce(
      content,
      [
        'export interface NebulaIdea {',
        '  id: number',
        '  x: number',
        '  y: number',
        '  color: string',
        '}',
      ].join('\n'),
      [
        'export interface NebulaIdea {',
        '  id: number',
        '  x: number',
        '  y: number',
        '  color: string',
        '}',
        '',
        '/** 只承载用户已确认的观察关系；画布不负责判断语义。 */',
        'export interface NebulaRelation {',
        '  sourceId: number',
        '  targetId: number',
        '  type: string',
        '}',
      ].join('\n'),
      'src/lib/nebula.ts',
      'NebulaIdea interface',
    )

    content = replaceOnce(
      content,
      '  private ideas: NebulaIdea[] = []\n',
      '  private ideas: NebulaIdea[] = []\n  private confirmedRelations: NebulaRelation[] = []\n',
      'src/lib/nebula.ts',
      'ideas field',
    )

    content = replaceOnce(
      content,
      [
        '  setIdeas(ideas: NebulaIdea[]): void {',
        '    this.ideas = ideas',
        '    this.refreshNodes()',
        '  }',
      ].join('\n'),
      [
        '  setIdeas(ideas: NebulaIdea[]): void {',
        '    this.ideas = ideas',
        '    const validIds = new Set(ideas.map((idea) => idea.id))',
        '    this.confirmedRelations = this.confirmedRelations.filter(',
        '      (relation) => validIds.has(relation.sourceId) && validIds.has(relation.targetId),',
        '    )',
        '    this.refreshNodes()',
        '  }',
        '',
        '  /** 接收工作台已确认的关系；建议态和已否定关系不会进入画布。 */',
        '  setConfirmedRelations(relations: NebulaRelation[]): void {',
        '    const validIds = new Set(this.ideas.map((idea) => idea.id))',
        '    const seen = new Set<string>()',
        '    this.confirmedRelations = relations.filter((relation) => {',
        '      if (relation.sourceId === relation.targetId) return false',
        '      if (!validIds.has(relation.sourceId) || !validIds.has(relation.targetId)) return false',
        "      const key = [relation.sourceId, relation.targetId].sort((a, b) => a - b).join(':')",
        '      if (seen.has(key)) return false',
        '      seen.add(key)',
        '      return true',
        '    })',
        '    // 关系更新后立即刷新；动效暂停时也会绘制一帧静态关系。',
        '    this.start()',
        '  }',
      ].join('\n'),
      'src/lib/nebula.ts',
      'setIdeas method',
    )

    const newDrawWorld = [
      '  private drawWorld(ctx: CanvasRenderingContext2D): void {',
      '    this.useCamera(ctx, 1)',
      '    this.drawConfirmedRelations(ctx)',
      '    this.drawGuide(ctx)',
      '    this.drawRipples(ctx)',
      '    this.drawSparks(ctx)',
      '    this.drawComets(ctx)',
      '  }',
      '',
      '  /** 只绘制用户确认的关系；空间距离不再被误认为语义联系。 */',
      '  private drawConfirmedRelations(ctx: CanvasRenderingContext2D): void {',
      '    if (this.confirmedRelations.length === 0) return',
      '    const zoom = Math.max(0.01, this.cam.zoom)',
      '    const focus = this.focusId',
      '    const ideaMap = new Map<number, NebulaIdea>()',
      '    for (const idea of this.ideas) ideaMap.set(idea.id, idea)',
      '    const palette: Record<string, { line: string; glow: string }> = {',
      "      'same-scene': { line: 'rgba(205, 184, 255, 0.94)', glow: 'rgba(172, 145, 255, 0.40)' },",
      "      'shared-friction': { line: 'rgba(126, 224, 255, 0.94)', glow: 'rgba(105, 213, 255, 0.40)' },",
      "      'cross-scene': { line: 'rgba(139, 239, 211, 0.94)', glow: 'rgba(115, 228, 197, 0.38)' },",
      "      'possible-contradiction': { line: 'rgba(255, 202, 145, 0.96)', glow: 'rgba(255, 179, 112, 0.40)' },",
      "      other: { line: 'rgba(189, 192, 255, 0.88)', glow: 'rgba(163, 169, 255, 0.32)' },",
      '    }',
      '    for (const relation of this.confirmedRelations) {',
      '      const source = ideaMap.get(relation.sourceId)',
      '      const target = ideaMap.get(relation.targetId)',
      '      if (!source || !target) continue',
      '      const sourceOffset = this.offsets.get(source.id)',
      '      const targetOffset = this.offsets.get(target.id)',
      '      const sourceBase = this.worldOf(source)',
      '      const targetBase = this.worldOf(target)',
      '      const ax = sourceBase.x + (sourceOffset?.x ?? 0)',
      '      const ay = sourceBase.y + (sourceOffset?.y ?? 0)',
      '      const bx = targetBase.x + (targetOffset?.x ?? 0)',
      '      const by = targetBase.y + (targetOffset?.y ?? 0)',
      '      const dx = bx - ax',
      '      const dy = by - ay',
      '      const distance = Math.max(1, Math.hypot(dx, dy))',
      '      const bendDirection = (relation.sourceId + relation.targetId) % 2 === 0 ? 1 : -1',
      '      const bend = Math.min(64, Math.max(22, distance * 0.075)) * bendDirection',
      '      const cx = (ax + bx) / 2 - (dy / distance) * bend',
      '      const cy = (ay + by) / 2 + (dx / distance) * bend',
      '      const highlighted = focus === null || source.id === focus || target.id === focus',
      '      const alpha = focus === null ? 0.72 : highlighted ? 1 : 0.12',
      '      const colors = palette[relation.type] ?? palette.other',
      '      ctx.save()',
      '      ctx.globalAlpha = alpha',
      "      ctx.lineCap = 'round'",
      "      ctx.lineJoin = 'round'",
      '      ctx.shadowColor = colors.glow',
      '      ctx.shadowBlur = (highlighted ? 18 : 8) / zoom',
      '      ctx.strokeStyle = colors.glow',
      '      ctx.lineWidth = (highlighted ? 4 : 2.2) / zoom',
      '      ctx.beginPath()',
      '      ctx.moveTo(ax, ay)',
      '      ctx.quadraticCurveTo(cx, cy, bx, by)',
      '      ctx.stroke()',
      '      ctx.shadowBlur = (highlighted ? 10 : 4) / zoom',
      '      ctx.strokeStyle = colors.line',
      '      ctx.lineWidth = (highlighted ? 1.35 : 0.85) / zoom',
      '      ctx.setLineDash([8 / zoom, 11 / zoom])',
      '      ctx.lineDashOffset = this.motion ? -this.time * 0.004 : 0',
      '      ctx.beginPath()',
      '      ctx.moveTo(ax, ay)',
      '      ctx.quadraticCurveTo(cx, cy, bx, by)',
      '      ctx.stroke()',
      '      ctx.setLineDash([])',
      '      const phase = ((relation.sourceId * 31 + relation.targetId * 17) % 100) / 100',
      '      const t = this.motion ? (this.time * 0.000045 + phase) % 1 : 0.5',
      '      const inverse = 1 - t',
      '      const px = inverse * inverse * ax + 2 * inverse * t * cx + t * t * bx',
      '      const py = inverse * inverse * ay + 2 * inverse * t * cy + t * t * by',
      '      const dotSize = (highlighted ? 3.4 : 2.4) / zoom',
      '      ctx.shadowColor = colors.line',
      '      ctx.shadowBlur = (highlighted ? 13 : 6) / zoom',
      '      ctx.fillStyle = colors.line',
      '      ctx.beginPath()',
      '      ctx.arc(px, py, dotSize, 0, TAU)',
      '      ctx.fill()',
      '      ctx.restore()',
      '    }',
      '  }',
      '',
    ].join('\n')

    content = replaceMethodBetween(
      content,
      '  private drawWorld(ctx: CanvasRenderingContext2D): void {',
      '  private drawGuide(ctx: CanvasRenderingContext2D): void {',
      newDrawWorld,
      'src/lib/nebula.ts',
      'drawWorld method',
    )
    return content
  },

  'src/components/ObservationWorkspace.vue': (source) => {
    let content = source
    if (content.includes("'relations-change'")) throw new Error('ObservationWorkspace.vue：已经存在 relations-change 事件，请勿重复运行。')
    content = replaceOnce(
      content,
      "const emit = defineEmits<{ create: [text: string] }>()",
      [
        'const emit = defineEmits<{',
        '  create: [text: string]',
        "  'relations-change': [relations: Array<{ sourceId: number; targetId: number; type: ObservationRelation['type'] }>]",
        '}>()'
      ].join('\n'),
      'src/components/ObservationWorkspace.vue',
      'defineEmits',
    )
    content = replaceOnce(
      content,
      'const visibleThemes = computed(() => workspace.value.themes.slice(0, 5))',
      [
        'const visibleThemes = computed(() => workspace.value.themes.slice(0, 5))',
        '',
        '// 把工作台已确认的关系同步给父级；建议态和已否定关系不会进入画布。',
        'const confirmedRelationsForCanvas = computed(() =>',
        '  workspace.value.relations',
        "    .filter((item) => item.status === 'confirmed')",
        '    .map((item) => ({ sourceId: item.sourceId, targetId: item.targetId, type: item.type })),',
        ')',
        'watch(confirmedRelationsForCanvas, (relations) => {',
        "  emit('relations-change', relations)",
        '}, { immediate: true })',
      ].join('\n'),
      'src/components/ObservationWorkspace.vue',
      'visibleThemes computed',
    )
    return content
  },

  'src/App.vue': (source) => {
    let content = source
    if (content.includes('confirmedRelationBridge') || content.includes('syncConfirmedObservationRelations')) {
      throw new Error('src/App.vue：已经存在 Phase 2 关系桥接代码，请勿重复运行。')
    }
    content = replaceOnce(
      content,
      'const bornTimers = new Map<number, number>()',
      'const confirmedRelationBridge = ref<Array<{ sourceId: number; targetId: number; type: string }>>([])\nconst bornTimers = new Map<number, number>()',
      'src/App.vue',
      'bornTimers declaration',
    )
    content = replaceOnce(
      content,
      [
        'function syncEngine() {',
        '  engine?.setIdeas(ideas.value.map((idea) => ({ id: idea.id, x: idea.x, y: idea.y, color: idea.color })))',
        '  engine?.refreshNodes()',
        '}',
      ].join('\n'),
      [
        'function syncEngine() {',
        '  engine?.setIdeas(ideas.value.map((idea) => ({ id: idea.id, x: idea.x, y: idea.y, color: idea.color })))',
        '  engine?.refreshNodes()',
        '}',
        '',
        'function syncConfirmedObservationRelations(relations: Array<{ sourceId: number; targetId: number; type: string }>): void {',
        '  confirmedRelationBridge.value = relations',
        '  engine?.setConfirmedRelations(relations)',
        '}',
      ].join('\n'),
      'src/App.vue',
      'syncEngine function',
    )
    content = replaceOnce(
      content,
      '    syncEngine()\n    engine.setMotionEnabled(motionEnabled.value)',
      '    syncEngine()\n    engine.setConfirmedRelations(confirmedRelationBridge.value)\n    engine.setMotionEnabled(motionEnabled.value)',
      'src/App.vue',
      'engine initialization',
    )
    content = replaceOnce(
      content,
      '@create="addObservationFromWorkspace"',
      '@create="addObservationFromWorkspace"\n  @relations-change="syncConfirmedObservationRelations"',
      'src/App.vue',
      'ObservationWorkspace create event',
    )
    return content
  },
}

// 所有文件先在内存中完成检查和修改；任一锚点失败，磁盘文件均不会改动。
const prepared = []
for (const [relativePath, patch] of Object.entries(patchers)) {
  const file = readFile(relativePath)
  prepared.push({ ...file, next: patch(file.content) })
}

fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
for (const file of prepared) {
  const backupPath = path.join(backupDir, `${file.relativePath.replaceAll('/', '__')}.${stamp}.bak`)
  fs.writeFileSync(backupPath, fs.readFileSync(file.fullPath))
}
for (const file of prepared) {
  fs.writeFileSync(file.fullPath, file.next.replace(/\n/g, file.eol), 'utf8')
}

console.log('IdeaBoom Phase 2 修正版已应用。原文件备份位于 .ideaboom-phase2-backup/。')
console.log('已修改：')
for (const file of prepared) console.log(`  - ${file.relativePath}`)
console.log('\n下一步请运行：npm run build')
