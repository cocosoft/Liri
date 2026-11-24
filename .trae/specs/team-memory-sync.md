# 团队记忆真实同步 · 立项方案（草案 · 2026-11-25）

> 来源：`agent-memory-optimization.md` §8.6（团队记忆当前为模拟/未接线实现，需单独立项）。
> 状态：**待评审**（本轮只出方案，不改代码）。
> 约束：默认关闭、默认不自动覆盖（沿用 `memory-conflict-detection.md` 裁定）、
> 密钥扫描 fail-closed、按阶段独立提交（`code-deletion.md` CD05/CD06）。

---

## 0. 结论摘要

仓库里已有 **两套半** 团队记忆同步实现，但没有一套能真正跨机器工作：

| 实现 | 位置 | 实际行为 | 接线状态 |
|---|---|---|---|
| 本地团队记忆 + 文件式 sync | `packages/infra/src/memory/services/TeamMemoryService.ts` | CRUD/访问级别/加密可用；`sync()` 用**文件系统**充当"远端"（`readRemoteTeamMemories`/`saveRemoteTeamMemories`） | 由 `MemoryManagerImpl` 构造，但 `this.teamMemoryService.` **零调用** |
| etag 同步客户端 | `packages/infra/src/memory/services/TeamMemorySyncService.ts`（680 行） | 有 `serverUrl`/etag/增量/冲突/密钥扫描/定时器 | `defaultTeamMemorySyncService` **零消费者** |
| setTimeout 模拟 | `packages/service/src/services/teamMemorySync/TeamMemorySyncService.ts` | 伪造延迟并返回成功，团队库恒为空 | 零消费者；已于 2026-11-25 标 `@deprecated` + `simulated` |

⇒ 本立项要做的不是"再写一套"，而是：**定服务端契约与身份模型 → 接线已有 etag 客户端 → 用开关灰度**。

---

## 1. 现状取证（代码事实）

### 1.1 本地团队记忆服务（infra）

- 配置：`TeamMemoryConfig`（`TeamMemoryService.ts:99-115`）—— `enabled` / `teamId` / `teamMemoryDir` /
  `syncInterval`（秒）/ `conflictResolution`（`local_wins|remote_wins|manual`）/ `enableEncryption` / `defaultAccessLevel`。
- 同步：`sync(): Promise<TeamMemorySyncRecord>`（`:292-350`）—— 读本地 + 读"远端文件" → 冲突检测 → 解决 → 合并 → 写回两端。
  **"远端"是同一台机器上的文件** ⇒ 不构成跨端同步。
- 冲突与记录类型：`TeamMemoryConflict`（`:146-151`）、`TeamMemorySyncRecord`（`:156-162`）、
  `TeamMemorySyncStatus`（`NOT_SYNCED/SYNCING/SYNCED/CONFLICT/ERROR`）。
- 其它能力：访问级别判定（`:951`）、加密/解密（`:190-195`）、统计（`:995`）、按路径配置（`:735-871`）。

### 1.2 etag 同步客户端（infra，683 行）

- 配置：`TeamMemorySyncConfig`（`TeamMemorySyncService.ts:92-102`）—— `serverUrl` / `teamId` / `localDir` /
  `syncInterval` / `conflictResolution` / `enableSecretScan` / `maxConcurrent` / `timeout` / `incremental`。
- 数据：`MemorySyncState{localEtag, remoteEtag, status: synced|local_newer|remote_newer|local_only|remote_only|conflict}`
  （`:46-59`）；`SyncResult{uploaded,downloaded,skipped,conflicts,errors,duration}`（`:64-72`）。
- 调度：`start()` 定时 `sync()`（`:142-159`，定时器 `unref`）；密钥扫描器可注入（`:649`）。
- 现状：`export const defaultTeamMemorySyncService`（`:680`）**无任何消费者**。

### 1.3 暴露面

- `MemoryManager` 接口上的 `getTeamMemories` / `triggerTeamMemorySync` / `setTeamMemoryConfig` 等
  （`packages/infra/src/memory/MemoryManager.ts:110,156,164`）位于**无人实现**的旧接口；实现类未提供。
- `app/src/infrastructure/http` 与 `client/src` 对 team memory **零命中** ⇒ 无 HTTP API、无 UI。
- 目录：`resolveTeamMemoryDir()` = `<data>/team-memory`（`packages/infra/src/environment/paths.ts:593-598`）。

---

## 2. 目标与非目标

### 2.1 目标

1. **跨机器**同步团队记忆：成员 A 写入的团队记忆，成员 B 在显式同步后可见。
2. **增量**：只传变更（版本/etag），断点可续（cursor 落盘）。
3. **默认安全**：开关默认关；同步前密钥扫描 fail-closed；跨团队隔离。
4. **默认不自动覆盖**：冲突产出候选，人工审阅后再决定（与 `memory-conflict-detection.md` 裁定一致）。
5. **可观测**：每次同步产出结构化记录（start/skip/fail/complete，R08-002）。

### 2.2 非目标（本轮不做）

- 服务端实现本身（属后端仓库/另一交付；本仓只定契约与客户端）。
- 实时推送（WebSocket）；先做拉取 + 手动/定时推送。
- 团队记忆的端到端加密协商（先客户端加密存储 + TLS 传输）。
- 跨团队共享/公开市场。

---

## 3. 服务端契约（建议）

### 3.1 数据模型 `TeamMemoryRecord`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 记忆 id（客户端生成，团队内唯一） |
| `teamId` | string | 团队隔离键（**所有查询必须带**） |
| `ownerKey` | string | 写入者（`<tenant>:<user>`，见 `project_rules §1.5`） |
| `content` | string | 正文（按策略加密后再传） |
| `contentHash` | string | 正文/元数据摘要（幂等与冲突判定） |
| `accessLevel` | enum | `public/team/project/private/protected/admin` |
| `version` | integer | 服务端单调递增（冲突与增量依据） |
| `updatedAt` | ISO | 客户端更新时间（仅展示/辅助，不用于定序） |
| `deletedAt` | ISO? | 软删（墓碑，保证删除可同步） |
| `etag` | string | `version + contentHash` 派生 |

### 3.2 端点

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `/v1/team-memory?teamId=&cursor=&limit=` | 增量拉取（`version > cursor`），返回 `{items, nextCursor}` |
| `GET` | `/v1/team-memory/:id` | 单条读取（含 `etag`） |
| `PUT` | `/v1/team-memory/:id` | 写入（`If-Match: <etag>`；不匹配 ⇒ **409** + 远端当前记录） |
| `DELETE` | `/v1/team-memory/:id` | 软删（`If-Match` 同上） |
| `POST` | `/v1/team-memory/sync` | 批量（可选；单条接口已足够时不做） |

**幂等**：同一 `(teamId, id, version)` 重放 ⇒ 直接返回当前记录，不重复写入。

### 3.3 鉴权与隔离（fail-closed）

- 传输：Bearer（复用 `REQUIRE_BEARER` 基线）；无有效身份 ⇒ 401。
- 授权：调用者必须是 `teamId` 成员；非成员 ⇒ 403。
- 隔离：服务端每条读都带 `teamId` 过滤（租户库另一层用 `owner_key`），漏过滤即越权。
- 客户端：`serverUrl` 为空 ⇒ 状态 `NOT_CONFIGURED` 并**明确报错**，**不得**伪造成功（当前模拟实现的反面）。

---

## 4. 客户端方案（本仓）

### 4.1 接线路径（复用，不新造）

1. **以 infra `TeamMemorySyncService` 为基底**（已有 etag/增量/冲突/密钥扫描/定时器）：
   - 补 `fetch` 传输层（`serverUrl` + Bearer + 超时/重试，复用 `withRetry`）；
   - `sync()` 改为真实 HTTP；`NOT_CONFIGURED` 显式状态；
   - 保留 `setSecretScanner()`：**上行前** `scanMemoryContent()` 命中即拒发并写审计。
2. **本地落库**：`TeamMemoryService`（本地目录 + 访问级别 + 加密）继续作为"本地团队记忆"读写面；
   同步器只在该目录与远端之间搬运。
3. **状态与 cursor**：新增表 `team_memory_sync_state(team_id PRIMARY KEY, cursor INTEGER, last_sync_at TEXT, last_error TEXT)`
   （仅新增表，不改既有结构；`project_rules §1.5` 允许新增）。
4. **调度**：开关 `memory.teamSync.enabled`（默认 `false`）；`memory.teamSync.serverUrl` / `teamId` / `intervalSec`。
5. **冲突**：默认 `manual` ⇒ 写候选文件（复用 P0-2 的 `conflict-candidates.json` 模式，例如
   `team-memory/conflicts/<id>-<version>.json`），**不自动改写本地/远端正文**。

### 4.2 状态机

`NOT_CONFIGURED → IDLE → SYNCING → {SYNCED | CONFLICT | ERROR} → IDLE`

- `SYNCING` 期间再次触发 ⇒ 跳过并记 `sync_skip`；
- `ERROR` 保留 `lastError`，下个周期重试（退避：1×/2×/4×，上限 15min）。

### 4.3 审计与可观测（R08-002）

事件/日志字段统一：`teamId`、`direction`、`uploaded`、`downloaded`、`skipped`、`conflicts`、`durationMs`、`error`。
落点：`logger`（module `memory:teamSync`）+ 同步记录持久化（`team_memory_sync_log` 表或复用现有记录文件）。

---

## 5. 分阶段路线

| 阶段 | 范围 | 门禁/验收 | 备注 |
|---|---|---|---|
| **Phase 0** | 接线开关 + `NOT_CONFIGURED` + 传输层骨架（不联网也能通过） | 默认关时行为零变更；未配置时状态明确；单测 | 本轮之后第一个提交 |
| **Phase 1** | 单向拉取（远端→本地，只读合并）+ cursor 续传 | 重复拉取幂等；重启后不重头；密钥扫描拒绝上行 | 不写远端 |
| **Phase 2** | 双向增量 + `If-Match` 409 + manual 候选 | 冲突产候选、正文不变；并发写不丢数据 | 光标 + etag 双保险 |
| **Phase 3** | 审阅入口（CLI/设置页）+ 审计报表 | 人工可采纳/忽略候选；审计可查 | UI 单独评估 |

每阶段独立提交；`memory.teamSync.enabled` 默认关，观察期后再开。

---

## 6. 验收与测试基线

**单测（临时目录 + fetch stub）**
1. 未配置 `serverUrl` ⇒ `NOT_CONFIGURED`、零网络请求、不伪造成功。
2. 增量：cursor=10 ⇒ 只请求 `version>10`；重复同步不重复下载。
3. `If-Match` 不匹配 ⇒ 409 ⇒ 生成冲突候选文件，本地正文不变。
4. 密钥命中 ⇒ 拒发该条 + 审计 + 继续处理其它条（不整批失败）。
5. 鉴权缺失/非成员 ⇒ 401/403，状态 `ERROR` 带原因。
6. 重启续传：cursor 从表读回，不从头拉。

**集成（本机）**：临时目录 + 本地 mock HTTP server（`Bun.serve`），跑通 拉取→修改→409→人工采纳 全链。

**明确不在本轮**：服务端实现、真实网络 e2e、团队权限服务。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 误覆盖团队记忆 | 默认 `manual`；不自动改写；候选文件 + `.trash` 归档可恢复 |
| 密钥/隐私外泄 | 上行前 `MemorySecretScanner` fail-closed；TLS；`enableEncryption` |
| 跨团队越权 | 服务端 `teamId` 强制过滤 + 成员校验；客户端不缓存他队数据 |
| 时钟漂移导致乱序 | 定序只用服务端 `version`；`updatedAt` 仅展示 |
| 同步风暴 | 单飞（SYNCING 跳过）+ 退避 + 单页 limit |
| 回滚 | 开关默认关；每阶段独立提交；cursor 表可清空重拉 |

---

## 8. 未决问题（需拍板）

1. **服务端归属**：自建（本仓后端）/ 复用现有协作设施 / 只做"共享目录"同步？
2. **身份来源**：本机身份（`LOCAL_PRINCIPAL`）还是登录租户（`<tenant>:<user>`）？
3. **加密责任端**：客户端加密（服务端只见密文）还是依赖服务端 + TLS？
4. **冲突默认策略**：确认 `manual`（建议）还是允许 `local_wins` 灰度？
5. **共享边界**：是否允许跨团队共享单条记忆（建议先不允许）。

---

## 9. 证据索引

- 本地团队记忆 + 文件式 sync：`packages/infra/src/memory/services/TeamMemoryService.ts:99-115,146-162,292-350,637,951,995`
- etag 同步客户端：`packages/infra/src/memory/services/TeamMemorySyncService.ts:46-72,92-118,142-159,175,649,680`
- 模拟实现（已标注）：`packages/service/src/services/teamMemorySync/TeamMemorySyncService.ts:47-65`
- 接口未实现：`packages/infra/src/memory/MemoryManager.ts:110,156,164`
- 团队目录：`packages/infra/src/environment/paths.ts:593-598`
- 既有裁定：`.trae/specs/memory-conflict-detection.md`；`.trae/specs/agent-memory-optimization.md` §8.6
- 安全基线：`.trae/rules/project_rules.md` §1.4（`REQUIRE_BEARER`）/ §1.5（租户库与 `owner_key`）
