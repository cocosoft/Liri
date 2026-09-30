# Spec：沙箱生命周期"冻结/复用"态（B5，pack_diff 轻量版）

> **状态**：🛑 **已下线（2026-09-29）—— 不再是"待实施"项**：本 spec 依赖的整层「沙箱实例层」已按用户裁定**删除**（`SandboxPruner` / `SandboxImpl`（含 `SandboxManagerImpl` + 各平台沙箱类）/ `WorkerSandbox` / `PluginHealthMonitor` / `tools/sandbox/ToolSandboxRouter`）—— 台账 **D-25**（前序取证见 **D-16**）。**冻结/复用无从谈起（既无触发点、也无可复用载体）**。若将来要重建"实例级沙箱生命周期"，应**另立新 spec**（含"为什么需要 + 挂哪条活链路"），本文件仅作历史留档。
> **来源**：[`Liri优化方案-20260925.md`](../../dev_docs/Liri优化方案-20260925.md) §3 B5（P1，§3 唯一剩余 P1）
> **关联规则**：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS05（根因优先）/ §1.8（日志）/ R06-008（分层）
> **代码面**：`app/src/sandbox/SandboxPruner.ts`（判据与状态机）、`app/src/sandbox/`（快照端口）
> **最后更新**：2026-09-29（D-16 追加取证：无可挂活路径 ⇒ 阻塞）

---

## 1. 问题（现状与缺口）

**现状（复核，2026-09-25）**：全仓**无** checkpoint / snapshot / restore / freeze 语义（`ResourceLimitManager` 的用量快照与 `DockerNetworkPolicy` 的配置快照语义不同，不算）。超时回收只做一件事：

- [`SandboxPruner.ts:26-31`](../../app/src/sandbox/SandboxPruner.ts)**`PruneResult`** = `{ removedCount, removedIds, remainingCount, durationMs }` —— **只有"移除"一种终态**；
- [`SandboxPruner.ts:195-198`](../../app/src/sandbox/SandboxPruner.ts)：判定超时后 `this.instances.delete(id)` + `removedIds.push(id)` ⇒ **沙箱状态直接丢弃**，下次同类任务只能**重建**（重新构建/装配）。

**缺口**：论文（DSec）指出的"会话状态值得 checkpoint"在 Liri 完全缺失 ⇒ 高频短任务场景下**重复付构建成本**。

**为什么值得做（可检验的动机）**：若同一 `fingerprint` 的沙箱被反复创建，冻结/复用应把这部分成本从"每次重建"降为"一次恢复"。**该收益未实测**（本机无 Docker CI）⇒ 本 spec 只把它作为**动机**，不作为验收前提。

---

## 2. 目标与验收（可证伪）

- **G1（主目标）**：`PruneResult` 增**第三态 `frozen`**；超时沙箱在**可冻结**时改为冻结（**不删除**），并登记到**可复用索引**；`fingerprint` 命中时走**恢复**而非重建。
- **G2（增量的可执行落点）**：论文明确前提是"**必须增量**（基于共享 base），否则存储爆"。本 spec 把该前提**变成代码约束**：冻结节记录 `baseRef`，**恢复时 `baseRef` 不匹配 ⇒ 拒绝恢复**（fail-closed，不静默给出错误状态）。
- **G3（不静默降级）**：快照器**缺失 / 抛错**时**不得静默丢弃状态**：至少 WARN + 如实计入 `PruneResult`（新增 `freezeFailedIds`），并退回"直接回收"（否则会泄漏沙箱）—— 该回退**必须被观测到**（CS03：允许的回退必须不掩盖错误）。
- **G4（零回归）**：未配置快照器时，行为**与现状完全一致**（`PruneResult` 旧字段语义不变）。

---

## 3. 设计要点

### 3.1 决策（为什么用"注入式端口"而不是直接写 Docker）

- **根因**：`SandboxPruner` 是**生命周期判据**（谁超时、谁回收），"怎么冻结"是**后端相关**能力（Docker `commit` / 可写层导出；未来还有别的后端）。把两者耦合会导致 pruner 依赖 Docker 细节（R06-008 分层）。
- **做法**：定义**端口** `SandboxFreezer`（`freeze(sandboxId, baseRef) => Promise<{snapshotRef}>` / `restore(snapshotRef) => Promise<void>` / `drop(snapshotRef)`），由**调用方注入**（GR01：不新造框架，端口即契约）。未注入 ⇒ 走 G4 的"与现状一致"路径。

### 3.2 数据结构（增量前提的可执行化）

- `PruneResult` 增：`frozenCount` / `frozenIds` / `freezeFailedIds`（缺省 0 / 空数组 ⇒ **旧消费方不受影响**）。
- 可复用索引：`Map<fingerprint, { snapshotRef: string; baseRef: string; frozenAt: number }>`；`baseRef` 不匹配 ⇒ **拒绝恢复**（G2）。`fingerprint` 由**调用方**提供（pruner 不该知道镜像/挂载语义）。
- **容量**：索引入口上限可配（默认如 8）；超限按 `frozenAt` 最旧淘汰并 `drop(snapshotRef)`（避免"存储爆"的第二道闸）。

### 3.3 回收判定（三态）

```
shouldRemove && freezer 可用 && fingerprint 已知  ⇒ 冻结（frozen）
shouldRemove && (无 freezer || 冻结失败)          ⇒ 回收（removed，现状行为）+ WARN
其余                                              ⇒ 保留（现状）
```

---

## 4. 任务清单与状态（未开工）

| 编号 | 任务 | 状态 | 验证方式 |
|---|---|---|---|
| S1 | `SandboxFreezer` 端口 + `PruneResult` 三态扩展（**纯类型/契约**，零行为变化） | 未开工 | typecheck + 现有 pruner 用例全绿（G4 零回归） |
| S2 | pruner 三态分流 + 可复用索引（容量 + 最旧淘汰） | 未开工 | **假快照器**离线用例：超时 ⇒ `frozenIds` 有值且 `instances` **未删**；无快照器 ⇒ 与旧行为逐字段一致 |
| S3 | `tryRestoreByFingerprint()` + **`baseRef` 不匹配拒绝** | 未开工 | 用例：命中 ⇒ 调 `restore` 且不入 `instances`？/基 `baseRef` 不同 ⇒ **拒绝**并给原因 |
| S4 | 冻结失败路径（WARN + `freezeFailedIds` + 退回回收） | 未开工 | 用例：假快照器抛错 ⇒ `freezeFailedIds` 含该 id 且**照常回收**（不泄漏） |

**依赖顺序**：S1 → S2 →（S3 ∥ S4）。**全部可离线完成**（假快照器注入）。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | 复用既有 `SandboxPruner` 的判定循环与日志门面；**不新造**调度框架（端口 + 注入） |
| CS01（新增前先查已有） | 已复核"全仓无 checkpoint/restore 语义"（§1）⇒ 属**真实缺口**，非重复实现 |
| CS03（回退最小化） | 仅一处回退（快照不可用 ⇒ 退回回收），**必须**伴随 WARN + `freezeFailedIds` 观测；不静默 |
| CS05（根因优先） | "增量"不靠文档约定，**落成 `baseRef` 校验**（不匹配即拒绝） |
| §1.8（日志） | 新增日志一律 `logger.warning/info`，module 沿用 `sandbox:*` |
| R06-008（分层） | pruner 只依赖**端口**，不 import Docker 实现 |
| R12-001 / 兼容 | `PruneResult` 新增字段**可选**？⇒ 采用"缺省 0/空数组"的**必填但默认值稳定**策略，旧消费方零改动 |

---

## 6. 不在范围 / 未验（如实）

- **真实 Docker 冻结/恢复的端到端**：`docker commit` 或可写层导出的**实现**与 e2e **不在本 spec 的 S1–S4**（本机无 Docker CI）⇒ S1–S4 完成后，Docker 侧实现应另开任务，并在真实 Docker 上验"恢复后的沙箱状态与冻结前一致"。
- **收益量化**（省了多少构建时间）：需真实工作负载，未做。
- B7（层级化配额与委派）、B8（QoS 执行侧投影）不在本 spec。
