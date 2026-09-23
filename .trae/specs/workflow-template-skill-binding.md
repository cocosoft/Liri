# 工作流模板 → 技能绑定 Spec（P2-1 绑定语义）

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / CS01（复用技能体系，不另造）/ CS02 / PY_APP §2（不做投机性扩展）/ project_rules §1.15（技能来源契约与"仅提示词注入"）
> 前置：`.trae/specs/workflow-template-persistence.md`（P2-1 落盘）

## 1. Problem Statement

路线图 P2-1 要求"模板与 Provider 绑定"。取证后发现两套类型族**根本错位**：

| 维度 | 模板 `WorkflowStep`（`workspace/types.ts#L536-L545`） | seam `WorkflowStepSpec`（`modules/workflow/types.ts#L38-L49`） |
|---|---|---|
| 执行体 | **无**（仅 `type: manual\|auto\|review` 标签） | **`tool` + `params`**（真正驱动执行） |
| 依赖 | `dependsOn?` | `dependsOn?`（seam 做校验 + 拓扑排序） |
| 角色 | `suggestedAgentRole?` —— **全仓零消费**（仅 4 内建模板 + 1 测试） | 无 |
| 其他 | `estimatedMinutes?`（零消费）、category/author/isPublic/usageCount/tags | description |

即：模板步骤**没有 `tool` 字段**，无法直接当流程定义执行。

## 2. 方案取舍（含安全判断）

| 方案 | 结果 | 判断 |
|---|---|---|
| A. 模板 → **可执行** `WorkflowDefinition`（新增 `tool`/`params`） | 经 `office:workflow` 执行 | ❌ **否决**：`POST /v1/workflows/templates` 因此变成"可构造任意工具调用序列"的入口（如 `mail:send`、文件写）；该接口在 `LIRI_API_SECRET` 未配置时放行任意本机调用，且当前无 UI 收紧。**这正是 V-3 删除 `createWorkflowTool` 桩的理由**（模型自撰流程 + 无隔离 = 权限扩张） |
| B. 解绑（判定两者不同概念） | 零改动 | 可选，但放弃了"让模板有真实消费路径"的机会 |
| **C. 模板 → prompt 型技能（采用）** | 模板清单作为提示词注入，模型自主选工具 | ✅ **采用**：复用既有技能注入链路（有真实消费者 `<available_skills>`/SkillTool），**零新增执行权限**，符合 §1.15"技能仅提示词注入" |

**决策 D1**：采用方案 C，**不**给模板新增 `tool`/`params`，**不**新增任何执行路径。
**决策 D2**：以 `SkillProvider` 契约接入（§1.15 #9 强制），禁止自建"只实现 loadSkills 的来源"。
**决策 D3**：内建 4 模板搬迁至 `workspace/builtinWorkflowTemplates.ts`，使 handler 层与技能层**同源**（避免 `skills → infrastructure/http` 反向依赖）。

## 3. 实现

| 文件 | 改动 |
|---|---|
| `workspace/builtinWorkflowTemplates.ts` | **新建**：4 个内建模板从 handler 原样搬迁（`BUILTIN_WORKFLOW_TEMPLATES`） |
| `infrastructure/http/handlers/workflow-template-handlers.ts` | 改为从新模块别名导入（内容零改动） |
| `skills/loaders/sources/WorkflowTemplateSkillProvider.ts` | **新建**：`implements SkillProvider`（`name='workflow-template'`，`rank=PROVIDER_RANK.USER`）；`loadSkills()` = 内建 4 + store 用户模板 → `Skill`；`renderWorkflowTemplatePrompt()` 渲染清单式提示词 |
| `constants/systemPromptSections.ts` | `initBuiltinSkills()` 纳入模板技能（启动注册，`<available_skills>` 可见） |
| `commands/builtin/skill/index.ts` | `loadAllSkills()` 的 providers 数组追加 |
| `skills/loaders/sources/__tests__/WorkflowTemplateSkillProvider.test.ts` | **新建**：5 用例（临时库注入，不碰真实 DB） |
| `app/docs/SKILLS.md` | 补"第二类内置来源"说明（§1.15 #8 文档一致性） |

**技能映射**：内建 → `wf-bug-fix` / `wf-feature` / `wf-refactor` / `wf-db-migration`（`SkillSource.BUILTIN` / `loadedFrom='bundled'`）；用户模板 → `wf-<id>`（`SkillSource.THIRD_PARTY` / `loadedFrom='user'`，复用既有约定）。`allowedTools: []`、`impl.kind='prompt'`。

**提示词语义**（`renderWorkflowTemplatePrompt`）：输出模板名/描述/场景/步骤清单，显式声明"**这是流程清单，不是强制工具调用序列**——具体工具由你按需选择"。

## 4. 验证

| 项 | 结果 |
|---|---|
| 类型/架构 | `bun run typecheck` **0**；`lint-architecture.ts` **0 错误 / 0 警告** |
| 单测 | 新增 **5 pass**；回归 **112 pass / 0 fail**（15 文件 394 断言） |
| 权限约束（关键） | `builtinWorkflowTemplates.ts` 内 `tool:` / `params:` **零命中** → 未新增执行权限 |
| 运行时（真实 HTTP） | 起 `--http-only` 服务（隔离 HOME + 端口 18992）→ `GET /v1/skills/system` **200**，共 **15** 个技能，其中 **4 个为 `wf-*`**（`wf-bug-fix`/`wf-feature`/`wf-refactor`/`wf-db-migration`，`source=builtin`） |

## 5. 已知限制（如实记录，未修）

1. ✅ **已修复（2026-09-13，V-10）**：新增 `reloadWorkflowTemplateSkills(provider?)`（`constants/systemPromptSections.ts`，照 `reloadUserSkills()` 模式），在 create/update/delete 三个写入口落库后触发；模板技能以 `config.workflowTemplateId` 作为**可区分标记**（禁用名称前缀判定）；已删模板 `unregister`、已存在则 `register` 覆盖刷新。运行时实测：隔离环境 POST 模板后**无需重启** `GET /v1/skills/system` 15→16（出现 `wf-user_*`），DELETE 后 16→15（消失）。
2. 未做前端展示（P3-1 已决策删除前端死接口；技能经 `/v1/skills/system` 可见）。
3. 内建模板 id 与用户模板 id 完全同名时，用户模板技能名会与之碰撞（极端情况，未处理）。

## 6. 合规检查清单

| 规则 | 检查点 |
|---|---|
| CS01 归一化 | 复用既有 `SkillProvider` 契约 + 技能注册链路，未另造加载机制 |
| CS02 | 技能名与来源标签均来自数据字段，未按字符串前缀做状态判断 |
| CS04 | 无 Mock 数据；测试用临时 DB |
| §1.15 #9 | 新来源实现 `SkillProvider` 并经 `collectSkillsFromProviders` 聚合 |
| §1.15 #7/#8 | 无 shell 执行；`SKILLS.md` 同步 |
| §1.8 / §1.9 | 通过 `getLogger('skills:...')` 记录；store 读取失败记 `logger.warn` 后降级为空（非静默） |
| PY_APP §2 | 未新增 speculative 抽象；未给模板加执行能力 |
