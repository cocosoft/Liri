---
description: 开发流程与模块管理规范。适用于开发任务、模块管理、工具验收、对标开发等场景。包含模块管理规则、开发流程（对标5步闭环、三层校验、同步交付、模块间集成、开发完成检查清单、提交前检查流程）、工具验收标准等。
---

# 开发流程与模块管理 / Development Workflow & Module Management

> 开发流程规范、模块管理规则、工具验收标准。
>
> Development workflow, module management, and tool acceptance standards.

---

## 一、模块管理规则 / Module Management

### 1.1 核心组件

| 组件     | 文件                                 | 职责         |
| ------ | ---------------------------------- | ---------- |
| 模块注册表  | `src/modules/ModuleRegistry.ts`    | 注册、查找、依赖解析 |
| 导入管理器  | `src/modules/ImportManager.ts`     | 统一管理导入路径   |
| 模块定义   | `src/modules/ModuleDefinitions.ts` | 统一定义模块信息   |
| 模块初始化器 | `src/modules/ModuleInitializer.ts` | 生命周期管理     |

### 1.2 标准分类

| 分类   | 标识         | 模块                                |
| ---- | ---------- | --------------------------------- |
| 核心模块 | `core`     | core, infrastructure              |
| 功能模块 | `ai`       | ai, agent, bridge                 |
| 界面模块 | `ui`       | ui, cli                           |
| 工具模块 | `tools`    | tools, commands                   |
| 数据模块 | `memory`   | memory, cache                     |
| 系统模块 | `security` | security, performance, monitoring |
| 其他模块 | `other`    | analytics, buddy, chat等           |

### 1.3 导入规范

- **必须使用**: `@modules/模块名` 格式
- **禁止使用**: `../../` 等相对路径

### 1.4 依赖声明

1. **核心依赖**: core/infrastructure 必须声明
2. **导入依赖**: `@modules/xxx` 必须声明在 `dependencies`
3. **可选依赖**: 条件加载的模块声明在 `optionalDependencies`
4. **验证**: 运行 `bun run modules:validate` 验证一致性

### 1.5 命名规范

- 目录: 小写连字符（如 `memory-management`）
- 文件: PascalCase（如 `MemoryManager.ts`）
- 接口: 以 `I` 开头（如 `IMemoryService.ts`）

### 1.6 目录结构

```
模块名称/
├── index.ts      # 入口（必须）
├── types/        # 类型定义
├── services/     # 服务层
├── utils/        # 工具函数
├── tests/        # 测试文件
└── README.md     # 文档（必须）
```

---

## 二、开发流程 / Development Flow

### 2.1 先设计原则

新需求先编制设计文档到 `dev_docs/YYYYMMDD/`，用户确认后再实施。

### 2.2 禁止重复造轮子

- 先学习 CC、Hermes-Agent 和 OpenClaw 源码，复用成熟方案
- 发现重复代码立即整合

### 2.3 对标开发5步闭环

① 对标分析（按 `.trae/rules/benchmark-rules.md` 四阶段法执行） → ② 实施方案 → ③ 代码实现 → ④ 验证记录 → ⑤ 总览同步

### 2.4 对标完整性原则（强制）

对标CC、Hermes-Agent和OpenClaw源码时，必须**先完整实现所有对标对象已有功能**，再评估修剪。禁止在对标分析过程中提前裁剪。

- **正确做法**: 完整列表示标对象功能 → 全部实现 → 作为独立步骤评估修剪
- **错误做法**: 分析时说"这个功能用不上"直接跳过实现
- **例外**: 只有当某个功能依赖PY\_APP不存在的底层依赖（如特定云服务API）时方可跳过，但须在注释中注明原因

### 2.5 规则同步机制

讨论中确认的约束性结论须即时同步到项目规则文件。

### 2.6 对标验证三层校验原则（强制）

对标验证不能仅做路径级文件存在性检查，必须执行以下三层校验才能最终判定"缺失"：

1. **第一层：文件路径存在性检查** — 目标模块/功能对应的文件或目录是否存在
2. **第二层：命令别名/路由映射检查** — 检查 `commands/builtin/*/index.ts` 的 `aliases` 字段，以及路由注册表（如 `routes.ts`、`registry.ts`），确认功能是否通过别名或路由映射存在
3. **第三层：跨模块引用检查** — 检查其他模块是否通过导入或代理方式引用了该功能

- **正确做法**：三层校验全部通过后才判定"缺失"
- **错误做法**：仅检查一次路径未找到即判定缺失
- **例外**：当目标功能明确依赖 PY\_APP 不存在的底层依赖时，可直接判定缺失

### 2.7 纠正报告交叉引用原则（强制）

编制新对标报告或任务计划时，**必须先检索同一日期目录下已有的纠正/验证报告**，避免：

- 重复记录已修复或已纠正的差距项
- 漏掉已有纠正结论，造成判定冲突
- 使用过时的分析数据作为决策依据

具体操作：

1. 检查 `dev_docs/YYYYMMDD/` 下所有 `*_*.md` 文件，按编号排序
2. 读取编号最大的 2-3 份报告，提取其纠正/验证结论
3. 在报告中交叉引用这些结论，标注来源

### 2.8 独立代码验证原则

对标分析报告中标注为"差距"或"缺失"的项，在最终报告发布前必须经过**独立的代码路径验证**：

- **验证人/工具**：与原始分析不同的视角（或后续会话中的独立检查）
- **验证方法**：按 §2.6 三层校验标准执行
- **验证记录**：在报告中附验证结果表，内容包括：差距项、验证路径、判定结果、判定依据
- **最小验证集**：至少覆盖报告中标注为"P0/P1 优先级"的所有差距项

目的：防止单次分析的误判（如路径遗漏、别名忽略）传播到后续决策中。

### 2.9 模块完成同步交付原则（强制）

每个模块或功能开发完成后，必须同步更新以下交付物：

1. **文档目录**：更新 `app/docs/` 下对应的模块文档（如新增渠道需在 `app/docs/渠道/` 添加文档，并在 `app/docs/渠道/index.md` 导航表中添加引用；新增命令需更新 `app/docs/命令参考/` 等）
2. **内置命令帮助**：更新对应命令或模块的帮助文件（位于 `commands/builtin/` 下），确保用户可通过 `/help` 和 `/docs` 命令获取最新说明
3. **依赖关系图**：运行 `bun run modules:snapshot` 更新 `dependency-snapshot.json`，反映最新的模块依赖结构

禁止在未更新文档目录和帮助文件的情况下合入模块/功能变更。

### 2.10 实施方案要求要素

实施方案文档必须包含：实施原则、任务分解、质量保证、风险评估四项要素。

### 2.11 模块间集成流程（强制）

当开发涉及多个模块的修改或新增时，必须按以下流程完成集成：

1. **依赖分析**：开发前先通过 `modules:validate` 确认模块依赖关系，识别受影响的上下游模块
2. **接口对齐**：与上下游模块的接口（导入/导出类型、方法签名、事件契约）对齐，确保兼容
3. **分步集成**：按依赖顺序逐个模块集成，每集成一个模块运行一次 `modules:validate` 验证依赖一致性
4. **集成测试**：所有模块集成完成后，运行集成测试（覆盖率 ≥ 40%），验证模块间协作正确性
5. **依赖图更新**：集成完成后运行 `modules:snapshot` 更新 `dependency-snapshot.json`

禁止在未完成集成测试的情况下合入涉及多模块的变更。

### 2.12 开发完成检查清单（强制）

每个模块或功能开发完成后，在合入前必须逐项确认以下检查清单：

```markdown
## 开发完成检查清单

### 测试验证
- [ ] 单元测试已编写并通过（覆盖率 ≥ 80%）
- [ ] 功能测试已编写并通过（覆盖率 ≥ 60%）
- [ ] 集成测试已编写并通过（覆盖率 ≥ 40%）
- [ ] 涉及 bug 修复：已编写可重现该 bug 的测试用例并验证通过

### 代码质量
- [ ] TypeScript 编译检查通过（零错误）
- [ ] ESLint 检查通过（零 warning）
- [ ] 禁止使用 `@ts-nocheck`
- [ ] 禁止使用 `any` 类型
- [ ] 函数级注释已添加

### 同步交付
- [ ] 模块文档已更新到 `app/docs/` 对应目录
- [ ] 内置命令帮助文件已更新（`commands/builtin/`）
- [ ] 依赖关系图已更新（运行 `modules:snapshot`）
- [ ] 模块已在 `ModuleDefinitions.ts` 注册（如涉及新模块）

### 集成验证
- [ ] 模块依赖关系已验证（运行 `modules:validate`）
- [ ] 上下游模块接口已对齐
- [ ] 跨模块引用已检查（三层校验）
- [ ] 集成测试已通过

### 架构合规
- [ ] 无双轨制（检查是否已有同功能实现）
- [ ] 状态管理从 `core/state/` 引入
- [ ] 类型定义收敛到 `src/types/`
- [ ] 工具函数检查是否已在 `src/utils/common.ts` 中存在
- [ ] 安全模块收敛到 `security/` 目录
```

### 2.13 提交前检查流程（强制）

每次代码合入前，必须按顺序执行以下检查，任何一步失败则不得提交：

```
bun run format           # 1. 代码格式化
bun run lint             # 2. ESLint 检查（零 warning）
bun run typecheck        # 3. TypeScript 类型检查（零错误）
bun run test             # 4. 完整测试套件
bun run modules:validate # 5. 模块依赖验证
bun run modules:snapshot # 6. 更新依赖快照
```

> 可将此流程配置为 pre-commit hook：`bun run modules:setup`

### 2.14 架构治理节奏（强制）

架构规范采用 **D（定义规范）→ C（编码检查）→ G（门禁强制）→ M（度量反馈）→ A（季度复盘）** 闭环，按三个节奏运转：

| 节奏 | 触发点 | 动作 | 产物 |
|------|--------|------|------|
| **每次 PR** | 提交/合入 | `bun run lint:arch` 门禁（error 阻断）+ pre-commit hook | 门禁结果 |
| **每迭代** | 迭代结束 | `bun run health:arch` 生成健康度报告，与上一迭代对比，owner 审查技术债 | `dev_docs/architecture-health.json` + 历史 |
| **每季度** | 季度末 | 复盘规则阈值/增删规则，更新 AGENTS.md 与 `.trae/rules/` | 规则修订记录 |

**强制规则**：
1. **新增/修改代码前**必须 `bun run lint:arch`，error 级违规不得合入（见 2.13 提交前检查）
2. **超限文件（>2000 行）** 必须登记 `scripts/layer-exceptions.json` 的 `fileSizeExceptions`，带 owner + 截止日期 + 拆分计划；例外到期未修复由 `checkExceptionExpiry` 阻断
3. **迭代健康度报告**由 owner 在迭代评审中审查，碎片/僵尸/桶等 SHOULD 级技术债持续下降为合格
4. **季度复盘**只改规则本身（阈值/强制级别），不回退到"重新写文档"

相关脚本：
- 门禁：`bun run lint:arch`（`scripts/lint-architecture.ts`）
- 度量：`bun run health:arch`（`scripts/architecture-health.ts`，支持 `--compare` 趋势对比）
- 例外管理：`scripts/layer-exceptions.json`（带过期衰减）

---

### 2.15 一次性脚本收尾约定（强制）

**规则**：`app/scripts/**` 下的一次性脚本（验证/迁移/播种/诊断），凡 `import` 了 `../src/**`（尤其是 `@modules/*` **桶**），**必须在末尾显式 `process.exit(0)`**（失败路径用 `process.exit(1)`）。

**为什么**：实测导入 `@modules/monitoring`、`@modules/core` 等桶所拉起的模块图后，进程会留下**无法枚举**的持有句柄 —— 工作完成后**永不退出**（`scripts/verify-derive.ts` 实测：工作 10s 内完成、+150s 仍未退出）。影响：CI / pre-commit hook / 人工跑脚本时"命令不返回"，易被误判为任务卡死。**依据**：台账 V-47（2026-09-15，TRAE-debugger 流程二分取证）。

**诊断限制（勿重复踩坑）**：Bun 下 `process.getActiveResourcesInfo()` / `process._getActiveHandles()` 均返回空数组、`process.report.getReport()` 不含 libuv 句柄 ⇒ **无法枚举持有句柄**；已排除：全局定时器（打桩计数 0）、文件流/`fs.watch`/socket/server/Worker/dns/`Bun.serve·spawn`（探针 0 记录）、`bun:sqlite` 未关闭连接（最小复现可正常退出）、"大导入必然滞留"（`typescript` 384ms 导入可正常退出）。

**同族先例**：`app/src/tools/DependencyValidator.ts` 早已用同一手法规避（其注释记录"import 链会初始化后台服务、定时器/监听器持有事件循环句柄 → 进程不退出 → pre-commit hook 永久挂起"，故显式 `process.exit`）。

**新脚本（推荐写法）**：用 `app/scripts/_runner.ts` 的 `runScript(async () => { … })` 统一收尾 —— 正常返回 `exit(0)`、抛错打印后 `exit(1)`；示例见 `scripts/verify-derive.ts`。

**存量迁移（2026-09-15 已完成）**：15 个 `import ../src/**` 的脚本已全部具备显式出口 —— **10 个**补 `process.exit(0)`、**4 个**原本已有显式出口（`benchmark-startup` / `measure-session-memory` / `migrate-attachments-to-fileregistry` / `migrate-graph-node-ids-o15b`）、**2 个**的**早返回分支**另行补齐（`migrate-channel-credentials` 的 `--rollback`、`migrate-memory-v1-to-v2` 的两处"跳过迁移"分支 —— 后者是迁移成功后再次运行的常态路径）；`verify-derive.ts` 已迁移到 `_runner`。

**范围现状（2026-09-15 评估）**：`app/scripts/**` **当前不在** tsc（`tsconfig.json` 的 `include` 仅 `src/**`、`tests/**`）与 ESLint（`tsconfig.eslint.json` 未含 scripts）范围内。纳入的**规模评估**（用临时 tsconfig 探针，`include` 取 `src+tests+scripts` 并集以免把 src 既有噪声计入，探针已删）：脚本侧 **12 处** TS 报错 → **已修 6 处（"活的"脚本，见下）**，**余 6 处待判定**（3 个**无任何调用方**的孤儿迁移脚本：`a4-migrate-and-accept`（globalThis 挂载 + `LogLevel` 未用枚举，3 处）、`migrate-attachments-to-fileregistry`（引用**已删除**的 `FileSource.TELEGRAM`/`WEB_FETCH`，2 处）、`migrate-memory-v1-to-v2`（`MemoryMetadata` 缺 `description/createdAt/updatedAt`，1 处））—— **删 or 修属产品判断**。

**已修复的 6 处（"活的"脚本，2026-09-15）**：均为"解析层"缺陷、**零行为变化**，修后探针复跑 12 → 6：
| 文件 | 处数 | 根因 | 被谁调用 |
|---|---|---|---|
| `copy-external-deps.ts` | 2 | 同一 `import { RUNTIME_DEPS }` **写了两遍**（第二条插在代码中段，历史编辑事故） | `build:win/mac/linux`、`build:deps`、Dockerfile |
| `package-compile.ts` | 2 | 使用**未导入**的 `RUNTIME_DEPS`（连带 `dep` 隐式 any） | `build:win:dist` |
| `benchmark-startup.ts` | 1 | 动态 `import()` 带 `.ts` 后缀 | `.github/workflows/ci.yml`、`benchmark:startup` |
| `install-service.ts` | 1 | 静态 import 带 `.ts` 后缀 | `service:install/uninstall/start/stop/restart/status/dev`（7 项） |

**已完成的准备（① 统一类型声明，2026-09-15）**：新增 `app/scripts/bun-globals.d.ts`，消除脚本侧 `bun:sqlite` / `import.meta.dir` 类错误 **18 处 → 0**（实测）。三条踩坑记录：
1. **不要装 `@types/bun`**：会与 `app/tests/bun-test.d.ts` 既有的 `declare module 'bun:test'` 形成重复声明，且影响面外溢到整个程序。
2. **该声明文件必须是"全局声明文件"**（无顶层 `import`/`export`）：带 `export {}` 的 `.d.ts` 会被当作**模块**，其中的 `declare module 'x'` 退化为"模块增强"，对环境模块（如 `bun:sqlite`）**不生效**（实测仍报 TS2307）。
3. **临时 tsconfig 探针必须带 `--noEmit`**：`tsc -p <探针>` 若省略该参数，会按 `tsconfig.json` 的 `outDir` 把整个 app 编译产出成 `dist/app/**`（含测试的编译副本）；此后 `bun test` 会把源测试与 **dist 副本**一并执行（实测 388 → 602 文件、51 个"幽灵失败"，且失败项在隔离复跑时全绿）。清理：删除 `dist/app`、`dist/shared`，**保留** `dist/main.js` 等既有构建产物。

---

## 三、工具验收标准 / Tool Acceptance Standards

### 3.1 功能要求

- **execute()**: 必须实现真实执行逻辑，禁止模拟
- **参数验证**: 必须正确处理输入参数
- **错误处理**: 必须返回标准错误格式
- **进度回调**: 支持 `onProgress`
- **取消操作**: 响应 `AbortController`

### 3.2 代码质量

- 禁止使用 `@ts-nocheck`
- 类和方法必须有 JSDoc 注释

### 3.3 注册规范

- 在 `ToolFactory` 中定义 `createXxxTool()` 方法
- 注册到 `builtinToolLoaders`
- 条件工具使用 `conditionalTool()` 包装

### 3.4 验收检查清单

```markdown
- [ ] execute() 实现真实逻辑
- [ ] 参数验证已实现
- [ ] 错误处理已实现
- [ ] 进度回调已支持
- [ ] 取消操作已支持
- [ ] TypeScript 检查通过
- [ ] ESLint 检查通过
- [ ] 单元测试已编写
- [ ] ToolFactory 方法已添加
- [ ] builtinToolLoaders 已注册
```

---

## 四、工具命令 / Tool Commands

```bash
bun run modules:test      # 测试模块系统
bun run modules:analyze   # 分析模块状态
bun run modules:validate  # 验证依赖关系
bun run modules:snapshot  # 导出依赖图快照
bun run modules:check     # 完整检查
bun run modules:setup     # 安装 pre-commit 钩子
```

---

## 五、故障排除 / Troubleshooting

| 问题     | 原因                         | 解决方案                         |
| ------ | -------------------------- | ---------------------------- |
| 模块找不到  | 未在 ModuleDefinitions.ts 注册 | 注册模块；运行 `modules:analyze`    |
| 循环依赖   | 模块间相互引用                    | 运行 `modules:validate`；提取公共功能 |
| 导入路径错误 | 使用相对路径                     | 使用 `@modules/模块名` 格式         |
