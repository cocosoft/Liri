# 事件名单一事实源下沉 `shared/`（消除 app / client 手写镜像漂移）

> 状态：**已实施**（2026-09-30；实现、门禁升级、双端 typecheck 与全量测试均已完成，实测见 §5）
> 创建：2026-09-30 | 触发：`architecture-benchmark-20260928.md` §5.3 落地的第一刀（**只下沉事件名**）
> 关联：**台账 D-56**（§5.3 前提已过时的更正取证）/ **D-53**（事件类型双端奇偶门禁，本次被升级）/ **D-1**（client 镜像落后 5 类型的漂移实证）
> 关联规则：**GR01**（基础设施复用）/ **GR16-002**（跨模块变更须建 Spec）/ **CS01**（归一化，不新造）/ **CS06**（证据驱动）/ **R02**（数据模型统一）/ **R06-008**（分层）/ `project_rules` §1.6（模型可见 ⇔ 已落盘：事件类型三处同步不破坏）/ §1.3（无正式用户 ⇒ 无向后兼容负担）

> ✅ **台账条目已回写（2026-09-30 复核订正）**：本变更对应台账 [**D-57**](../../dev_docs/error_repairs/预存错误与待处理问题.md)（「§5.3 单一事实源**落地** —— 事件名下沉 `shared/`，两端派生」）。
> 本行原写"截至本 spec 创建时台账尚无 D-57 条目 ⇒ 悬空引用待回写"，**该标注已过时**：复核确认 D-57 **已存在**，代码注释中的引用**不再悬空**。§6 L1 与 §8 任务 7 已同步订正。

---

## §0 修订记录

| 版本 | 变更 | 依据 |
|---|---|---|
| v1（2026-09-30） | 初稿 + 实施：单源 `shared/events/eventNames.ts`（**44** 项）、两端派生、门禁升级为三端一致性 | 逐字面量抽取 + PowerShell 复核（§1.4）；`typecheck` 双端 0、全量测试零回归 |

---

## §1 背景与问题

### 1.1 问题一：双端手写镜像，且**已实证漂移**（D-1）

| 端 | 文件 | 原状 |
|---|---|---|
| app | `app/src/chat/types/events.ts:35-105` | `LiriEventType` 联合，**手写 44 个名字** |
| client | `client/src/types/events.ts:33-87` | `LiriEventType` 联合，**手写镜像 44 个名字** |

client 文件头原文：「前端不直接 import 后端类型，按 client/types 约定镜像一份。**双端结构必须保持一致**，新增事件类型时双端同步。」——**该约定此前无任何机制保证**，2026-09-28 曾**实证** client 落后 5 个类型（`goal/*` ×4 + `agent/recovery`，台账 D-1，由 D-53 门禁抓出）。

### 1.2 问题二：§5.3 的**前提已过时**（台账 D-56 更正）

`architecture-benchmark-20260928.md` §5.3 原文称：`shared/`「**只有 `client` 在用**（`@shared/types` 3 处命中；`app` **零引用**）⇒ 名为 shared，实为"前端专用"」。

**实测更正（D-56）**：

- `shared/` 位于**仓库根**（中性位置，非"前端目录"）；
- **两端别名均已配**：`app/tsconfig.json:156` `"@shared/*": ["../../shared/*"]`；`client/tsconfig.json:21` `"@shared/*": ["../shared/*"]`；`client/vite.config.ts:22` `"@shared"`（**运行时别名**，值导入必需）；
- **`app` 已有真实引用**：`app/src/ink/repl/StatusFloatingBar.tsx:11`（`@shared/utils`，值导入）、`app/src/session/storage/EventMessageDeriver.ts:38`、`app/src/runtime/api/CoreAPIImpl.ts:132`（`STATUS_TYPE` 值导入）、`app/src/services/voice/models/types.ts:132`；
- **部署侧已支持**：`app/docker/Dockerfile:49-50` `COPY shared/ /shared/`（与 `app/tsconfig.json` 的 `baseUrl: ./src` + `../../shared/*` ⇒ `/shared/*` 对齐）。

⇒ 「事件名下沉 `shared/`」是**已有先例的复用**（先例 spec：`.trae/specs/chat-status-type-contract.md`，同类下沉），**无需新建基础设施**。

### 1.3 问题三：D-53 门禁的**口径缺口**（42 ≠ 44）

`app/tests/chat/eventTypeParity.test.ts` 原正则 `^\s*\|\s*['"]([a-z_]+(?:\/[a-z_]+)+)['"]` 中，`[a-z_]+` **不含连字符 `-`** ⇒ 静默漏掉 2 个名字：

- `assistant/text-batch`
- `context/model-input`

即原门禁实际只覆盖 **42/44**（任务书中"42 个"的成因即此）。此外，该门禁**只比对"两端联合"**——而本轮改造后两端联合**由构造同源**（不再各自手写），继续比对联合将变得无意义；同时它**会在新结构下直接失效**（见 §4 风险 R3），因此必须升级。

### 1.4 现状取证（本轮实测）

**抽取口径**：取 `LiriEventType` 联合块（`export type LiriEventType =` 至其后首个 `;`），逐字面量列出。

| 项 | 实测 |
|---|---|
| 后端联合成员 **N** | **44**（`app/src/chat/types/events.ts:37-105`） |
| 客户端联合成员 | **44**（`client/src/types/events.ts:34-87`），与后端**集合完全相同** |
| **不含 `/` 的成员** | **无**（两侧均为空集） |
| 重复成员 | 0 |
| 复核方式 | PowerShell：按 `;` 截取联合块后正则提取 ⇒ 两侧各 44、`Compare-Object` diff 为空；`Select-String "^\s*\|\s*'"` 命中 **50** 行 = 44 联合成员（37-105）+ 6 个 `LiriEventCategory` 成员（168-173）⇒ **与行数一致** |

---

## §2 目标与非目标

### 2.1 目标

1. 事件名**单一事实源**下沉到 `shared/events/eventNames.ts`（`LIRI_EVENT_NAMES as const` + `LiriEventName`）；
2. 两端 `LiriEventType` **由该清单派生**（`(typeof LIRI_EVENT_NAMES)[number]`），成员集合**逐字不变**；
3. 门禁升级为**三端一致性**（shared 清单 ⟷ 两端载荷映射），并**修掉 42/44 的口径缺口**。

### 2.2 非目标（明确不做）

| 不做 | 理由 |
|---|---|
| **载荷（`LiriEventMap` / 客户端 `LiriEventMap`）下沉 shared** | 后端载荷**引用后端领域类型**（`TaskGoalStatus`、`MermaidLintIssue`、`DataAttachment` 等）⇒ 下沉会把后端领域类型拖进 shared，制造分层倒挂（CS01/R06-008） |
| **ACP / A2A 协议类型下沉** | 协议契约（`app/src/acp/*`、A2A 对外面）与"会话事件名"不是同一契约域，混入会扩大面 |
| `TaskGoalStatus` / `TaskGoalUpdateReason` / `GoalTemplateKind` 三个联合的下沉 | 它们是**载荷引用类型**（非事件名），client 侧注释已标注其"治标"性质（`client/src/types/events.ts:40-48`）；本次不动（P2 项） |
| 改任何载荷字段 / 事件信封 / 分类函数 | 与"名字单源"无关（PY_APP §3 外科手术式修改） |
| 新增 `shared/events/index.ts` barrel | 无必要；且更贴近门禁 `R07-003`（薄桶）的意图 —— 直指具体文件导入 |
| 改 wire 字段、事件 schema、Docker/别名配置 | 均已就绪（§1.2），无收益变更 |

---

## §3 方案

### 3.1 单源（新增 1 文件）

`shared/events/eventNames.ts`：

```ts
export const LIRI_EVENT_NAMES = [
  // ─── 对话核心 ───
  'turn/start',
  /* … 共 44 项，保持后端原文顺序与原分组注释 … */
  'assistant/code_run',
] as const;

export type LiriEventName = (typeof LIRI_EVENT_NAMES)[number];
```

- **顺序**：保持后端原文顺序，原分组注释（含 `F-2` / `TR-12-B` / `B2-2` / `B4-1` / `CM-5` 等逐条标注）随清单移入本文件各项旁；
- **风格**：单引号字符串（对齐后端文件风格）；中文注释。

### 3.2 两端派生（各自 3 处改动）

| 端 | 改动 |
|---|---|
| app | `+ import { LIRI_EVENT_NAMES } from '@shared/events/eventNames';`；`export type LiriEventType = (typeof LIRI_EVENT_NAMES)[number];`（原 44 行联合删除，文档注释改为指向单源 + 保留"三处同步"说明） |
| client | `+ import { LIRI_EVENT_NAMES } from "@shared/events/eventNames";`；同上派生；文件头"手写镜像"段改写为"单源派生" |

两端**载荷映射、`LiriEvent<T>`、`categorizeEvent`、`isLiriEvent`、分类联合**一律不动。

### 3.3 门禁升级（`app/tests/chat/eventTypeParity.test.ts`）

| 项 | 旧 | 新 |
|---|---|---|
| 比对对象 | 后端联合 ⟷ client 联合（文本行） | **shared 清单 ⟷ 两端载荷映射顶层键**（三端） |
| 名字口径 | `[a-z_]+(?:\/[a-z_]+)+`（漏 `-`，42/44） | `^ {2}['"]([a-z][a-z0-9_/-]*)['"]\s*:`（**含 `-`，44/44**）+ 只取**行首 2 空格缩进的顶层键/数组项**（避免误抓载荷内部的字符串值） |
| 断言 | 双向子集（漏/多） | 3 条：①三处均 >30（防空跑假绿）；②shared ⊆ 两端载荷；③两端载荷 ⊆ shared（禁单端自发增长） |

### 3.4 为什么"名字单源 + 载荷自持"足够

`LiriEventType` 既是**事件名清单**，又是 `LiriEventMap` 的**索引约束**（`LiriEvent<T>.data: LiriEventMap[T]`）：

- shared 清单**多**出一个名字 ⇒ 两端载荷缺该键 ⇒ **`typecheck` 直接报错**；
- shared 清单**少**一个名字（而某端生产者/载荷仍在用）⇒ 该端 `typecheck` 报错；
- 两端联合**不再可能漂移**（同一 `const` 派生，构造上同源）。

⇒ "名字"由**编译期**强制，"载荷内容"仍各端自持 —— 这正是 §2.2 非目标所依赖的分工。

---

## §4 兼容性与风险

| # | 风险 | 处置 / 实测 |
|---|---|---|
| R1 | **映射类型自检**：清单与某端载荷不一致 ⇒ 编译失败 | 已实测：`bun run typecheck` 双端 **0**（§5）。这正是本次的自检手段，非风险 |
| R2 | **client 构建路径**：值导入在 vite 下需运行时别名 | ① `client/vite.config.ts:22` `@shared` 别名已在（先例 spec 补）；② 本处导入**仅用于类型位置**（`typeof`）⇒ 转译后擦除，不产生运行时依赖；③ `tsc --noEmit` 通过（类型层解析 OK） |
| R3 | **旧门禁在新结构下假绿/失效**：后端文件不再含 `| 'name'` 联合行 ⇒ `extractEventNames(BACKEND)` 返回空集 ⇒ 原"两侧 >30（防空跑假绿）"断言**必然失败** | 已按 §3.3 升级；升级后三处各 44，门禁 3 用例全通过 |
| R4 | **Docker/部署**：新文件是否随镜像分发 | `app/docker/Dockerfile:49-50` `COPY shared/ /shared/` **整目录复制** ⇒ 新文件自动包含，**无需改 Dockerfile** |
| R5 | **app 运行时解析**：`@shared/events/eventNames` 是否可解析 | app 侧 `@shared/*` 运行时解析**已有既证**（`CoreAPIImpl.ts:132` 值导入 `@shared/types`，被全量测试覆盖）⇒ 同别名同目录，无新风险 |
| R6 | 门禁文本口径脆弱（依赖缩进 2 空格） | 可接受的**冗余**守卫：主强制手段是 §3.4 的**编译期**；门禁只做二层文本校验，且断言了"三处均 >30"防静默退化 |
| R7 | `client/src/types/events.ts` 未跑 `prettier --write` | **有意跳过**：client 无 prettier 配置与 format 脚本；实测**原始文件在默认配置下 `--check` 即失败**（`ORIG_CLIENT_EXIT=1`，存在大量存量风格差异）⇒ 强跑会重排无关行（违反外科手术式修改）。新增行已对齐文件既有风格（双引号 / 2 空格 / 单行） |
| R8 | `shared/events/eventNames.ts` 未跑 `prettier --write` | 同上：`shared/` 无 prettier 配置，默认风格为**双引号**，会与"对齐后端单引号风格"的要求冲突 ⇒ 跳过（任务已允许） |

---

## §5 验收证据（实测）

| 验收项 | 命令 | 结果 |
|---|---|---|
| app 类型检查 | `cd app; bun run typecheck` | **exit 0** |
| client 类型检查 | `cd client; bun run typecheck`（`tsc --noEmit`） | **exit 0** |
| 门禁 + chat 域测试 | `cd app; bun test tests/chat` | **335 pass / 0 fail**（56 文件，18.95s） |
| 全量测试 | `cd app; bun test` | **4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件，101.25s，exit 0） |
| 架构门禁 | `bun run scripts/lint-architecture.ts` | **错误 0 / 警告 1**（唯一警告为**预存** `R07-004 REF 参考副本目录`，与本次无关）· 违规 **0** / 已豁免 **463** · 分层检查 3957 文件 |
| 格式（app 侧改动文件） | `cd app; bunx prettier --write src/chat/types/events.ts tests/chat/eventTypeParity.test.ts` | `--check` 通过（`All matched files use Prettier code style!`） |
| 抽取复核 | PowerShell 截取联合块 + `Select-String` 行数交叉校验 | 两侧各 **44**；`|'…'` 行 50 = 44 + 6（分类成员） |

**用例数一致性**：本轮全量为 4272 用例 —— 门禁升级**未增删用例**（仍为 3 条 `test`），仅替换了断言对象与提取正则 ⇒ 与改动前一致。

---

## §6 未覆盖 / 遗留

| # | 遗留 | 说明 |
|---|---|---|
| L1 | ~~**台账 D-57 尚未回写**~~ ✅ **已回写** | 2026-09-30 复核确认：台账 [D-57](file:///e:/PY/Documents/CODES/PY_APP/dev_docs/error_repairs/预存错误与待处理问题.md#L6400) **已存在** ⇒ 4 个改动文件的注释引用**不再悬空**。本行原标注系**过时**，随本次复核订正 |
| L2 | **载荷形状仍未校验** | 本次只统一**名字**。两端载荷字段是否逐字一致（如 `assistant/status`、`assistant/doc_workflow` 类富块）仍只能靠人工 —— 载荷下沉被列为非目标（§2.2） |
| L3 | 三端一致性的"单侧新增"防护 | 若有人**只在 shared 加名字**：两端 `typecheck` 会因载荷缺键报错（强）；若**只在单端载荷加键**：门禁断言 ③ 抓出（中）；若**只在单端生产者写字面量**：该端 `typecheck` 报错（强） |
| L4 | `client/src/types/events.ts` 的 3 个"治标"联合（§2.2） | 仍为手写镜像（`TaskGoalStatus` / `TaskGoalUpdateReason` / `GoalTemplateKind`）⇒ §5.3 的完全落地需另开一刀 |
| L5 | 未跑 client 侧测试（`vitest`） | 本次改动为**类型层等价替换**（联合成员集合逐字不变 + 端到端 `tsc` 通过）；app 侧全量测试已覆盖事件派生链路。如需，可补 `cd client; bun run test` |

---

## §7 合规清单

| 规则 | 落实 |
|---|---|
| **GR01** 基础设施复用 | ✅ 复用既有 `shared/` + 双端 `@shared/*` 别名 + 既有 Docker 复制；**不新造**任何基础设施/目录结构（新文件落在既有 `shared/` 下新增子目录 `events/`） |
| **GR16-002** 跨模块变更须建 Spec | ✅ 本 spec（app ↔ client ↔ shared 三端） |
| **CS01** 归一化 | ✅ 新增前已检索：`shared/` 既有 4 文件与 `@shared/*` 先例（`chat-status-type-contract.md`）；仅新增 1 个名字清单文件，未另起炉灶 |
| **CS06** 证据驱动 | ✅ N=44 逐字面量抽取 + PowerShell 交叉复核；42 vs 44 的成因定位到正则缺 `-`；风险逐条实测（§4/§5） |
| **R02** 数据模型统一 | ✅ 事件名从"双份手写"收敛为**单份**；旧门禁从"比对两份"升级为"校验单份 ⟷ 两端载荷" |
| **R06-008** 分层 | ✅ 方向为 `app`/`client` → `shared`（契约层），无反向依赖；`shared/events/eventNames.ts` **零依赖**（不 import 任何模块） |
| `project_rules` §1.6（模型可见 ⇔ 已落盘） | ✅ **不破坏**三处同步：① `LiriEventType`（现派生）② `LiriEventMap`（索引泛型强制）③ `ALL_SESSION_EVENT_TYPES`（`knownEventTypes.ts` 末尾穷尽断言）。已实测 `typecheck` 0 |
| `project_rules` §1.3 / §1.13 | ✅ 无正式用户 ⇒ 直接改写（不留兼容层）；未新增路径常量、未碰 `paths.ts` |
| PY_APP §2/§3 | ✅ 无投机性扩展（不建 barrel、不下沉载荷）；改动均直接追溯到"消除手写镜像漂移" |

---

## §8 任务状态

| # | 任务 | 状态 |
|:--:|---|:---:|
| 1 | 逐字面量抽取事件名（N=44，含非 `/` 成员核查） | ✅ 完成（两侧各 44、集合相同、无非 `/` 成员、无重复；`Select-String` 行数交叉校验一致） |
| 2 | 新建 `shared/events/eventNames.ts` | ✅ 完成（44 项，中文注释 + 原分组注释，单引号） |
| 3 | app `LiriEventType` 改为派生 | ✅ 完成（`bun run typecheck` exit 0） |
| 4 | client `LiriEventType` 改为派生 | ✅ 完成（`bun run typecheck` exit 0） |
| 5 | 门禁升级为三端一致性 | ✅ 完成（3 用例全过；口径 42 → **44**） |
| 6 | 双端 typecheck + chat 域 + 全量 + lint:arch + prettier（app 侧） | ✅ 完成（见 §5） |
| 7 | 台账 D-57 回写 | ✅ **完成**（2026-09-30 复核：台账 D-57 条目已存在；原「⬜ 未做」系过时标注，已订正） |
