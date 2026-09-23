# 时序轨迹双源问题 · 实证报告

> 结论范围：**基于源码静态证据（含文件路径 + 行号）**。
> 运行时漂移样本（lastEventSeq 与 maxChunkSeq 的实际差值）需执行 `probe_sessions.ps1` 采集，**本报告未包含该运行时数据**。

## 一、问题定界

系统**已有**时序轨迹（`events.jsonl`，seq 单调递增、append-only），且读路径确实以它为权威源。
未收敛为单源的原因不是"没做"，而是处于**权威源 + 物化视图的双源过渡态**。

## 二、五条根因（静态证据）

### 根因 1：存量 v0 会话是硬闸门

`app/src/runtime/api/CoreAPIImpl.ts:1796-1800`

```ts
const hasV1 = events.some((e) => {
  const d = e.data as { messageId?: string };
  return typeof d.messageId === 'string';
});
if (!hasV1) return null;   // ← 回退投影路径
```

事件派生链路 2026-08-23（P2-1）才引入；此前的会话只有 `messages.jsonl` 投影。
移除投影路径将使存量会话读出空 → 投影路径**是兼容层，不是冗余**。

### 根因 2：反向迁移未跑完，双写是中间态

- `app/src/chat/ChatManager.ts:1481 / 1502 / 1788 / 1927` — 四处 `new MessageToEventMigrator(...)`，用投影**反向补写**事件
- `app/src/session/storage/ReconcileService.ts:320` — 对 `backfillCandidates` 反向补全
- `app/src/session/storage/ReconcileService.ts:192` — 报错文案：`投影消息 ${p.id} 无对应事件（lastEventSeq=...），events 半写，需反向补全`

即：**事件流尚不完备**，存在靠投影回填的缺口。此时把投影降级为可丢弃 = 丢数据。

### 根因 3：投影携带事件中不存在的信息

| 信息 | 证据 |
|---|---|
| thinking 块 | `CoreAPIImpl.ts:1790` — 派生时 `excludeTypes: ['assistant/thinking']`（长会话优化），thinking 仅存于投影 + 实时流 |
| 消息形态契约不同 | `CoreAPIImpl.ts:1531-1534` 注释：投影含**独立 tool 消息**（1601/1634），事件派生把 tool 信息**嵌入 blocks**；前端契约为 blocks |
| 压缩摘要消息 | `trajectoryCompactions` 是 metadata + 投影侧概念，派生器按区间 `endSeq` 合成 |

### 根因 4：性能 —— 物化视图的正当性

- 事件不可变 ⇒ 读 = 重放
- `CoreAPIImpl.ts:1838` 注释：N-55 实测 3847 事件冷派生 **~1.2s**
- 对冲手段：`CoreAPIImpl.ts:1704` 32 会话 LRU 派生缓存；`CoreAPIImpl.ts:1755-1766` 指纹 = `tailSeq | 投影条数 | 末条 id | 压缩区间数`

### 根因 5：不可变日志的删除语义代价

`app/src/session/storage/deletedRanges.ts`

- 事件日志不重写（重写留 seq 空洞）⇒ 删除只能打墓碑：闭区间，`endSeq === null` 表示"到会话末尾"
- 读时过滤：`CoreAPIImpl.ts:1541-1544` `_filterDeletedRanges` → `CoreAPIImpl.ts:2146` 注释「无墓碑时零成本返回原数组；过滤键为派生消息的 `lastEventSeq`」

## 三、缺陷收口点：同一个时序，两套坐标

| 坐标 | 语义 | 证据 |
|---|---|---|
| 投影 `lastEventSeq` | **写盘时刻的会话全局 tail seq** | `ChatManager.ts:2114-2117`（`getStreamTailSeq` → `eventLog.getTailSeq()`）；`ChatManager.ts:2275-2280` 赋值 |
| 事件聚合 `agg.maxChunkSeq` | **该消息自身最后一个 chunk 的 seq** | `EventMessageDeriver.ts:61` 声明、`:545/:552` 累加 |

比较点：`app/src/session/storage/EventMessageDeriver.ts:655-659`

```ts
if (proj && typeof proj.lastEventSeq === 'number' && proj.lastEventSeq >= agg.maxChunkSeq) {
  // 投影可信 → 用投影覆盖聚合结果
```

同文件 `:666-670` 的注释**已自承这是历史 bug 源**：

> 投影版本戳可能错误指向后续事件（如损坏行/并发写入后 updateMessageBlocks 落盘的 seq 漂移），导致该消息被排到实际时序之后（"AI 回复被混合进下一轮"）

**连带成本**（双坐标导致）：

- `EventMessageDeriver.ts:109-119` `resolveFallbackSeq` — lastEventSeq 缺失时按 timestamp 在事件时间轴二分定位近似 seq
- `ReconcileService.ts:166` — 跳过 `lastEventSeq === 0` 的纯投影兜底
- `ReconcileService.ts:177` — `isInTrimRange(p.lastEventSeq, trimRanges)` 修剪缺口排除
- `CoreAPIImpl.ts:1685` — N-57：排序键 `lastEventSeq` 存在重复值（同轮多条共享 seq）

## 四、收敛路径

1. **投影降级为纯缓存**：写投影不再是正确性前提，仅服务加速与 v0 兼容
2. 迁移 + 对账跑净后，移除 `hasV1` 闸门（`CoreAPIImpl.ts:1800`）
3. **统一坐标（建议先做）**：投影 `lastEventSeq` 语义改为"该消息自身事件区间 maxChunkSeq" ⇒ `EventMessageDeriver.ts:655` 整段比较逻辑可删，`resolveFallbackSeq` 可简化

第 3 步风险最低、收益最大，且不依赖迁移完成，可直接消灭"AI 回复被混合进下一轮"类时序错位。

## 五、待采集的运行时证据（未完成）

`probe_sessions.ps1`（仓库根目录）用于扫描磁盘上真实会话，输出：

- `events.jsonl` / `messages.jsonl` 是否存在及规模
- 各消息 `lastEventSeq` 与事件侧 `maxChunkSeq` 的实际差值分布
- 差值 > 0 的样本（即坐标漂移实例）

**运行方式**（需在本机 PowerShell 执行；我无 shell 执行权限，故此项未落地）：

```powershell
cd E:\PY\Documents\CODES\PY_APP
powershell -ExecutionPolicy Bypass -File .\probe_sessions.ps1
```

把输出贴回来，即可把本报告的"静态推断"升级为"运行时实证"。
