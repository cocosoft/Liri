# Spec：任务分解结果 Schema 校验（M1）

> 版本 1.1 ｜ 创建 2026-10-06 ｜ 状态：🟢 **已实施（2026-10-06）** —— 裁定 D1=zod / D2=抛错降级 / D3=判失败，见 §8
> 来源：`dev_docs/任务计划-20261004.md` §14.1 **M1**「分解结果无 schema 校验（`TaskDecomposer.ts:227` 裸 `JSON.parse`）」+ §14.4 净新增可执行项 1
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R06-008（分层）
> 口径（CS06）：下列 file:line 为 **2026-10-06 实测**。

---

## 1. Problem Statement（回仓取证）

### 1.1 现状：LLM 返回的 JSON **直接信任**，只有零散的"就地归一化"

`app/src/ai/router/TaskDecomposer.ts`：

| 位置 | 现状 |
|---|---|
| `:232` | `const parsed = JSON.parse(json);` —— **裸解析**，无结构校验（`parsed` 为隐式 `any`） |
| `:234-244` | 逐字段**就地兜底**：`subTasks` 缺省 `[]`、`id` 缺省 `step-N`、`description` 用 `name` 兜底再退 `步骤 N`、`tier` 走 `normalizeTier`、`dependsOn` 非数组则 `[]`、`slice(0, MAX_SUBTASKS)` 截断 |
| `:247` | `mainTier: this.normalizeTier(parsed.mainTier)` —— `parsed.mainTier` 为 `any`，非法值静默落 `medium`（`:264-270`） |
| `:249` | `reasoning: parsed.reasoning \|\| 'LLM 自动分解'` |
| `:251-258` | `catch` → `handleError` + 日志 + **`throw`** |

### 1.2 降级路径**已存在**（M1 的"无降级"指控不成立）

```
llmDecompose(:179) → parseDecomposition(:193)
  → 解析/校验失败 throw(:257)
    → decompose() catch(:163-169) 记录并告警
      → simpleDecompose()(:173, :199-223) 单步分解
```

⇒ **唯一缺口 = "无 schema 校验"**：畸形结构（如 `subTasks` 为对象/字符串、元素为 `null`、`dependsOn` 含非字符串、`id` 重复）会被就地兜底**静默接受**，产出的 `SubTask[]` 可能语义错乱（如 `null.map` 抛错虽被 catch，但 `{subTasks:{}}` 会得到空列表并被当作"合法空分解"）。

### 1.3 归一化检查（CS01）

- `grep` 全仓 `validateDecomposition|DecompositionResult` 的校验实现 ⇒ **0 命中**（无既有校验器可复用）。
- 依赖：全仓 `zod` / `ajv` ⇒ **0 命中**（本仓无 schema 库；`package.json` 无该依赖）。
- `ParsedSubTaskJson`（`:133-140`）是**专为"宽进"设计的宽松接口**，非校验产物。

---

## 2. 目标 / 非目标

**目标**
- G1：为 LLM 分解结果引入**结构化校验**，畸形输入 ⇒ **明确失败**（走既有 `throw → simpleDecompose` 降级），不再被静默兜底成"看起来合法"的结果。
- G2：校验器为**纯函数 + 纯模块**（无 IO、无 LLM），可单测。
- G3：**保留既有宽进能力**（`name`→`description`、缺 `id` 自动编号、超发截断）—— 校验只拒绝**结构性畸形**，不收紧既有容错。

**非目标**
- N1：**不改 LLM 分解 prompt**（`DECOMPOSE_PROMPT :103-126` 不动）。
- N2：**不改降级路径**（`simpleDecompose` 语义与调用方不变）。
- N3：不改 `MAX_SUBTASKS` / tier 归一化规则 / 依赖编排语义。
- N4：不做"用 LLM 修复畸形 JSON"的二次调用（成本与不确定性）。
- N5：不为 `SubTask.status`/`result` 等**运行时字段**加校验（只校验 LLM 出参面）。

---

## 3. 设计

新增纯模块 `app/src/ai/router/decompositionSchema.ts`（同目录、无出向依赖）：

```ts
export interface DecompositionValidationIssue {
  path: string;                       // 如 'subTasks[2].dependsOn[0]'
  kind: 'not_object' | 'missing_field' | 'wrong_type' | 'empty_array' | 'duplicate_id';
}

export type DecompositionValidation =
  | { ok: true; subTasks: ParsedSubTaskJson[]; mainTier?: string; reasoning?: string }
  | { ok: false; issues: DecompositionValidationIssue[] };

/** 纯结构校验：只判定"能否安全消费"，不做兜底归一化（归一化仍留在 parseDecomposition） */
export function validateDecompositionShape(raw: unknown): DecompositionValidation;
```

**规则（最小必要集）**
1. 顶层必须是对象；`subTasks` 必须是**非空数组**（空 `subTasks` ⇒ `empty_array`，交降级）。
2. 每个元素必须是对象；`dependsOn` 若存在必须是 `string[]`。
3. `id` 若存在必须是字符串；**重复 `id` ⇒ `duplicate_id`**（依赖图会歧义）。
4. `mainTier` / `reasoning` 若存在必须是字符串。
5. 截断（`slice(0, MAX_SUBTASKS)`）**先于**重复 id 判定，避免"被截断的重复"误报。

**接线**：`parseDecomposition` 中 `JSON.parse` 之后、映射之前调用；`ok:false` ⇒ 抛 `AppError`（`category` 用既有错误类型），沿用 `:251-258` 的 catch → `throw` → `decompose()` → `simpleDecompose()` 路径。

---

## 4. 决策点（已裁定 2026-10-06）

| ID | 决策项 | 选项 | 裁定 |
|:--:|---|---|---|
| **D1** | 校验实现方式 | (a) 轻量手写校验／(b) 引入 **zod** | **(b) zod**（用户裁定）。⚠️ 实测 **零新增依赖** —— `zod` 早在 `app/package.json` 声明（`^3.23.0`，装 3.25.76），此前全仓 `app/src` 无消费者 |
| **D2** | 校验失败处置 | (a) 抛错 → 既有 `simpleDecompose` 降级／(b) 尽力修复 | **(a)** —— 复用生产已验证的降级路径；"部分修复"会把结构畸形变成静默少步骤 |
| **D3** | 空 `subTasks` | (a) 判失败／(b) 视为合法空分解 | **(a)**（按 spec 建议默认，未单独提问）—— `.min(1)` 拦截 |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/ai/router/decompositionSchema.ts` | **新建**：纯校验器 |
| 2 | `app/src/ai/router/TaskDecomposer.ts` | **改**：`parseDecomposition` 接入校验（`ok:false` ⇒ 抛错） |
| 3 | `app/tests/ai/decompositionSchema.test.ts` | **新建**：校验器单测 |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 合法输入 | 正常 LLM JSON ⇒ `ok:true`，产出与改造前**逐字段一致**（零行为回归） |
| 结构畸形 | `subTasks` 为对象/字符串/含 `null` 元素/`dependsOn` 含非字符串 ⇒ `ok:false` + 明确 `issues` |
| 重复 id | 截断后仍重复 ⇒ `duplicate_id`；超发截断后被截掉的重复 ⇒ **不报** |
| 降级 | `parseDecomposition` 失败 ⇒ `decompose()` 回退 `simpleDecompose()`（单步），不抛到调用方 |
| 架构 | `typecheck` 0；`lint:arch` 不新增错误；新模块不出 `ai` 层 |
| 回归 | 全量 `bun test` 0 fail |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 先 spec，裁定后动码 |
| GR01 基础设施复用 | ✅ 复用既有 `throw → simpleDecompose` 降级路径与 `handleError`；不新造降级机制 |
| CS01 归一化 | ✅ 已检索：全仓无分解校验器；`zod` 已声明但 `app/src` 零消费者 ⇒ 复用既有依赖（非新增）；`ParsedSubTaskJson` 上移消除重复类型 |
| CS03 回退最小化 | ✅ 不为"LLM 一定返回合法 JSON"加多余防御；畸形 ⇒ 走**已存在**的降级 |
| CS04 零 Mock | ✅ 单测用纯结构字面量，不 mock |
| CS05 根因优先 | ✅ 根因＝"解析结果无结构校验"，而非"降级缺失"（降级已在） |
| R06-008 分层 | ✅ 纯模块留 `ai` 层（无出向依赖） |
| PY_APP §2 简洁优先 | ✅ 1 个纯模块 + 1 个纯函数；D1=(b) zod —— **实测零新增依赖**（早已在 `package.json` 声明，此前 `app/src` 无消费者） |

---

## 8. 实施结果（2026-10-06）

| 项 | 结果 |
|---|---|
| G1 结构校验 | ✅ 新建纯模块 `app/src/ai/router/decompositionSchema.ts`(zod)：顶层对象 + `subTasks` **非空数组** + 元素为对象 + `dependsOn` 为 `string[]` + `mainTier`/`reasoning` 为字符串 + **显式 `id` 重复**（先截断后判定） |
| G2 纯函数 | ✅ `validateDecompositionShape(raw, maxSubTasks)` —— 无 IO、无 LLM；失败返回结构化 `issues[{path,kind}]`（**非文案**，CS02） |
| G3 保留宽进 | ✅ `name`→`description` 兜底、缺 `id` 自动编号、超发截断**仍留在 `TaskDecomposer`**；校验只拒结构性畸形 |
| 接线 | ✅ `parseDecomposition` 在 `JSON.parse` 后调用；`ok:false` ⇒ `throw new ValidationError(..., 'DECOMPOSITION_SCHEMA_INVALID', {issues})` ⇒ 既有 catch → `decompose()` → `simpleDecompose()`（**不抛到调用方**） |
| CS01 单一事实源 | ✅ `ParsedSubTaskJson` 由 `TaskDecomposer` 文件内接口**上移**至 `decompositionSchema.ts`（`z.infer`），消除重复类型定义 |
| 测试 | ✅ `app/tests/ai/decompositionSchema.test.ts` **12 例**（9 纯校验 + 3 接线：合法零回归 / `subTasks` 非数组降级 / 空数组降级） |
| 门槛（实测） | `typecheck` **0** · 定向 **12 pass / 0 fail** · 全量 **4606 pass / 21 skip / 0 fail**（4627 tests / 486 files） · `eslint`（改动文件）**0** · `lint:arch` **错误 0 / 警告 4（基线）** |

**与 spec 的偏离（如实）**

1. **`maxSubTasks` 作为参数传入**（spec §3 未细列）：避免 `decompositionSchema` ↔ `TaskDecomposer` 循环导入（`MAX_SUBTASKS` 定义在后者）。
2. **重复 id 只比对"显式给出"的 id**：缺 `id` 由 `TaskDecomposer` 自动编号（`step-N`）⇒ 本模块不去猜编号后是否冲突（保证"先截断后判定"顺序可验证）。
3. **`ParsedSubTaskJson` 语义微调**：`slice` 由 `map` 后移到 `map` 前（等价输出，少一次全量 map）。

**未做（明确边界）**

- 未改 LLM prompt（N1）、未改降级路径语义（N2）、未改 `MAX_SUBTASKS`/tier 归一化（N3）、未做 LLM 修复（N4）、未校验运行时字段（N5）。
