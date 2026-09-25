# Spec：系统侧中止标记加固（reason 可定位 + 判定收敛）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**已实施（2026-09-25，见 §6.5；含 2 处如实偏差）**
> 来源：`dev_docs/error_repairs/last-exit-20260925-0154Z.md` §7 **建议 ②**（用户裁定「按建议②先出 spec」）
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ CS02（状态判据）/ CS03（回退最小化）/ CS05（根因优先）/ R02（数据模型统一）
> 前置：建议 ① 已实施（`isAbortReason()` 判据收敛，见同文档 §7.1）—— 本项**不重开 ① 的语义**
> 用户裁定：**先出 spec，经批准后实施**

---

## 1. Problem Statement

### 1.1 现状（带证据）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 系统侧中止的标记是**裸字符串** `'liri:system-abort'` | [ReActLoop.ts:120](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L113-L120) `export const SYSTEM_ABORT_REASON = 'liri:system-abort'` |
| 2 | 因此该 reason 外泄为 rejection 时**不带任何栈** —— 事后无法定位"谁没 catch" | 实测 crash dump `crash-2026-09-25T01-54-25-186Z.json`：`"raw": "liri:system-abort"`、`originalType: string`，`stack` **只是记录器自身**（`writeCrashDump` 内 `new Error(String(reason))`，[main.ts:1416](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L1416)）；`app:top` 的 handleError 上下文同样 `{originalType:"string"}` |
| 3 | 系统侧/用户侧的判定**只有一处**，且是**字符串恒等** | [ReActLoop.ts:403-404](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L403-L404) `externalSignal.reason === SYSTEM_ABORT_REASON ? 'system' : 'user'` ⇒ 结果经 [:514](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L514) 产出 `system_aborted` |
| 4 | 写入点 **2 处**（都传字符串常量） | [ChatManager.ts:413](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L407-L419)（HTTP `req.on('close')` 断线）、[SessionLifecycleManager.ts:555](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/SessionLifecycleManager.ts#L549-L556)（会话删除的清理性中止） |
| 5 | 判定结果进入**闭集**语义：`AbortSource = 'user' \| 'system'` → `TerminationReason` 的 `aborted` / `system_aborted` | [ReActLoop.ts:111](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L110-L111)、[:484](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L480-L484)；Goal 侧同族枚举见 `TaskGoalStore.ts:82`、`goalRunBinding.ts:263` |
| 6 | **关键**：所有派生文案都取 `.message`，而非整体字符串化 | [OpenAIProvider.ts:568](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OpenAIProvider.ts#L566-L575) `const errorMessage = (error as Error).message \|\| String(error)`；[BaseAIProvider.ts:1012](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/BaseAIProvider.ts#L1011-L1015)；[ExitRecorder.ts:181](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/exit/ExitRecorder.ts#L177-L183) `reason instanceof Error ? reason.message : String(reason)` ⇒ **若 reason 为 Error 且 `message === 常量`，这些文案逐字不变** |

### 1.2 为什么要做（与 ① 的关系）

① 让"这类外泄**不再被误报**"（分类层已修）；但 **③ 根因仍未定位**，而定位的唯一障碍就是 §1.1-2：**reason 无栈**。② 的目标 = **让下次同类外泄自带抛出点**，使 ③ 从"无法定位"变为"下一次发生即可定位"。

> 换句话说：① 是止血，② 是给下一次事故装上黑匣子。若不装，同类外泄永远只能看到"记录器自己的栈"。

### 1.3 风险（本 spec 要解决的核心）

`SYSTEM_ABORT_REASON` 是**唯一标记**，且判定是**字符串恒等**：一旦改动 reason 的形态而不收敛判定，**Goal 会被记成 `user_aborted`**（把"系统中止"说成"用户主动放弃"），并在 `TerminationReason` 上同理错位。故"改形态"与"收敛判定"**必须同一批**。

---

## 2. 目标 / 非目标

**目标**

- **G1 可定位**：系统侧中止的 reason 携带**真实抛出点栈**（Error 形态），CPU 与内存开销可忽略。
- **G2 判定收敛**：把"是否**系统侧**中止"收敛为**单一判定函数** `isSystemAbortReason(reason)`，与常量同文件导出；`ReActLoop` 的 system/user 判定改走它。
- **G3 反向兼容**：**字符串形态仍被识别**（既有调用/测试/cmd 脚本可继续 `abort(SYSTEM_ABORT_REASON)`）；既有用例 [reactToolLoop-termination-o2.test.ts:182](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/reactToolLoop-termination-o2.test.ts#L176-L190)（字符串 ⇒ `system_aborted`）**零改仍绿**。
- **G4 与 ① 严格分工**（**本项最容易做错的地方**）：
  - `isAbortReason(reason)`（①）＝ **预期中断**（广义，含 AbortError 形态）
  - `isSystemAbortReason(reason)`（②）＝ **系统侧标记**（狭义）
  - 用户主动停止也是 AbortError ⇒ **绝不可**被 `isSystemAbortReason` 命中（否则 Goal 错落 `system_aborted`）。
- **G5 文案稳定**：凡走 `.message` 的派生文案（provider `AppError` 消息、`last-exit.json.message`、`流式读取异常`）**逐字不变**（依据 §1.1-6）。

**非目标（明确不做）**

- **N1**：不改 `AbortSource` / `TerminationReason` / Goal 状态**枚举**（形态变更不涉契约枚举）。
- **N2**：不改 ① 的 `isAbortReason` 语义与既有用例；不在本项重开"预期中断"口径。
- **N3**：不做字符串包含式宽松匹配（如 `includes('abort')`）——那是**反向漏判**。
- **N4**：不加 UI/文案、不加事件类型/表/端点。
- **N5**：**不试图在本项内定位 ③ 的外泄链路**（无复现证据；② 只是为 ③ 提供条件）。
- **N6**：不改 `OpenAIProvider` 的重试判定（`isTimeout/isSocketClosed/isSSLError` 正则跑在 `.message` 上，形态变更不影响其匹配结果）。

---

## 3. 设计

### 3.1 标记形态（方案 A，建议采用）

```ts
/** 系统侧中止标记（二期 O2-1）：**值不变** —— 它是消息文本、跨边界兼容与判定的锚点 */
export const SYSTEM_ABORT_REASON = 'liri:system-abort';

/**
 * 系统侧中止错误（② 加固）：`abort(createSystemAbortReason())` 时，
 * `signal.reason` / 外泄的 rejection reason 都是**带栈的 Error**。
 *
 * - `name = 'AbortError'` ⇒ 已被 ① 的 `isAbortReason()` 判为预期中断（无需改 ①）
 * - `message = SYSTEM_ABORT_REASON` ⇒ 所有取 `.message` 的派生文案**逐字不变**（G5）
 */
export class SystemAbortError extends Error {
  constructor() {
    super(SYSTEM_ABORT_REASON);
    this.name = 'AbortError';
  }
}

/** 每次中止**新实例**（禁止共享单例：共享会让所有栈都指向模块加载点，等于没有栈） */
export function createSystemAbortReason(): SystemAbortError {
  return new SystemAbortError();
}

/** 是否**系统侧**中止（狭义；与 ① 的 `isAbortReason` 广义口径**分开**） */
export function isSystemAbortReason(reason: unknown): boolean {
  if (reason instanceof SystemAbortError) return true;              // 主路径（品牌类）
  if (reason === SYSTEM_ABORT_REASON) return true;                  // 兼容：裸字符串（既有调用/测试）
  if (reason instanceof Error && reason.message === SYSTEM_ABORT_REASON) return true; // 跨边界/序列化还原
  return false;
}
```

### 3.2 收敛点与写入点

| 位置 | 现状 | 改为 |
|---|---|---|
| [ReActLoop.ts:403-404](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L403-L404) | `externalSignal.reason === SYSTEM_ABORT_REASON ? 'system' : 'user'` | `isSystemAbortReason(externalSignal.reason) ? 'system' : 'user'` |
| [ChatManager.ts:413](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L413) | `controller.abort(SYSTEM_ABORT_REASON)` | `controller.abort(createSystemAbortReason())` |
| [SessionLifecycleManager.ts:555](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/SessionLifecycleManager.ts#L555) | `pendingAbort.abort(SYSTEM_ABORT_REASON)` | `pendingAbort.abort(createSystemAbortReason())` |
| [query/index.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/index.ts#L26-L31) | 导出 `SYSTEM_ABORT_REASON` | 追加导出 `SystemAbortError` / `createSystemAbortReason` / `isSystemAbortReason` |

`AbortSource` 类型、`TerminationReason` 产出、Goal 落库**零改动**（判定结果仍是 `'system'`）。

### 3.3 不做的替代方案（对照，含否决理由）

| 方案 | 否决理由 |
|---|---|
| B：只把常量改成对象/类实例（`SYSTEM_ABORT_REASON = new SystemAbortError()`） | ❌ 与现有 `=== SYSTEM_ABORT_REASON`（字符串）语义冲突；**单例共享栈**会把所有中止的栈都指向模块加载点 ⇒ 等于没有栈 |
| C：直接 `Object.assign(new Error(msg), { name: 'AbortError' })`，不建品牌类 | ⚠️ 可行但判定只能靠 `message` 字符串（CS02 取向不佳）；建类后可用 `instanceof` 做**结构无关**的显式标记（与二期 O2-1 注释"用显式标记而非字符串推断"同向） |
| D：reason 保持字符串，只在 abort 站点补一条"记栈"日志 | ❌ 不解决"下游外泄无栈"（外泄点 ≠ abort 站点；③ 的难点正是不知道是**谁**在 abort 之后没 catch） |
| E：把 reason 改成 `DOMException('…','AbortError')` | ⚠️ 也能被 ① 识别，但**无法携带我们的标记**（`instanceof` 判定系统/用户需另加品牌或查 `message`）；且 `DOMException` 在部分环境构造签名不一致 ⇒ 选 `Error` 子类更稳 |

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | **保留字符串兼容**（`isSystemAbortReason` 仍认裸字符串） | 既有测试/调用直接传常量；零改即绿；且外部（插件/渠道）若有同值传参不至于误判为 user |
| D2 | 用 **`Error` 子类 + `name='AbortError'`**（而非纯品牌属性） | 顺带被 ① 的 AbortError 分支兜住；语义上它就是一次 abort |
| D3 | **每次中止新实例**（工厂函数，不用单例） | 单例共享栈 = 无栈（见 §3.3-B） |
| D4 | `message` 严格等于常量 | 保证 G5 文案逐字不变（§1.1-6 的三个派生点） |
| D5 | 是否同批**加一条 INFO 日志**记录"系统侧中止已发出（含站点）" | 可选增强（让 abort 站点本身可观测）；代价是多一条日志。**建议：加**，但要与日志噪声权衡（会话删除/断线均为高频动作） |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/query/ReActLoop.ts` | **改**：新增 `SystemAbortError` / `createSystemAbortReason` / `isSystemAbortReason`；`:404` 改走判定函数 |
| 2 | `app/src/query/index.ts` | **改**：barrel 追加导出 3 个符号 |
| 3 | `app/src/chat/ChatManager.ts` | **改**：`:413` 改用工厂 |
| 4 | `app/src/chat/services/SessionLifecycleManager.ts` | **改**：`:555` 改用工厂 |
| 5 | `app/tests/query/abortReason.test.ts` | **改（扩展）**：新增 `isSystemAbortReason` 组用例（三形态命中 + **反向：用户 AbortError / 普通错误不得命中**） |
| 6 | `app/tests/chat/reactToolLoop-termination-o2.test.ts` | **改**：新增"以 **Error 形态** abort ⇒ 仍 `system_aborted`"用例（既有字符串用例**零改**作为兼容锁） |
| 7 | `.trae/docs/api-spec.md` | **不加**（无 HTTP/IPC 端点变更） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；改动文件 `eslint` 0；`lint:arch` 0 错 0 警 |
| G1 可定位（**核心**） | 单测断言：`createSystemAbortReason().stack` **非空**且**包含调用点**（如 `createSystemAbortReason` / 测试文件行）；且两次调用的实例**不相等**（非单例） |
| G2 判定收敛 | 全仓 `externalSignal.reason === SYSTEM_ABORT_REASON` **0 命中**（改为函数调用）；判定函数有 1 处定义、多处消费 |
| G3 兼容 | 既有 `reactToolLoop-termination-o2` 用例（字符串 ⇒ `system_aborted`）**零改仍绿** |
| G4 分工（**反向断言**） | `isSystemAbortReason(new DOMException('x','AbortError'))` / `isSystemAbortReason(new Error('aborted'))` ⇒ **false**；而 `isAbortReason(同值)` ⇒ true（两者分工不混） |
| G5 文案稳定 | 断言 `String(new SystemAbortError().message) === SYSTEM_ABORT_REASON`；并在 provider 侧用一条轻量断言锁 `.message` 派生链（或代码审查 + 现有用例回归） |
| 突变验证 | ① 把 `:404` 改回字符串恒等 ⇒ "Error 形态 abort ⇒ system_aborted"用例必 red；② 把工厂改成单例 ⇒ "实例不相等"用例必 red |
| 零回归 | 全量 `bun test` 0 fail（基线：**3721 pass / 19 skip / 0 fail**，375 文件） |
| **运行时（可选，尽力而为）** | 若 ③ 的竞态复现成功 ⇒ 崩溃转储的 `stack` 应指向**真实抛出点**（而非 `writeCrashDump`）—— 这是 ② 的最终验收口径；**复现不了则如实标注"未取得运行时证据"** |
| 未做（明确） | ③ 外泄链路定位、④ 数据清理、UI/文案、枚举变更 |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 可定位 | ✅ `createSystemAbortReason()` 返回**带真实调用点栈**的 `Error`（`name='AbortError'`，`message=SYSTEM_ABORT_REASON`，非枚举品牌属性）；**每次新实例**（禁止单例） |
| G2 判定收敛 | ✅ 新增 [`isSystemAbortReason()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L162-L185)（狭义）：品牌属性 / 裸字符串 / 同值 `Error.message` 三形态；[ReActLoop.ts:452-455](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L448-L456) 的 system/user 判定改走它（全仓 `externalSignal.reason === SYSTEM_ABORT_REASON` **0 命中**） |
| G3 兼容 | ✅ 既有用例（字符串 ⇒ `system_aborted`）**零改仍绿** |
| G4 分工 | ✅ 新增反向断言：`DOMException/AbortError` 与 `new Error('aborted')` 在 `isAbortReason` ⇒ true、在 `isSystemAbortReason` ⇒ **false**（用户停止不得落 `system_aborted`） |
| G5 文案稳定 | ✅ `message` 严格等于常量；provider `AppError` / `流式读取异常` / `last-exit.json.message` 取值路径逐字不变 |
| 写入点 | ✅ [ChatManager.ts:416](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L413-L416)、[SessionLifecycleManager.ts:557](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/SessionLifecycleManager.ts#L553-L557) 改传工厂产物；[query/index.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/index.ts#L26-L33) 追加导出 |

**验证**：用例 **14 例**（原 3 例 ① 组 + 新 3 例 ② 组 + `reactToolLoop-termination-o2` 新 2 例）；**突变验证 ×2**：① 判定改回字符串恒等 ⇒ "Error 形态 ⇒ `system_aborted`" **1 例 red**；② 工厂改单例 ⇒ "非单例" **1 例 red**（且失败输出正好印证本 spec §3.3-B —— 单例的 `stack` 指向**模块定义处**，等于无栈）。`typecheck` 0 · 改动文件 `eslint` 0 · `lint:arch` **0 错 0 警** · 全量 **3726 pass / 19 skip / 0 fail**（3745 tests / 375 文件；+5 即本批）。运行时：重启后 daemon 正常、`/health` 200、启动无 error、**无锁残留告警**、`last-abnormal.json` 未重建。

**与 spec 的偏差（2 处，如实）**

1. **§3.1 的 `class SystemAbortError extends Error` 未采用**，改为「**普通 `Error` + 品牌属性**（`unique symbol`，非枚举）+ 工厂」：
   - 直接原因：架构门禁 **R01-002** 以正则匹配"导出类 + 直接继承 `Error`"⇒ 新增 1 条 warning（本仓基线是 0/0，属本批引入）；
   - **不能简单改成 `extends AppError`**：`OpenAIProvider` 有 `if (error instanceof AppError) throw error;` 分支（[OpenAIProvider.ts:567](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OpenAIProvider.ts#L566-L568)）⇒ abort reason 会被**直接上抛**，`OpenAI stream failed: …（Provider: …）` 文案与 `errorRecovery` 的 errorCategory 判定会**一同改变**（真·行为回归）；
   - 品牌属性同样满足 CS02（**显式标记**，非字符串推断），且保留 G1 的栈与 G5 的文案；
   - **附带教训（值得记）**：门禁的正则**连注释里的示例文本也会命中** —— 首版把示例原样写进注释（`export class X extends Error`）导致"自己撞自己"，改为散写措辞后 0 警。
2. **D5（新增 INFO 日志）未做**：`createSystemAbortReason()` 的栈本身已指向**调用点**（G1），D5 的观测目的被 G1 取代；且两处站点均已可观测（`req.on('close') 触发 — 中止会话流` 已有日志、会话删除有 `deleteSession:*` 日志链），再加一条会引入高频噪声（CS03）。

**运行时证据（2026-09-25 晚补正 + 收口）**：**已取得**（此前"3 次尝试均未触发"是我检索口径过窄导致的漏判，详见 `预存错误与待处理问题.md` 建议② 条目）。
　　　**① 收口改动（同日，用户裁定"先修复 ② 的栈缺失问题"）**：原实现该 warn 分支只记 `{reason: String(reason)}`（**不含 stack**），且该分支现在不写崩溃转储（① 的意图）⇒ ② 捕获的栈**运行时无处可见**。已补：[main.ts:1488-1500](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L1488-L1500) 在 `reason instanceof Error && reason.stack` 时并记 `stack`（1 处，条件展开）。
　　　**② 复现与实测**（动作：新建临时会话 → 发长输出请求 → 2.5s 后 `DELETE` 该会话）：`12:13:07.376Z` `FetchInterceptor SSE reader error {error:"liri:system-abort"}` → `provider 流式失败` → `12:13:07.391Z` **`main: unhandledRejection（AbortError 预期中断）{reason:"AbortError: liri:system-abort", stack:…}`** ⇒ ① 与 ② **同时得到运行时验证**：reason 以 **Error 形态**贯通（不再是裸字符串）、走预期中断分支（**无** error 级记录、**无**崩溃转储）；`stack` 落在 `createSystemAbortReason (ReActLoop.ts:153)` ← `deleteSession (SessionLifecycleManager.ts:557)` ← `deleteSession (ChatManager.ts:6034)` ← `handleDeleteSession`。
　　　**③ 边界（重要，修正我原先对 ② 收益的表述）**：该 `stack` 指向的是 **abort 站点**（reason 的**创建处**），**不是**"谁没 catch 这条链" ⇒ **② 能让"哪个中止站点触发"可证，但不足以定位 ③ 要的"未 catch 的 promise 链"**（与 §8-1 的边界声明一致）。
　　　**③ 手段确认（2026-09-25，独立探针实跑；运行时 = Bun 1.3.14 / node compat 24.3.0）**：

| 通道 | 实测结论 | 可用于 ③？ |
|---|---|---|
| `unhandledRejection` **第二参数** | **存在**（`(reason, promise)`，`arguments.length === 2`；无第三参）；确实是被拒的 Promise 对象（`ctor: Promise`、`Bun.inspect → Promise { <rejected> }`） | ⚠️ **本身不含定位信息**（`ownProps` 仅自定义标记、`ownSymbols` 空、inspect 仅 `<rejected>`） |
| **Promise 打标（逆向利用第二参数）** | 在**创建点**给 promise 打自定义属性，能在全局 handler 里**原样读回**（实测 `myMark: marked-A`） | ✅ **可行**（对本仓自建的 promise 链：在候选创建点打"来源标记"，handler 打印即定位）——**推荐** |
| `node:async_hooks` | **可用**（`createHook(...).enable()/disable()` 均成功） | ⚠️ 备选（创建点采栈），但"promise 对象 → asyncId"关联需额外手法，未验证 |
| `bun --unhandled-rejections=strict` | **被识别**，但 Bun 原生报告给的是 **reason 的栈**（= abort 站点）+ 代码帧，**不含 promise 创建点** | ❌ 对本问题无增量 |
| 静态排查 | 已排除 `FetchInterceptor` 的 SSE reader（有 try/catch）；已发现**独立**潜在误报点 [`ParallelToolExecutor.ts:282/286`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ParallelToolExecutor.ts#L280-L288)（`reject(new Error('[CASCADE_ABORTED] …'))` —— 大写 `ABORTED` 不匹配 `isAbortReason` 的 `includes('aborted')` ⇒ 若外泄会被判为真异常） | ⚠️ 与打标法互补 |

　　　**插桩实验（2026-09-25 实跑，用户裁定"执行插桩实验"；已全部回退）**：
　　　**① 实现**：临时模块 `src/diagnostics/leakProbe.ts`（+ `main.ts` 一行 import）对四类"创建点"打标（WeakMap 记录，**只记录不包裹**、语义零变更），并注册独立 `unhandledRejection` 观察者按第二参数读标：⑴ `fetch` 返回值；⑵ `Promise.race` 每个入参；⑶ `Promise.prototype.then` 派生（含父链继承）；⑷ `AsyncGeneratorPrototype.{next,return,throw}`（`for await` 的悬空 next 属此类）。
　　　**② 结果（两次实跑，动作均为"流式中删会话"）**：`[LEAK] reason=AbortError: liri:system-abort | tagged=NO`（**四类全部 MISS**）⇒ 泄漏者**不是** fetch 返回、**不是** race 入参、**不是** `.then` 派生、**不是**异步迭代器方法。

| 结论 | 说明 |
|---|---|
| **打标法对该泄漏者天生不可达** | 剩余未覆盖类 = **引擎创建的 async 函数返回 / `await` 内部链**（`await` 对**原生** promise 走内部 `PerformPromiseThen`，**不经**可观测的 `Promise.prototype.then`；async 函数返回的 promise 亦由引擎创建）⇒ 除非在**具体调用点**手工包一层，否则无从打标 |
| **`async_hooks` 通道关闭（实测）** | 探针 2（临时脚本，已删）实测：`createHook({init})` 对 `type==='PROMISE'` **一次都不触发**（`promiseInitCount: 0`，而同期 3 个未处理拒绝全部产生）⇒ Bun 1.3.14 的 `node:async_hooks` **不实现 promise 追踪**，Node 侧"用 init 的 resource 反查 promise 创建栈"的经典手法**在本运行时不可用** |
| **`--unhandled-rejections=strict` 亦无增量** | 只给 **reason 的栈**（= abort 站点）+ 代码帧 |

　　　**③ 下一步 → 子系统二分（已执行第 1 步，2026-09-25）**：
　　　**二分第 1 步：停用 trace 拦截器 → 控制组结果 = 泄漏仍复现 ⇒ `trace-recording` 已排除**。
　　　• 停用方式（**不改生产文件**）：临时模块在装配前把 `FetchInterceptor.prototype.install/uninstall` 置空（`trace-recording` 明确"不再支持 `DISABLE_TRACE_RECORDING` 环境变量关闭"⇒ 无 env 开关）；
　　　• 生效证据：启动标记 `[BISECT] FetchInterceptor.install/uninstall 已置空（trace 拦截器停用）pid=17540`，且该窗口 app.log **无任何 `FetchInterceptor` 行**；
　　　• 结论证据：`12:28:37.922Z` 仍出现 `main: unhandledRejection（AbortError 预期中断）{reason:"AbortError: liri:system-abort", stack:…}`（栈仍指 abort 站点）⇒ **泄漏与 trace 拦截器无关**；
　　　• **顺带新观察（指向下一步）**：该次中止后**发起了重试** —— 同一中止产生**两次** provider 请求（`12:28:37.914` STREAM_FAILURE `chunkCount:16/107` → `12:28:38.573` TTFB_FAILURE），即 `query:errorRecovery` 决定 retry 后**第二次请求又被同一中止打掉** ⇒ **建议下一步二分维度 = 重试路径**（`ErrorRecoveryManager` 的 `DEFAULT_MAX_RETRIES.server_error`，无 env 开关 ⇒ 需临时置 0 对照）；
　　　• **插桩全部回退**：`src/diagnostics/leakBisect.ts` 已删除、`main.ts` 临时 import 已移除、`%TEMP%\leak-bisect.log` 已删、服务已按"停→清残留→启"重启（PID 变更）。
　　　**二分第 2 步：停用重试路径 → 结果 = 重试路径已排除（2026-09-25，用户裁定）**。
　　　• 方式（**不改生产文件**）：临时模块包装 `ErrorRecoveryManager.prototype.assess`，把任何非 `abort` 的恢复动作**强制改为 `abort`**，并落标记日志 `%TEMP%\leak-bisect2.log`；
　　　• **实测（关键，如实）**：本次运行**根本没有发生重试** —— 标记日志只有装载行（无"重试已强制停用"）、`app.log` 中该次**仅 1 次** provider 失败（`attempt:1`，无 `Recovery action decided`）⇒ **控制手段未被介入**；
　　　• 而**泄漏仍出现**：`12:32:05.127Z` 记录 `unhandledRejection（AbortError 预期中断）`（`core:exit` 亦记 `exitAt:"2026-09-25T12:32:05.127Z"`）⇒ **"无重试"的运行里泄漏照样发生 ⇒ 重试路径不是必要条件，已排除**；
　　　• 回退：`leakBisect2.ts` 删除、`main.ts` 临时 import 移除、`%TEMP%\leak-bisect2.log` 删除、服务已重启；
　　　• **下一批候选（已静态列出，供"手工包裹"步骤用）**：delete/流式路径上的 fire-and-forget 调用 —— `ChatManager.ts:6043 void this._deleteSessionCheckpoints()`、`:6056 void this._dismissSessionInboxItems()`、`:3499 void this.appendStreamEvent()`、`:2518/:3115 void this._recordModelInputSnapshot()`。**假设（与"四类打标全 MISS"完全自洽）**：其中某个在 **aborted 信号**下会 `throw signal.reason`（或其内部 await 的中止态操作如此），其返回 promise **由引擎创建** ⇒ 打标法不可达、只能在该调用点**手工包一层 `.catch(report)`** 定位。

　　　**③ 第 3 步前置核查（2026-09-25，用户批准后、动手前先取证）→ 上面那段"假设"被判据推翻**：

| 候选点 | 能否 reject | 证据（文件:行） |
|---|---|---|
| `ChatManager.ts:6043 void this._deleteSessionCheckpoints()` | **❌ 不可能** | 函数体整体包 try/catch（L6145-6183），catch 调 `handleError(e, …)` **不带 `rethrow`** ⇒ `handleError` 仅在 `options.rethrow` 为真时 `throw`（[handleError.ts:234](file:///e:/PY/Documents/CODES/PY_APP/app/src/error/handleError.ts#L234)） |
| `ChatManager.ts:6056 void this._dismissSessionInboxItems()` | **❌ 不可能** | 函数体整体包 try/catch，catch 仅 `logger.warn`（L6061-6072） |
| `ChatManager.ts:3499 void this.appendStreamEvent(...)` | **❌ 不可能** | 函数体整体包 try/catch，catch 走 `handleError(...).catch(() => {})` 后 `return {ok:false}`（L1932-2001） |
| `ChatManager.ts:2518/:3115 void this._recordModelInputSnapshot(...)` | **⚠️ 仅 `_ensureIndex` 处可 reject（文件态错误，非 abort reason）** | `RequestSnapshotService.record` 的 try 从 **L149** 起，而 `await this._ensureIndex(sessionId)` 在 **L115**（**try 之外**）；其 catch（L176-182，`@ignore-catch`）已吞掉 append 段异常 |

　　　• **⇒ 结论一**：四个候选点上**都不存在"因 aborted 信号而 reject"的路径** ⇒ 若照原计划包裹，**控制手段永远不会触发**，只会产出"**仍复现**"的**假阴性结论**（错误地把 ChatManager 删除路径判为"已排除"）。故**未执行**该包裹实验，改为先报告（CS06 / TE08-002：批准方案的前提被证伪时停止链路并上报）。
　　　• **⇒ 结论二**：泄漏者**不在 ChatManager 删除路径的 fire-and-forget 调用**里。该信号（`_sessionAbortControllers` 里的 controller）的真实消费者在其**下游**：`ChatOrchestrator`（[ChatOrchestrator.ts:85](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L85)）/ provider 流式读取链路 —— 与既有实测时序（`12:32:05.072Z` SSE reader error → `.075` provider 失败）一致。
　　　• **下一步候选（待用户裁定，未开工）**：(甲) 对**信号消费者**取证 —— 包装 controller 的 `abort`，记录 aborted 之后仍持 promise 的下游调用点；(乙) 因果二分 —— 临时让 [SessionLifecycleManager.ts:557](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/SessionLifecycleManager.ts#L557) 跳过 `abort(reason)`，确认"泄漏是否由该 abort 引起"。
　　　• 顺带核查（排除项）：全仓仅**一个** `globalThis.fetch` 改写点（[FetchInterceptor.ts:71](file:///e:/PY/Documents/CODES/PY_APP/app/src/trace-recording/interceptor/FetchInterceptor.ts#L71)，即第 1 步已停用的那个）⇒ 不存在"第二个 fetch 拦截器"这一嫌疑。

　　　**③ 第 3 步（探针 3：取证 abort 监听器注册点）→ "手工把 reason 转成 reject 的适配器"假设被排除，并取得 3 项硬证据（2026-09-25，用户裁定方向）**：
　　　• 手段（**零行为变更，只记录不包裹**）：临时模块 `src/diagnostics/leakProbe3.ts` 包装 ⑴ `EventTarget.prototype.addEventListener`（仅 `type==='abort'` 且目标为 `AbortSignal` 时记录**注册栈**）、⑵ `AbortController.prototype.abort`（记录被中止 signal 编号 + reason + **该 signal 上的 JS 监听器数**及注册栈）、⑶ 独立 `unhandledRejection` 观察者判定 reason 是否**就是**传给 `abort()` 的同一对象（WeakSet 恒等）。落盘 `%TEMP%\leak-probe3.log`。
　　　• 前置校验（`bun -e` 实测，证明探针落点正确）：`AbortSignal.prototype` **无**自有 `addEventListener`（自有=false，继承自 `EventTarget.prototype`，后者自有=true）⇒ 包装 `EventTarget.prototype` 可拦到；`AbortController.prototype` **有**自有 `abort` ⇒ 包装有效；`signal instanceof AbortSignal`=true。
　　　• **实测（有效中止场景，`12:43:17`）**：
　　　　　`AbortController.abort signal#未知(该 signal 无 JS abort 监听器) reason=AbortError: liri:system-abort JS监听器数=0`
　　　　　`unhandledRejection 命中 reason=AbortError: liri:system-abort 是否为"传给 abort 的同一对象"=true`
　　　• **证据一（关键）**：整个运行**没有任何** `AbortSignal` 的 `addEventListener('abort')` 注册记录；被中止的会话 signal **JS 监听器数 = 0** ⇒ **"手工把 `signal.reason` 转成 reject"的适配器写法被排除**（该路径根本不存在此类监听器；`utils/abortController.ts` 的子控制器传播链亦**未参与**——否则父 signal 上必有 1 个 JS 监听器）。
　　　• **证据二**：外泄的 reason **就是**传给 `abort()` 的同一对象（恒等=true）⇒ **无复制、无包装**，reason 从 `abort(reason)` 原样进入 rejection。
　　　• **证据三**：abort（`.420`）→ 外泄（`.429`）= **9ms**，即中止后的**微任务级立即失败**。
　　　• **⇒ 收敛**：无 JS 监听器 + reason 原样 + 立即失败 ⇒ 拒绝由**运行时内建**的 signal 消费者产生（`fetch(..., {signal})` 及其**响应体流**）——与"打标法四类全 MISS"自洽：`await` 原生 promise 走内部 `PerformPromiseThen`，外泄的是**引擎创建的 async 函数 promise**，打标天生不可达。（**注**：先前的打标实验覆盖的是 `AsyncGeneratorPrototype.next`，而 `for await (const c of response.body)` 走的是 `ReadableStream` 的 **async iterator**，两者不是同一对象 ⇒ 该类别当时**并未被覆盖**。）
　　　• **复现前提（如实记录两次无效运行，防止误判）**：⑴ 首跑（`12:40:34`）删除落在 `streamMessage:token — 实际发送前`（`.164`）之后 **4ms**，provider 请求**尚未发出** ⇒ 无内建消费者、**不产生泄漏**（探针 `JS监听器数=0` 印证）；⑵ 二跑（`12:42`）删除请求与流式请求**同一 HttpClient 连接被排队**，删除实际落到 `chatStream:完成`（`finishReason:"stop"`，95.9s）**之后** ⇒ 会话已无活跃流、未触发 abort；⑶ 三跑改为**独立进程**发 DELETE（`Start-Process` 另起连接）⇒ 中止落在生成中（读到 1968 字节即被砍），泄漏稳定复现。**这三点是后续任何复现的可复现前提。**

　　　**③ 第 4 步（探针 4：fetch + 响应体 reader 双点取证）→ 归因到具体层（2026-09-25，用户裁定方向）**：
　　　• 手段（**零业务语义变更，只记录**）：在探针 3 同模块追加 ④ 包装 `globalThis.fetch`（`Object.defineProperty` 接管以捕获后续赋值，兼容 `FetchInterceptor.install/uninstall` —— 该 `install` **无**"已被改过"守卫，只做 `this.originalFetch = globalThis.fetch.bind(globalThis)`，故不冲突；另用 `Symbol.for` 品牌位防双层重包）与 ⑤ 包装 `ReadableStreamDefaultReader.prototype.read`（补上第 3 步标注的漏掉类别）。两者都只**附加 rejection 观察者**，**不替换对外返回值身份**。
　　　• **实测（`12:45:37`，有效中止场景）**：abort（`.172`，`JS监听器数=0`）→ 两处 `reader.read` 被**同一** reason 打掉：
　　　　　⑴ `.174` 调用点 = `FetchInterceptor.ts:299`（trace 层 SSE 重组读）← `BaseAIProvider.ts:604` `fetchWithConnectionRetry`；
　　　　　⑵ `.181` 调用点 = `BaseAIProvider.ts:973` `readStreamChunkWithTimeout` ← `OpenAIProvider.ts:454` `chatStreamInternal`（**provider 自己的 SSE 读**）；
　　　　→ 泄漏 `.192`（`是否为"传给 abort 的同一对象"=true`）。
　　　• **判据一**：泄漏在两处 read promise **均被本探针挂上 `.catch` 之后仍然发生** ⇒ **两者都不是泄漏者**；泄漏者是**其上的引擎 promise**（async 函数 / async generator 的 promise）——与"打标法四类全 MISS"完全自洽。
　　　• **判据二（排除）**：第 1 步已证"停用 trace 拦截器后泄漏仍复现" ⇒ 调用点 ⑴ 被排除 ⇒ **泄漏链路锁定在 ⑵：`readStreamChunkWithTimeout` ← `chatStreamInternal`**（`private async *`，[OpenAIProvider.ts:355](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OpenAIProvider.ts#L355)）。
　　　• **关键结构发现（KB-INTERRUPT-ORPHAN 防护层级不足）**：[BaseAIProvider.ts:968-974](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/BaseAIProvider.ts#L968-L974) **已**为孤儿 `reader.read()` 挂 noop `.catch`（`readPromise.catch(() => {})`，注释明确针对 `ERR_STREAM_RELEASE_LOCK` / `TimeoutError`）⇒ 这正是"read promise 不漏"的原因；但**同一类孤儿问题在 generator / function 层没有等价防护** ⇒ 中止时 `chatStreamInternal`（async generator）内部 `await` 的 rejection 落在其 **pending request promise** 上，若消费方已放弃迭代 / 未持有该 promise，即成为全局 unhandledRejection。
　　　• **同批新发现（未修，属 ① 的残留缺口）**：强杀前的启动日志出现 `core:exit`「上次退出信息（异常退出）」`{reason:"unhandledRejection", code:1, exitAt:"2026-09-25T12:43:17.440Z"}` —— `exitAt` 与泄漏时刻（`.429`）**同一秒**、而非强杀时刻 ⇒ **① 的"预期中断不记为异常"意图未覆盖 exit recorder**：一次预期的会话中止仍会在退出记录里留下"异常退出"。**已记录，未修。**

　　　**③ 第 5 步（探针 5：认领被遗弃的 next()）→ next() 被排除，并由此**定位到根因（2026-09-25，用户裁定方向）**：
　　　• 手段（**不改生产文件**）：在探针同模块追加 ⑥，遍历 `(async function*(){})()` 的原型链逐层包裹**自有** `next`/`return`/`throw`，对返回 promise 挂**观察型** `.catch`（记录**调用点栈** + reason）。实测包裹落点 `level2: [next,return,throw]`（即 `%AsyncGeneratorPrototype%`），生效。
　　　• **实测（`12:48:56`，有效中止场景）**：
　　　　　`.411` abort（`JS监听器数=0`）→ `.415`/`.420` 两处 `reader.read` 被拒（raw reason）→ `.422~.437` **6 次 `asyncgen.next()` 被拒**（调用点依次为 `BaseAIProvider:710 wrapChatStreamMeasure` → `OpenAIProvider:349 chatStream` → `streamMessageFlow:1200 runStreamMessage` → `ChatManager:4849 streamMessage` → `CoreAPIImpl:1091 chatStream` → `chat-handlers:794 handleStreamingChat`；**reason 全部是 `AppError: OpenAI stream failed: liri:system-abort`（已被 provider 包装）**）→ `.442` **全局 `unhandledRejection`（reason = 原始对象，恒等=true）**。
　　　• **判据**：6 次 `next()` rejection **全部被观测到**，而 `.442` 的泄漏**没有任何一条 `next()` 记录与之对应**，且泄漏 reason 是**未被 AppError 包装的原始对象** ⇒ **`next()` 被排除**；泄漏者携带 raw reason ⇒ 产生于 provider **包装之前**的裸 fetch/流层。另注：`[PROBE4] fetch 被拒绝` **一条都没有** ⇒ fetch 本身正常 resolve，出问题的是**响应体流**。
　　　• **⇒ 根因定位（单一处，已确认）**：[BaseAIProvider.ts:1004](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/BaseAIProvider.ts#L1001-L1010) 的 **`reader.cancel()` 未 await、未 catch**：
　　　　　```ts
　　　　　} catch (err) {
　　　　　  try {
　　　　　    reader.cancel();        // 返回 Promise
　　　　　  } catch (cancelErr) {     // ❗ try/catch 只捕获同步抛错，抓不到 promise rejection
　　　　　    logger.warn(`[${this.id}] 流式读取取消失败`, {...});
　　　　　  }
　　　　　```
　　　• **机制**：流已被 abort 置错 ⇒ `cancel()` 以**流的 stored error（即原始 abort reason）** reject ⇒ 该 rejection **未被 try/catch 捕获**（异步错误不落同步 catch）、也**无人消费** ⇒ 全局 `unhandledRejection`。
　　　• **该根因与全部既有证据一致**：raw reason（未经 AppError 包装）✔ / 非 read 非 next 非 fetch promise ✔ / 泄漏晚于 read 拒绝 22ms（catch 分支在 read reject 后运行，cancel() 的 rejection 再晚一个微任务）✔ / 打标法不可达（引擎创建的 promise，且当时未覆盖 `cancel`）✔ / 停用 trace 拦截器后仍复现（provider 自身代码）✔ / 被中止 signal 的 `JS监听器数=0` ✔。**注**：[L968-974](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/BaseAIProvider.ts#L968-L974) 的 KB-INTERRUPT-ORPHAN 注释**已经点到**"`reader.cancel()`/`releaseLock()` 会让 pending 的 `read()` 以 AbortError reject"，但只给 `readPromise` 打了防护，**`cancel()` 自身的 promise 漏了**。
　　　• **修法（用户裁定「甲」，2026-09-25）**：`void reader.cancel().catch(() => {})` —— 与同文件 L966 `timeoutPromise.catch` / L974 `readPromise.catch` 的既有 silent noop 先例**一致**；同步 `catch` 分支**保留**（覆盖 `cancel()` 同步抛错的情形）。
　　　• **✅ 已验证（2026-09-25 `12:51:07`，同一探针在线对照实验）**：修复后同一复现动作（流式中删会话、中止落在生成中）——
　　　　　⑴ 中止链路**形状未变**：abort `.930` → 两处 `reader.read` 拒绝 `.933`/`.939` → 六次 `asyncgen.next()` 拒绝 `.942~.955`（reason 均为已包装的 `AppError: OpenAI stream failed: liri:system-abort`）；
　　　　　⑵ **探针 ③ 的 `unhandledRejection 命中` 行不再出现**（修复前同条件必有）；
　　　　　⑶ `app.log` 规范 handler 亦**无**新增 `AbortError 预期中断`（全仓命中仍为 **9** 条，末条 = 修复前 `12:48:56.446Z`）。
　　　　⇒ **双重确认泄漏已消除**。**对照有效性说明（防止"是我的探针掩盖了"）**：探针的 `.catch` 观察者**不会**掩盖泄漏 —— 修复前那次（`12:48:56`）探针**在线**而泄漏**照样发生**，故修复后的消失可归因于修复本身。
　　　• **门禁与回退**：`bun run typecheck` **0 错误**；探针（`src/diagnostics/leakProbe3.ts` + `main.ts` 临时 import + 复现脚本 + 探针日志）**已全部回退**，服务已按"停 → 清残留 → 启"重启为干净实例（`12:52:24`）。
　　　• **③ 结论（终）**：外泄链路 = `deleteSession` → `abort(createSystemAbortReason())` → provider 响应体流置错 → `read()` 拒绝（已防护）→ `catch` 分支 → **`reader.cancel()` 的 promise 拒绝无人消费** → 全局 `unhandledRejection`。**单点根因，已修并实证。**

　　　**未做**：④ 数据清理（`crashes/` 历史转储、8 个孤儿会话目录）、UI/文案、枚举变更。**③ 已闭环（外泄链路已定位并修复，见上）**；**已定位但未修（另批待裁定）**：⑴ ~~看门狗孤儿条目~~ ✅ **已修（2026-09-25，见下 §6.6）**；⑵ provider 层把「预期中止」记成 `high` 级 `AppError` 并触发 `[ALERT] [P2]`（与 ① 同族不同层）；⑶ `core:exit` 把预期中止记为「异常退出」（① 的收口未覆盖退出记录链路）；⑷ `ParallelToolExecutor.ts:282/286` 大写 `ABORTED` 不匹配 `isAbortReason` 的 `includes('aborted')`。

　　**§6.6 看门狗孤儿条目修复（2026-09-25，用户裁定「按这个方案修复看门狗孤儿条目」）**
　　　• **缺陷**（附图见 `dev_docs/error_repairs/预存错误与待处理问题.md` 附带发现 3-(i)）：turn 已于 `11:45:52` 以 `finishReason:'error'` 结束，但 `11:57:17`（+10 分钟）仍由 `chat:TurnLivenessWatchdog` 对该会话报 `Turn liveness watchdog fired（无产出超过阈值，尝试中断）{idleSeconds:600}` + `chat:orchestrator: 会话 turn 卡死看门狗触发，尝试中断` ⇒ **对已结束的 turn 触发"尝试中断"**。
　　　• **根因**：[ChatOrchestrator.ts:987](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L969-L999)（修复前行号）的 `watchdog.stop()` **只在 `while (!next.done)` 正常走完后执行**，两条路径会跳过它：**① `await gen.next()` 抛错**（中止/异常向上传播 —— 本 spec 的探针 5 实测栈正落在 `ChatOrchestrator.ts:985:24`，即该 `await`）；**② 消费方提前终止**（客户端断线 ⇒ 生成器被 `.return()`，其后代码不执行）。跳过即定时器常驻 ⇒ 阈值后对**已结束的 turn** 触发 `onStall`（误报 + 定时器/闭包泄漏）。
　　　• **修法**：把循环体与 `return next.value` 包进 `try`，`watchdog.stop()` 移入 `finally`（三条路径统一收尾）。**语义不变**（正常路径行为完全一致）。
　　　• **验证**：⑴ **红→绿**：新增 [tests/chat/orchestrator/turnLivenessOrphan.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/orchestrator/turnLivenessOrphan.test.ts) 2 例（消费方提前 `return()` / 正常走完），修复前 **1 fail**（实测 `watchdog fired {sessionId:"test-session", idleSeconds:0, timeoutMs:60}` + `stalled` 非空）、修复后 **2 pass**；⑵ 相关回归 `bun test tests/chat/TurnLivenessWatchdog.test.ts tests/chat/orchestrator/` = **22 pass / 0 fail**；⑶ `bun run typecheck` 0 / `eslint` 0；⑷ **运行时验证（路径①，与生产同源）**：以 `TURN_LIVENESS_TIMEOUT_MS=20000` / `TURN_LIVENESS_POLL_MS=2000` 起服务（比默认严格 30 倍），流式中删会话（`12:59:50.561` 中止），静置 35s ⇒ 全日志 `Turn liveness watchdog fired` **仅剩修复前的 `11:57:17.355Z` 一条**，本次**零误报**。验证后已**不带 env 重启**为正常实例。
　　　• **用例编写陷阱（如实记录）**：`TURN_LIVENESS_POLL_MS` 必须 **≥ `MIN_POLL_MS`(=100)**；首版设 20ms 被判非法并回退默认 15s（warn `TURN_LIVENESS_POLL_MS 非法`），导致观察窗口内根本不 tick ⇒ 断言恒成立、用例**失去判定力**（首跑"2 pass"实为假绿）。已在用例注释中固化该约束。
　　　• **同批观察 → 已升级为独立小节 §6.7（2026-09-25 验证成立）**。

　　**§6.7 内层生成器未关闭风险 —— 已验证成立（2026-09-25，用户裁定「先验证内层生成器未关闭的风险」）**
　　　• **结论：风险成立**（**现存缺陷，未修**；**非**本次看门狗修复引入）。三条独立证据：
　　　　　⑴ **JS 语义（Bun 1.3.14，实测）**：被遗弃的 async generator **不会**补跑 `finally`。探针 `%TEMP%\probe-gen-finally.js` 复刻"外层 finally 跑、内层被遗弃"的委托结构，实测 `after return: outerFinally = true / innerFinally = false`，且 **3 次 `Bun.gc(true)` 后仍为 false** ⇒ **不存在"GC 兜底"**。
　　　　　⑵ **确定性 A/B（新增 `tests/chat/orchestrator/innerGenerationClose.test.ts`）**：向 host 注入 mutex 探针，先推进到 `acquire` 之后再关外层 ——
　　　　　　　**对照组**（正常消费到 `done`）：`mutex events = ["acquire","release"]`（**证明探针有效**，排除探针失效导致的假结论）；
　　　　　　　**取证组**（外层提前 `return()`）：`mutex events = ["acquire"]` ⇒ **`release` 未发生**。
　　　　　⑶ **静态链条（精确）**：`runStreamMessage` 的 `finally`（[streamMessageFlow.ts:2627-2650](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L2627-L2650)）是**唯一** release 点（其注释明言"此处是唯一释放点，保证释放恰好一次"），同处被跳过的还有 `endInteractionSpan()`、**兜底检查点落盘**、`endSpan(streamSpan)`。而**上下两层都不把 `return` 往下传**：
　　　　　　　• [ChatOrchestrator.ts:996-998](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L969-L999)（本次新增的 `finally`）只做 `watchdog.stop()`；
　　　　　　　• [CoreAPIImpl.chatStream](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L1182-L1184) 用**手工 `await generator.next()`** 驱动（L1036/L1091），其 `finally` **只移除一个事件监听器**，且**全文件 `.return(` 零命中** ⇒ 最外层 [chat-handlers.ts:572](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/chat-handlers.ts#L557-L576) 的 `generator.return()` **传导不到** `ChatManager.streamMessage`（`yield*` 那一跳本可传导，但其上游已断）。
　　　• **可达性（如实限定）**：**尚未取得生产发生的实证**。⑴ 现有 `app.log` 中聊天断线分支的日志 `SSE 客户端已断开，停止流式输出` **0 命中**；⑵ 我以**原始 TCP + 硬关连接**尝试触发该分支，结果该分支**仍未触发**（首个流继续产出至 15594 字符、日志无该行）⇒ 该次实验**没有**造成遗弃 ⇒ **不能**据此断言生产可达。故本项定性为**潜在缺陷**：一旦 [chat-handlers.ts:559](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/chat-handlers.ts#L557-L576) 的断线分支被触发，即会命中（该分支自身的注释 P2-10 也承认同一后果："否则 streamMessage 的会话互斥锁永不释放，后续同一会话请求会 SimpleMutex: acquire timeout after 30000ms"）。**（补充 2026-09-25：改用 `LingerState(enabled,0)` 强制发 RST 再试一次，仍未触发该分支 —— 该次首个流照旧在 53s 后拿到锁并继续产出 15635 字符 ⇒ harness 两次都**未能制造"遗弃"**；初步指向"断线检测只在 chunk 边界执行、而本模型 TTFB 长达约 50s"，但未深究。故"生产可达"仍**未获实证**。）**
　　　• **✅ 已修（2026-09-25，用户裁定「两跳都补」）**：
　　　　　• `ChatOrchestrator.streamMessage` 的 `finally` 补 `void gen.return(undefined as never).catch(() => {})`；
　　　　　• `CoreAPIImpl.chatStream` 的 `finally` 补同款 —— **并因块级作用域把 `let generator` 声明提升到 `try` 之外**（原 `const generator` 在 try 块内，catch/finally **不可见**；typecheck 实测报 `TS2304: Cannot find name 'generator'`，正是它把位置错误挡了下来）；
　　　　　⇒ 与 [chat-handlers.ts:572](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/chat-handlers.ts#L557-L576) 的 `generator.return()` 形成**三层闭环**。
　　　• **✅ 验证**：⑴ 回归用例（`tests/chat/orchestrator/innerGeneratorClose.test.ts`）2 例 —— 正常完成 `release` 恰一次、**提前 `return` 后 `release` 恰一次**（修复前为 0 次）**全绿**；⑵ `bun test tests/chat tests/http tests/runtime` = **392 pass / 0 fail**（64 文件）；⑶ `bun run typecheck` 0 / `eslint` 0；⑷ **端到端冒烟**：同一会话连续两轮流式均 `saw_DONE`，各记 `获取互斥锁(首轮)` + `chatStream:完成 {finishReason:"stop"}`，且第二轮仅隔 **2.5s** 即拿到锁 ⇒ **锁已释放且可重入**；全日志 `acquire timeout` **0 命中**。
　　　• **同批未解异常（不归因，另行排查）**：上述实验中跟进请求（`stream:false`、`max_tokens:64`）**耗时 41722ms** 才返回 —— 其 LLM 调用实测仅约 1s（`LLM call recorded: … 17674/64 tokens` 于 `.583`），而 HTTP 响应直到 `13:08:22.182` 才完成（`contentLength:0 / finishReason:"stop"`）。**阻塞点未查明**，仅记录、不下结论（避免"无证据归因"）。

---

## 6.8 预期中断的分类收口（② provider 层误报 + ③ `core:exit` 误记）—— 2026-09-25，用户裁定「根因式：判据下沉到 error/」

### 6.8.1 问题（两条，同源）

| # | 现象（实测） | 证错的层 |
|---|---|---|
| ② | 一次预期中止产生 `core:api` **error** `[chatStream] OpenAI stream failed: liri:system-abort（Provider: …）{category:"execution", severity:"high", code:"1000"}` → `error:tracker High severity error` → `monitoring:alerts [ALERT] [P2] [high]` | `OpenAIProvider.ts:643-648` 把 abort 升格为 `AppError(EXECUTION, HIGH)` |
| ③ | 一次预期中止使下次启动报 `core:exit 上次退出信息（异常退出）{reason:"unhandledRejection", code:1}` | `ExitRecorder.ts:177-183` 的 `unhandledRejection` 钩子**无条件** `recordExit` |

### 6.8.2 根因（单一）

**「预期中断」的判据住在高层 `query/ReActLoop.ts`，而需要它的三层（`error/` 的错误入口、`ai/providers/` 的包装点、`core/exit/` 的退出记录）都在更低层** —— 向上 import 是反向依赖。于是各层只能"各自为政"：provider 升格、exit recorder 无条件记录。

**关键取证（决定改哪里）**：`handleError`（§1.9 的唯一错误入口）对**裸 `Error`** 会包成 `UNKNOWN/MEDIUM`，而 [handleError.ts:212-231](file:///e:/PY/Documents/CODES/PY_APP/app/src/error/handleError.ts#L212-L231) **仅 `CRITICAL/HIGH` 才 publish `error:occurred`** ⇒ ② 的告警**只能**来自 provider 的 `HIGH` 升格；但**只改 provider 不够** —— abort 会以 `MEDIUM` 继续进 `recordError` 并被 `logger.error` 记成 ERROR 级（噪声换个地方）。

### 6.8.3 设计（判据下沉 + 一处收口）

1. **新增 `src/error/abortReason.ts`（判据唯一归属，低层可依赖）**：`SYSTEM_ABORT_REASON` / `SYSTEM_ABORT_BRAND` / `isAbortReason()` 从 `query` **移入**；`isAbortReason` 新增一支 **`reason[SYSTEM_ABORT_BRAND] === true`**（**显式标记**，使"被包装过的异常"仍可识别 —— 满足 CS02，不与字符串匹配冲突）；新增 `markAsExpectedAbort(err)`（非枚举品牌属性，供包装点携带标记）。`query/ReActLoop.ts` 改为 import + **re-export**（对外 API 与 `@modules/query` 出口**逐字不变**）；`createSystemAbortReason` / `isSystemAbortReason` 留原地（循环语义），引用共享常量与品牌。
2. **`error/handleError.ts` 开头加"预期中断"分支**：`isAbortReason(error)` ⇒ `logger.warn`（**不** `logger.error`）、**不** `recordError`、**不** publish、**不**记 OTel，返回 `AppError(message, UNKNOWN, LOW, 'EXPECTED_ABORT')`；`rethrow` 语义保留。⇒ **一处收口，覆盖所有层**（provider / TAORLoop / CoreAPIImpl …），这是 ② 的真正闭环点。
3. **providers（OpenAI / Azure / Anthropic）**：包装前若 `isAbortReason(error)` ⇒ 包装结果 `markAsExpectedAbort(...)` 且 `severity` 降为 `LOW`（不谎报 high）。**消息文案不变** ⇒ 用户可见诊断与 `errorRecovery` 的 errorCategory 判定**均不变**（这正是 ② 加固注释所顾虑的点）。
4. **`core/exit/ExitRecorder.ts`**：`unhandledRejection` 钩子内 `isAbortReason(reason)` ⇒ **不 `recordExit`**（预期中断 ≠ 异常退出）；不额外打日志（`main.ts` 的全局 handler 已记 warn，避免双记）。

### 6.8.4 影响面与不变式

| 项 | 结论 |
|---|---|
| `abortSource` 判定 | **不变** —— 循环侧只从 `externalSignal.reason` 读（[ReActLoop.ts:468](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L468)），不依赖被 catch 的 error |
| `errorRecovery` 分类 | **不变** —— 包装消息逐字保留；且 `isAbortReason` 本就对包装后的消息不命中（`'abort'` ≠ `'aborted'`），本设计不改该判据的消息分支 |
| 用户可见错误文案 | **不变**（仍含 Provider 诊断） |
| 变化点 | 预期中断**不再**：发 `error:occurred` / 触发 P2 告警 / 计入 `recordError` 统计 / 写 ERROR 级日志 / 写"异常退出"记录 |

### 6.8.5 验证计划

- 单测：`tests/error/handleErrorAbort.test.ts`（预期中断 ⇒ warn、`getErrorStats()` 不增、`error:occurred` 不发布；对照：非中断 `HIGH` ⇒ 仍发布）；`tests/query/abortReason.test.ts` 扩充品牌分支（`markAsExpectedAbort` 后 `isAbortReason` 命中）。
- 运行时 E2E：流式中删会话（既有可复现手段）⇒ 断言 `app.log` **无** `severity:"high"` 的 `core:api` 行、**无** `[ALERT] [P2]`；重启后 `core:exit` **不再**是「异常退出 / reason=unhandledRejection」。
- 门禁：`typecheck` / `eslint` / `tests/chat+http+runtime+error+query`。
- **不作单元测试的部分（如实）**：`ExitRecorder` 无注入缝（`exitFile()` 固定指向真实 `~/.pyapp/data/last-exit.json`），单测会污染用户真实文件 ⇒ 该条**仅做运行时 E2E**。

### 6.8.6 实施与验证（✅ 已完成，2026-09-25）

| 项 | 结果 |
|---|---|
| 判据下沉 | 新增 `src/error/abortReason.ts`（`SYSTEM_ABORT_REASON` / `SYSTEM_ABORT_BRAND` / `isAbortReason` **+ 品牌分支** / `markAsExpectedAbort`）；`query/ReActLoop.ts` 改为 import + **re-export**（`@modules/query` 出口不变）；`error/index.ts` 增导出 |
| ② 收口 | `handleError` 开头新增预期中断分支（warn / 不 recordError / 不 publish / 不记 OTel，返回 `EXPECTED_ABORT` + `LOW`）；providers（OpenAI / Azure / Anthropic）包装时 `markAsExpectedAbort` 且 severity 降 `LOW` |
| ③ 收口 | `ExitRecorder` 的 `unhandledRejection` 钩子 `isAbortReason` ⇒ 跳过 `recordExit` |
| 单测 | 新增 `tests/error/handleErrorAbort.test.ts`（5 例）；`tests/query/abortReason.test.ts` 增品牌分支 1 例 ⇒ `tests/error+query` **107 pass / 0 fail**；广度 `tests/chat+http+runtime+ai+core+monitoring` **730 pass / 0 fail**（104 文件） |
| 门禁 | `typecheck` **0** / `eslint` **0**（10 个改动文件） |
| **② 运行时 E2E** | 流式中删会话（`13:30:44`）⇒ 该窗口**只有 warn**：`core:api [chatStream] 预期中断（不计入错误）{reason:"AppError: OpenAI stream failed: …", code:"EXPECTED_ABORT"}`；**不再**出现 `severity:"high"` / `error:tracker High severity error` / `[ALERT] [P2]`；`chatStream:完成 {finishReason:"error"}` 与 fallback 落盘**行为不变** |
| **③ 运行时 E2E** | 同一动作前后 `last-exit.json` 的**内容与 mtime 逐字节不变**（脚本断言 `last_exit_unchanged = True`）；对照：其 `before` 值正是**修复前**同一动作留下的 `{code:1, reason:"unhandledRejection", message:"liri:system-abort"}` |
| 用户可见文案 | **不变**（warn 的 reason 仍含 `OpenAI stream failed: …（Provider: …）`） |

**用例期踩的两个坑（如实记录）**：⑴ 断言最初写在**进程级单例**（`getErrorStats()` 与 `error:occurred` 全局计数）上，而 bun 同进程并发跑其他用例也在发布事件 ⇒ **假失败**；改为**按 message 过滤**的隔离安全断言。⑵ 首版把裸常量**加了后缀**（`liri:system-abort:tag-…`）—— 判据对字符串形态**精确匹配**，本就不该命中；且**广义判据不认 `new Error(常量)`**（"`Error.message === 常量`"那条兼容分支属**狭义** `isSystemAbortReason`）。两点均已固化进用例注释。

**未尽事项（如实）**：其余 provider（Google / Bedrock / Vertex / Ollama 等）的流式失败包装点**未逐一改造** —— 它们不再触发 P2 告警（`handleError` 仅在能识别"预期中断"时降噪，而这些点包装后**不带品牌**，仍会走 HIGH 路径）；若要彻底一致，需按同一模式补 `markAsExpectedAbort`。**已记录，未做**。

**⬆️ 已在 §6.8.8 收尾（2026-09-25）**：Google / Vertex / Ollama 三处**流式**包装点已补品牌；**Bedrock 经核对无需改**（它没有"包装"环节，中止原因原样上传 ⇒ 天然可识别）。

### 6.8.7 延伸修复：级联中止判据（④，2026-09-25 用户裁定「按这个方案修复 ParallelToolExecutor 的判据」）

**缺陷**：`ParallelToolExecutor.executeOne` 的级联中止 rejection 用**大写** `[CASCADE_ABORTED] …`，而 `isAbortReason()` 对 Error 走的是**大小写敏感**的 `message.includes('aborted')` ⇒ **命中不了**。

**严重性更正（比最初记录更重，如实）**：原记录写"**若外泄**会被判为真异常"；实际上 [`executeOne` 的 catch](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ParallelToolExecutor.ts#L327-L333) 对**任何** rejection 都调 `handleError` ⇒ 级联中止**本来就会**被记成 **ERROR 级 + 进 `recordError` 统计**（并非"仅在外泄时"）。实测：当前保留日志中 `CASCADE_ABORTED` **0 命中** ⇒ 该路径**尚未被触发过**（静默潜在缺陷）。

**修法**：两处 rejection（`abortSignal.aborted` 快路径 + abort 监听器回调）统一改为经 `markAsExpectedAbort(new Error(...))` **携带品牌位**（CS02：显式标记，不靠字符串大小写）；**消息文案保持不变**（`[CASCADE_ABORTED] …` 会作为工具错误文本对用户/模型可见）。**未动** L199 / L270 / `CascadeAbortManager.ts:228` 的 `error:` 字符串 —— 它们是**结果文本**，不是异常对象。

**验证**：`tests/error/handleErrorAbort.test.ts` 增 1 例（级联形态 + 品牌 ⇒ `EXPECTED_ABORT` 且不发布；**反向锁定**"未带品牌的同文案仍为 `false`"，防止有人改成靠字符串）；`tests/error+query+chat+http+runtime` = **500 pass / 0 fail**；`typecheck` 0 / `eslint` 0。**未做 E2E（如实）**：触发真实级联需要"工具失败 → CascadeAbortManager 触发"的模型相关链路，未跑。

### 6.8.8 收尾：其余 provider 的流式失败包装品牌（⑦，2026-09-25 用户裁定「⑦ 其余 provider 补品牌」）

**背景**：即 §6.8.6「未尽事项」预告的那一项。本次**逐点核对**（不按 provider 名单假设）后收尾。

**盘点（实测优先于命名假设）**：

| Provider | 流式包装点 | 外部 `signal`？ | 处置 |
|---|---|---|---|
| GoogleProvider | [chatStreamInternal catch](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/GoogleProvider.ts#L281-L292)（`Gemini stream error: …`） | ✅ `AbortSignal.any([options.signal, timeout])` | ✅ 补品牌 |
| VertexAIProvider | [chatStreamInternal catch](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/VertexAIProvider.ts#L297-L308)（`Vertex AI stream error: …`） | ✅ 同上 | ✅ 补品牌 |
| OllamaProvider | [chatStreamInternal catch](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OllamaProvider.ts#L425-L436)（`Ollama stream error: …`） | ✅ 同上 | ✅ 补品牌 |
| BedrockProvider | **无 catch / 无包装**（`sendConverseRequest` 原样抛出，`wrapChatStreamMeasure` 亦原样 `rethrow`） | ✅ | ⛔ **不改**（见下） |

**为什么 Bedrock 不改（避免"为一致而一致"）**：它的中止原因**不经过包装** —— `DOMException/AbortError`（或 `createSystemAbortReason()` 的 `name='AbortError'`）原样上传，`isAbortReason()` 天然命中。**没有"包装丢身份"这一环，加品牌就是投机性代码**（CS03 / PY_APP §2 简洁优先）。核对方式：`grep 'catch|AppError|signal|abort'` 该文件仅命中 import / `signal` / 一处 `!response.ok` 的 `throw`，**全文无 `catch`**。

**修法**：三处 catch 统一为「`isAbortReason(error)` ⇒ severity `LOW` + `markAsExpectedAbort(wrapped)`」，**包装文案逐字不变**（与 §6.8.6 的 OpenAI / Azure / Anthropic 同形）；判据经 `@modules/error` 出口导入（守 R03-002，不直连子目录）。

**验证**：新增 [tests/ai/providers/streamAbortBrand.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/ai/providers/streamAbortBrand.test.ts)（3 provider × 2 例 = 6 例，mock `fetch` 直打真实 `chatStream`）：
- ① 预期中断（`createSystemAbortReason()`）⇒ 包装后的 `AppError` **仍**被 `isAbortReason()` 识别 + severity `LOW`；
- ② **防假绿前提校验**：断言包装文案**不含** `aborted`（`liri:system-abort` 无 `-ed`）⇒ ① **只可能**由品牌位通过；
- ③ 反向防线：非中止错误**不得**被标记，severity 仍 `HIGH`。

**可证伪性 A/B（实测）**：临时摘掉 Google 的品牌位 ⇒ **exit 1、精确 1 红**，落在 `assertExpectedAbort` 的 `expect(isAbortReason(err)).toBe(true)`（`Received: false`）；恢复后 **6 pass / 0 fail**。⇒ 用例依赖品牌位，**不是**被字符串兜底悄悄救活。

`typecheck` **0** / `lint:arch` **0**（3673 文件，违规 0）/ `tests/error+query+ai` **313 pass / 0 fail**（40 文件）。**未做运行时 E2E（如实）**：需真实流式中途中止 + 命中 Google/Vertex/Ollama 三者之一，本机未跑；覆盖由上述行为级单测承担。

**新发现（当时范围外）**：这三个 provider（外加 OpenAI）的**非流式 `chat()`** catch 同样是"有 `signal`、包装后丢身份"（`options.signal` 供**压缩超时**使用）—— 属同一缺陷族。当时记入 `dev_docs/error_repairs/预存错误与待处理问题.md` **附带发现 14**；**随后经用户裁定「按同形修复这 4 处」，已同批收尾 —— 见 §6.8.9**。

### 6.8.9 收尾（续）：非流式 `chat()` 的同类包装点（附带发现 14，2026-09-25 用户裁定「按同形修复这 4 处非流式 chat() 的缺陷」）

**背景**：§6.8.8 盘点时连带发现 —— 同一批 provider 的**非流式** `chat()` 也有外部 `signal`，包装点同样无品牌。当时按 ⑦ 的裁定范围（"**流式**失败包装点"）**只记未修**；本次按同一模式收尾。

**落点（实测）**：

| Provider | `signal` 落点 | 包装点（catch） | 包装文案 |
|---|---|---|---|
| GoogleProvider | [L130-132](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/GoogleProvider.ts#L130-L132) | [L150-161](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/GoogleProvider.ts#L150-L161) | `Gemini chat failed: …` |
| VertexAIProvider | [L138-139](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/VertexAIProvider.ts#L138-L139) | [L158-169](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/VertexAIProvider.ts#L158-L169) | `Vertex AI chat failed: …` |
| OllamaProvider | [L202-204](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OllamaProvider.ts#L202-L204) | [L234-245](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OllamaProvider.ts#L234-L245) | `Ollama chat error: …` |
| OpenAIProvider | [L273 / L290](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OpenAIProvider.ts#L270-L274) | [L333-344](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/OpenAIProvider.ts#L333-L344) | `OpenAI chat failed: …` |

**范围判定（为什么"恰为这 4 处"）**：判据是"包装点所在方法**是否接外部取消信号**"。四文件内 `signal?: AbortSignal` 声明**只**出现在 `chat`/`chatInternal`（非流式）与 `chatStream`/`chatStreamInternal`（流式）两对方法上 ⇒ 非流式包装点恰为 4 处。**不纳入**：`OllamaProvider.generate()`（只 `AbortSignal.timeout`，无外部取消）、GoogleProvider 的视觉分析方法（同上，且不抛异常、只返回 `success:false`）、VertexAIProvider 的凭据加载处（`Failed to load service account key`，无 signal）。

**`measureChat` 不会丢品牌（已核）**：非流式 `chat()` 经 `BaseAIProvider.measureChat` 包装，其 catch 是 `throw error` **原样 rethrow** ⇒ 品牌位穿过。

**修法**：4 处 catch 统一为「`isAbortReason(error)` ⇒ severity `LOW` + `markAsExpectedAbort(wrapped)`」，**文案逐字不变**（与 §6.8.6 / §6.8.8 同形）。

**验证**：`tests/ai/providers/streamAbortBrand.test.ts` 改为**表驱动**，共 **14 例** = 流式 3 provider + 非流式 4 provider，各 2 例（预期中断 / 反向防线），三类断言同 §6.8.8（含**防假绿**前提校验：文案不含 `aborted`）。

**可证伪性 A/B（实测于非流式侧）**：临时摘掉 OpenAI 非流式品牌位 ⇒ **exit 1、精确 1 红**，落在非流式用例 → `assertExpectedAbort` 的 `expect(isAbortReason(err)).toBe(true)`（`Received: false`），其余 13 例仍 pass；恢复后 **14 pass / 0 fail**。

`typecheck` **0** / `lint:arch` **0** / `tests/ai` **210 pass / 0 fail**（25 文件）；`streamAbortBrand + tests/error + tests/query` **125 pass / 0 fail**。**未做运行时 E2E（如实）**：同 §6.8.8（`crashes/` 已归档清空，无实锤样本），且"系统侧 signal 是否确实打进**非流式** `chat()`"**未追**。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| CS01 归一化 | ✅ 复用既有常量与 `AbortSource`/`TerminationReason`；把散落的"字符串恒等判定"收敛为**唯一函数**（减少而非新增概念） |
| CS02 状态判据 | ✅ 显式标记（`instanceof SystemAbortError`）为主判据；字符串仅作**兼容**分支（值 = 受控常量，非用户可见文案） |
| CS03 回退最小化 | ✅ 不新增兜底/降级；兼容分支是"既有调用方仍传字符串"这一**真实场景** |
| CS05 根因优先 | ✅ 针对 ③ 的**可达性**做根因式铺垫（无栈 → 有栈），而非再打补丁 |
| CS06 证据驱动 | ✅ §1.1 全部带文件:行号与实测 dump 字段；未验证项（运行时复现）显式标注 |
| R02 数据模型统一 | ✅ 不新增持久化字段；`last-exit.json.message` 取值语义不变 |
| §1.6 模型可见 ⇔ 已落盘 | 不适用（不涉模型可见输入） |
| 向后兼容策略（§1.3） | ✅ 复用既有"无正式用户 ⇒ 可直接改"的授权，但仍**刻意保留字符串兼容**（因仓内测试/调用真实存在） |

---

## 8. 风险与边界（如实）

1. **② 不能保证"下次一定能定位 ③"**：有栈是**必要条件**——若外泄点把 reason 包成了新 Error 或转成字符串，栈仍会指向包装处而非遗漏的 `catch`。故 ② 的收益必须表述为"**更可能**定位"，而非"必然可定位"。
2. **`name='AbortError'` 的连带效果**：该 reason 一旦进入全局 handler，会走 ① 的预期中断分支（warn、不写 dump）——这**正是期望行为**；但也意味着 `SystemAbortError` 的外泄**不再产生 crash dump** ⇒ 由 ③ 需要的"可定位"改由**栈上的日志/warn 行**承载（必要时按 D5 增加 INFO 日志，把 abort 站点本身也记下来）。
3. **文案影响面（已审计）**：仅 [main.ts:1490](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L1487-L1490) 的 warn 文本会从 `liri:system-abort` 变为 `AbortError: liri:system-abort`（`String(reason)`）；其余三处（provider `AppError`、`流式读取异常`、`last-exit.json.message`）**逐字不变**。
4. **未验证项（实施时确认）**：① 是否有仓外（插件/渠道脚本）以**字符串字面量**（而非常量）传 reason —— 兼容分支已覆盖同值字符串，风险低；② `OpenAIProvider` 的重试路径对"被中止"的请求仍会 `retry` 一次（既存行为，本项**不改**，但会在实施说明中如实标注）。
5. **不做**：③/④、UI、枚举、重试策略。
