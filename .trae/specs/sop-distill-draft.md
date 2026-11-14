# 成功轨迹 → SOP 草案（D10）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · D10）
> 约束：**只产草案，不自动注册**（方案 §3-4：注册必须人工确认）。

## 1. 目标

1. **成功轨迹可蒸馏**：读已完成的 PDCA 计划，生成可复用的 SOP 草案（Markdown）。
2. **草案生成可复现**：不调 LLM，同一轨迹 ⇒ 逐字相同的正文与 id（内容哈希）。
3. **HITL 闸门**：`/sop distill` 只落草案；`/sop approve` 才写 `~/.pyapp/skills/<name>/SKILL.md`。
4. **拒绝率可观测**：`computeSopDraftStats().rejectedRate`（无已决草案 ⇒ `null`，不伪造 0%）。

## 2. 边界（如实）

| 项 | 口径 |
|---|---|
| 轨迹事实源 | `TaskOrchestrator` 的计划文件 `~/.pyapp/data/plans/plan_<id>.json`（**不新建轨迹存储**，CS01/R02） |
| 成功判定 | 计划 ≥1 步且**每步** `status === 'completed'`、每步描述非空（不做"部分蒸馏"） |
| 蒸馏方式 | **纯模板**（步骤 / 产物台账 / 重试次数 / 验收标准），不调 LLM ⇒ 可复现、不臆造 |
| 草案存储 | `~/.pyapp/data/sop-drafts/sop-draft_<id>.json`（数据层，不参与技能加载；不新增 DB 表） |
| 触发 | **人工执行** `/sop distill`（不新增后台调度器 / 不新增默认关开关） |
| 注册 | 仅 `/sop approve`：写入用户技能目录；同名目录已存在 ⇒ 拒绝覆盖（fail-closed） |
| 状态取值 | `sop_pending` / `sop_approved` / `sop_rejected`（带前缀，避免与跨域通用词 `pending/approved/rejected` 冲突） |
| 不做 | LLM 归纳润色、自动批准、HTTP/客户端面板入口、跨计划的合并归纳 |

## 3. 数据流

```
~/.pyapp/data/plans/plan_*.json
   └─(每步 completed)→ SopTrajectory ─buildSopMarkdown→ 草案 Markdown + id=sha256(正文)[:12]
        └─ SopDraftStore.save → ~/.pyapp/data/sop-drafts/sop-draft_<id>.json（sop_pending）
             ├─ /sop reject <id>  → sop_rejected（终态，记录原因）
             └─ /sop approve <id> → 写 ~/.pyapp/skills/sop-<id>/SKILL.md → sop_approved（终态）
```

## 4. 验收

| 验收项 | 落点 |
|---|---|
| 同轨迹 ⇒ 正文/id 逐字相同；内容不同 ⇒ id 不同 | `sopDistill.test.ts` · `buildSopDraft` / `distillSopDrafts` |
| 只选「每步都完成」的轨迹；坏文件跳过；limit 生效 | `sopPlanSource` 用例（临时目录） |
| 蒸馏不写技能；保存幂等；终态不可改写 | `SopDraftStore` 用例 |
| `approve` 写 SKILL.md（含 front matter）且同名目录不覆盖 | `SopDraftStore.installSkill` 用例 |
| 拒绝率：无已决 ⇒ `null`；全拒绝 ⇒ 1 | `computeSopDraftStats` 用例 |
| 命令全链路（distill → list → reject → approve） | `createSopCommand` 用例 |

## 5. 实现落点

| 文件 | 变更 |
|---|---|
| `app/src/tasks/evolution/sopDistill.ts` | **新增** 纯函数：`buildSopMarkdown` / `buildSopDraft` / `computeSopDraftId` / `distillSopDrafts` |
| `app/src/tasks/evolution/sopPlanSource.ts` | **新增**：计划文件 → 成功轨迹（`toSopTrajectory` / `readCompletedPlanTrajectories`） |
| `app/src/tasks/evolution/SopDraftStore.ts` | **新增**：草案落盘 / 前缀查找 / 人工决定 / `installSkill` / 统计 |
| `app/src/commands/builtin/sop/Sop.ts` | **新增** `/sop`（list / distill / show / approve / reject / stats） |
| `app/src/tasks/index.ts`、`commands/builtin/command-registry.ts`、`commands/loader/CommandLoader.ts`、`commands/groups/commandGroups.ts`、`commands/{index,builtin/index}.ts` | 接线（模块出口 + 命令注册 + 顶层保留） |
| `.trae/architecture/state-literal-baseline.json` | `Sop.ts` 的 `type: 'error'`（CommandResult 既有词汇的新出现点）收编基线 |
| `app/tests/tasks/evolution/sopDistill.test.ts` | **新增** 12 条用例 |
| `app/tests/commands/commandGroups.test.ts` | 顶层命令数 28 → 29 |

## 6. 未做项（如实登记）

1. **LLM 归纳润色**：当前为纯模板，SOP 可读性弱于模型归纳；引入 LLM 会牺牲"可复现"，需单独立项（草案可附带"模型润色版"字段，不影响 id）。
2. **后台自动蒸馏**：没有调度器/开关；后续若接入，按默认关开关三处登记（`featureFlags` / `project_rules §1.4` / `SAFETY_SWITCHES` + 默认关登记表）。
3. **UI/HTTP 入口**：暂只有 CLI 命令；客户端如需草案面板，走 `.trae/docs/api-spec.md` 新增接口。
