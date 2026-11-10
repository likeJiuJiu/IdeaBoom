<div align="center">

# 🌌 IdeaBoom · 灵感星云

**不急着有答案，让想法先发光。**

把想法当作观测对象，而不是待办事项。

[![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Local-first](https://img.shields.io/badge/local--first-yes-8a2be2?style=flat-square)](#-数据与隐私)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-贡献)
[![License](https://img.shields.io/github/license/likeJiuJiu/IdeaBoom?style=flat-square)](LICENSE)

🚧 **早期原型** · 本地优先 · 无需后端即可体验完整核心流程

</div>

---

## 🕳️ 你的备忘录，是个黑洞吗？

你记下的那些念头——便利店里没人设计过的等待、某个软件用起来不对劲的地方、走在路上突然冒出的疑问——它们存进去了，然后**再也没有被打开过**。

问题不在你。问题在工具：**备忘录要求你先整理，再保存。** 起标题、选文件夹、打标签——灵感来的时候，你根本没空做这些。而就算你记下来了，列表是线性的，想法不是。三个月前那条观察，和昨天那条，在列表里隔着几十条，**永远不会被放在一起看**。

IdeaBoom 想做的，就是把这个黑洞，变成一片**你能反复回来观测的星空**。

---

## 💡 IdeaBoom 是什么

IdeaBoom 是一个**把想法当作观测对象**的个人工作台。每条想法在星云里是一颗可交互的光点；旧想法会按规则重新回来找你，两条不同时间的想法有机会相遇；AI 会拆解你的观察、提出关联建议，但**关系是否成立、值不值得深挖，由你确认**。

产品由两条互补的主线构成：

```text
灵感相遇主线
  捕获想法 → 星云呈现 → 时间回响 / 双星共振 → 生成带来源的新想法

观察探索主线
  捕获观察 → 自动理解 → 关联建议 → 人工确认 → 问题主题 → 外部研究
```

一条感性，负责让想法发光；一条理性，负责把光聚成火。

---

## 🆚 它和别的工具有什么不同

|  | 备忘录 / 笔记软件 | 随机灵感碰撞工具 | **IdeaBoom** |
|---|---|---|---|
| 记录成本 | 需要标题、分类、标签 | 低 | **一句话，零分类** |
| 旧想法回访 | 靠你主动翻，通常不会 | 无 | **时间回响主动呈现** |
| 想法之间 | 手动双链，建完就静态存在 | 随机配对，系统说了算 | **规则筛选 + 人确认** |
| AI 的角色 | 总结、续写、生成 | 制造廉价的惊喜感 | **提供有原文证据的线索** |
| 关系是否成立 | — | 系统说了算 | **你说了算，否定不可被覆盖** |
| 数据 | 云端 | 云端 | **只在你当前浏览器** |

一句话：**你的备忘录只会存，IdeaBoom 会让旧想法回来找你。**

---

## ✨ 核心能力

### 🔭 灵感相遇

- **⚡ 一句话捕获** — 按 `N` 输入，回车。不要求标题、分类、标签。想法变成星点，播放出生动画。
- **🌌 星云画布** — 全屏星空，每条想法是一颗 DOM 光点。支持拖拽平移、滚轮缩放、视角重置、标题显示切换、动画暂停（尊重系统的减少动态效果偏好）。
- **⏳ 时间回响** — 你主动触发，系统挑一条满足沉淀时间、冷却与频率的旧想法重新呈现。你可以只读，也可以写下一条**带来源 ID 的补充想法**。
- **💫 双星共振** — 你主动触发，系统按轻量文本规则挑两条想法相遇。你可以不写，也可以写下一条**带两个父级 ID 的新联想**。界面明确写着：*候选由轻量文本规则筛选；是否存在联系，由你自己决定。*

### 🧠 观察探索

- **🔍 自动理解** — 新增观察自动进入分析队列（可关闭）。模型提取场景、现象、阻碍、人群、替代方式、潜在问题、待探索问题——以及**尚不能确定的信息（`unknowns`）**。它不虚构频率、人数、损失，不知道就写不知道。
- **🛟 本地兜底** — 大模型失败时自动降级到本地规则分析，界面明确标记"本地规则初筛"，原始观察一个字都不丢。
- **🔗 证据优先的关系建议** — 每条关系建议必须附上**两条原文各自的证据短语**，服务端校验短语真实存在于原文。关系有三种状态：**建议 / 确认 / 否定**——AI 默认只给建议，你否定过的，后续分析不能覆盖。
- **🧩 问题主题** — 至少两条观察、且已有你确认过的关联，才能创建主题。支持状态管理（持续观察 / 探索中 / 暂时搁置）、详情空间、事件时间线。
- **🌐 主题外部研究** — 四种方向（解决方案 / 用户反馈 / 替代方案 / 机会发现）。开始前必须勾选数据发送范围确认；结果区分**外部事实、用户反馈、市场规律、AI 推断**，外部事实必须绑定来源 URL；结果由你手动保存，不自动写入。

---

<!-- 📸 建议在此处添加 2–3 张真实截图或一段 30 秒 GIF，这是 README 最能留住人的位置。
     例如：
     ![星云首页](docs/screenshots/nebula.png)
     ![双星共振](docs/screenshots/encounter.gif)
     ![关系建议](docs/screenshots/relation.png)
-->

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（Vite 8 要求）

### 安装与运行

```bash
git clone https://github.com/likeJiuJiu/IdeaBoom.git
cd IdeaBoom
npm install
npm run dev
```

打开终端输出的地址（默认 `http://localhost:5173`），即可进入星云首页。

**不配置任何 API Key 也能跑通核心流程**——观察分析会自动降级到本地规则引擎，记录、星云、回响、共振、关系确认、主题管理全部可用。

### 可选：接入 AI 与外部研究

在根目录创建 `.env.local`：

```dotenv
IDEABOOM_LLM_BASE_URL=https://your-llm-provider.example/v1
IDEABOOM_LLM_API_KEY=your-llm-api-key
IDEABOOM_LLM_MODEL=your-model-name
TAVILY_API_KEY=your-tavily-api-key
```

- 观察分析需要三项 `IDEABOOM_LLM_*` 齐全；
- 主题研究需要 `TAVILY_API_KEY` 执行联网搜索，配置模型后可生成综合结果。

> ⚠️ 这些 API 由 Vite **开发期插件**（`apply: 'serve'`）提供，`npm run build` 的产物**不含生产后端**。真实密钥只放在 `.env.local`（已被 `*.local` 规则忽略），**绝不要写进前端 bundle**。

### 构建

```bash
npm run build
```

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 框架 | Vue 3 + TypeScript | Composition API，类型安全 |
| 构建 | Vite 8 | 开发服务器与生产构建 |
| 视觉 | 原生 Canvas 2D + DOM | 星云与星系渲染，零重型图形库 |
| 状态 | Vue 响应式 + localStorage | 本地持久化，刷新可恢复 |
| AI / 搜索 | OpenAI-compatible API + Tavily | 经 Vite 开发期插件代理 |

---

## 📁 项目结构（核心部分）

```text
src/
├── App.vue                          # 星云首页：想法、相遇事件、视图控制
├── components/
│   ├── ObservationWorkspace.vue     # 观察工作台：分析队列、关系判断、主题中心
│   ├── ThemeDetailSpace.vue         # 主题详情：概览 / 观察 / 关系 / 研究 / 时间线
│   └── ThemeResearchWorkspace.vue   # 外部研究：模式、同意、结果与历史
├── lib/
│   ├── nebula.ts                    # 星云渲染引擎（相机 / 粒子 / 引力线）
│   ├── spiral-galaxy.ts             # 程序化螺旋星系背景层
│   ├── encounter-system.ts          # 时间回响 / 双星共振的候选与冷却
│   ├── observation-engine.ts        # 本地规则分析（兜底）
│   ├── observation-ai.ts            # LLM 分析请求封装
│   ├── observation-store.ts         # 观察 / 关系 / 主题持久化
│   └── theme-research-*.ts          # 外部研究的请求、存储与数据流
├── types/
│   ├── observation.ts               # 观察 / 关系 / 主题类型定义
│   └── theme-research.ts            # 研究运行与发现的数据结构
└── vite.config.ts                   # 开发期 API 插件挂载
```

---

## 🧭 设计原则

这八条不是功能列表，是这个项目**不会妥协的东西**。如果你认同它们，欢迎一起来做；如果你不同意，也欢迎开 Issue 辩论。

1. **先留下，后理解。** 记录不要求分类、命名或补齐字段。
2. **保留原文。** 分析是附加层，永不覆盖你的原始记录。
3. **相遇有规则。** 回响与共振必须满足候选、冷却与频率限制，不靠纯随机制造虚假关联。
4. **AI 给线索，人做判断。** 关系默认是"建议"，只有你确认才生效；你否定过的，后续分析不能覆盖。
5. **证据优先。** 每条关系建议必须附原文证据短语，服务端校验其真实存在。
6. **允许没有结果。** 没有可靠关联时返回空，不为了"智能感"凑数。
7. **个人观察 ≠ 普遍需求。** 主题是待验证的问题线索，不是市场结论。
8. **发送需知情。** 外部研究明确告知发送范围，并必须由你勾选同意。

**产品判断标准：** 如果用户只觉得它是个漂亮的星空笔记，价值还没有成立；如果用户能在保留原文的前提下重新遇见旧想法、核对证据、主动把观察整理成值得继续探索的问题，核心体验才开始成立。

---

## 🔐 数据与隐私

所有数据默认只存在**当前浏览器的 localStorage**：

| 数据 | Key |
|---|---|
| 星云想法 | `idea-nebula-ideas-v1` |
| 相遇历史 | `idea-nebula-encounter-history-demo-v1` |
| 观察 / 关系 / 主题 | `ideaboom-observation-workspace-v1` |
| 主题研究历史 | `ideaboom-theme-research-v1` |
| 自动理解偏好 | `ideaboom-auto-analyze-v1` |

- 自动理解开启时，新增记录会把当前观察 + 最多 20 条近期历史发给模型服务；
- 外部研究必须由你勾选同意，只发送主题信息、最多 6 条观察摘要（每条 ≤ 280 字符）和检索到的公开来源，**完整观察库不会发送**；
- **清理浏览器站点数据可能导致记录丢失**，当前版本尚无内置导入 / 导出。

---

## 🗺️ 路线图

- [ ] 数据导出 / 导入与恢复
- [ ] 将两个 Vite 开发插件迁移到独立生产后端
- [ ] 回响机制从秒级演示参数切换为可配置长期周期
- [ ] 核心流程自动化测试（队列去重、自动关闭、失败兜底、关系状态保护）
- [ ] 移动端手势与键盘可访问性优化
- [ ] 真实运行截图 / GIF 与在线 Demo

---

## 🤝 贡献

欢迎 Issue 与 PR。想快速上手，建议从这两个文件开始读：

- [`src/types/observation.ts`](src/types/observation.ts) — 整个系统的数据契约
- [`src/lib/observation-engine.ts`](src/lib/observation-engine.ts) — 本地规则与兜底逻辑

```bash
# 1. Fork 并克隆
git checkout -b feature/your-feature
git commit -m 'feat: add your feature'
git push origin feature/your-feature
# 2. 发起 Pull Request
```

如果你对"用可视化辅助思考""AI 只给线索、人做判断"这个方向感兴趣，欢迎来聊。

---

## 📄 许可证

请参阅仓库中的 [LICENSE](LICENSE) 文件。

---

<div align="center">

**不急着有答案，让想法先发光。**

如果这个项目让你想起某个被遗忘的念头，请给它一个 ⭐

</div>
