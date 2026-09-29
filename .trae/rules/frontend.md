---
description: 前端（py-app-client）开发规则。适用于 Tauri 桌面客户端开发、React 组件开发、前端架构设计、后端能力前端化等任务。包含客户端定位、架构原则、组件规范、数据流约定等。
---

# 前端开发规则 / Frontend Development Rules

> 本规则继承 `project_rules.md` 所有规范，在前端开发时额外生效。
>
> 优先级：本规则中与 `project_rules.md` 冲突的条目，以本规则为准。

---

## §1 核心定位

### 1.1 客户端定位（不可违背）

Liri 桌面客户端（`client/`）是 **app 的专用桌面前端（Presentation Layer）**，不是独立 AI 客户端。

**三大铁律**:

| # | 原则 | 说明 |
|:-:|------|------|
| 1 | **App 优先暴露** | app 已有的功能 → 客户端优先实现 UI，不重复造后端轮子 |
| 2 | **App 缺失才建** | 如果 app 没有对应能力，先评估是否需要在 app 添加，而非在客户端独立实现 |
| 3 | **对标仅限 UI 参考** | 对标客户端（Open WebUI / Hermes / Claw Admin 等）源码仅作为 UI/UX 设计参考，不作为功能需求来源。功能需求必须源于 app 暴露的能力 |

### 1.2 评分对照参考

| 阶段 | 当前 | 目标 | 增量 | 核心思路 |
|:----:|:----:|:----:|:----:|---------|
| Phase 1 | 22 | 40 | +18 | REPL 前端化：聊天体验桌面化 |
| Phase 2 | 40 | 55 | +15 | 管理功能前端化：80+ 命令变 UI 面板 |
| Phase 3 | 55 | 65+ | +10 | 深度集成：文件/知识/Agent/斜杠命令 |

---

## §2 架构规范

### 2.1 客户端与后端通信（双通道）

```
模式 A: Tauri IPC（Rust command → child_process → Backend Node.js API）
  适用：请求-响应短连接（会话 CRUD、配置、状态查询）

模式 B: HTTP（fetch SSE → LocalHTTPService → Backend CoreAPI）
  适用：流式长连接（聊天流式响应）
```

| 场景 | 推荐模式 | 理由 |
|------|---------|------|
| 聊天流式响应 | **模式 B** HTTP SSE | 流式传输，适合长连接 |
| 会话 CRUD | **模式 A** IPC | 短连接，延迟低 |
| 文件操作 | **模式 A** IPC | 直接 Tauri FS API |
| 系统状态/统计 | **模式 A** IPC | 快速响应 |
| 模型列表 | **A/B 均可** | 数据量小，两种均可 |

### 2.2 Rust Command 组织规范

每个 Rust command 是对 backend CoreAPI 或子系统的 REST 封装，命名规则：

```
src-tauri/src/commands/
├── mod.rs               # 模块声明
├── backend_ctrl.rs      # backend 进程管理（启动/停止/状态）
├── chat.rs              # 聊天（chatStream / chatSync）
├── session.rs           # 会话 CRUD + 搜索
├── config.rs            # 配置读取/修改
├── tool.rs              # 工具列表/详情
├── model.rs             # 模型列表/切换
├── stats.rs             # 系统状态/用量统计
├── cron.rs              # 定时任务 CRUD
├── file.rs              # 文件操作
├── skill.rs             # 技能管理
├── knowledge.rs         # 知识/记忆 CRUD
├── agent.rs             # Agent 任务
└── channel.rs           # 渠道管理（可选）
```

- 每个 command 文件导出一个 `invoke()` 函数，接收 `tauri::State` + 参数 → 调用后端接口 → 返回 JSON
- 禁止在 Rust command 中实现业务逻辑，仅做参数校验 + 转发

### 2.3 前端组件目录镜像后端模块

前端组件目录按 **功能域** 组织，与 backend 模块一一对应：

```
client/src/
├── components/
│   ├── ChatArea/           # ← backend: CoreAPI.chat* / repl.ts
│   │   ├── ChatArea.tsx
│   │   ├── ChatInput.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── MarkdownRenderer.tsx
│   │   ├── CodeBlock.tsx
│   │   ├── ModelSelector.tsx
│   │   └── FileAttachment.tsx
│   ├── Sidebar/            # ← backend: SessionManager
│   │   ├── Sidebar.tsx
│   │   ├── SessionSearch.tsx
│   │   └── SessionItem.tsx
│   ├── ConfigPanel/        # ← backend: config 命令 + ConfigTool
│   ├── ToolPanel/          # ← backend: listTools() + SkillHub
│   ├── common/
│   │   ├── ThemeToggle.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── LanguageSwitch.tsx
│   └── views/              # ← backend: commands/* / tools/* 映射
│       ├── DashboardPage.tsx   # ← status/usage/health
│       ├── CronPage.tsx        # ← ChronosTool
│       ├── FileExplorerPage.tsx # ← files 命令 + FileRead/WriteTool
│       ├── KnowledgePage.tsx   # ← memory/knowledge 命令
│       ├── AgentPage.tsx       # ← AgentTool
│       └── ChannelsPage.tsx    # ← ChannelManager
├── stores/
│   ├── chatStore.ts         # 聊天状态
│   ├── sessionStore.ts      # 会话状态 + 搜索
│   ├── configStore.ts       # 配置 + 模型 + 主题
│   ├── toolStore.ts         # 工具/技能状态
│   ├── statsStore.ts        # 仪表盘数据
│   ├── cronStore.ts         # 定时任务
│   ├── fileStore.ts         # 文件浏览器
│   └── knowledgeStore.ts    # 知识/记忆
```

### 2.4 数据流规则

- **禁止使用 Mock 数据**: 所有数据必须来自 backend 真实接口（Tauri IPC 或 HTTP）
- **禁止在客户端缓存业务数据**: 会话历史、配置、工具列表等数据每次从 backend 获取，客户端仅缓存 UI 状态（主题、语言偏好等本地设置）
- **Zustand store 职责**: 仅管理 UI 状态 + 加载态/错误态，业务数据通过 service 层获取

---

## §3 组件规范

### 3.1 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 框架 | React 19 + TypeScript | 函数组件 + Hooks |
| 桌面容器 | Tauri 2 (Rust) | 跨平台原生桌面 |
| 状态管理 | Zustand | 轻量级状态管理 |
| 样式 | TailwindCSS | 工具类优先 |
| 通信 | Tauri IPC + HTTP SSE | Tauri `invoke()` + `fetch()` |
| 构建 | Vite | 开发/构建 |
| 类型 | TypeScript strict | `any` 禁止（同 backend 规范） |

> **2026-09-15 校正**：上表"框架"原写 **React 18**，与实测不符——`client/package.json` 实际为 `react` / `react-dom` **19.3.0**（校正前实测 19.2.8）、`@testing-library/react` **16.3.3**、`@types/react(-dom)` 19.3.0。同批已同步：`project_rules.md §1.7`、`AGENTS.md` 第二层规则表。

### 3.2 组件编写规范

- **PascalCase 命名**: `ChatMessage.tsx`, `ModelSelector.tsx`
- **一个组件一个文件**: 除非紧密关联的子组件（如 `ChatMessage.Header`）
- **函数组件 + Hooks**: 禁止 class 组件
- **Props 接口定义**: 每个组件必须有明确的 Props 类型（`.tsx` 文件内定义或从 `types/` 导入）
- **TailwindCSS 工具类**: 禁止编写自定义 CSS（除非极特殊情况如动画关键帧）

```tsx
// 正确示例
interface ChatMessageProps {
  message: Message;
  onRetry?: (messageId: string) => void;
}

export function ChatMessage({ message, onRetry }: ChatMessageProps) {
  return (
    <div className="flex gap-3 p-4 rounded-lg hover:bg-gray-50">
      <MarkdownRenderer content={message.content} />
    </div>
  );
}

// 错误示例
export default class ChatMessage extends React.Component { ... }  // ❌ class 组件
function chat_message(props) { ... }                               // ❌ 非 PascalCase
function ChatMessage(props: any) { ... }                          // ❌ any 类型
```

### 3.3 Store 编写规范

```tsx
// 正确示例 — store 专注 UI 状态，不缓存业务数据
interface ChatState {
  // UI 状态
  isStreaming: boolean;
  activeMessageId: string | null;
  error: string | null;
  // 操作
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
}

// 错误示例 — store 缓存业务数据
interface ChatState {
  messages: Message[];        // ❌ 消息应通过 service 获取
  sessions: Session[];        // ❌ 会话应通过 service 获取
  models: ModelInfo[];        // ❌ 模型列表应每次获取
}
```

### 3.4 服务层约定

业务数据获取通过 **service 层** 封装 Tauri IPC 调用：

```
src/services/
├── chatService.ts        # chatStream / chatSync
├── sessionService.ts     # createSession / listSessions / deleteSession / renameSession
├── configService.ts      # getConfig / setConfig
├── toolService.ts        # listTools / getTool
├── modelService.ts       # listModels / setModel
├── statsService.ts       # getStats / getUsage
├── cronService.ts        # listCronJobs / createCronJob / deleteCronJob
├── fileService.ts        # listFiles / readFile / writeFile / deleteFile
├── skillService.ts       # listSkills / toggleSkill
├── knowledgeService.ts   # listKnowledge / createKnowledge / deleteKnowledge
└── agentService.ts       # submitAgentTask / getAgentProgress
```

---

## §4 开发工作流

### 4.1 功能开发流程

```
1. 确认功能需求
   ↓
2. 检查 backend 是否有对应能力
   ├─ 有 → 直接对接 backend 接口
   └─ 无 → 先在 backend 添加能力（CoreAPI → Rust command）
   ↓
3. 参考对标客户端 UI 设计（可选）
   ↓
4. 创建/更新组件
   ↓
5. 确保 TypeScript 类型正确 + 测试通过
```

### 4.2 Rust Command 开发流程

```
1. 在 backend 确认或添加 CoreAPI 方法
2. 在 src-tauri/src/commands/ 新增 .rs 文件
3. 在 mod.rs 注册模块
4. 实现 invoke() 函数：
   - 接收 Rust 类型参数
   - 调用 child_process 执行 bun 命令或 HTTP 请求
   - 解析输出为 JSON
   - 返回 Result<T, String>
5. 前端 service 层调用 tauri.invoke()
```

### 4.3 禁用清单

| 类别 | 禁止内容 | 理由 |
|------|---------|------|
| **Mock** | 任何模拟数据 | 必须对接后端真实接口 |
| **独立业务逻辑** | 客户端自行实现业务规则 | 业务逻辑应在 backend 实现 |
| **直接 HTTP 调用** | 前端直接请求 AI 模型 API | 必须通过 backend 网关转发 |
| **Console 日志** | `console.log` / `console.warn` | 使用 backend Logger（通过 IPC 发送日志事件） |
| **Any 类型** | TypeScript `any` | 使用具体类型或 `unknown` |
| **Class 组件** | React class 组件 | 仅使用函数组件 |
| **CSS Modules** | 独立的 `.css` / `.module.css` | 必须使用 TailwindCSS 工具类 |

---

## §5 参考资源

### 5.1 后端对接参考

| 资源 | 路径 | 说明 |
|------|------|------|
| CoreAPI 接口 | `app/src/runtime/api/CoreAPI.ts` | 统一门面，所有功能的 API 定义 |
| CoreAPI 实现 | `app/src/runtime/api/CoreAPIImpl.ts` | 具体实现 |
| LocalHTTPService | `app/src/core/gateway/local/LocalHTTPService.ts` | 流式 HTTP API（SSE） |
| Command 系统 | `app/src/commands/` | 80+ 内置命令 |
| 工具系统 | `app/src/tools/` | 60+ 工具 |
| REPL 入口 | `app/src/entrypoints/repl.ts` | 被前端化的核心体验 |

### 5.2 UI 设计参考（对标客户端）

| 参考源 | 汲取点 |
|--------|-------|
| Claw Admin `src/views/chat/ChatPage.vue` | 聊天界面布局、ToolCall 卡片 |
| Claw Admin `src/views/cron/CronPage.vue` | 定时任务 CRUD |
| Claw Admin `src/views/monitor/MonitorPage.vue` | 仪表盘大屏 |
| Claw Admin `src/views/skills/SkillsPage.vue` | 技能管理器 |
| Hermes Web UI `MarkdownRenderer.vue` | Markdown 渲染 |
| Open WebUI `CodeBlock.svelte` | 代码块组件 |
| OpenClaw WebUI `static/commands.js` | 斜杠命令体系 |

### 5.3 客户端现有源码参考

| 文件 | 说明 |
|------|------|
| `src-tauri/src/commands/` | 现有 Rust Command（按相同模式扩展） |
| `src/stores/` | 现有 Zustand store（按相同模式扩展） |
| `src/types/index.ts` | 类型定义 |

---

## §6 版本历史

- **v1.0.0** (当前): 初版——继承 project_rules.md，新增前端定位、架构规范、组件规范、开发工作流
