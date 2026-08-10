# AGENTS.md — 架构规则入口（AI 必读）

> 本仓库所有架构规范、编码规范、开发流程的唯一权威来源。
> 任何 AI 助手在开始编码任务前，必须按以下顺序加载规则。

---

## 加载顺序（优先级从高到低）

### 第一层：强制编码铁律（编码前必读）

| 优先级 | 文件 | 用途 |
|:---:|------|------|
| 1 | [PY_APP.md](.trae/rules/PY_APP.md) | 通用行为准则（先思考再编码、简洁优先、外科手术、目标驱动、证据驱动） |
| 2 | [coding-standards.md](.trae/rules/coding-standards.md) | 编码铁律 CS01-CS06（归一化检查、禁止字符串匹配状态、回退最小化、Mock 零容忍、根因优先） |
| 3 | [task-execution.md](.trae/rules/task-execution.md) | 任务执行规范 TE01-TE10（工具调用上限、静默超时报告、完成总结模板、路径收敛） |

### 第二层：领域规范（按任务类型加载）

| 场景 | 文件 | 用途 |
|------|------|------|
| 架构/重构/审查 | [architecture.md](.trae/rules/architecture.md) | 架构设计原则（Harness 驱动、TAOR 循环、双轨制禁止） |
| 架构合规检查 | [architecture-compliance.md](.trae/rules/architecture-compliance.md) | 架构合规规则 R01-R05（基础设施复用、数据模型统一、模块边界、文件组织） |
| 前端开发 | [frontend.md](.trae/rules/frontend.md) | 前端规范（React 18 + TS + TailwindCSS + Zustand） |
| 模型/AI 相关 | [model-usage.md](.trae/rules/model-usage.md) | 模型使用规则（DB 唯一事实来源、禁止硬编码模型名/属性表） |
| 路径/存储操作 | [paths.md](.trae/rules/paths.md) | 路径使用规范（三层分离架构、统一入口 `core/paths.ts`） |
| 版本规划 | [versioning.md](.trae/rules/versioning.md) | 版本管理规范 |
| 版本一致性 | [version-consistency.md](.trae/rules/version-consistency.md) | 版本号一致性检查 |
| 部署/安全 | [operations.md](.trae/rules/operations.md) | 运维 Checklist |
| 对标分析 | [benchmark-rules.md](.trae/rules/benchmark-rules.md) | 对标分析规范 |

### 第三层：项目全局规则（始终生效）

| 文件 | 用途 |
|------|------|
| [project_rules.md](.trae/rules/project_rules.md) | 项目规则（安全合规、环境变量、文件存储、日志、错误处理、通道、技能系统等） |
| [development-workflow.md](.trae/rules/development-workflow.md) | 开发流程（Spec-Driven Development、代码审查、分支策略） |

---

## 快速索引

| 问题 | 查哪 |
|------|------|
| 能复用已有代码吗？ | [CS01 归一化检查](.trae/rules/coding-standards.md) |
| 状态判断用字符串？ | [CS02 禁止字符串匹配](.trae/rules/coding-standards.md) |
| 需要 try-catch 回退吗？ | [CS03 回退策略最小化](.trae/rules/coding-standards.md) |
| 能写 Mock 数据吗？ | [CS04 Mock 零容忍](.trae/rules/coding-standards.md) |
| 文件能超过 800 行吗？ | [R04-001 文件行数限制](.trae/rules/architecture-compliance.md) |
| 新增 HTTP 端点往哪放？ | [api-spec.md](.trae/docs/api-spec.md) + [R03 模块边界](.trae/rules/architecture-compliance.md) |
| 日志怎么写？ | [project_rules.md §1.8](.trae/rules/project_rules.md) — 唯一入口 Logger.ts |
| 错误怎么处理？ | [project_rules.md §1.9](.trae/rules/project_rules.md) — 唯一入口 handleError() |
| 路径怎么获取？ | [paths.md](.trae/rules/paths.md) — 唯一入口 `@modules/core/paths` |
| 模型名能硬编码吗？ | [model-usage.md](.trae/rules/model-usage.md) — 禁止 |
| 新增通道怎么注册？ | [project_rules.md §1.14](.trae/rules/project_rules.md) |
| 技能怎么加？ | [project_rules.md §1.15](.trae/rules/project_rules.md) |
| 工具调用太多怎么办？ | [TE01 工具调用上限](.trae/rules/task-execution.md) |
| 任务完成了怎么汇报？ | [TE06 完成总结模板](.trae/rules/task-execution.md) |

---

## 关键 MUST 规则速查（违反即阻断）

| 规则 ID | 内容 | 来源 |
|---------|------|------|
| CS01 | 新增前先搜索已有实现 | coding-standards.md |
| CS02 | 状态判断禁止字符串匹配 | coding-standards.md |
| CS04 | 生产代码零 Mock 数据 | coding-standards.md |
| CS06 | 证据驱动：禁止空结果编造 | coding-standards.md |
| R01 | 基础设施复用（EventBus/Error/Cache/Retry） | architecture-compliance.md |
| R02 | 数据模型统一（禁止重复定义类型） | architecture-compliance.md |
| R03 | 模块边界控制（禁止跨层依赖） | architecture-compliance.md |
| R04-001 | 文件行数不超过 800 行 | architecture-compliance.md |
| R06-001 | Handler 注册模式（禁止 if/else 路由） | architecture-compliance.md |
| R06-005 | 文件命名规范（禁止 utils/helpers 垃圾桶） | architecture-compliance.md |
| R06-006 | 文件职责单一（禁止薄转发僵尸方法） | architecture-compliance.md |
| R06-008 | 分层架构（禁止反向依赖） | architecture-compliance.md |
| R08-001 | 跨重启状态必须持久化（后台任务禁止纯内存计数） | architecture-compliance.md |
| R08-002 | 后台任务必须记录 4 类事件（start/skip/fail/complete） | architecture-compliance.md |
| TE01 | 单轮工具调用 ≤ 5 次 | task-execution.md |
| TE08 | 工具结果完整性校验 | task-execution.md |
| TE09 | 路径解析 2 次内收敛 | task-execution.md |
| TE10 | 中断后上下文恢复 | task-execution.md |

---

## 规则体系说明

- **规则分级**：MUST（违反即阻断）> SHOULD（需登记例外）> MAY（建议）
- **规则文件总数**：14 个（`.trae/rules/`）
- **可执行检查**：`bun run lint:arch`（`scripts/lint-architecture.ts`，20+ 项检查）
- **CI 门禁**：`.github/workflows/ci.yml` → `arch-check` job
- **例外管理**：`scripts/layer-exceptions.json`（带过期衰减机制）
- **架构治理文档**：`dev_docs/20260809/`（分析报告，非规则源）

> **原则**：dev_docs 中的治理文档是分析报告，不是规则源。所有规则以 `.trae/rules/` 为准。