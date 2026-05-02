# Tasks/Tools 模块对标分析报告

**分析日期**: 2026-05-01
**模块范围**: tasks、tools
**对标状态**: 🟡 部分对标

---

## 1. Tasks 模块

### 1.1 CC源码实现

| 文件 | 功能 |
|------|------|
| `Task.ts` | Task类型定义（核心） |
| `tasks.ts` | Task注册和获取 |
| `tasks/types.ts` | Task类型 |
| `tasks/pillLabel.ts` | Task标签 |
| `tasks/stopTask.ts` | 停止Task |
| `tasks/LocalShellTask/` | 本地Shell任务 |
| `tasks/LocalAgentTask/` | 本地Agent任务 |
| `tasks/RemoteAgentTask/` | 远程Agent任务 |
| `tasks/DreamTask/` | Dream任务 |
| `tasks/LocalWorkflowTask/` | 本地工作流任务（条件编译） |
| `tasks/MonitorMcpTask/` | MCP监控任务（条件编译） |

CC源码Tasks的特点：
- TaskType: local_bash / local_agent / remote_agent / in_process_teammate / local_workflow / monitor_mcp / dream
- TaskStatus: pending / running / completed / failed / killed
- 终止状态判断（`isTerminalTaskStatus()`）
- Task ID前缀系统
- 每个Task实现 `kill()` 方法
- 条件编译支持（Workflow、Monitor）
- Task输出文件管理

### 1.2 PY_APP实现

| 文件 | 功能 |
|------|------|
| `tasks/index.ts` | 模块入口 |
| `tasks/BaseTask.ts` | 基础Task |
| `tasks/TaskRegistry.ts` | Task注册表 |
| `tasks/types.ts` | 类型定义 |
| `tasks/LocalBashTask.ts` | 本地Bash任务 |
| `tasks/LocalAgentTask.ts` | 本地Agent任务 |
| `task/index.ts` | 任务模块入口 |
| `task/models/task.ts` | 任务模型 |
| `task/models/types.ts` | 任务类型 |

### 1.3 对比分析

| 维度 | CC源码 | PY_APP | 差异评估 |
|------|--------|--------|----------|
| Task类型 | 7种 | 2种 | CC源码更丰富 |
| Task状态 | 5种 | 基本 | CC源码更完善 |
| 终止状态 | isTerminalTaskStatus | 无 | CC源码独有 |
| ID前缀 | 完整前缀系统 | 无 | CC源码独有 |
| 远程Agent | RemoteAgentTask | 无 | CC源码独有 |
| Dream任务 | DreamTask | 无 | CC源码独有 |
| 工作流任务 | LocalWorkflowTask | 无 | CC源码独有 |
| MCP监控 | MonitorMcpTask | 无 | CC源码独有 |
| Task注册 | getAllTasks() | TaskRegistry | PY_APP更结构化 |
| 输出管理 | 完整 | 基本 | CC源码更完善 |
| 停止Task | stopTask.ts | 无 | CC源码独有 |

### 1.4 差距与建议

**PY_APP优势**:
1. TaskRegistry更结构化

**需要改进**:
1. 🔴 高: 补充RemoteAgentTask
2. 🔴 高: 补充DreamTask
3. 🔴 高: 补充Task终止状态判断
4. 🟡 中: 补充Task ID前缀系统
5. 🟡 中: 补充stopTask功能
6. 🟢 低: 补充Workflow和Monitor任务

---

## 2. Tools 模块

### 2.1 CC源码实现

CC源码的Tools系统包含丰富的工具实现：

| 工具 | 功能 |
|------|------|
| `tools/AgentTool/` | Agent工具 |
| `tools/BashTool/` | Bash执行工具 |
| `tools/BriefTool/` | 简报工具 |
| `tools/FileEditTool/` | 文件编辑工具 |
| `tools/FileReadTool/` | 文件读取工具 |
| `tools/FileWriteTool/` | 文件写入工具 |
| `tools/GlobTool/` | Glob搜索工具 |
| `tools/GrepTool/` | Grep搜索工具 |
| `tools/LSPTool/` | LSP工具 |
| `tools/MCPTool/` | MCP工具 |
| `tools/NotebookEditTool/` | Notebook编辑工具 |
| `tools/SkillTool/` | 技能工具 |
| `tools/TaskOutputTool/` | 任务输出工具 |
| `tools/TaskStopTool/` | 任务停止工具 |
| `tools/TodoWriteTool/` | Todo写入工具 |
| `tools/WebFetchTool/` | Web获取工具 |
| `tools/WebSearchTool/` | Web搜索工具 |
| `tools/TungstenTool/` | Tungsten工具 |
| `tools/AskUserQuestionTool/` | 用户提问工具 |
| `tools/EnterPlanModeTool/` | 进入计划模式工具 |
| `tools/EnterWorktreeTool/` | 进入Worktree工具 |
| `tools/ExitWorktreeTool/` | 退出Worktree工具 |
| `tools/ExitPlanModeTool/` | 退出计划模式工具 |
| `tools/ListMcpResourcesTool/` | 列出MCP资源工具 |
| `tools/ReadMcpResourceTool/` | 读取MCP资源工具 |
| `tools/ToolSearchTool/` | 工具搜索工具 |
| `tools/TestingPermissionTool/` | 测试权限工具 |
| `tools/SyntheticOutputTool/` | 合成输出工具（条件编译） |
| `tools/SleepTool/` | 睡眠工具（条件编译） |
| `tools/SendMessageTool/` | 发送消息工具（条件编译） |
| `tools/TeamCreateTool/` | 创建团队工具（条件编译） |
| `tools/TeamDeleteTool/` | 删除团队工具（条件编译） |
| `tools/SuggestBackgroundPRTool/` | 建议后台PR工具（条件编译） |
| `tools/REPLTool/` | REPL工具（条件编译） |
| `tools/PushNotificationTool/` | 推送通知工具（条件编译） |
| `tools/SendUserFileTool/` | 发送用户文件工具（条件编译） |
| `tools/SubscribePRTool/` | 订阅PR工具（条件编译） |
| `tools/MonitorTool/` | 监控工具（条件编译） |
| `tools/RemoteTriggerTool/` | 远程触发工具（条件编译） |
| `tools/CronCreateTool/` | Cron创建工具（条件编译） |
| `tools/CronDeleteTool/` | Cron删除工具（条件编译） |
| `tools/CronListTool/` | Cron列表工具（条件编译） |

CC源码Tools的特点：
- 每个工具有独立子目录，包含Tool实现、UI组件、prompt
- 使用Zod定义工具输入Schema
- 工具权限检查（`useCanUseTool`）
- 工具进度报告
- 条件编译支持大量可选工具
- 工具名称匹配（`toolMatchesName()`）
- 工具搜索功能

### 2.2 PY_APP实现

PY_APP的Tools系统更为复杂，包含40+子目录：

**核心工具**:
| 工具 | 功能 |
|------|------|
| `tools/BashTool/` | Bash执行 |
| `tools/FileEditTool/` | 文件编辑 |
| `tools/FileReadTool/` | 文件读取 |
| `tools/FileWriteTool/` | 文件写入 |
| `tools/GlobTool/` | Glob搜索 |
| `tools/GrepTool/` | Grep搜索 |
| `tools/LSPTool/` | LSP工具 |
| `tools/MCPTool/` | MCP工具 |
| `tools/WebFetchTool/` | Web获取 |
| `tools/WebSearchTool/` | Web搜索 |
| `tools/TodoWriteTool/` | Todo写入 |
| `tools/TungstenTool/` | Tungsten工具 |
| `tools/AgentTool/` | Agent工具 |
| `tools/SkillTool/` | 技能工具 |
| `tools/BriefTool/` | 简报工具 |
| `tools/NotebookEditTool/` | Notebook编辑 |
| `tools/AskUserQuestionTool/` | 用户提问 |
| `tools/PlanTool/` | 计划工具 |
| `tools/ConfigTool/` | 配置工具 |
| `tools/TaskTool/` | 任务工具 |

**PY_APP新增工具**:
| 工具 | 功能 |
|------|------|
| `tools/BrowserTool/` | 浏览器工具 |
| `tools/ChronosTool/` | 定时任务工具 |
| `tools/CodeAnalysisTool/` | 代码分析工具 |
| `tools/MonitorTool/` | 监控工具 |
| `tools/PowerShellTool/` | PowerShell工具 |
| `tools/VoiceInputTool/` | 语音输入工具 |
| `tools/VoiceOutputTool/` | 语音输出工具 |
| `tools/TimeTool/` | 时间工具 |
| `tools/SleepTool/` | 睡眠工具 |

**架构层**:
| 目录 | 功能 |
|------|------|
| `tools/core/` | 工具管理核心 |
| `tools/executor/` | 工具执行器 |
| `tools/security/` | 工具安全 |
| `tools/monitoring/` | 工具监控 |
| `tools/cache/` | 工具缓存 |
| `tools/orchestration/` | 工具编排 |
| `tools/progress/` | 工具进度 |
| `tools/scheduler/` | 工具调度 |
| `tools/permissions/` | 工具权限 |
| `tools/adapters/` | 工具适配器 |
| `tools/extensions/` | 工具扩展 |
| `tools/utils/` | 工具工具函数 |

### 2.3 对比分析

| 维度 | CC源码 | PY_APP | 差异评估 |
|------|--------|--------|----------|
| 工具数量 | 30+ | 30+ | 基本相当 |
| 架构模式 | 扁平工具目录 | 分层架构（核心/执行/安全/监控） | PY_APP更结构化 |
| Schema验证 | Zod | TypeScript接口 | CC源码更严格 |
| 工具UI | 每个工具有UI.tsx | 部分工具有UI.tsx | CC源码更完善 |
| 工具Prompt | 每个工具有prompt.ts | 部分工具有prompt.ts | CC源码更完善 |
| 条件编译 | feature()控制 | 无 | CC源码更灵活 |
| 工具权限 | useCanUseTool | ToolPermissionManager | 各有实现 |
| 工具进度 | ToolProgressData | ProgressManager | 各有实现 |
| 工具搜索 | ToolSearchTool | ToolDiscoveryService | 各有实现 |
| 工具编排 | 无 | orchestration/ | PY_APP新增 |
| 工具调度 | 无 | scheduler/ | PY_APP新增 |
| 工具缓存 | 无 | cache/ | PY_APP新增 |
| 工具适配器 | 无 | adapters/ | PY_APP新增 |
| 缺失工具 | - | EnterPlanMode/ExitPlanMode/EnterWorktree/ExitWorktree | CC源码独有 |

### 2.4 差距与建议

**PY_APP优势**:
1. 分层架构更清晰
2. 工具编排、调度、缓存是创新功能
3. 新增工具（Browser、Chronos、CodeAnalysis、PowerShell等）

**需要改进**:
1. 🔴 高: 补充Zod Schema验证
2. 🔴 高: 补充工具Prompt文件
3. 🔴 高: 补充工具UI组件
4. 🟡 中: 补充PlanMode/Worktree工具
5. 🟡 中: 补充条件编译支持
6. 🟢 低: 补充TeamCreate/TeamDelete工具

---

## 3. 总体评估

### Tasks对标完成度: 🟡 部分对标 (约35%)
### Tools对标完成度: 🟡 部分对标 (约55%)

### 改进优先级

1. 🔴 高: Tasks补充RemoteAgentTask和DreamTask
2. 🔴 高: Tools补充Zod Schema验证
3. 🔴 高: Tools补充工具Prompt和UI组件
4. 🟡 中: Tasks补充终止状态判断和ID前缀
5. 🟡 中: Tools补充PlanMode/Worktree工具
6. 🟢 低: Tasks补充Workflow和Monitor任务
7. 🟢 低: Tools补充条件编译支持
