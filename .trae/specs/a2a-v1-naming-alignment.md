# Spec：A2A 命名对齐 v1.0.0（发现路径 / TaskState / 方法名）—— 论文 A5

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：🟡 **分批实施** —— **T1/T2/T3 已实施（2026-10-06）**；**T4（JSON-RPC 分发 / SSE / 扩展卡）待裁定**
> **来源**：`dev_docs/papers/精读笔记-优先级论文-2026-10-06.md` 行动 **A5**；依据 `dev_docs/papers/notes/a2a-protocol.md` §3.3（发现）、§4.2（方法重命名表）、§5.1（TaskState 枚举）、§7（对照表 1/4/5/6/9 行）
> **关联规则**：GR15（**API 变更 ⇒ 必须 spec**）· GR01 · CS01 · CS06 · §1.3（无正式用户 ⇒ **无需向后兼容**）
> **前置**：`.trae/specs/a2a-external-exposure.md`（P3-1/F2 已交付：A2A 对外面默认关、`A2A_*` 环境变量）
> **口径**：下列 `file:line` 为 **2026-10-06 实测**。

---

## 0. 一句话

A2A 实现是 **v0.3.0 命名**（`/.well-known/agent.json` · `A2ATaskState` kebab-case · `A2A_METHODS` = `message/send` 式绑定名）；v1.0 已把这些**破坏性改名**。本批只做**命名对齐**（3 处），**不**新增 JSON-RPC 分发/流式等能力。

---

## 1. 取证（2026-10-06）

| # | 面 | v1.0.0 权威值 | Liri 现状 | 结论 |
|:--:|---|---|---|---|
| 1 | 发现路径 | `/.well-known/**agent-card.json**`（RFC 8615） | `/.well-known/agent.json`（`a2a-routes.ts:44`） | ❌ **不符** ⇒ **T1** |
| 6 | TaskState | `TASK_STATE_*`（**SCREAMING_SNAKE**，ProtoJSON；含 `UNSPECIFIED`(0) / `AUTH_REQUIRED`(8)） | `types/a2a.ts:78-85` kebab-case 7 值，**缺** `unspecified` / `auth-required` | ❌ **不符** ⇒ **T2** |
| 5 | 方法命名 | 抽象操作名 = **PascalCase**（`SendMessage`/`GetTask`/`CancelTask`…） | `types/a2a.ts:199-206` 的 `A2A_METHODS` **值**为 `message/send`/`tasks/get`/`tasks/cancel`（v0.3 绑定名） | ❌ **不符** ⇒ **T3** |
| 4 | 抽象操作数 | 11 个 | 仅 3 个（Send/Get/Cancel） | ⏸ **T4**（需实现，非改名） |
| 9 | 流式 SSE | `capabilities.streaming:true` + `SendStreamingMessage` | 无；卡片**如实** `streaming:false` | ⏸ **T4** |

**⚠️ note 的行号已失效（如实）**：`a2a-protocol.md` §7 引用的 `a2a.ts:78-85` / `a2a.ts:199-223` / `a2a-routes.ts:44` —— 前两者现位于 **`app/src/types/a2a.ts`**（`a2a/` 目录下已无 `a2a.ts`，仅 `types.ts`/`taskStore.ts`/`agentCard.ts`）；`a2a-routes.ts:44` **仍准确**。

**CS01 归一化**：全仓仅 `types/a2a.ts` · `agent/a2a/taskStore.ts` · `agent/index.ts`（再导出）· `runtime/api/a2aPorts.ts`（类型引用）· `a2a-routes.ts` · `route-table.ts`（注释）· `tests/http/a2aRoutes.test.ts` 涉及 ⇒ 影响面**封闭**，**无客户端引用**。

---

## 2. 目标 / 非目标

**目标**
- **G1（T1）**：发现路径改为 **`/.well-known/agent-card.json`**（含注释与测试常量）。
- **G2（T2）**：`A2ATaskState` 改为 **9 个 `TASK_STATE_*`**（补齐 `UNSPECIFIED` / `AUTH_REQUIRED`）；`A2A_TERMINAL_STATES` 同步（**不含** `AUTH_REQUIRED`：它是**中断态**）；使用点 `taskStore.ts` 同步。
- **G3（T3）**：`A2A_METHODS` 的**值**改为 v1.0 PascalCase 抽象操作名；`A2A_METHOD_ALIASES` 的**键**随之校正（保留 v0.3 绑定名作迁移别名）。

**非目标**
- **N1** 不实现 JSON-RPC 分发（当前路由为 REST 形态）—— T4。
- **N2** 不实现 SSE 流式、`ListTasks`、`SubscribeToTask`、推送配置、`GetExtendedAgentCard` —— T4。
- **N3** 不改 `capabilities`（`streaming:false` **如实**）；不改 `A2A_*` 环境变量与默认关闭策略。
- **N4** 不加向后兼容层（§1.3：无正式用户 ⇒ 旧路径/旧枚举**不保留**）。

---

## 3. 设计

### 3.1 T1 发现路径
`WELL_KNOWN_AGENT_JSON = '/.well-known/agent-card.json'`（**常量名同批改为 `WELL_KNOWN_AGENT_CARD`**，避免名实不符）。

### 3.2 T2 TaskState（v1.0 §5.1 全 9 值）
```
TASK_STATE_UNSPECIFIED(0) · SUBMITTED(1) · WORKING(2) · COMPLETED(3,终) · FAILED(4,终)
CANCELED(5,终) · INPUT_REQUIRED(6,中断) · REJECTED(7,终) · AUTH_REQUIRED(8,中断)
```
`A2A_TERMINAL_STATES = [COMPLETED, CANCELED, FAILED, REJECTED]`（不变的口径，仅改名）。

### 3.3 T3 方法名
```ts
export const A2A_METHODS = {
  SendMessage: 'SendMessage',
  GetTask: 'GetTask',
  CancelTask: 'CancelTask',
} as const;
```
别名表：canonical = 上表值；别名 = v0.3 绑定名（`message/send`、`tasks/get`、`tasks/cancel`）+ 早期 `tasks/send`。

---

## 4. 决策点

| ID | 决策项 | 选项 | 采纳 |
|:--:|---|---|---|
| **D1** | 旧路径/旧枚举是否保留兼容 | (a) **全换、不保留**／(b) 双路径并存 | **(a)** —— §1.3 无正式用户；A2A 默认关 |
| **D2** | 是否本批实现 JSON-RPC 分发 + SSE | (a) 是／(b) **否（T4 待裁定）** | **(b)** —— 属**新能力**（11 操作 + 事件流 + 扩展卡），非"命名对齐"；且无对端可验 |
| **D3** | `A2A_METHODS` 值是否改 PascalCase | (a) **改（值是抽象操作名）**／(b) 留绑定名 | **(a)** —— v1.0 §4.2/§9.3：JSON-RPC `method` 即抽象操作名 |

---

## 5. 任务分解

| # | 步骤 | 状态 |
|:--:|---|---|
| **T1** | `a2a-routes.ts` 路径 + 注释；`route-table.ts` 注释；`tests/http/a2aRoutes.test.ts` 常量 | ✅ 已实施 |
| **T2** | `types/a2a.ts` 枚举 + 终态；`taskStore.ts` 状态字面量 | ✅ 已实施 |
| **T3** | `types/a2a.ts` `A2A_METHODS` + 别名表 + 注释 | ✅ 已实施 |
| **T4** | JSON-RPC 分发（11 操作）/ SSE / 扩展卡 / 能力协商 | ⏸ **待裁定** |

---

## 6. 验收（T1–T3，可证伪）

1. `bun run typecheck` → **0**（枚举改名若漏改使用点会**编译失败**，此为强约束）；
2. `bun run lint:arch` → **错误 0**（警告回基线）；
3. 定向 `bun test tests/http/a2aRoutes.test.ts` → **0 fail**（路径改名后用例须通过）；
4. **无残留旧命名**：`grep -n "well-known/agent.json"` 与 `grep -n "'submitted'\\|'input-required'" app/src/types/a2a.ts` → **0 命中**；
5. 全量 `bun test` → **0 fail**（当前基线：**4644 pass / 21 skip / 0 fail / 4665 tests / 492 files**）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| **GR15** Spec-Driven | ✅ API 变更先 spec；D1–D3 已采纳 |
| **GR01** 复用 | ✅ 只改既有常量/类型，**不新增**模块 |
| **CS01** 归一化 | ✅ 影响面已全仓 grep 封闭（§1 末） |
| **CS03** 回退最小化 | ✅ **不加**旧路径/旧枚举兼容层（D1=a，符合 §1.3） |
| **CS06** 证据驱动 | ✅ 逐项对 note §7 对照表；**并如实标注 note 行号已失效** |
| **R12-001** | ✅ 不涉 `baseline.json` |

---

## 8. 未取证（如实）

| # | 项 | 说明 |
|:--:|---|---|
| **U1** | 真实对端互操作 | 无 A2A 对端可测；本批只做命名对齐，**未验证**与 v1.0 客户端互通 |
| **U2** | `TASK_STATE_UNSPECIFIED` 的线上语义 | Liri 不会产生该值（无"未知"来源）—— 保留以对齐枚举，**未被运行时使用** |
| **U3** | note 其它行号 | §7 表其余行的 `file:line` **未逐条复核** |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项 + T1–T3 实施** | 用户「继续处理 A4、A5 与 A6」⇒ 发现路径 `agent-card.json` · TaskState 9 值 `TASK_STATE_*` · `A2A_METHODS` 值改 PascalCase；**T4 待裁定**（D2=b）。验证见 §6 |
| 2026-10-06 | **编译期强制实证** | 枚举改名后 `typecheck` **精确报出 4 处残留状态字面量**（`taskStore.ts:112`、`a2a-routes.ts:277/285/297`）⇒ 全部修正；并同批改 **3 处测试断言**（`'completed'`×2 / `'working'`×1）。**这正验证了 §6-1 的强约束设计**（漏改即编译失败） |
| 2026-10-06 | **验证（四证）** | `typecheck` **0** · `eslint`（6 文件）**0** · `lint:arch` **错误 0 / 警告 4（基线）**、分层 **3886 不变** · 定向 `tests/http/a2aRoutes.test.ts` **11 pass / 0 fail** · 全量 **4644 pass / 21 skip / 0 fail**（4665 tests / 492 files，与基线**逐数一致** ⇒ 仅改取值、未增用例） |
