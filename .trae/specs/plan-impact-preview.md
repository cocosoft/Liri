# 计划影响预演（D7 一期）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · D7）
> 一期口径：**零执行、零写入**的静态预演；**真实沙箱预演/回放**为二期（前置见 §5）。

## 1. 取证（2026-11-14）

| 事实 | 证据 |
|---|---|
| 仓库**没有**工具/计划级 dry-run 原语 | `Grep "dryRun|dry-run|预演"` 仅命中迁移脚本 / 清理脚本 / evals 题源干跑（`packages/evals/src/evals/cli.ts:343`），无"工具调用或计划影响"预演 |
| `evals` 沙箱是**整进程隔离跑评测**，不是可复用预演原语 | `packages/evals/src/evals/sandbox.ts:22-33`（`VACUUM INTO` 快照 + 独立 daemon 进程 + 独立端口） |
| 四平台隔离已有，但不提供"预演"语义 | `packages/sandbox/src/sandbox/*`（landlock / win / darwin / docker） |
| 副作用声明事实源已就绪 | `app/src/tools/toolEffects.ts`（`TOOL_EFFECTS` / `resolveToolEffect`：`idempotent` + `sideEffect: none|local|external`） |
| 计划台账已含可预演的事实 | `PlanStep.toolOutcomes`（含 `toolName` / 失败 / 拦截 / 待审批）+ `artifacts` + `dependsOn`，随计划 JSON 持久化 |
| 副作用录制 / 回放**不存在** | 无工具级"副作用流水"存储；`session` 事件只记调用与结果，不能重放外部副作用 |

⇒ 真实"沙箱内预演"需要 evals 沙箱扩展 + 副作用录制（方案原文亦如此标注），一期先交付
**可复用的静态影响预演**，并把"上次执行影响"接进 D3 的计划续跑指令（真实消费点）。

## 2. 一期交付

| 件 | 内容 |
|---|---|
| `app/src/tasks/plan/planImpactPreview.ts` 🆕 | 纯函数 `buildPlanImpactPreview(plan, { resolveEffect? })` + `renderPlanImpactPreview` + `hasRecordedImpact`：副作用按声明归类（未声明 ⇒ `unknown`，**不猜**）、关注项（失败/拦截/待审批）、产物去重排序、剩余步骤带依赖序号、风险定级 `none | local-only | external | intercepted`（避开目标状态机的 `blocked` 词汇） |
| `planStartupResume.buildPlanResumeInstruction(plan, impactOptions?)` | 有历史台账时追加「上次执行影响」段落（**无台账不塞空段落**） |
| `resolveStartupPlanResume({ …, resolveEffect? })` | 透传副作用解析 |
| `app/src/chat/manager/recovery.ts` | 注入 `resolveToolEffect(name)?.sideEffect`（唯一事实源，避免 `tasks → tools` 循环依赖） |
| `.trae/specs/plan-impact-preview.md` | 本文件 |
| `app/tests/tasks/plan/planImpactPreview.test.ts` 🆕 | 8 条（分类计数 / 关注项 / 产物 / 依赖序号 / 风险定级 / 可复现 / 无台账 / 指令透传） |

**为什么注入而不直接 import `tools`**：`app/src/tools/**` 已静态依赖 `@modules/tasks`
（`TaskOrchestratorTools` 等 6 处）⇒ `tasks → tools` 会形成模块环。故副作用解析以函数入参注入，
纯函数层零依赖（也便于测试）。

## 3. 边界（如实）

| 项 | 口径 |
|---|---|
| 执行 | **不执行任何工具、不修改任何文件**；报告只来自计划台账 + 副作用声明 |
| 事实缺口 | 未声明副作用的工具计 `unknown`；计划未执行过 ⇒ 无副作用/关注项（如实说明） |
| 风险定级 | 只按历史事实：有拦截 ⇒ `blocked`；有外部动作 ⇒ `external`；仅本地 ⇒ `local-only`；否则 `none`（**不是**执行前预测） |
| 回放 | **不做**（无副作用录制）；二期再评估 |
| 用户入口 | 本期只接 D3 续跑指令（真实消费点）；不做独立命令/面板（避免为单点开新命令面） |

## 4. 验收

| 验收项 | 判据 |
|---|---|
| 分类正确 | `file_read→none` / `file_write→local` / `bash→external` / 未声明→`unknown`（1 条用例） |
| 关注项来自汇总 | 失败 / 拦截 / 待审批 与 `ToolOutcomeSummary` 一致（1 条） |
| 产物与依赖 | 产物去重排序；剩余步骤依赖映射为 1-based 序号（1 条） |
| 可复现 | 同计划 + 同声明 ⇒ 渲染逐字相同（1 条） |
| 风险定级 | 拦截 > 外部 > 本地 > 无（1 条） |
| 无台账不塞段落 | `hasRecordedImpact=false` ⇒ 指令里无「上次执行影响」（1 条） |
| 生产透传 | `resolveStartupPlanResume` 带 `resolveEffect` ⇒ 指令含外部动作计数（1 条） |

## 5. 二期前置（未做，如实登记）

1. **副作用录制**：工具级"将要/已经改变什么"流水（路径、网络目标、子进程），需与 `security/rollback` 的轮快照对齐；
2. **evals 沙箱扩展**：把"计划"作为输入跑在隔离 workspace（现有 `EvalSandbox` 以提示词任务为输入），并输出"沙箱内真实副作用清单"；
3. **回放**：基于副作用流水的可重放/可对比执行（幂等工具才允许自动重放，复用 `canReplayAfterUnknown`）；
4. 用户入口：`/plan preview` 或客户端计划面板（届时再评估命令面/接口面）。
