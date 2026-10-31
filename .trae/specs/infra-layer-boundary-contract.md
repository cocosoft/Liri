# Spec：infra 层边界契约（Infra Layer Boundary Contract）

> 版本 1.2 ｜ 创建 2026-10-31 ｜ 状态：🟢 **约束与规范已立 + §8 四条门禁已落地 + R2/R3 存量已清零**（`lint:infra`，2026-10-31）
> 来源：用户 2026-10-31 指令「infra 层内的模块，按 core 的方式处理，先写约束、规范」。
> 事实源：`scripts/modules-to-layers.json`（分层唯一事实源）· `.trae/rules/architecture.md` · `.trae/rules/architecture-compliance.md`
> 同类先例：`.trae/specs/kernel-style-architecture-governance.md`（core 的 Linux 式治理）· `packages/kernel/src/core/README.md`（core 的"零 I/O"判据）

---

## 1. 一句话

core 的判据是「**零 I/O**」；infra 的判据是「**有 I/O，但不含业务策略**」——
infra 只提供**可替换的能力适配与基础设施机制**，一旦开始表达"业务该怎么走"，就该上移到 app。
**层由模块名在事实源里声明，与物理目录位置无关**（例：`lsp` 声明为 infra，物理路径却是 `app/src/lsp`）。

## 2. 依赖规则（强制，`lint:arch` R00-001）

```
infra 允许依赖：infra、core            （`allowedDependencies.infra = ["infra","core"]`）
infra 禁止依赖：entry、ui、app、service
```

- 静态检查当前 **0 违规**；动态导入盲区（R00-003，仅上报）里仍有 **infra → app** 的既有漂移，见 §6.1。
- core 反向依赖 infra 同样禁止（core 只允许依赖 core）。

## 3. 准入判据（决定"该不该在 infra"）

| 判据 | 允许进 infra | 必须出 infra |
|---|---|---|
| 是否触达 I/O | 文件 / SQLite / 网络 / 进程 / 环境探测 / 时钟 | —— |
| 是否含**策略** | 只做"能做什么、怎么做"的机制（重试、缓存、驱动、日志、度量、权限判定原语） | 含"业务上该不该做"的编排与领域规则（会话生命周期、项目归属、PDCA 阶段、任务路由） |
| 是否含**用户可见语义** | 无（只暴露能力与错误码） | 有（文案、交互、页面状态、i18n 词条归属 UI/文案层） |
| 是否可替换 | 同一能力可被另一种实现替换（SQLite ↔ PG、本地日志 ↔ 远端） | 能力与业务强绑定、不可替换 |
| 是否零 I/O | 否（若是 ⇒ 应下沉 core） | —— |

**三层的判定顺序（自上而下，第一个命中即止）**：

1. 能做成"零 I/O 契约/机制"？⇒ **core**
2. 需要 I/O，但只暴露能力、不含业务策略？⇒ **infra**
3. 需要表达业务编排 / 领域模型 / 用户可见语义？⇒ **app**（或 service/ui）

## 4. 现状盘点（28 个 infra 模块，2026-10-31 实测）

| 分组 | 模块 | 说明 | 状态 |
|---|---|---|---|
| **能力适配**（外部技术可替换） | `external`（SQLite 驱动）· `environment`（目录/环境解析）· `media`（媒体处理）· `oauth`（OAuth）· `i18n` · `lsp`（LSP 客户端） | 典型"换实现不改上层" | `external`/`environment` 有明确裁定；`lsp` **零消费者**（S6 观察期） |
| **基础设施机制** | `config` · `cache` · `state` · `memory`（存储）· `chronos`（定时）· `daemon` · `runtimeHost` · `featureflags` · `error` · `permission`（判定原语）· `security`（检测/审计原语） | 提供机制，不做业务决策 | `runtimeHost` 是"内核去 I/O"的落点；`security/permission` 见 §6.2 |
| **观测与度量** | `monitoring` · `diagnostics` · `performance` · `trace-recording` · `analytics` · `cost` · `logger`（逻辑 id，实现在 `monitoring/logs` + kernel `loggerFacade`） | 只采集与展示**事实**，不参与决策 | 常态 |
| **纯常量与工具** | `constants` · `common` · `utils` | 无状态、可被任意层使用 | `common`/`utils` **双包并存**，见 §6.3 |
| **待裁定** | `system`（"聚合容器：auth/i18n/state/theme"） | 聚合容器天然有"跨模块编排"风险 | 见 §6.4 |

> 层声明口径提醒：`logger` 与 `doc` 这类**逻辑模块 id 无同名目录**的条目，层归属以事实源为准，不以"有没有目录"推断。

## 5. 出入口与实现规范（新增/改造 infra 模块时强制）

| 规范 | 要求 |
|---|---|
| **入口** | 每模块一个 `index.ts` 作为唯一出口（R03-002）；`@modules/<name>/<subpath>` 仅在 `canonicalEntryKeys` 白名单内允许 |
| **跨层暴露** | 需要被 app/service 消费的能力，**优先以 core 的 `spi/*` 窄端口**表达契约 + `entrypoints/spiWiring.ts` 装配；禁止让上层直连 infra 内部实现类型 |
| **不反向依赖** | 需要上层回调时用**注入**（函数/端口），不得 `import` app 类型；动态 `import('@modules/…')` 同样按 R00-003 追责（仅上报≠允许） |
| **配置读取** | 只经 `featureFlags` / `config`；**禁止**直接 `process.env`（`lint:arch` 已 0 处） |
| **日志与错误** | 只用 `loggerFacade` / `AppError`（不得自建 Logger、不得抛出裸 `Error`） |
| **生命周期** | 注册必须返回 **disposer**，注销按 LIFO（`project_rules §1.16`） |
| **副作用时机** | 模块顶层**不做 I/O**；副作用集中在显式 `init()` / 工厂函数 |
| **可观测** | 关键失败必须留痕（`logger.warn` + 错误码），不得静默降级（CS03-002） |

## 6. 现有漂移与待裁定（本 spec 只登记，不改代码）

### 6.1 动态导入造成的 infra → app 引用（R00-003 盲区，实测 2 处文件 / 3 条导入）

| 位置 | 形态 | 处置建议 |
|---|---|---|
| `app/src/permission/integrations/BashPermission.ts:121` | infra 静态链中动态 `require('@modules/tools/SmartApprovalObserver')`(app) | 改为经 `spi` 端口或由 app 注入（独立变更） |
| `app/src/utils/ContextWindowResolver.ts:249` | infra 动态 `import('@modules/ai')`(app) | 同上；或把"模型属性"下沉为 core 类型 + 由 app 注入实现 |
| `app/src/utils/ContextWindowResolver.ts:256` | 同上，相对路径 `../ai/models/ModelPricingService.js` | 同一清零目标（`lint:infra` R3 已逐条冻结） |

> **2026-10-31 已清零**：① `BashPermission` 改为**注入**审批评估器（`setCommandApprovalEvaluator`，未注入即询问），删掉 `require('@modules/tools/…')`；② `calibrateContextWindow` 上移 `app/src/context/window/calibrateContextWindow.ts`（读 `ModelRegistry` + 写 `model_registry` 属领域动作），`utils/ContextWindowResolver` 保持 app-free，`@modules/context` 经 shim 继续转出（消费方零改动）。`lint:infra` R2 / R3 检查数均归 0，白名单两段已清空。

### 6.2 `security` / `permission` 的"策略 vs 原语"边界

- 允许：检测原语（危险命令规则、路径校验、审计留痕、审批记录存储）。
- 不允许：**审批流程编排**（该不该弹卡、何时放行、与 UI/会话交互）—— 属 app（`chat/services/ToolExecutionService`）。
- 已知边界：`ALL_UNIFIED_RULES`（37 条）目前**只被测试引用**（UW-6 已登记）⇒ 接入或清理需独立裁定，本 spec 不预设。

### 6.3 `common` 与 `utils` 双包

- 两者同为 infra、都是"无状态工具"，**分工已定（2026-10-31）**：`common/utils.ts` 为**零依赖命名空间**（纯函数、不 import 任何模块）；`utils/common.ts` 为**跨域工具实现的唯一出口**（可依赖 `monitoring` 等设施）。
- 已完成的 CS01 归一化：`truncate` / `deepClone` / `throttle` / `debounce` 在 `common/utils.ts` 的命名空间副本**零消费者**，已删除（保留 `utils/common.ts` 实现），`lint:infra` R4 存量 6 → **2**。
- 剩余 2 项为**同名不同概念**（`Option`、`ValidationResult`），已在白名单登记并写清理由，不构成第二份实现。

### 6.4 `system` 聚合容器

- 事实源描述为"auth/i18n/state/theme 基础能力"聚合 —— 聚合容器容易演变成**隐形的编排层**。
- 待办：逐项确认真实消费者；若只是再导出，应收敛为 `index.ts` barrel 或拆回各自模块。

### 6.5 `lsp`（infra，零消费者）

- 2026-10-31 已去掉唯一生产消费者（`tools/lsp/LSPToolIntegration` 的校验改为 `tools/lsp/validation.ts`），
  并摘掉懒加载 / ImportManager 别名 / build-variant 三个入口（`dabb97a82`）。
- 现状：**零静态消费者、零外部动态导入**，进入 **CD05 观察期**；观察期后按 CD06 独立删除（S6）。

## 7. 升降级规则（未来变更的判据）

| 变更方向 | 触发条件 | 动作 |
|---|---|---|
| infra → **core** | 该模块**不再触达 I/O**（纯类型/纯算法/纯常量） | 迁 `packages/kernel`，按 core 的"零 I/O"判据复核；事实源同步改 `core` |
| infra → **app** | 出现业务策略（编排、领域规则、用户可见语义） | 上移，infra 只保留能力原语；必要时新增 `spi` 端口 |
| core → infra | 需要落 I/O（如当初 `paths`） | 迁出并保留同名转出，保证对外 API 不变（先例：`environment`） |
| 新模块入 infra | 满足 §3 全部判据 | 在 `modules-to-layers.json` 登记 `layer=infra` + **理由 + 触发条件**（与 `vfs` 条目同格式） |

## 8. 门禁挂点（现状与建议）

| 门禁 | 现状 | 说明 |
|---|---|---|
| `lint:arch` R00-001 | ✅ 生效 | 按事实源判跨层，当前 0 违规 |
| `lint:arch` R00-002 | ✅ 生效 | 未登记分层的顶层目录会被点名（防"新目录静默绕过门禁"） |
| `lint:arch` R00-003 | ⚠️ 仅上报 | 动态盲区 45 处；本 spec §6.1 的两处 infra → app 属重点清理对象 |
| `lint:arch` R03-002 | ✅ 生效 | 模块出口单一；infra 新模块不得开新子路径入口 |
| 不得裸 `process.env` | ✅ 已检查 | `lint:arch` 的 Config/Env 检查（当前 0 处 / 0 文件） |
| 不得自建 Logger | ✅ R11-001 | 只允许 `loggerFacade` |
| 生命周期 disposer / LIFO | ✅ 规则 + 既有断言 | `project_rules §1.16` |
| **"模块顶层不做 I/O"** | ✅ `lint:infra` R1 | AST 判定（函数 / 类体内不算）；存量 1 处 `utils/env.ts` 已登记 |
| **审批编排不得下沉** | ✅ `lint:infra` R2 | `security/**`、`permission/**` 运行时不得引用上层；**存量已清零**（`BashPermission` 改注入评估器） |
| **infra → app 动态导入** | ✅ `lint:infra` R3（白名单清零） | **存量已清零**（0 条，2026-10-31）；后续新增即红，条目消失即提示清理 |
| **common / utils 重复检测** | ✅ `lint:infra` R4 | 同名导出（含命名空间内导出）；4 个真重复已去重（保留 `utils/common`），剩 2 个同名不同概念已登记 |
| **门禁接线与自证** | ✅ | `app/package.json` 的 `lint:infra` 进 pre-commit（`setup-git-hooks.ts`）+ `ci` 链；白名单 `.trae/architecture/infra-boundary-allowlist.json`（每条须带理由）；自证 `app/tests/gates/infraBoundary.test.ts`（18 例） |

## 9. 验收（本 spec 自身）

1. 零代码改动：规范批只新增本 spec；门禁批（v1.1）只新增 `app/scripts/lint-infra-boundary.ts` / `infraBoundaryCore.ts`、测试与白名单，不改 `app/src`、不改事实源。
2. 28 个 infra 模块**每个都能在 §4 找到归属**（能力适配 / 机制 / 观测 / 常量 / 待裁定）。
3. §6 的每项漂移都有**可执行处置**或**明确"待裁定 + 触发条件"**，不留悬空结论。
4. 与 `modules-to-layers.json` 不冲突；冲突以事实源为准。
