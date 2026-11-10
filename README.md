# 🌌 IdeaBoom · 灵感星云

> **不急着有答案，让想法先发光。**
> *把想法当作观测对象，而不是待办事项。*

[![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Local-first](https://img.shields.io/badge/local--first-yes-8a2be2?style=flat-square)](#-数据与隐私)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-贡献)

> 🚧 **早期原型** · 本地优先 · 无需复杂配置即可体验完整认知闭环


https://github.com/user-attachments/assets/71d228a6-2b03-4aef-9852-36bd7d7aeefb

---

## 🕳️ 你的备忘录，是个黑洞吗？

你记下的那些念头——便利店里没人设计过的等待、某个软件用起来不对劲的地方、走在路上突然冒出的疑问——它们存进去了，然后**再也没有被打开过**。

传统笔记要求你**先整理再保存**，且列表是线性的，导致三个月前那条观察，和昨天那条永远无法产生交集。而市面上的 AI 工具，往往用“随机碰撞”制造虚假的智能感，用黑盒推荐替代了人的判断。

IdeaBoom 想做的，就是把这个黑洞，变成一片**你能反复回来观测的星空**。

---

## 💡 什么是 IdeaBoom？

IdeaBoom 是一款以个人观察为起点，通过 AI 理解、证据化关联与跨领域方法迁移，帮助用户从零散思考中发现问题、探索新方案的个人认知工具。

它由**两大业务主线**构成：

```text
灵感相遇主线
  捕获想法 → 星云呈现 → 时间回响 / 双星共振 → 生成带来源的新想法

观察探索主线
  捕获观察 → AI 理解 → 证据关系确认 → 问题主题 → 外部研究
```

一条感性，负责让想法发光；一条理性，负责把光聚成火。

---

## ✨ 三大核心机制

围绕用户的认知路径，IdeaBoom 设计了三个截然不同的功能矩阵：

### ⏳ 1. 时间回响（记忆唤醒）
**回答的问题：过去的我曾经想过什么？**
- 主动触发机制：系统按沉淀时间、冷却与频率规则，重新呈现旧想法。
- 二次创作：你可以只读，也可以写下一条带来源 ID 的补充想法，让新想法站在旧想法的肩膀上。

### 🧠 2. AI 关联（认知收敛）
**回答的问题：这些观察之间有什么联系？**
- 证据优先：AI 默认只提供“建议”，每条建议必须附上**双方原文的证据短语**，服务端校验其真实性。
- 三态模型：建议 / 确认 / 否定。只有你确认，关系才成立；你否定过的，后续 AI 不能覆盖。
- 防幻觉设计：引入 `unknowns`（未知信息）字段，强迫 AI 承认“原文未说明”，不虚构事实。

### 💫 3. 双星共振（跨域启发）
**回答的问题：其他领域的什么方法能启发我？**
- 非对称跨领域迁移：打破传统的“对等关联”，采用“A 目标问题 -> B 异域启发 -> C 新方案”的结构。
- 激发新思路：从其他业务领域借用设计机制。例如，将“外卖点餐的分步引导”迁移到“社区报修”场景，产出全新的产品方案假设。
- 界面明示：*“候选由轻量规则筛选；是否存在联系，由你自己决定。”*

---

## 🛠️ 技术栈与架构

| 层级 | 技术 | 说明 |
|---|---|---|
| 框架 | Vue 3 + TypeScript | Composition API，类型安全 |
| 构建 | Vite 8 | 极速开发服务器与生产构建 |
| 视觉 | 原生 Canvas 2D + DOM | 星云与星系渲染，零重型图形库依赖 |
| 状态 | Vue 响应式 + localStorage | 本地持久化，刷新即刻恢复 |
| AI / 搜索 | OpenAI-compatible API + Tavily | 经 Vite 开发期插件代理，支持本地降级 |

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 18

### 安装与运行
```bash
# 1. 克隆仓库
git clone https://github.com/likeJiuJiu/IdeaBoom.git
cd IdeaBoom

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev
```
打开终端输出的地址（默认 `http://localhost:5173`）即可进入星云首页。

> **不配置 API Key 也能跑通核心流程！** 观察分析会自动降级到本地规则引擎，记录、星云、回响、关系确认、主题管理全部可用。

### 可选：接入 AI 与外部研究
在根目录创建 `.env.local` 填入：
```dotenv
IDEABOOM_LLM_BASE_URL=https://your-llm-provider.example/v1
IDEABOOM_LLM_API_KEY=your-llm-api-key
IDEABOOM_LLM_MODEL=your-model-name
TAVILY_API_KEY=your-tavily-api-key
```

---

## 🧭 设计原则

这八条不是功能列表，是这个项目**不会妥协的东西**：

1. **先留下，后理解。** 记录不要求分类、命名或补齐字段。
2. **保留原文。** 分析是附加层，永不覆盖你的原始记录。
3. **相遇有规则。** 回响与共振必须满足约束，不靠纯随机制造虚假关联。
4. **AI 给线索，人做判断。** 关系默认是“建议”，你否定过的，后续分析不能覆盖。
5. **证据优先。** 每条关系建议必须附原文证据短语，服务端校验其真实存在。
6. **允许没有结果。** 没有可靠关联时返回空，不为了“智能感”强行凑数。
7. **个人观察 ≠ 普遍需求。** 主题是待验证的问题线索，不是市场结论。
8. **发送需知情。** 外部研究明确告知发送范围，并必须由你勾选同意。

---

## 🔐 数据与隐私

- **本地优先**：所有数据默认只存在**当前浏览器的 localStorage** 中。
- **透明发送**：自动理解开启时，会把当前观察 + 最多 20 条近期历史发给模型服务；外部研究必须由你勾选同意，且仅发送主题信息与最多 6 条摘要（每条 ≤ 280 字符）。
- **密钥安全**：真实 API Key 仅保存在本地 `.env.local` 并由 Vite 服务端插件读取，**绝不进入前端构建产物**。

---

## 🗺️ 路线图

- [ ] 数据导出 / 导入与恢复机制
- [ ] 将 Vite 开发插件迁移至独立生产后端
- [ ] 双星共振引入“目标问题驱动”的独立入口
- [ ] 核心流程自动化测试（队列去重、降级兜底、状态保护）
- [ ] 移动端手势与可访问性优化

---

## 🤝 贡献

欢迎 Issue 与 PR！想快速上手，建议从这两个文件开始读：
- [`src/types/observation.ts`](src/types/observation.ts) — 系统的数据契约
- [`src/lib/observation-engine.ts`](src/lib/observation-engine.ts) — 本地规则与兜底逻辑

如果你对“用可视化辅助思考”“AI 只给线索、人做判断”这个方向感兴趣，欢迎来聊。

<div align="center">
  <br/>
  <b>不急着有答案，让想法先发光。</b><br/>
  如果这个项目让你想起了某个被遗忘的念头，请给它一个 ⭐
</div>
