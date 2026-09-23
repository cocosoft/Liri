# Spec：事件派生读路径根因修复（N-52）

> 状态：**已实施并验证**（2026-09-20）—— V1-V8 全通过，实测结论见台账 N-52；本 Spec 保留作后续维护基线
> 立项日期：2026-09-20 ｜ 关联条目：台账 N-52（根因）/ N-50（必须同批）/ N-51、N-53（相邻项）
> 变更性质：**跨模块行为变更**（会话消息读源切换）⇒ 按 §2.1 先 Spec 后实施

---

## 1. 背景与根因

**现象**：`CoreAPIImpl.getSessionMessages()` 永远不会走"事件派生"分支，恒由投影兜底（`messages.jsonl`）供数。因此注释所称的 `P2-1 事件统一派生` 及其全部下游能力在生产**均未生效**。

**根因（单点）**：[CoreAPIImpl.ts:1651](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L1651)

```ts
const eventLog = new EventLogStorage(sessionId, 'default');   // ← 第二参是 worktreeHash
```

`EventLogStorage` 构造第二参为 **worktreeHash**（[EventLogStorage.ts:343](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/EventLogStorage.ts#L343)、`:369-394` `sessionDir = join(resolveLegacySessionsDir(), worktreeHash, sessionId)`），而真实分区是 `resolveWorktreeHash()`（本机为 `57971aa3`）⇒ `exists()` 恒 false ⇒ `_deriveSessionMessagesFromEvents` 恒 `return null` ⇒ 每轮读都落到投影兜底。

`'default'` 的来源：`EventLogStorage.buildSessionDir` 的注释明确记载 —— **P1（2026-09-18）之前存在"传 `env={PYAPP_PROJECT_DIR:''}` 让 `resolveSessionsDir` 走 default"的旧 hack**；此处是该 hack 移除后的**残留字面量**。

**同文件内的正确写法早就在用**（本项的关键依据）：

```ts
// CoreAPIImpl.getSessionEvents（:1823-1830）—— 工作正常
const chatManager = this.chatManager as unknown as {
  _getOrCreateEventLog?(sessionId: string): EventLogStorage;
};
const log = chatManager._getOrCreateEventLog?.(sessionId);
```

`ChatManager._getOrCreateEventLog`（`:1651-1661`）用 **`resolveWorktreeHash()` 单一真源** + 实例缓存（key = `${hash}:${sessionId}`，P2-5 注释明写"与存储分区一致"）。

**证据链（三条独立）**
1. 代码：`CoreAPIImpl.ts:1651` 是全仓**唯一**硬编码 `'default'` 的 `new EventLogStorage(...)`；其余调用点分别为 `resolveWorktreeHash()`（ChatManager）、`path.basename(basePath)`（SessionGateway）。
2. 文件系统实测：`~/.pyapp/data/sessions/default/<sid>/events.jsonl` **不存在**；`~/.pyapp/data/sessions/57971aa3/<sid>/events.jsonl` **存在**。
3. 运行期：`GET …/messages` 响应中所有消息 `lastEventSeq` 为空；N-50 修复时基于"派生结果"的墓碑计算恒失败（日志 `deleteMessage: 未能定位该轮的事件 seq 区间`）。

---

## 2. 目标 / 非目标

**目标**
- G1：事件派生读路径按其设计生效（同一会话的读源 = `事件派生(agg) + 投影覆盖`）。
- G2：**不引入回归** —— 尤其不得让 N-50 的"删提问留孤儿回复"复活。

**非目标（明确不做）**
- N1：不改 `EventMessageDeriver` 派生算法本身（聚合/覆盖/合并块规则一律不动）。
- N2：不重构"事件 + 投影"双写架构，不动写入路径。
- N3：不顺手修 N-51（投影重复写入）与 N-53（同进程陈旧读）—— 仅复测其表现并回填台账。
- N4：不引入特性开关（项目规则反对 feature flag）；回滚 = 一处代码回退。

---

## 3. 影响面（评审重点）

| 领域 | 现状（派生未生效） | 修复后预期 | 风险 |
|------|------------------|-----------|------|
| 读源 | 投影 `messages.jsonl` | 事件派生（agg 基线）+ 投影覆盖 | 长期休眠路径可能有未暴露缺陷 |
| 排序 | 投影写入序 | `lastEventSeq`（事件序，B-2） | 用户可见顺序变化（多为修正） |
| 重复消息（N-51） | 投影同 id ×2 **直接外溢** | 派生按 `messageId` 聚合，**预计自动去重** | 待实测确认 |
| 中断提示 | 依赖投影是否落 `finishReason` | 按 turn 回填（canceled/error，`:635-654`） | 提示可能**新增**出现（属修正） |
| yield 回放标记（A1-f） | 到不了前端（N-45 补注） | `finishReason:'yielded'` 可达消息 | 与 N-45 会话级提示条并存（互补） |
| 压缩 summary | `trajectoryCompactions` 合成 | 生效 | 长会话可能多出摘要消息 |
| **删除（N-50）** | 删投影即生效（因读投影） | **不再足够** ⇒ 必须同批补墓碑 | **最高风险：否则孤儿回复回归** |
| 性能 | 纯投影读 | 每次读**全量 events**（分批 10000，排除 `assistant/thinking`） | 长会话延迟上升 —— 需实测基线 |

---

## 4. 方案

### 4.1 主改（最小、复用既有正确写法）

`_deriveSessionMessagesFromEvents` 改为复用 ChatManager 的事件日志实例（与写入方同分区、同实例缓存）：

```ts
// N-52 修复：与 getSessionEvents 同一访问器 —— worktreeHash 走 resolveWorktreeHash 单一真源
const chatManager = this.chatManager as unknown as {
  _getOrCreateEventLog?(sessionId: string): EventLogStorage;
};
const eventLog = chatManager._getOrCreateEventLog?.(sessionId);
if (!eventLog || !eventLog.exists()) return null;   // 取不到 ⇒ 保持现有投影兜底（显式降级）
```

未取到实例时**保持现有投影兜底**（不新增第二条 fallback 逻辑）。

### 4.2 同批必做：N-50 删除墓碑（防回归）

派生生效后，删投影不再能阻止 agg 重新派生被删轮次 ⇒ 必须补回"轮次墓碑 + 读时过滤"：

1. `session/storage/deletedRanges.ts`（**纯函数**，可单测）：`DeletedSeqRange`、`isSeqInDeletedRanges`、`addDeletedRange`（合并重叠/相邻）。*（该实现已在本日 N-50 过程中写完并验证过，后因前提不成立而回退；此处按已修正的前提重新引入。）*
2. 会话语义：`SessionMetadata.deletedMessageRanges?: Array<{ startSeq: number; endSeq: number | null }>`（`core/data-models.ts` 与 `session/types/Session.ts` 两处声明，后者已标注 `@deprecated`，仍为该路径实际类型）。
3. 写入（`CoreAPIImpl.deleteMessage`）：区间边界取**派生结果**的 `lastEventSeq`（此时派生已生效 ⇒ 精确）：起点 = 目标 user 消息的 `lastEventSeq`；终点 = 下一个 user 消息的 `lastEventSeq - 1`（无下一个 ⇒ `null` = 到末尾）；写入内存 + `gateway.updateSession` 落盘。
4. 读取（`getSessionMessages` 的派生分支）：`_filterDeletedRanges(sessionId, derived)` 按 `lastEventSeq` 过滤（无墓碑时零成本返回原数组）。
5. 投影侧仍整轮删除（N-50 已实现）—— 两条防线互补（投影兜底路径靠它）。

### 4.3 不做的事

不改派生算法；不加开关；不为"历史已删轮次"做一次性回填（当前无此类数据）。

---

## 5. 验证计划（每步留证据，禁止推测）

| # | 动作 | 通过标准 |
|---|------|---------|
| V1 | 修复前基线快照：3 个代表性会话（短/中/长，含 `hello` 192 条投影）记录 `GET …/messages` 的条数、id 序列、顺序、耗时（各 3 次取中位数） | 形成基线数据 |
| V2 | 修复后逐会话对比（条数/id/顺序/内容） | 所有差异**逐条解释**，无未解释差异 |
| V3 | N-51 复检：曾经重复的会话（投影同 id ×2） | 重复是否消失（记录结论并回填台账） |
| V4 | N-50 回归：新建双轮会话 → 删 A 轮提问 → 读回只余 B 轮 → **重启**后仍只余 B 轮 | 无孤儿、无复活 |
| V5 | A1-f 生效性：驱动一次真实 yield → 消息携带 `finishReason:'yielded'` | 标记可达 |
| V6 | 性能对比：长会话 `GET …/messages` 耗时（前/后中位数） | 记录实测值；若显著劣化（阈值待评审确认）另立优化项 |
| V7 | 静态与回归：app `typecheck` / `eslint` / `bun test` 全量 + `lint:arch` | 全绿，测试数不低于基线 |
| V8 | 相邻项复测：N-53（同进程陈旧读）是否变化 | 记录结论并回填台账 |

**回滚**：4.1 一处回退即回到现状（投影兜底）；4.2 的墓碑对投影路径无副作用，可独立保留。

---

## 6. 合规核对

| 规则 | 落实情况 |
|------|---------|
| **CS01 归一化检查** | 复用既有 `_getOrCreateEventLog`（同文件 `getSessionEvents` 已在用）与 `resolveWorktreeHash()` 单一真源；墓碑纯函数复用本日已写并验证过的实现，不新造 |
| **CS03 回退策略最小化** | 仅保留"取不到事件日志实例 ⇒ 走既有投影兜底"这一条（真实存在的降级场景）；不新增其他 fallback |
| **CS05 根因优先** | 修 `'default'` 字面量这一单点根因，不绕过（不改为"投影为主源"以此掩盖） |
| 架构 R01（基础设施复用） | 复用 `EventLogStorage` 实例缓存与路径解析，不新建平行实现 |
| 架构 R02（数据模型统一） | 墓碑字段在 `DataSessionMetadata` 与 `session/types/Session.ts` 两处**同时**声明并注明 `@deprecated` 关系（存量类型重复问题不在本项范围） |
| §2.1 / §2.9 | 本 Spec + 实施后台账（N-52/N-50）与 `api-spec.md` 同步 |

---

## 7. 评审待决问题

1. **性能阈值**：长会话读全量事件的开销可接受线是多少？（V6 实测后判定，或先设定如"中位数增幅 ≤ 2×"）
2. **顺序变化**：排序切到 `lastEventSeq` 后，若个别会话顺序与用户认知不符，是否接受"以事件序为权威"？
3. **实施粒度**：4.1 与 4.2 是否必须同一批落地（我建议**必须**，否则 N-50 回归）？
