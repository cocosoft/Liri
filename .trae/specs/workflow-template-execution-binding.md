# 工作流模板 ↔ Provider/执行器 绑定 Spec（P1-19 ②）

> 版本: 1.1（**全部裁定并实施**） | 创建: 2026-10-05 | 实施: 2026-10-08
> 关联: `workflow-template-persistence.md` §3 D5（本问题是其明确延后项）/ `workflow-definition-externalization.md` D4（「不合并」原裁定）/ `workflow-engine-seam.md`（seam 契约）/ GR15 / CS01 / CS02 / CS05 / CS06 / R02 / R00-001
> 状态：**推荐形态 ①+② 已实施**（`WorkflowStep.tool?` + 装配层 `templateToDefinition()` + `WorkflowTemplateProvider`）；
> **P0-2 = (a) HTTP `POST /v1/workflows/templates/:id/run`**、**P0-3/S24③ = 仅非破坏性工具（fail-closed）** 亦已实施。
> **待裁定项 = 0**。实施记录见 **§9**（①+②）、**§10**（触发入口 + 权限边界）、**§11**（模型可见专用工具）。
> 触发面：**HTTP `/run`**（人/脚本）+ **`workflow:run-template` 工具**（**模型可见**，2026-10-08 续已开）；`office:workflow` 的 enum **未改**。

## 1. 目标

让用户经 `/v1/workflows/templates` CRUD 创建的**用户自定义模板**能够**真正驱动执行**
（用户模板 → 可执行 `WorkflowDefinition` → 经既有 `WorkflowEngine` seam 执行）；
**内建 4 模板行为不变**；不破坏既有 CRUD 语义与状态码。

## 2. 事实基线（取证，附路径#行号）

### 2.1 两套类型族（本问题核心）

| 族 | 类型 | 步骤字段 | 是否驱动工具调用 | 位置 |
|---|---|---|---|---|
| 模板族（"清单"） | `WorkflowStep` / `WorkflowTemplate` | `id`·`name`·`description`·`type:'manual'\|'auto'\|'review'`·`dependsOn?`·`suggestedAgentRole?`·`estimatedMinutes?` | **否** | `app/src/workspace/types.ts:530-571` |
| 定义族（"可执行"） | `WorkflowStepSpec` / `WorkflowDefinition` | `id`·`description`·**`tool`**·`params?`·`dependsOn?` | **是**（Provider 按 `tool` 调真实工具） | `app/src/modules/workflow/types.ts:41-60` |

- 模板族在服务层有**逐字镜像类型** `WorkflowStepDto` / `WorkflowTemplateDto`（service 层不能引用 app 层类型 ⇒ 端口镜像）：`app/src/runtime/api/workspaceOpsPorts.ts:170-194`。
- 定义族的执行契约：`WorkflowProvider.execute(definition, params, signal?, stepReporter?)`，引擎按 **workflowName 跨 Provider 查找**（`app/src/modules/workflow/WorkflowEngine.ts:71-77`、`:232-265`、`:547-561`）。

### 2.2 现状模板来源与消费

- 内建 4 模板 = **代码内静态常量** `BUILTIN_TEMPLATES`（`workflow-template-handlers.ts`），符合 persistence spec D3（不入库）。
- ~~用户模板 = handler **模块私有内存 Map** `userTemplates`~~ ⇒ **已订正（2026-10-08）**：用户模板改经**持久化 store** `app/src/workspace/WorkflowTemplateStore.ts`（`workflow_templates` 表，落唯一 `app.db`），5 个 CRUD 已全部改经 store（见 `workflow-template-persistence.md` §7 / 台账 S24 ①）。
- ~~⚠️ **`WorkflowTemplateStore.ts` 在 main 分支不存在**~~ ⇒ **已订正（2026-10-08，同上）**：该文件**已在 main 落地**（原文所述"仅归档 tag `dawate-archive-2026-09-16` 持有"是 2026-10-05 的当时事实；S24 ① 已把持久化补到 main）。**P0-1（存储基座）随之解除**（见 §7）。
- `WorkflowTemplate` / `WorkflowStep` **全仓无执行方消费者**：`suggestedAgentRole` grep 仅命中「定义本体 + 4 内建模板字面量 + 端口镜像」，**零读取方**。
  ⇒ **补充（2026-10-08，①② 实施后）**：`suggestedAgentRole` **仍零读取方**（本轮**未**采用"角色约定表"路线，故保持其"纯描述"语义）；新增的唯一执行方消费者是装配层 `templateToDefinition()`，它只读**新增的** `steps[].tool`。
- 前端：`client/src/services/workspaceService.ts:515-543` 有 5 个模板方法，但**无任何组件引用**（grep 仅命中 service 自身）⇒ 与 persistence spec §3 D5「P3-1 无组件引用」一致。
- seam 侧现有 Provider（可对照）：`DocOrchestratorProvider` 把静态编排声明为定义，**`step.id === step.tool`**（`app/src/modules/doc/orchestration/DocOrchestratorProvider.ts:60-75`）；`DocWorkflowProvider` 同理（`app/src/modules/doc/workflow/DocWorkflowProvider.ts:107-139`）。
- seam 的真实工具执行在 app 侧：`DocModule` 注入 `toolExecutor` = `globalToolManager.executeTool(actualTool, params, {})`（`app/src/modules/doc/DocModule.ts:230-244`）。

### 2.3 分层事实（**订正任务描述**）

事实源 `scripts/modules-to-layers.json`：`workspace` → **app**（L68）、`modules` → **app**（L109）、`infrastructure` → **service**（L77）；
`allowedDependencies.service = ["service","infra","core"]`（L12）⇒ **service 不能依赖 app**。

- ⚠️ 任务描述「`workspace` 属 infra、`modules/workflow` 属 app，注意依赖方向」**与事实源不符**：二者**同为 app**，app↔app 合法。
- 真正的约束在**触发入口**：`workflow-template-handlers.ts` 属 `infrastructure`（**service**）⇒ 它**不能**直接 import app 的装配层/引擎，必须经**端口**（如 `runtime/api/*Ports.ts`，service→service）注入 app 侧实现（既有「服务层端口化」范式）。

### 2.4 归一化检索（CS01）：是否有可直接复用的"角色→执行方"映射

- `app/src/core/patterns/PatternRegistry.ts:17-114` 已有结构化**「角色 → 承担方」绑定**：`assembly.bindings: { role, providers[] }`（如 `verifier_agent` / `task_decomposer` / `taor_loop`）。
- 但该表是 **pattern 内部角色**（`generator`/`worker`/`verifier`/`adversarial-reviewer`…），与模板的 `suggestedAgentRole`（`researcher`/`coder`/`reviewer`/`planner`/`tester`）**词表不一致**；且其 `providers` 是**编排运行时标识**，**不是工具名**（如 `doc:create-docx`）。
- `query/patternAssembler.ts:44-67` 只做 `PatternSelection.descriptor.assembly.assembler → 运行路由`（当前唯一可执行路由 `research`），**与模板无输入/输出关系**。
- **结论（CS01）**：现无任何"模板 → 工具/执行方"的既有映射可**直接复用**；下述任一方案都需**新增**绑定数据。

## 3. 映射口径（问题 1）

**问**：`WorkflowTemplate.steps[].{type, suggestedAgentRole, description}` 如何映射到 `WorkflowDefinition.steps[].tool`？tool 名从何而来？

**答（取证结论）**：**这三个字段都无法可靠推导出 `tool`**：

| 候选来源 | 语义 | 能否安全派生 `tool` | 理由 |
|---|---|---|---|
| `type: manual\|auto\|review` | 人机交互模式（谁来做/是否需人审） | **否** | 与"调用哪个工具"正交；`manual`/`review` 本就无自动工具 |
| `suggestedAgentRole` | 「建议的」角色（唯一消费者为零，纯描述） | **否** | 角色 ≠ 工具；`researcher`/`coder`/`tester` 无对应单工具，且无既有映射表（§2.4） |
| `description` | 人读描述文本 | **否** | CS02：禁止以用户可见字符串做业务判定；解析自然语言生成工具名不可控 |

⇒ **tool 名必须来自"显式声明"**（新增一处权威数据），不来自派生。显式声明的落点 = §4 的方案分野。

**约束**：映射产物若含 `dependsOn`，可直接沿用 `WorkflowStep.dependsOn`（模板已有），交由 `WorkflowEngine.validate()/orderSteps()` 做静态校验 + 拓扑排序（`WorkflowEngine.ts:146-218`）——这部分**天然可复用**。

## 4. 两族关系：① vs ②（问题 2）

### 4.1 方案 ① 给 `WorkflowTemplate` 扩展可选 `tool?` / `executable?`（改公共域类型）

- `WorkflowStep` 增 `tool?: string`；装配时 `step.tool` 直取；缺失 `tool` 的模板 ⇒ **显式不可执行**（不猜、不降级，CS04）。
- 影响面：`workspace/types.ts`（公共域类型）+ `workspaceOpsPorts.ts`（镜像 DTO）+ 前端类型（若有）+ CRUD 校验（哪些 step 应带 tool）+ 装配层 + Provider。
- 兼容性：**加性**（可选字段，缺省 `undefined`）。4 内建模板无 `tool` ⇒ 仍**不可执行**，行为与现状一致；用户旧模板同理。**产品含义变化**：模板从"清单"变为"清单 + 可执行脚本（同源一份）"。

### 4.2 方案 ② 新增独立"模板 → 定义"装配层（保持两族独立、不改公共类型）

- **不改** `WorkflowTemplate`；新增装配层 + 一份**并行**的可执行绑定数据（绑定自带 `tool`，按 `templateId`/`stepId` 关联）。
- 影响面：新增类型（绑定）+ 存储（谁持久化？当前无 store）+ 装配层 + Provider + 触发入口。
- 兼容性：**完全加性**（既有类型/CRUD 零改动）。
- **产品含义**：模板仍是"清单"；"可执行规格"是**第二份产物**，与 `steps` **可能漂移**（两份数据需同步，违背 CS01「同一事实源不得两份」）。
- ⚠️ **关键缺口**：②"不改公共类型"的前提是"tool 有别的落点"，而当前**无持久化 store、`userTemplates` 私有、内建模板静态** ⇒ 必须**先定**"可执行绑定存哪、谁写、谁读、如何与模板同步"。

### 4.3 推荐（供裁定，非自行拍板）

**推荐 ①+② 的组合形态**（**✅ 2026-10-08 已被采纳并实施，见 §9**）：`WorkflowStep` 增**可选 `tool?`**（①）**且**新增 app 层**装配层** `templateToDefinition(template)` + Provider（②），二者互补：

- **理由**：唯一事实源（模板即权威数据，避免 ②纯版的"第二份产物漂移"，CS01/R02）；加性可选字段缺省不改行为（内建 4 模板不回归）；装配层保持 seam 与"市场/展示"关注点解耦（不把 `tool` 语义塞进 seam）。
- **兼容性**：可选字段缺省 = 不可执行（与现状一致）；无 DB 结构删除；CRUD 语义/状态码不变。
- **但**：本推荐**必须扩改公共域类型 `WorkflowTemplate`（`WorkflowStep`）**，且触及**产品语义（模板可执行性）** —— 命中 §7 停止条件 ⇒ 原为"不自行实施"；**2026-10-08 用户批准，已实施**。

## 5. 内置 4 模板共存（问题 3，不破坏 D3）

- D3 要求"内建模板保持代码内静态、不入库"。三者共存口径：
  1. **来源分层**：内建 = `BUILTIN_TEMPLATES`（静态，只读，`:23-254`）；用户 = `userTemplates`（现内存，未来 store）。装配层**只对"带显式 tool 的条目"**产出定义；内建 4 模板**不含 tool** ⇒ 默认不产出任何定义，**行为不变**。
  2. **命名空间隔离**：定义名若由模板 id 派生，须防与 seam 既有工作流名（`send-report` / `doc_pipeline` …）**撞名**（`WorkflowEngine.find` 按名首个命中，`:547-561`）。建议定义名加来源前缀（如 `template:<id>`）并做**注册期**冲突校验（`validate()` fail loud）。
  3. **内建模板的执行**：若产品希望内建也可执行，则需**同时**给内建模板补 `tool`（改静态数据，仍不入库）——这是**产品选择**，属 §7 选项差异，不在本文件的默认口径内。
     - **⚠️ 2026-10-08 复核（用户要求"先解决内建模板不可执行"时的取证结论）**：**不能靠"补 `tool`"达成** ——
       ① 4 个内建模板**每一步都是人工方法论**（`builtin:bug-fix` 的 `reproduce`/`manual`、`builtin:db-migration` 的
          `backup`/`migrate`/`rollback` 均为 `manual`；`review` 步为 `type:'review'`）⇒ "等人做"的步骤**在 seam 里
          无对应概念**（`WorkflowEngine.execute` 无 human-in-the-loop），补 `tool` 只能是**编造**（违 CS04 精神）。
       ② **机械欠缺**：`WorkflowStep` **无 per-step `params`** ⇒ 模板所有步骤只能共用**同一份** runtime `params`；
          异质工具（如 `grep` 要 `pattern`、`file_read` 要 `file_path`）**无法用同一参数袋驱动** ⇒ 多步异质映射
          **结构性不可行**（须先给 `WorkflowStep` 加 `params?` 并同步 CRUD/端口/前端）。
       ③ **权限冲突**：写入/执行类步骤（"编写修复代码"/"执行迁移"）需破坏性工具 ⇒ 被 ③（仅非破坏性，fail-closed）
          拦截；若为内建开豁免，则会**绕过"按任务裁剪工具"**（chat 任务下模型不能直呼 `bash`，却能借内建模板跑 `bash`）
          ⇒ **构成权限提升**，须先补"步骤工具必须属于当前任务白名单"才安全。
       ⇒ **结论**：内建模板"不可执行"是**语义正确的设计终点**（它们是人工方法论清单）；本轮只**修正误导性表述**
          （`/run` 对 `builtin:*` 曾返回 404 "not found" ⇒ 现为 **400 + 准确原因**，见 §11）。
       ⇒ ✅ **已裁定「维持现状」（2026-10-08，用户）**：不改造内建模板；本轮交付 = 上述语义订正。
          **触发条件（重开）**：出现"内建模板需可执行"的**真实诉求**时，二选一 —— **(i) 语义改写**为纯工具脚本
          （须同时给 `WorkflowStep` 加 per-step `params?`，并接受丢失 `manual`/`review` 语义）；**(ii) 新增
          human-in-the-loop** seam 能力（manual 步真正等人确认）。二者均需先补"步骤工具须属当前任务白名单"以守住 ③。
  4. **CRUD 保护不变**：`builtin:` 前缀的 PUT/DELETE 仍 403（`:399-405`、`:459-465`）。

## 6. 与 `instantiatePattern` / `PatternAssembly` 的关系（问题 4，CS01）

- **无直接可复用关系**：`instantiatePattern(selection)`（`query/patternAssembler.ts:60-68`）输入是 `PatternSelection`、输出是**运行路由**（当前仅 `research`）；与"模板 → 定义"无数据结构交集。
- **潜在可借用的既有概念**只有一处：`PatternRegistry` 的 `assembly.bindings: {role, providers[]}`（§2.4）是"角色 → 承担方"的**结构化**写法，可作为**命名/结构参考**（若裁定走"角色约定表"路线，应复用该「显式绑定」形态而非新造隐式表）。
- **结论**：**不新增与 pattern 装配平行的第二套装配运行时**；本问题的装配层应**独立、轻量**（纯函数 `template → definition`），复用 seam 的 `validate/orderSteps` 而非重写拓扑逻辑（CS01 归一化）。

## 7. 停止条件触发与选项对比（交裁定）

**触发判定**：本问题的**任一可行方案都改变产品语义（模板可执行性）**；且 §4.3 的推荐**必须扩改公共域类型 `WorkflowTemplate`**；同时存在**多个语义等价但产品含义不同**的选项 ⇒ **命中任务给定的停止条件，停手不拍板**。

| 选项 | 一句话 | 是否改公共域类型 | 产品含义 | 影响面 | 兼容性 | 主要风险 |
|---|---|---|---|---|---|---|
| **① 模板内显式 `tool?`** | 模板既是清单又是可执行脚本（同源一份） | **是**（`WorkflowStep`/镜像/前端类型） | 模板成为**一等可执行产物**；作者需写工具名 | 类型 3 处 + CRUD 校验 + 装配层 + Provider | 加性、缺省不变 | 公共类型变更需跨端同步；工具名对用户作者门槛高 |
| **② 独立装配层 + 并行可执行规格** | 模板保持清单，"执行规格"为**第二份**产物 | 否 | 模板**仍不可执行**；多一份可漂移的规格 | 新类型 + 新存储 + 装配层 + Provider + 触发入口 | 完全加性 | 两份数据漂移（CS01）；"存哪/谁读写"未定（当前无 store） |
| **③ 角色/类型约定表映射 tool** | 用 `suggestedAgentRole`/`type` 查表得到工具 | 否 | 模板的"角色建议"被**解释**为工具调用（角色≠工具） | 约定表 + 装配层 + Provider | 加性 | 语义牵强；硬编码表（与「禁按名建属性表」精神冲突）；覆盖不全即静默不可执行 |
| **④ 维持现状（不绑定）** | 模板仅为清单/文档，执行只走 `office:workflow`/seam 既有 Provider | 否 | 无变化 | 0 | — | 用户模板"创建后不能跑"，CRUD 为悬空能力 |

**另需一并裁定的前置项（因任务前提不成立）**：

| 前置项 | 选项 | 说明 |
|---|---|---|
| P0-1 模板**存储基座** | ~~(a) 先恢复 `WorkflowTemplateStore`…；(b) 先在**内存 Map** 上做装配/执行…~~ ⇒ **✅ 已解除（2026-10-08）** | 由 **S24 ①** 直接落地：`WorkflowTemplateStore` 已在 main（§2.2 已订正）⇒ 装配层的"读取源"= 该 store（经其**同步快照** `listSync()`，因 seam 的 `listWorkflows()` 是同步契约） |
| P0-2 **触发入口** | ~~(a) 新增 HTTP 端点 `POST /v1/workflows/templates/:id/run`；(b) 模板注册为 seam Provider 经 `office:workflow`；(c) 以 skill 暴露~~ ⇒ **✅ 已裁定 = (a)（2026-10-08）** | **裁定理由（另两项被硬约束排除，非偏好）**：(b) `office:workflow` 的 `enum` 在**工具创建时**由 doc 域 `DocOrchestrator.getAvailableWorkflows()` **静态**生成，而用户模板是运行期 CRUD ⇒ 动态模板进不了该 enum；且该工具语义专属 doc 办公编排。(c) 技能按规范**仅提示词注入**（`SkillTool` 无执行分支，`project_rules §1.15-6`）⇒ **不能**承载执行。⇒ 已实现 `/run`（`runWorkflowTemplate` + 端口 + handler + 路由）；**并补：模型可见入口 = 新增专用工具 `workflow:run-template`**（见 §11）。~~模型可见触发面未打开~~ ⇒ **2026-10-08 续已打开（专用工具）** |
| P0-3 **可执行工具白名单/权限边界**（= S24 ③） | ~~是否限制模板只能调用非破坏性工具~~ ⇒ **✅ 已裁定 = 仅非破坏性工具（fail-closed）（2026-10-08）** | 事实源 = `tools/toolEffects.ts` 的 `TOOL_EFFECTS`（编译期强制的**唯一声明表**，经 `ToolSideEffectResolver` 注入 ⇒ 不硬编码工具名表）；**判据 = `sideEffect === 'none'`**，**未声明工具（MCP/插件）同样拒绝**；越界 ⇒ **执行前整体拒绝**（`stopReason:'error'`、`completedSteps` 为空），**不静默跳过越界步骤**（CS03）。收口点 = Provider 的 `execute()` 预检（**唯一**收口 ⇒ 任何入口都受约束） |

## 8. 声明

- ~~**本轮未改任何业务代码**（仅新增本设计文档 + 台账取证登记）。~~ ⇒ **2026-10-08 订正**：**推荐形态 ①+② 已实施**（见 §9）；**P0-2 / P0-3 亦已裁定并实施**（见 §10）。
- **待裁定项 = 0**（主方案 = ①+②；P0-1 已解除；P0-2 = (a)；P0-3 = 仅非破坏性工具）。
- **仍未做（明确）**：**"内建 4 模板是否也可执行"** = **产品选择**（§5.3），需给静态模板补 `tool`；模型可见入口见 §11（**已开**，为**专用工具**而非扩 `office:workflow`）。

## 9. 实施记录（2026-10-08，①+② 落地）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/workspace/types.ts` | `WorkflowStep` 增**可选 `tool?: string`**（①；缺省 = 不可执行） |
| 2 | `app/src/runtime/api/workspaceOpsPorts.ts` | `WorkflowStepDto` 同步镜像 `tool?: string \| undefined`（service 层不引 app 层类型） |
| 3 | `app/src/workspace/workflowTemplateAssembly.ts` | **新建**：纯函数 `templateToDefinition()` + `templateWorkflowName()` + `TEMPLATE_WORKFLOW_PREFIX`（②） |
| 4 | `app/src/workspace/WorkflowTemplateProvider.ts` | **新建**：`WorkflowProvider` 实现（同步 `listWorkflows()` + 逐步 `execute()` + 步骤边界取消）+ 幂等注册入口 `registerWorkflowTemplateProvider()`（②） |
| 5 | `app/src/workspace/WorkflowTemplateStore.ts` | 增**同步快照** `listSync()`（seam 的 `listWorkflows()` 是**同步**契约 ↔ 回调式异步 sqlite 的桥接；`doInit` 预热、`upsert`/`remove` 同步维护；事实源仍是表） |
| 6 | `app/src/workspace/index.ts` | 导出装配层 / Provider / 注册入口（供 Phase 5 经**模块出口**取用） |
| 7 | `app/src/bootstrap/pipeline/BootPipelineIntegrator.ts` | Phase 5 `domain:init` 注册 Provider（try/catch + `handleError`） |
| 8 | `app/tests/workspace/workflowTemplate{Assembly,Provider}.test.ts` | **新建**：装配 8 例 + Provider 6 例（含**经真实 `WorkflowEngine.execute`** 的端到端） |
| 9 | `app/tests/workspace/workflowTemplateStore.test.ts` | 增同步快照 1 例 |

**关键决策（实施口径）**：

1. **`tool` 只显式声明，不派生**（CS04）：任一步骤缺 `tool`（或为空白）⇒ `templateToDefinition()` 返回 `null` ⇒ 该模板**显式不可执行**；内建 4 模板不含 `tool` ⇒ **不产出任何定义，行为不变**（§5.1）。
2. **定义名加前缀** `template:<id>`（§5.2）：`WorkflowEngine.find()` 按名首个命中 ⇒ 加前缀防撞名；`validate()` 仍在**注册期** fail loud（重复/缺依赖/成环）。
3. **不重写拓扑**（CS01）：`dependsOn` 原样透传，交 `WorkflowEngine.validate()/orderSteps()`。
4. **同步快照是派生缓存、非第二事实源**：store 是表的唯一写者 ⇒ 不会漂移；`doInit` 预热以杜绝"未 `list()` 就取用 ⇒ 静默空列表"的隐性错误。
5. ~~**权限不越权（P0-3 未裁）**：Provider 不自定义工具白名单…~~ ⇒ **2026-10-08 同日续裁并实施**（见 §10；③ = 仅非破坏性工具，收口在 Provider 预检）。
6. ~~**触发面不打开（P0-2 未裁）**：仅注册 Provider…~~ ⇒ **2026-10-08 同日续裁并实施**（见 §10；P0-2 = (a) HTTP `/run`）；**`office:workflow` 的 enum 仍未改动**（模型可见触发面仍未打开）。

**验证（实测）**：`bun run typecheck` **0**；定向 ESLint **0**；`lint:arch` **错误 0 / 警告 4**（基线，未新增）；`bun test tests/workspace/` **32 pass / 0 fail**、`tests/modules/`（seam 族）**112 pass / 0 fail**。

**仍未做（明确）**："内建 4 模板是否也可执行"（§5.3 产品选择）；是否再开模型可见触发面 —— 见 §10 结尾。

## 10. 实施记录（2026-10-08 续：**P0-2(a) 触发入口 + ③ 权限边界**）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/workspace/workflowTemplateRunner.ts` | **新建**：`runWorkflowTemplate()`（**纯逻辑 + 依赖注入**；四态归一 `WorkflowTemplateRunOutcome`） |
| 2 | `app/src/workspace/WorkflowTemplateProvider.ts` | **③ 权限预检**（执行前）：`unsafeTools()` + `ToolSideEffectResolver`（**必填**注入，无隐式默认）；越界 ⇒ 整体拒绝 |
| 3 | `app/src/runtime/api/workspaceOpsPorts.ts` | `WorkflowTemplateRunOutcomeDto`（逐字镜像）+ `WorkspaceOpsPort.runWorkflowTemplate()` |
| 4 | `app/src/runtime/api/domainSnapshotOps.ts` | 实现 `runWorkflowTemplate`（动态 import `@modules/workspace` / `WorkflowTemplateStore` / `@modules/workflow`） |
| 5 | `app/src/infrastructure/http/handlers/workflow-template-handlers.ts` | `handleRunWorkflowTemplate`（四态 → 状态码） |
| 6 | `app/src/infrastructure/http/handlers/routes/monitor-command-routes.ts` | 路由 `POST /v1/workflows/templates/:id/run` |
| 7 | `app/src/workspace/index.ts` | 导出 `runWorkflowTemplate` + 结果类型 |
| 8 | `app/tests/workspace/workflowTemplateRunner.test.ts` | **新建**：四态 6 例 |
| 9 | `app/tests/workspace/workflowTemplateProvider.test.ts` | 增 **③ 权限策略 3 例**（纯只读放行 / 越界整体拒绝 / 未声明 fail-closed） |

**关键决策**：

1. **P0-2 = (a) HTTP 端点**（理由见表：另两项被硬约束排除）⇒ **模型可见触发面仍未打开**（`office:workflow` 未改；该工具 enum 静态、语义专属 doc）。
2. **③ 判据 = `sideEffect === 'none'`**：事实源 = `TOOL_EFFECTS`（编译期强制）；**未声明工具同样拒绝**（fail-closed）；经 `ToolSideEffectResolver` **注入**（不硬编码工具名表）。
3. **越界 = 整体拒绝**（不做"跳过越界步骤继续跑其余"）：静默跳过会让"部分执行"被误认为成功（CS03/CS04）。
4. **收口唯一**：策略在 Provider 的 `execute()` 预检 ⇒ **任何入口**（今 `/run`，将来的入口）都受同一约束。
5. **四态 `kind` 判别**（非文案匹配，CS02）⇒ HTTP 状态码映射：`not-found`→404 · `not-executable`→400 · `failed`→400（body 带 `stopReason`）· `completed`→200。

**验证（实测）**：`bun run typecheck` **0**；定向 ESLint **0**；`lint:arch` **错误 0 / 警告 4**（基线，未新增）；`bun test tests/workspace/` **41 pass / 0 fail**（新增 Provider 策略 3 例 + Runner 6 例）；`tests/modules/` **112 pass / 0 fail**。

**仍未做（明确）**："内建 4 模板是否也可执行" = **产品选择**（§5.3；需给静态模板补 `tool`，仍不入库）。~~是否再开模型可见触发面~~ ⇒ **2026-10-08 续已开**（§11，专用工具）。

## 11. 实施记录（2026-10-08 续二：**模型可见专用工具** `workflow:run-template`）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/workspace/workflowTemplateTool.ts` | **新建**：`createWorkflowTemplateTool(deps)`（`action: list\|run`；**依赖注入** ⇒ 可单测）+ `registerWorkflowTemplateTool()`（幂等） |
| 2 | `app/src/tools/toolCategories.ts` | `TOOL_CATEGORIES['workflow:run-template'] = 'assist'`（**N-44/N-45 必需**，见下） |
| 3 | `app/src/bootstrap/pipeline/BootPipelineIntegrator.ts` | Phase 5 独立 try 块注册工具（与 Provider 注册解耦，任一失败不互相影响） |
| 4 | `app/tests/workspace/workflowTemplateTool.test.ts` | **新建**：可见性回归锁 + 元信息 + list/run + 参数校验（12 例） |

**关键决策**：

1. **不用 `enum`**：模板目录是**运行期 CRUD**，静态 `enum` 承载不了 ⇒ `template` 为自由字符串，**未知 id 时返回当前可用清单**（动态目录的正确做法）。这正是 (b) 选项在 `office:workflow` 上不可行的同一原因，此处以设计规避。
2. **不复制权限策略**：执行转给 seam（`WorkflowEngine.execute('template:<id>')`）⇒ 复用 Provider 的 ③ 预检（**同一收口**，CS01）；越界模板在执行前被整体拒绝，工具把该 error 原样透出。
3. **⚠️ 必须登记 `TOOL_CATEGORIES`**（N-44/N-45 陷阱）：出站按 **wire 安全名**（`workflow:run-template` → `workflow_run-template`）裁剪工具集；未登记类别 ⇒ 落 `misc` ⇒ **不在任何任务白名单** ⇒ **模型永远看不到该工具**（N-45 现场）。已登记为 `assist`（与 `plan`/`clipboard`/`canvas` 同口径 = "任何对话都可能用到"）⇒ 在 `chat`/`default` 任务下可见；**wire 形态由 `WIRE_KEYED_CATEGORIES` 自动派生**（无需另填）。
   - **边界（如实）**：`assist` 类目**不在 `coding`/`agent` 等任务白名单** ⇒ 那些任务类型下本工具**仍会被裁剪**（与 `plan`/`clipboard`/`canvas` 现状一致）。若要在那些任务下可见，属**另行放宽类别口径**的决策（会影响同类的 plan/clipboard/canvas）。
4. **`isReadOnly: () => false`**：不冒充只读 —— 避免影响既有只读清单与审批口径（与 `office:workflow` 一致）。
5. **注册方式 = 运行期注册**（同 `office:*` 由所属域注册），**非** `ToolFactory` 内建 ⇒ 不进 `toolNames.generated.ts`（其门禁只比对 `getAllBuiltinToolLoaders()` 派生清单）。
6. **内建模板的语义订正（2026-10-08 续三）**：`/run` 与工具对 `builtin:*` **不再返回"not found"**，改为**准确原因** ——
   `/run` ⇒ **400**（"内建模板：人工方法论清单，未声明 tool ⇒ 不可自动执行"）；工具 ⇒ FAILURE（同义）。
   修复前的 `/run` 走端口只查 store ⇒ 对**确实存在**的内建模板报 404，与 `GET /templates/:id` **自相矛盾**（误导）。
   为何不改成"可执行"：见 §5.3-3 的三点取证（人工步骤 / 无 per-step params / 权限提升）。

**验证（实测）**：`bun run typecheck` **0**；定向 ESLint **0**；`lint:arch` **错误 0 / 警告 4**（基线，未新增）；`bun test tests/workspace/ tests/tools/` **681 pass / 0 fail**（70 文件；含可见性回归锁 —— 断言 wire 形态在 `chat`/`default` 下**不被裁剪**）。
