# 团队记忆真实同步 · 立项方案（草案 · 2026-11-25）

> 来源：`agent-memory-optimization.md` §8.6（团队记忆当前为模拟/未接线实现，需单独立项）。
> 状态：**待评审**。已实现：Phase 0 门禁 + Phase 1 拉取 + Phase 2 共享目录版 + Phase 3-lite 审阅（见 §5.1）。
> **网络版服务端契约与实施拆解已补齐（2026-11-25，方案态；本次未改任何运行时、未新增端点）**，见 §3.2–§3.8 / §4.4 / §5.2 / §8。
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
| `contentHash` | string | `sha256(规范化正文 + 元数据关键字段)`；规范化 = 换行统一 `\n`、去首尾空白（与客户端 `TeamMemorySharedDirSync` 同口径） |
| `accessLevel` | enum | `public/team/project/private/protected/admin` |
| `version` | integer | 服务端单调递增（**唯一**定序依据） |
| `updatedAt` | ISO | 客户端更新时间（仅展示/辅助，**不**用于定序） |
| `deletedAt` | ISO? | 软删（墓碑；删除必须可同步，不能物理消失） |
| `etag` | string | `W/"<version>-<contentHash>"`（弱校验器；服务端每次写回新值） |

### 3.2 端点

**前缀约定**：`{base}` = 配置项 `memory.teamSync.serverUrl`（例：`https://team.example.com`）。
路径段固定为 `/teams/{teamId}/memories` —— 与**现有客户端**（`TeamMemorySyncService.ts:316/514/572`）一致，
避免"契约定一套、代码写一套"；前缀若需带 `/v1`，只改客户端**单一常量**（见 §5.2 Phase 2N-0）。

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `{base}/teams/{teamId}/memories?cursor=&limit=` | 增量拉取（`version > cursor`，`limit` 默认 100 / 上限 200），返回 `{items, nextCursor, hasMore}` |
| `GET` | `{base}/teams/{teamId}/memories/{id}` | 单条读取（含 `etag`）；墓碑同样返回（带 `deletedAt`） |
| `PUT` | `{base}/teams/{teamId}/memories/{id}` | 写入（`If-Match: <etag>`；首次创建可不带）。**不匹配 ⇒ 412** + 远端当前记录 |
| `DELETE` | `{base}/teams/{teamId}/memories/{id}` | 软删（写 `deletedAt` + `version+1`；`If-Match` 语义同上） |
| `POST` | `{base}/teams/{teamId}/memories/sync` | 批量（可选；**默认不做**，单条接口足够） |

**幂等**：同一 `(teamId, id, version, contentHash)` 重放 ⇒ 直接返回当前记录（2xx），不重复写、不递增 `version`。
**删除**：软删后 `GET` 列表仍返回该条（带 `deletedAt`），客户端据此删除本地；物理清理由服务端保留期策略负责。

### 3.3 鉴权与隔离（fail-closed）

- 传输：Bearer（复用 `REQUIRE_BEARER` 基线）；无有效身份 ⇒ 401。
- 授权：调用者必须是 `teamId` 成员；非成员 ⇒ 403。
- 隔离：服务端每条读都带 `teamId` 过滤（租户库另一层用 `owner_key`），漏过滤即越权。
- 客户端：`serverUrl` 为空 ⇒ 状态 `NOT_CONFIGURED` 并**明确报错**，**不得**伪造成功（当前模拟实现的反面）。
- **令牌来源（新增，建议）**：本机凭据库（`<LIRI_HOME>/credentials.json`，经 `CredentialStore`）的
  `teamSync` 条目（`getCredentialStore().get('teamSync')`）；缺失时不阻断启动，由服务端 401 如实暴露；
  **禁止**把令牌写进配置明文或日志（`TeamMemorySyncConfig` 不含令牌字段）。
- **成员校验的数据来源**：服务端主数据（团队表）——本仓不定义团队权限服务，只要求
  "非成员必 403"；客户端不缓存他队数据。

### 3.4 条件请求与错误码（客户端必须能分类）

| 状态码 | 语义 | 客户端处理 |
|---|---|---|
| 401 | 令牌缺失/过期 | `ERROR`，提示重新登录；**不重试** |
| 403 | 非团队成员 | `ERROR`（不重试，不降级为"空团队"） |
| 404 | 记录不存在（GET 单条） | 视为远端无此条（本地可推） |
| 412 | `If-Match` 不匹配（远端已变） | **冲突候选**（不覆盖）；拿响应里的远端记录算 hash |
| 409 | 并发创建同 id 且内容不同 | 同 412：冲突候选 |
| 428 | PUT/DELETE 缺 `If-Match`（且非首次创建） | `ERROR`（客户端缺陷，应修代码而非重试） |
| 429 | 限流 | 退避重试（见 §3.7） |
| 5xx | 服务端故障 | 退避重试；连续失败 ⇒ `ERROR` + `lastError` |

**错误体统一**：`{"error":{"code":"ETAG_MISMATCH","message":"…","current":{…}}}` ——
`code` 供程序分支，`message` 供人读；`current` 仅 409/412 返回。

### 3.5 请求/响应示例

```json
// PUT {base}/teams/team-a/memories/m_123   (If-Match: W/"7-ab12")
{"content":"部署窗口每周二 03:00","contentHash":"ab12…","accessLevel":"team"}
// 200
{"id":"m_123","teamId":"team-a","version":8,"etag":"W/\"8-cd34\"","updatedAt":"2026-11-25T08:00:00Z"}
// 412
{"error":{"code":"ETAG_MISMATCH","message":"remote version changed","current":{"id":"m_123","version":9,"etag":"W/\"9-ef56\"","content":"…"}}}
```

```json
// GET {base}/teams/team-a/memories?cursor=9&limit=100
{"items":[{"id":"m_123","version":10,"etag":"W/\"10-aa11\"","contentHash":"aa11…","deletedAt":null}],"nextCursor":10,"hasMore":false}
```

### 3.6 分页与限流

- `cursor` = 上次成功应用的最大 `version`（客户端落盘，见 §4.1-3）；服务端按 `version` 升序返回。
- `limit` 默认 100、上限 200；超过上限按 200 处理（不报错）。
- 服务端建议限流：单 token 60 req/min；超限 429 + `Retry-After`。

### 3.7 超时、重试与退避

- 客户端超时沿用 `TeamMemorySyncConfig.timeout`（默认值见实现）。
- 仅对 **429/5xx/网络错误** 重试：1× → 2× → 4×，上限 15min（与 §4.2 状态机一致）。
- 4xx（除 429）**不重试**；412/409 走冲突候选而不是重试。

### 3.8 服务端一致性验收清单（供对端实现自检）

- [ ] 所有读写都带 `teamId` 过滤，且校验调用者成员身份（401/403 语义见 §3.4）。
- [ ] `version` 单调递增；`etag` 由 `version + contentHash` 派生并随写更新。
- [ ] `If-Match` 不匹配返回 412 且带 `current`；首次创建允许不带 `If-Match`。
- [ ] 软删写墓碑（`deletedAt` + `version+1`），列表仍可增量拉取到。
- [ ] 同 `(teamId,id,version,contentHash)` 重放幂等（不重复写/不递增）。
- [ ] `cursor` 语义 = `version > cursor`；分页 `limit ≤ 200`。
- [ ] 幂等/冲突/鉴权失败均落审计（`teamId`、`ownerKey`、`id`、`version`、结果码）。

---

## 4. 客户端方案（本仓）

### 4.1 接线路径（复用，不新造）

1. **以 infra `TeamMemorySyncService` 为基底**（已有 etag/增量/冲突/密钥扫描/定时器）：
   - 补 `fetch` 传输层（`serverUrl` + Bearer + 超时/重试，复用 `withRetry`）；
   - `sync()` 改为真实 HTTP；`NOT_CONFIGURED` 显式状态；
   - 保留 `setSecretScanner()`：**上行前** `scanMemoryContent()` 命中即拒发并写审计。
2. **本地落库**：`TeamMemoryService`（本地目录 + 访问级别 + 加密）继续作为"本地团队记忆"读写面；
   同步器只在该目录与远端之间搬运。
3. **状态与 cursor**：新增表 `team_memory_sync_state(team_id PRIMARY KEY, cursor INTEGER, etags_json TEXT, local_hashes_json TEXT, last_sync_at TEXT, last_error TEXT)`
   （仅新增表，不改既有结构；`project_rules §1.5` 允许新增。`local_hashes_json` 为 2N-12 追加，旧表启动时自动补列）。
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

### 4.4 现有客户端与目标契约的差距（实证，Phase 2N 必改点）

| # | 现状（代码事实） | 目标 | 必改文件 |
|---|---|---|---|
| C1 | 路径写死 `/teams/{teamId}/memories`（`TeamMemorySyncService.ts:316/514/572`） | 契约同前缀；`/v1` 等差异收敛为**单一常量** | `TeamMemorySyncService.ts` |
| C2 | 请求**无 `Authorization`** 头 | Bearer（令牌来自 `credentials.json#teamSync.token`） | 同上 |
| C3 | 列表请求**无 `cursor/limit`**（一次拉全量） | 分页 + cursor 落盘（§4.1-3 的表） | 同上 |
| C4 | 非 2xx 一律抛通用错误；**无 412/409 分支** | 按 §3.4 分类：412/409 ⇒ 冲突候选 | `TeamMemorySyncService.ts` + `TeamMemorySharedDirSync.ts`（候选格式复用） |
| C5 | `etagCache` 仅内存（重启丢失） | etag 与 cursor 同表持久化 | 同上 + 新表 |
| C6 | 上传 body 仅 `{content}` | `{content, contentHash, accessLevel}` | 同上 |
| C7 | 无墓碑处理（远端删除不可见） | `deletedAt` ⇒ 删本地（`.trash` 归档） | 同上 |

**复用而非重写**：冲突候选文件格式、密钥扫描（`MemorySecretScanner`）、取舍入口
（`resolveTeamConflict` / CLI `/memory team` / 设置页 `TeamMemoryPanel`）全部沿用共享目录版，
网络版只替换"搬运层"（文件 ↔ HTTP）。

**解决进度（2026-11-25）**：C1/C2 已随 2N-0 解决；C3/C5（拉侧 cursor/etag 持久化）随 2N-1 解决；
C6 与 C4 推侧（412/409 ⇒ 候选）随 2N-2 解决。**C7（墓碑）随 2N-3 解决（2026-11-25）**；
网络候选在设置页**已可人工采纳**（2026-11-25：`resolveNetworkConflict` + 同一 resolve 端点；`keep_local` 清基线、`keep_shared` 下载落盘）。

---

## 5. 分阶段路线

| 阶段 | 范围 | 门禁/验收 | 备注 |
|---|---|---|---|
| **Phase 0** | 接线开关 + `NOT_CONFIGURED` + 传输层骨架（不联网也能通过） | 默认关时行为零变更；未配置时状态明确；单测 | ✅ 已实现（2026-11-25） |
| **Phase 1** | 单向拉取（远端→本地，只读合并）+ 幂等 | 重复拉取幂等；冲突不覆盖；密钥 fail-closed | ✅ 已实现（共享目录版，2026-11-25） |
| **Phase 2** | 双向增量 + `If-Match`（412/409）+ manual 候选 | 冲突产候选、正文不变；并发写不丢数据 | ✅ 共享目录版已实现（拉取+推送，异文只记冲突）；网络版拆解见 §5.2（Phase 2N-0…2N-5），待 §8 三项决策 |
| **Phase 3** | 审阅入口（CLI/设置页）+ 审计报表 | 人工可采纳/忽略候选；审计可查 | ✅ 已实现：候选文件 `conflicts.json` + 可编程取舍 `resolveTeamConflict`（含网络候选）+ 同步历史 `sync-history.jsonl` + CLI `/memory team` + 设置页 `TeamMemoryPanel`（HTTP 五端点：status/conflicts/resolve/audit/sync）；**审计报表随 2N-7 落地**（`/v1/memory/team/audit`） |

每阶段独立提交；`memory.teamSync.enabled` 默认关，观察期后再开。

### 5.1 实施记录

**Phase 0（2026-11-25）**
- `SyncStatus.NOT_CONFIGURED`：`serverUrl` 为空时 `sync()` 直接返回失败（不再走"空表 ⇒ 假成功"路径）；
  `start()` 不启动定时器。
- 配置键：`memory.teamSync.enabled`（默认 `false`）/ `serverUrl` / `teamId` / `intervalSec`（默认 300）。
- app `init.ts`：仅当 `enabled === true` 时解析配置并启动 `defaultTeamMemorySyncService`。
- 用例：`app/tests/memory/teamMemorySyncGate.test.ts`（NOT_CONFIGURED / start 不启动 / 配置解析）。

**Phase 1（2026-11-25，共享目录版）**
- 服务：`pullTeamMemoriesFromSharedDir({sharedDir, localDir})`（`TeamMemorySharedDirPull.ts`）——
  远端新 id 导入、同 id 同文跳过（幂等）、同 id 异文**只记冲突不覆盖**、命中密钥拒收。
- 配置键：`memory.teamSync.sharedDir`（与 `enabled` 同时满足才执行）；本地目标 = `resolveTeamMemoryDir()`。
- 接线：`runMaintenancePass()` 空闲期执行，报告落 `<team-memory>/pull-report.json`。
- 用例：`app/tests/memory/teamSharedDirPull.test.ts`（导入/幂等/冲突不覆盖/密钥拒收/目录不可读）。
- **检索接线（2026-11-25 追加）**：`recall_memory` 新增 `scope="team"` —— 统一服务
  `memorySearchService` 的 `resolveTeamMemory` 对团队目录复用 `MemoryRetrieverImpl`（无嵌入走关键词）；
  `all` 顺序 = 会话 → 团队 → 全局。团队记忆仍**不进系统提示**（不写 `MEMORY.md`）。
- **Phase 2（2026-11-25，共享目录版）**：`pushTeamMemoriesToSharedDir({localDir, sharedDir})` 与拉取镜像 ——
  本地新 id 上传、同文跳过、异文**只记冲突不覆盖**、命中密钥**拒发**；维护期先拉后推，
  报告分别落 `<team-memory>/pull-report.json` / `push-report.json`。
  用例：`app/tests/memory/teamSharedDirSync.test.ts`（拉取 4 + 推送 3）。
- **Phase 3-lite（2026-11-25）**：维护期把拉/推两向冲突合并为审阅候选，落
  `<team-memory>/conflicts.json`（`id` / `directions` / 两侧文件路径与 sha256）——**只读、不改写任一侧**；
  另提供**可编程取舍** `resolveTeamConflict({id, resolution: keep_local|keep_shared})`：
  只复制人工选中的一侧，且源内容仍要过密钥扫描（fail-closed）。
  每次维护追加一条审计留痕到 `<team-memory>/sync-history.jsonl`（拉/推条数、冲突数、密钥拒收、错误数；保留最近 200 行）。
  **CLI 审阅入口（2026-11-25）**：`/memory team` 列出冲突候选；`/memory team keep-local|keep-shared <id>`
  调用 `resolveTeamConflict`；支持 `--json`。
  **设置页审阅入口（2026-11-25 已做）**：`GET /v1/memory/team/status`（配置/状态/最近同步/最近记录）、
  `GET /v1/memory/team/conflicts`（候选列表）、`POST /v1/memory/team/conflicts/resolve`（人工取舍）；
  前端 `MemoryPage` 右列 `TeamMemoryPanel`（未配置提示 / 冲突列表 / 保留本地·采纳共享 / 失败提示）。
  取舍成功后 `resolveTeamConflict` 把该候选从 `conflicts.json` 移除（避免审阅列表继续展示已处理项）。
- 如实边界：团队记忆是独立目录/独立访问级别；共享目录版不含真实网络（网络版 Phase 2 待 §8 后三项拍板）。

**Phase 2N-0（2026-11-25，网络版传输层）**
- `TeamMemorySyncConfig.apiPrefix`（默认 `/teams`）：路径统一为
  `${serverUrl}${apiPrefix}/${teamId}/memories[...]`，`/v1` 差异只改这一处。
- Bearer：`setAuthToken(token)`（**不在 config 内**，避免 `getConfig()`/日志带出明文）；
  app `init.ts` 从 `CredentialStore.get('teamSync')` 注入；缺失不阻断启动，由 401 如实暴露。
- 错误分类：`classifyTeamMemoryHttpStatus()` → `UNAUTHORIZED/FORBIDDEN/NOT_FOUND/CONFLICT/
  PRECONDITION_FAILED/PRECONDITION_REQUIRED/RATE_LIMITED/SERVER_ERROR/HTTP_ERROR`，
  非 2xx 抛 `AppError(errorCode=分类码)`。
- **fail-closed 修复**：`fetchRemoteMemories` 原把异常吞成"空表"（401/网络故障 ⇒ 伪装远端为空 ⇒
  可能把本地全量当新增上传）；现记日志后**上抛**，由 `sync()` 记为 `ERROR`。
- 用例：`app/tests/memory/teamMemorySyncTransport.test.ts`（路径/鉴权头/apiPrefix/401/429/分类表）。

**Phase 2N-1（2026-11-25，分页与续传）**
- 新表 `team_memory_sync_state(team_id PK, cursor, etags_json, last_sync_at, last_error)`
  （`TeamMemorySyncStateStore`，仅新增表；`cursor` 只增不减，失败只写 `last_error` 不动 cursor）。
- `fetchRemoteMemories`：`cursor/limit=100` 分页循环（上限 50 页防游标异常死循环）；
  响应兼容契约 `{items,nextCursor,hasMore}` 与旧服务端 `{memories:[...]}`（etag 取 `metadata.etag ?? etag`）；
  成功后保存 `cursor = maxVersion` 与 `id→etag`；`incremental=false` ⇒ 单页全量、不带 cursor。
- `sync()` 失败时把原因写入 `last_error`（保留 cursor/etag，下一轮续传）。
- 用例：`app/tests/memory/teamMemorySyncPagination.test.ts`（两页推进 / 重启续传 / 全量模式 / 失败落库 4 例）。

**Phase 2N-2（2026-11-25，推送与冲突候选）**
- 本地源：`getLocalMemories()` 读 `config.localDir` 下的 `*.md`（文件名 = id，`etag` = 正文 sha256；
  与服务端 `contentHash` 同口径，`compareMemories` 优先比 hash，缺失时退回比 etag）。
- 上传：body `{content, contentHash, accessLevel}`（`accessLevel` 默认 `team`，可配置）；
  `If-Match` 取持久化/内存 etag；成功响应的新 etag **落库**（`saveEtags`，重启后仍是基线）。
- 冲突：412/409 ⇒ `TeamMemorySyncConflictError` ⇒ 写 `conflicts.json`
  （`source:'network'`、`directions:['push']`、两侧 sha256），**只尝试一次、不重试、不覆盖**；
  有冲突且无错误时状态为 `CONFLICT`。
- 设置页：网络候选只展示提示文案，不提供"保留本地/采纳共享"按钮（按文件取舍不适用于网络候选）。
- 用例：`app/tests/memory/teamMemorySyncPush.test.ts`（412 候选与不覆盖 / 成功 etag 落库）。




### 5.2 网络版实施拆解（Phase 2N-0 … 2N-15；每步独立提交）

> 前置：§8 的 3 项阻塞决策已拍板；默认 `memory.teamSync.enabled=false`，未配置 `serverUrl` 时行为零变更。

| 步骤 | 范围 | 落点（文件） | 验收 / 门禁 | 回滚 |
|---|---|---|---|---|
| **2N-0** | 契约常量 + Bearer + 错误码分类 + 超时/重试（C1/C2；不联网也能过） | ✅ 已实现（2026-11-25）：`apiPrefix` + `setAuthToken` + `classifyTeamMemoryHttpStatus`；**fetch 失败上抛**（不再吞成空表） | 未配置 ⇒ `NOT_CONFIGURED` 零请求；单测断言路径/鉴权头/401/429 | 独立提交可 revert；开关默认关 |
| **2N-1** | 拉取分页 + cursor 持久化（C3/C5 拉侧） | ✅ 已实现（2026-11-25）：`TeamMemorySyncStateStore`（新表 `team_memory_sync_state`）+ `cursor/limit` 分页；响应兼容 `{items,nextCursor,hasMore}` 与旧 `{memories}`；etag 落库 | cursor=10 ⇒ 只请求 `version>10`；重启从表续传；重复拉取幂等 | 清空表即可全量重拉 |
| **2N-2** | 推送 `If-Match` + 409/412 ⇒ 冲突候选（C4/C6/C7 推侧） | ✅ 已实现（2026-11-25）：本地 `*.md` 读取（hash=etag）+ 上传 body `{content,contentHash,accessLevel}` + `If-Match`；412/409 ⇒ `conflicts.json`（`source:'network'`），状态 `CONFLICT`；成功新 etag 落库 | 412/409 ⇒ 候选落 `conflicts.json`；**本地/远端正文均不变**；密钥命中拒发；只尝试一次不重试 | 关开关即停；候选可人工放弃 |
| **2N-3** | 墓碑处理（远端 `deletedAt` ⇒ 本地 `.trash` 归档） | ✅ 已实现（2026-11-25）：墓碑在 `compareMemories` **之前**摘除两侧条目（防 remote_only 反复下载 / local_only 复活）；本地 `<id>.md` 移到 `<localDir>/.trash/<id>.<ts>.md`；失败留 `<id>.deleted` 标记（下轮重试、期间不参与同步）。**顺带补全下载落盘**：`downloadMemory` 原只取 etag 属假成功，现按单条 GET 的 `content` 原子写入（缺正文 ⇒ `DOWNLOAD_CONTENT_MISSING` 报错）；远端 id 落盘前做路径安全校验（`UNSAFE_MEMORY_ID`） | 删除可同步；归档不物理删除；下载真实落盘；路径穿越被拒 | `.trash` 可还原 |
| **2N-4** | 状态机/退避/审计接线（R08-002）+ 设置页状态 | ✅ 已实现（2026-11-25）：`computeTeamMemorySyncRetryDelay`（1×/2×/4×，上限 15min）+ `isRetriableTeamMemorySyncError`（仅 429/5xx/网络错误；401/403 不重试）+ 退避定时器（`stop()`/手动 sync 清理）+ `getLastError()`；每轮结构化日志 + `sync-history.jsonl`。**顺带修冲突检测失效**：列表返回的 etag 只是"观测值"（`observedEtags`），不再覆盖"成功同步基线"（`etagCache`）——原实现把观测值当基线 ⇒ PUT 永远 If-Match 命中、静默覆盖他人修改；"内容已同步"时才采用远端 etag 作基线（人工采纳路径），成功同步后补存基线。**设置页状态已接**：`GET /v1/memory/team/status` 新增 `network` 字段（`teamMemoryNetworkStatus.ts` 投影，不含令牌）+ `TeamMemoryPanel` 展示网络同步状态/团队/最近同步/最近错误（未配置时提示开关） | `SYNCING` 单飞；429 触发 1× 退避；4 类事件齐全 | 开关关 + `stop()` 清定时器 |
| **2N-5** | 集成测试（本机 `Bun.serve` mock 服务端） | ✅ 已实现（2026-11-25）：`app/tests/memory/teamMemoryNetworkSync.test.ts` —— 契约 §3.2 三端点 + If-Match/412；覆盖 拉取→本地改→412→人工采纳→再推成功 + 401/403/429 各一例。**顺带修复（集成测试暴露）**：① 网络冲突候选原写死全局 `resolveTeamMemoryDir()` ⇒ 自定义/隔离 `localDir` 时错位并污染用户数据目录；现改落 `config.localDir`（与下载/墓碑/审计同源）。② 网络候选在设置页只能看不能处理 ⇒ 新增 `TeamMemorySyncService.resolveNetworkConflict`（`keep_local` 清基线、`keep_shared` 下载落盘）+ 复用 `POST /v1/memory/team/conflicts/resolve` 路由（网络分支不需要 sharedDir）+ 面板对 network 候选显示同一组采纳按钮 | 全链通过；候选落在配置目录；网络冲突可人工采纳（本地/远端两种）；三种鉴权/限流分支如实 ERROR | 测试仅本地，无运行时影响 |
| **2N-6** | 本地删除同步（软删上行 + 防复活） | ✅ 已实现（2026-11-25）：判据 = **基线有 etag 且本地文件已不存在**；先从未处理列表摘除（防 `remote_only` 复活），再单条 GET 确认：404 ⇒ 清基线；`etag==基线` ⇒ `DELETE`（带 `If-Match`，软删）；远端已变 ⇒ 只记 `direction:'delete'` 候选（manual，不自动删）。`SyncResult` 新增 `deleted`；delete 候选的人工采纳：`keep_local`=确认删除远端（用观测 etag 或省略 If-Match）、`keep_shared`=下载远端到本地 | 本地删除可同步；远端已变不误删；不复活 | 清基线即可恢复"未同步"状态 |
| **2N-7** | 审计报表（读 `sync-history.jsonl` 聚合 + 设置页展示） | ✅ 已实现（2026-11-25）：`TeamSyncAuditReport.ts`（`readTeamSyncHistory` 坏行跳过/数值收敛 + `buildTeamSyncAuditReport` 汇总 cycles/pulled/pushed/conflicts/rejectedSecrets/errors/lastAt/errorRate/recent）；`GET /v1/memory/team/audit`；`TeamMemoryPanel` 展示汇总。**顺带修复**：`getTeamMemoryStatus` 漏传 `network` 字段（面板此前永远看不到网络同步状态） | 有历史 ⇒ 汇总正确；无历史 ⇒ cycles=0 空报表；坏行不影响其它轮 | 只读聚合，不写历史 |
| **2N-8** | 手动触发同步 + 冲突候选读取同源 | ✅ 已实现（2026-11-25）：`POST /v1/memory/team/sync`（`handleTriggerTeamSync`；body 可选 `{full}` ⇒ `fullSync()` 清基线全量重同步；400 `NOT_CONFIGURED`/`INVALID_REQUEST`、409 `SYNC_IN_PROGRESS`、200 返回 `SyncResult`）；`TeamMemoryPanel` 新增「立即同步」按钮（仅网络已配置时显示）。**顺带修复（同源读取）**：`GET /v1/memory/team/conflicts` 原只读 `resolveTeamMemoryDir()`，而网络候选写同步器 `config.localDir`（2N-5）⇒ 自定义 `localDir` 时网络候选在设置页不可见、无法采纳；现 `readMergedTeamConflicts` 合并两处并按 id 去重（网络候选优先，与 resolve 入口先判 `source:'network'` 一致） | 手动触发如实返回本轮错误；单飞不并发；自定义 `localDir` 下网络候选可见可采纳；`fullSync` 用于恢复本地误删（不触发删除上行） | 不新增定时器；关开关/不点按钮即零请求 |
| **2N-9** | 密钥拒发的审计口径（`rejectedSecrets` 不再恒为 0） | ✅ 已实现（2026-11-25）：推送侧密钥命中改抛 `TeamMemorySyncSecretRejectedError`（**独立错误类型**，不用消息字符串判断 —— CS02）；`sync()` 单独计入 `SyncResult.rejected`，**不写 `errors`**（否则整轮被判失败、退避重试也无意义），其余条目继续推送；`sync-history.jsonl` 的 `rejectedSecrets` 改记真实值（原硬编码 0）；设置页审计区块在该值 >0 时显示"密钥拒发 N 条" | 命中密钥 ⇒ 拒发该条 + 其余照常 + 审计可见；`success` 不被单条拒发拉红 | 不改扫描规则；关扫描开关即无拒发 |
| **2N-10** | CLI 审阅入口与设置页同源 | ✅ 已实现（2026-11-25）：`/memory team` 原只读 `resolveTeamMemoryDir()` 的 `conflicts.json`（2N-8 只修了 HTTP 侧）⇒ 网络候选在 CLI 不可见、`keep-local/keep-shared` 也必然失败（要求两侧文件存在）。现合并读取（`readMergedTeamConflicts`）并在列表标记 `(network)`；网络候选改走同步器新增的 `resolveConflictCandidate`（**HTTP 与 CLI 共用同一判定**，原 handler 里的判来源逻辑下沉到 infra）；`dirs` 注入支持 `networkDir`（单测不触碰真实用户目录） | CLI 能看到并采纳网络候选；两入口判定不分叉 | 不改候选文件格式；无候选时行为不变 |
| **2N-11** | 设置页"已配置"判定（网络-only 不再被整体隐藏） | ✅ 已实现（2026-11-25）：`GET /v1/memory/team/status` 原 `configured = enabled && sharedDir` ⇒ **只配网络（serverUrl）时被判未配置**，面板渲染"未启用共享目录同步"并把网络状态/审计/候选全部隐藏（「立即同步」按钮虽在外层，信息区仍不可见）。现 `computeTeamMemoryConfigured`：`enabled && (sharedDir 非空 ‖ 网络已配置)`；新增 `sharedConfigured` 字段；面板在共享目录未启用时显示"未启用（仅网络同步）"、状态标签改用网络同步状态；`teamNotConfigured` 文案补全两种启用方式 | 网络-only 配置下设置页可见网络状态/审计/候选并可立即同步；共享目录-only 行为不变 | 只改 DTO 与展示，不改同步行为 |
| **2N-12** | 增量拉取下的本地正文基线（避免每轮重复上行） | ✅ 已实现（2026-11-25）：契约 §3.6 的列表是**增量**（`version > cursor`）⇒ 未变的远端条目不在本轮列表里，原 `compareMemories` 一律把它们判成 `local_only` ⇒ **每轮把未变条目重复 PUT**（version 空转、审计 `pushed` 虚高）。现新增本地正文基线（`team_memory_sync_state.local_hashes_json`，旧表自动补列）：远端缺席 + 有 etag 基线 + 本地 hash 与基线一致 ⇒ `synced`（跳过）；本地 hash 变了 ⇒ `local_newer`（推送，`If-Match` 仍是上次基线，远端若已变则 412 转人工）。基线在下载/推送/一致时更新，并与 etag 一并落库；`resolveNetworkConflict`、墓碑、本地删除同步同步维护 | 增量服务端下稳定后每轮 `uploaded=0`；本地编辑仍推一次；不改变冲突语义 | 表仅新增一列（默认 `{}`）；清空该表即回到旧行为（多推一次后自动收敛） |
| **2N-13** | 游标只在整轮拉取应用成功后推进（下载失败不丢条目） | ✅ 已实现（2026-11-25）：原实现在 `fetchRemoteMemories` 结束时就 `saveProgress`，而该方法的 cursor 是 `MAX(旧值, 新值)` ⇒ **单条下载失败也会越过该版本**，该条目下一轮不再出现在增量列表里 ⇒ 永久漏拉（只剩 `errors` 留痕，无法自愈）。现改为：拉取只把游标记到内存（`pendingCursor`），`sync()` 末尾在**无下载失败**时落库；失败则保留旧游标，下一轮重拉同一批（已下载条目因内容一致判 `synced`，不会重复写） | 下载失败后恢复 ⇒ 漏拉条目自动补齐；成功轮次行为不变 | 不推进游标只是"多拉一次"，幂等安全 |
| **2N-14** | `conflicts.json` 双写互不抹除（共享目录版 vs 网络版） | ✅ 已实现（2026-11-25）：两版共用同一个 `conflicts.json`（默认同目录），共享目录版每轮用本轮扫描结果**整文件覆写** ⇒ 网络候选（412/409）在每个共享目录周期被抹掉（用户来不及采纳、审计失真）。现写入前经 `preserveNetworkConflictCandidates` 合并：保留磁盘上的网络候选，**同 id 以网络候选为准**（与审阅入口先判 `source:'network'` 的顺序一致，避免"按 A 的来源判、按 B 的方式改"）；文件候选仍按本轮扫描刷新 | 两版同开时网络候选持久可见可采纳；单开任一版行为不变 | 纯合并逻辑，不新增文件/不改变格式 |
| **2N-15** | 删除候选跨重启采纳（缺 `If-Match` ⇒ 428） | ✅ 已实现（2026-11-25）：`direction:'delete'` 候选的人工采纳原用**内存** `observedEtags` 作 `If-Match`，"没有就不带"；重启后该表为空，而契约 §3.4 规定非首次创建的 DELETE 缺 `If-Match` ⇒ **428**，导致"确认删除"必然失败。现改为现取一次单条 GET：404 ⇒ 远端已不存在（直接视为完成并清理候选）；否则要求远端 hash 与候选记录的 `sharedHash` 一致（变了 ⇒ 交回人工，不删未见版本），再用**当前** etag 作 `If-Match` 软删 | 重启后仍能确认删除；远端又变时不误删 | 仅多一次单条 GET；不加新状态 |

> 进度（2026-11-25）：2N-0 … 2N-15 已全部实现（各自独立提交，默认关）。
> 2N-4 的设置页状态：`/v1/memory/team/status` 增加 `network` DTO + `TeamMemoryPanel` 展示（未配置时提示开关）。
> 2N-3 回归用例：`app/tests/memory/teamMemorySyncTombstone.test.ts`；2N-4：`teamMemorySyncBackoff.test.ts`、
> `teamMemoryNetworkStatus.test.ts`；2N-5/2N-6：`teamMemoryNetworkSync.test.ts`（`Bun.serve` mock 全链、含删除同步）；
> 2N-7：`teamSyncAuditReport.test.ts`（聚合/坏行/limit）；2N-8：`teamSharedDirSync.test.ts`（候选合并/去重）
> 与 `teamMemoryNetworkSync.test.ts`（`fullSync` 恢复本地误删）；2N-9：`teamMemoryNetworkSync.test.ts`
> （密钥拒发只计 `rejected` + `sync-history.jsonl` 的 `rejectedSecrets` 落值）；2N-10：`memoryTeamCommand.test.ts`
> （网络候选合并列出 + `(network)` 标记 + `--json` 同源）；2N-11：`teamMemoryNetworkStatus.test.ts`
> （`computeTeamMemoryConfigured` 四态：总开关关 / 网络-only / 共享目录-only / 两者皆空）；
> 2N-12：`teamMemoryNetworkSync.test.ts`（`Bun.serve` 按 `version>cursor` 增量：未变不重复上传、
> 本地改后推一次、再回到稳定态）；2N-13：`teamMemoryNetworkSync.test.ts`（单条 GET 500 ⇒ 游标不推进、
> 恢复后下一轮补齐）；2N-14：`teamSharedDirSync.test.ts`（写前合并保留网络候选、同 id 网络优先）；
> 2N-15：`teamMemoryNetworkSync.test.ts`（mock 按契约对无 `If-Match` 的 DELETE 返回 428；
> 删除候选跨重启采纳）。


---

## 6. 验收与测试基线

**单测（临时目录 + fetch stub）**
1. 未配置 `serverUrl` ⇒ `NOT_CONFIGURED`、零网络请求、不伪造成功。
2. 增量：cursor=10 ⇒ 只请求 `version>10`；重复同步不重复下载。
3. `If-Match` 不匹配（**412**；兼容 409）⇒ 生成冲突候选文件，本地与远端正文均不变。
4. 密钥命中 ⇒ 拒发该条 + 审计 + 继续处理其它条（不整批失败）。
5. 鉴权缺失/非成员 ⇒ 401/403，状态 `ERROR` 带原因。
6. 重启续传：cursor/etag 从表读回，不从头拉。
7. 墓碑：远端 `deletedAt` ⇒ 本地归档到 `.trash`（不物理删除）。
8. 退避：429/5xx 按 1×/2×/4×（上限 15min）重试；4xx（除 429）不重试。
9. 幂等：同 `(teamId,id,version,contentHash)` 重放不产生重复写。

**集成（本机）**：临时目录 + 本地 mock HTTP server（`Bun.serve`），跑通 拉取→修改→412→人工采纳→再推 全链。

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

**已拍板（2026-11-25）**

1. **服务端归属** = **共享目录同步**（Phase 1 先做，本阶段不走网络；自建 HTTP 服务/复用协作设施后置）。
2. **身份来源** = **本机身份**（`ownerKey` 不参与共享目录阶段；网络阶段再引入租户身份）。

**按建议默认推进（2026-11-25；用户"继续"授权按建议实施，实施前可随时改判）**

| # | 决策 | 采用值 | 影响（若改判） |
|---|---|---|---|
| 3 | **加密责任端** | **TLS + 服务端可见明文**（`enableEncryption` 保留但默认关） | 改"客户端加密" ⇒ `contentHash` 按密文算、冲突判定移到客户端（§3.1 需改） |
| 4 | **冲突默认策略** | **`manual`**（2N-2 生成候选，不自动覆盖） | 改灰度 ⇒ 2N-2 需加"自动覆盖 + 审计"，并放宽"不自动改写"裁定 |
| 5 | **共享边界** | **不允许跨团队共享单条** | 改允许 ⇒ 服务端过滤需支持 `sharedWith`（越权面扩大） |


---

## 9. 证据索引

- 本地团队记忆 + 文件式 sync：`packages/infra/src/memory/services/TeamMemoryService.ts:99-115,146-162,292-350,637,951,995`
- etag 同步客户端：`packages/infra/src/memory/services/TeamMemorySyncService.ts:46-72,92-118,142-159,175,649,680`
- 模拟实现（已标注）：`packages/service/src/services/teamMemorySync/TeamMemorySyncService.ts:47-65`
- 接口未实现：`packages/infra/src/memory/MemoryManager.ts:110,156,164`
- 团队目录：`packages/infra/src/environment/paths.ts:593-598`
- 既有裁定：`.trae/specs/memory-conflict-detection.md`；`.trae/specs/agent-memory-optimization.md` §8.6
- 安全基线：`.trae/rules/project_rules.md` §1.4（`REQUIRE_BEARER`）/ §1.5（租户库与 `owner_key`）
