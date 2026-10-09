# Spec：EventBus 三语义显式化（C2 子 spec）

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：**已实施**
> **来源**：`dev_docs/20261009/任务计划.md` §3-C2（O1/O2/O3/O4/O5）· 主 spec `.trae/specs/execution-lifecycle-ownership.md`（§8-C2）
> **关联规则**：GR15 · CS01（复用/不另起炉灶）· CS02 · CS03（回退最小化）· CS06（证据驱动）· `project_rules.md §1.13`

---

## 1. 问题（现状，已核验）

`core/events/EventBus.ts`（439 行）的问题（来自任务计划 §1-O 系列）：

| ID | 现状 | 判定 |
|---|---|---|
| **O1** | `publish()` **同步返回 `void`** 且 `executeListener()`（自身 `async`）**被调用即弃** ⇒ "发出去就算完"与"等所有人处理完"两种意图**混在一个 API**里，语义不明 | ✅ 真缺陷 |
| **O2** | 事件名是 `string`、载荷默认 `any`（`subscribe<T = any>` / `publish<T = any>`） | ✅ 真缺陷（但**大改动**，见 §2） |
| **O3** | `once()` 先 `unsubscribe` 再调原监听器 ⇒ 极端时序（重入/并发）下可能**重复触发** | ✅ 真缺陷 |
| **O4** | `recordHistory`/`getHistory` 持外部引用 ⇒ 外部改写污染历史 | ✅ 已修（快照，2026-10-09） |
| **O5** | wildcard 与精确监听器**有确定顺序**（先精确后 `'*'`）但**未文档化为契约** | ⚠️ 部分成立（补文档即可） |

---

## 2. 范围决策

**做**：
1. **三语义显式化**（O1）：`publish`（**fire-and-forget**，保持既有行为与签名）+ 新增 `publishAndWait`（**await-directed**，逐监听器 await 并回报投递结果）；`durable` 语义**明确不由本总线提供**（其载体是**会话事件日志** `events.jsonl` 与 `SettlementOutbox` —— 本总线是**进程内内存**广播）。
2. **`once()` 幂等**（O3）：加 `fired` 守卫，任何时序下至多触发一次。
3. **wildcard 顺序契约**（O5）：文档化"先精确匹配、后 `'*'`"为**稳定契约**。
4. **O4 快照**（已完成）：`snapshotData`（本 spec 仅登记，不重复实现）。

**不做（范围外，如实登记）**：
- **O2「去 `any` 类型化」整体**：把默认泛型 `any` → 具体事件映射，需**全局事件名→载荷表**并迁移 **39 文件 / 87 处**调用；且 `TypedEventBus<T>`（类型安全版本）**已存在但零消费者**。改默认泛型是**破坏性变更**（`listener(data)` 将变 `unknown`）
  ⇒ 需独立立项，**不在本 spec**。本 spec 以 `publishAndWait` 的**显式返回类型**作为局部类型收益，并保留 `TypedEventBus` 供新代码使用。
- **durable 语义实现**（重复造轮子，CS01）：durability 已由会话事件日志/Outbox 承担。

---

## 3. 设计

### 3.1 语义契约（文档化）

| 方法 | 语义 | 行为 |
|---|---|---|
| `publish(event, data?)` | **fire-and-forget** | 同步遍历监听器并**启动**执行（不 await）；监听器内部异常各自捕获并记日志（**不**向发布方抛错） |
| `publishAndWait(event, data?)`（新增） | **await-directed** | **按序** `await` 每个精确监听器、再 `await` 每个 `'*'` 监听器；返回 `{ delivered, failed }`；**单监听器失败不中断其余**（与逐条捕获口径一致） |
| （durable） | **不由本总线提供** | 需持久化投递者走会话事件日志（`ChatManager.appendStreamEvent`）/ `SettlementOutbox` |

**顺序契约（O5）**：任一发布路径均为 **先精确匹配、后 `'*'` 通配**（数组序 = 订阅序）。

### 3.2 返回值

```ts
export interface PublishResult { delivered: number; failed: number; }
```

### 3.3 `once()` 幂等（O3）

```ts
once(event, listener) {
  let fired = false;
  const wrapped = (data) => {
    if (fired) return;      // 幂等守卫（先于 unsubscribe）
    fired = true;
    this.unsubscribe(event, wrapped);
    return listener(data);
  };
  return this.subscribe(event, wrapped);
}
```

---

## 4. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 | 复用既有 `EventBusImpl`；**不新建**第三套事件总线；durable 复用会话事件日志/Outbox |
| CS03 | `publish` 保持既有"不抛错"口径（零行为变更）；`publishAndWait` 亦不抛（沿用逐条捕获） |
| CS06 | 影响面（39 文件/87 处）与 `TypedEventBus` 零消费者**均经 grep 取证**，不臆造 |
| §1.13 | 改动限于单文件；接口新增方法仅 `EventBusImpl` 需实现（`channelEventBus` 经 Proxy 透传） |

---

## 5. 验收

- **A1** `publishAndWait`：多个监听器**按序 await**（后一者在前一者 resolve 后才开始）；返回 `delivered/failed` 计数；某监听器抛错 ⇒ `failed+1` 且**其余仍执行**、整体**不抛**。
- **A2** `publish` 保持零行为变更（不 await、不抛）。
- **A3** `once()`：重入 publish（监听器内再 `publish` 同事件）⇒ **仅触发一次**；正常路径触发一次后自动退订。
- **A4** 既有 `EventBusHistory` 快照用例保持绿（O4 回归）。

---

## 6. 实施记录（2026-10-09）

| 交付 | 落点 |
|---|---|
| `PublishResult` + `EventBus.publishAndWait`（接口 + 实现）；`executeListener` 改为回报 `boolean` | `app/src/core/events/EventBus.ts` |
| `once()` 幂等守卫；`publish`/`publishAndWait` 语义与顺序契约文档化 | 同上 |
| 测试（await 顺序 / 计数 / 失败不中断 / once 重入） | `app/tests/core/EventBusSemantics.test.ts` |

**验证**：`typecheck`（app + client）✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/core` ✅。
