# Spec：事件名/载荷「去 `any` 类型化」专项（立项）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：📋 **立项（待排期；本文件不含产品代码改动）**
> 来源：`CHANGELOG.md` v0.4.70（C2 EventBus 三语义）· `.trae/specs/eventbus-semantics.md` §2-O2 / §7
> 关联规则：**CS01**（归一化）· **CS03**（回退最小化）· **CS06**（证据驱动）· `.trae/specs/boundary-convergence-plan.md` §2-P1-2

---

## 0. 一句话

`EventBus` 的默认泛型是 `any`（`EventListener<T = any>` / `subscribe<T = any>` / `publish<T = any>` / `once<T = any>` / `publishAndWait<T = any>`）⇒ **事件名是裸 `string`、载荷默认 `any`**，事件名拼写错误与载荷字段错误**编译期一律不可查**。去 `any` 需引入「**事件名 → 载荷类型**」全局映射并迁移全部调用点；改动面**破坏性**（`listener(data)` 由 `any` 收窄），故**独立立项、不在小版本夹带**。

## 1. 影响面口径复核（CS06：不沿用未复核数字）

- **原口径**：CHANGELOG v0.4.70 记「**39 文件 / 87 处**」（外部评估当时 grep 取证），但**查询串未留档** ⇒ 无法精确重放。
- **本轮复核（2026-10-10）**，以「核心总线 `globalEventBus` 直连调用点」为**可复现口径**：

| 口径 | 命令 | 实测 |
|---|---|---|
| 核心总线（基线） | `git grep -o -E 'globalEventBus\.' -- app/src` | **84 处 / 36 文件** |
| 上界（含非核心总线 / EventEmitter，须逐点甄别） | `git grep -o -E '\.(publish\|publishAndWait\|subscribe\|once)\(' -- app` | **203 处 / 90 文件** |
| 客户端 | 同基线口径 `-- client` | **8 处 / 6 文件**（`globalEventBus` 在 `client` 为 **0**，前端走自身事件层） |

- **结论**：与 39/87 **同量级**（差异源于原口径含混 + 一日内 v0.4.75/v0.4.76 变更）；本 spec 以**本轮可复现口径为基线**，数字为**快照**，排期时须**再测**（不沿用本数字）。

### 1.1 基线口径的域分布（`app/src`，改动面清单）

| 域 | 处 | 域 | 处 |
|---|:--:|---|:--:|
| `core`（内核，含 `core/events`） | 22 | `config` · `buddy` · `infrastructure` · `monitoring` · `dream` | 各 3 |
| `tools` | 9 | `cost` · `entrypoints` | 各 2 |
| `channels` | 7 | `analytics` · `plugins` · `session` · `subagents` · `tasks` · `chronos` | 各 1 |
| `agent` · `workspace` | 各 6 | — | — |
| `daemon` | 5 | **合计** | **84 / 36 文件** |
| `knowledge` | 4 | — | — |

## 2. 破坏性说明（为何不能顺手改）

- 默认泛型 `any → unknown`（或具体类型）后，所有 `listener(data)` 体内对 `data` 的**裸字段访问**立即 `TS2339` —— 这是**有意的**：强制每个消费点显式声明期望载荷类型。
- 类型安全版本 `TypedEventBus<T extends Record<string, unknown>>` **已存在**（`app/src/core/events/EventBus.ts`）但**零消费者**（全仓仅定义 + 1 处文档注释提及）⇒ 迁移目标是**接线 `TypedEventBus<T>`**，**不新造抽象**（CS01/CS03）。

## 3. 分批顺序（每批可独立编译 + 独立提交）

| 批 | 面 | 内容 | 验证 |
|---|---|---|---|
| **S1** | `core/events` 内核 | 落地「事件名 → 载荷」类型表（与 `SystemEvents` 常量对偶）+ 收紧总线默认泛型 | `typecheck` 0 · `tests/core/EventBusSemantics.test.ts` 不回归 |
| **S2** | `channels/*` + `channels/events/*` 桥接 | 渠道事件名/载荷类型化（含 `setupEventBridges` 桥接面） | 渠道用例 + 桥接契约 |
| **S3** | `session/*` · `tasks/*` · `agent/*` · `workspace/*` · `daemon/*` | 域服务事件载荷类型化 | 对应域用例 |
| **S4** | `monitoring/*` · `analytics/*` · `cost/*` · `dream/*` · `knowledge/*` | 观测/成本/记忆事件类型化 | 对应域用例 |
| **S5** | `client/*` + `tools/*` + 长尾 | 前端事件层与剩余调用点 | `client` typecheck + 构建 |

- 每批**只改类型与调用点签名**，**不改运行期行为**（零行为变更）；发现「载荷实际形态与类型不符」时**单独登记**，不动逻辑（CS05 根因另行）。
- 顺序按**被依赖度**：S1 先落地类型表，后续批才能引用其事件名→载荷映射。

## 4. 收益（编译期穷尽断言）

- 事件名 `string` → **字面量联合** ⇒ 拼错事件名 = **编译错误**（现状为静默"发布到没人听的通道"）。
- 载荷 `any` → **具体类型** ⇒ 字段错/漏 = **编译错误**，并**阻断 `any` 传播**。
- 「事件名 → 载荷表」成为**单一事实源**，与 `SystemEvents` 对偶 ⇒ 新增事件必须同时补类型（否则 `TypedEventBus<T>` 编译失败），消除双源漂移。

## 5. 不做项 / 触发条件

- ❌ **不在任何小版本夹带**（破坏性，见 §2）。
- ❌ **不新造总线抽象**（`TypedEventBus<T>` 已在；CS01/CS03）。
- ❌ **不借机改事件语义/顺序**（`eventbus-semantics.md` 已冻结三语义；本专项**只动类型**）。
- **触发条件**：排期「类型安全专项」时；或出现「事件名拼写错 / 载荷字段错」导致的**用户可见缺陷**时（即时升优先级）。
- **验收**：全部批次落地后 `typecheck` 0，且总线 API 默认泛型**不再为 `any`**；`.trae/specs/eventbus-semantics.md` §2-O2 由「真缺陷（大改动）」改为「已收口」。