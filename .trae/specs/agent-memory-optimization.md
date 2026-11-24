# Liri 记忆系统优化方案（草案 · 2026-11-25）

> 来源：Anthropic《The components of agent memory》（2026-11-06，本地 HTML 已读）+ 本仓记忆子系统实测取证。
> 状态：**Phase 1 已实施**（P0-1 全部 + P0-2 的 1–3 项；P0-2-4 字段留待 Phase 3）；**Phase 2 进行中**（P1-1 向量持久化 + 检索参数接线已落地，见 §8.3）。落地时按阶段拆独立提交，遵循 `code-deletion.md` CD05（先接线、再观察、后删旧路）。
> 相关既有裁定：`.trae/specs/memory-conflict-detection.md`（冲突**不自动改写**）、`.trae/specs/dead-code-and-unwired-items-rulings.md`（未接线项不得当作既有能力）。

---

## 0. 结论摘要

Liri 的记忆"三件套"（文件存储 / 混合检索 / 梦境巩固）都已存在，但当下有四个结构性缺口：

1. **顶层索引没接线**：`buildAutoMemoryPrompt`（MEMORY.md 提示）零消费者，`MEMORY.md` 从未进入系统提示；而会话记忆 `memory.md` 却是**全文无预算**注入（`systemPromptAssembly.ts:237-283`）。
2. **治理"有但不生效"**：保留上限默认 dry-run、冲突只记日志、`memory.md` 的"LLM 压缩"实为保留最近 20 行的截断（`SessionMemoryManager.ts:555-585`）。
3. **向量不持久**：`saveVectorIndex/loadVectorIndex` 无调用（`MemoryStore.ts:495-649`），进程重启后向量需重算。
4. **检索能力未被用满**：MMR 与时序衰减默认关闭、权重固定 0.5/0.5（`MemoryRetriever.ts:79-103`）；`memory_search` 只在 MCP 暴露，主 Agent 仅有 `recall_memory`。

对应文章四条主线，建议按 **P0 注入分层 → P1 检索质量 → P2 Dreaming v2 → P3 评估/团队记忆** 推进。最优先三件事：

- **P0-1** 顶层索引接线 + 注入预算（对齐文章"200 行 / 25KB 的小注入层"）；
- **P0-2** 治理闭环真正生效（保留上限、冲突候选、真压缩）；
- **P1-1** 向量持久化 + 检索调参（decay / MMR / 类型配额）。

---

## 1. 文章要点（转成可执行结论）

| # | 文章观察 | 对 Liri 的含义 |
|---|---|---|
| A1 | 记忆 = **跨会话保留、可再读的上下文**；不含权重、上下文内学习、压缩摘要 | 边界要写清：`memory.md`/长期库属记忆；上下文压缩产物不算 |
| A2 | 分工：**会话内记笔记（salience）+ 离线 dreaming 巩固** | 保留现有"逐轮提炼 + 梦境"双轨，但两者职责要收敛（见 P2） |
| A3 | **少而准**：9 个文件 4 枚徽章 vs 413 个文件 1 枚徽章；不记"每回合可重读"的状态 | 禁止把工具输出/文件内容流水账写进记忆；只记"经验、规则、陷阱、计划" |
| A4 | 记忆是**对未来的预测**：规则 + "我如何知道它成立" + 陷阱警告 | 记忆条目需要 `evidence / confidence / verifiedAt` 结构化字段 |
| A5 | 告诉模型"**记忆用来干什么**"，不要预设硬规则（"只记失败"反而降低强模型收益） | 以"会话/项目目的"做软引导，不做 only-failures 之类的硬过滤 |
| A6 | Dreaming 四类作用：**对照 transcript 纠错 / 建表示（wiki+链接）/ 上提层级 / 目标聚焦 + 跨会话补洞** | 现有 dream 只做"合并精炼"，需扩成四段流水线 |
| A7 | **表示 + 搜索**优于单用；但 wiki 过大会"什么都没抽象"（比源文件还大） | 表示层必须有体积上限与"链接完整性二遍" |
| A8 | 注入层必须小：Claude Code 只注入 MEMORY.md 前 **200 行 / 25KB** 作为索引，其余按需检索 | 直接对应 P0-1 的预算与"索引 + 召回提示"设计 |

---

## 2. Liri 现状对照（代码取证）

| 维度 | 现状 | 与文章的差距 |
|---|---|---|
| 长期记忆 | `<data>/memory/global|sessions/<id>.md` + `MEMORY.md` 索引 + `memory-index.json` + 关系图 | 文件型记忆成立；索引未进提示 |
| 会话记忆 | `sessions/<sid>/memory.md`，5,000 token / 5 次工具触发提炼，fire-and-forget | 全量注入、无预算；"压缩"是截断 |
| 注入 | `sessionMemory` 全文 + `memoryContext` top-10（200 行/25KB 截断，1h 冻结快照） | 缺"顶层小索引"；会话段无预算 |
| 检索 | `hybridSearch` 关键词+向量（0.5/0.5，max 6，minScore 0.35）；关系图扩展 + LLM 精选 | MMR/衰减关；权重不可配；`memory_search` 仅 MCP |
| 向量 | `app.db#memory_vectors` 表已定义但未接线；向量仅进程内 | 重启重算 |
| 巩固 | 梦境服务（cron 02:00 + 30min 心跳）：分组 LLM 合并精炼 + 知识回写 | 无 transcript 对照纠错；无 wiki 表示；无上提预算 |
| 治理 | contentHash 去重（热路径）+ 空闲相似度去重 0.85；冲突仅日志；90/180/45 天淘汰；1000 条上限 dry-run | 治理"有但不生效" |
| 团队记忆 | `TeamMemoryService` + 路径分层；同步是 `setTimeout` 模拟（`TeamMemorySyncService.ts:70-143`） | 能力不可用，需标注或立项 |
| 评估 | `app/tests/memory/` 17+ 用例（去重/保留/冲突/漂移/冻结/RRF/Schema） | 缺"跨会话任务级"记忆 eval |

---

## 3. 目标与量化指标

| 指标 | 目标 |
|---|---|
| 注入预算 | `memory.md` 注入 ≤ 1.5k tokens；顶层索引 ≤ 200 行 / 25KB；记忆注入总量可配上限 |
| 会话增长 | 注入体积随轮次**不线性增长**（索引化后趋平） |
| 召回质量 | 内部 eval：跨会话事实召回 / 过期事实纠正 / 多文档组合题 通过率提升 ≥ 15% |
| 噪声 | 重复条目录入率 ≤ 1%；悬空链接数 → 0；stale 条目（超过 TTL 未复核）可观测 |
| 成本 | 单会话记忆 token 下降；dream 单次调用数 / 时长有上限 |
| 可解释 | 每条记忆可回指 `sourceEventSeqs`；冲突/纠错有结构化候选可审 |

---

## 4. 优化方案

### P0-1 顶层索引接线 + 分层注入（对齐 A8）

**问题**：`buildAutoMemoryPrompt` / `buildTeamMemoryLines` 零消费者（`MemoryPromptBuilder.ts:212`、`teamMemPrompts.ts:43`）；`MEMORY.md` 未进提示，而 `memory.md` 全文注入。

**做法**：
1. 新增 `memoryIndex` 系统段（stable 段，可缓存）：只注入 `MEMORY.md` 前 `N` 行 / `25KB`（沿用 `MemoryTruncation` 单一实现），尾部固定一行："共 N 条记忆；详情用 `recall_memory` 搜索"。
2. `sessionMemory` 改为**结构化索引**：`目标 / 下一步 / 规则与陷阱 / 相关笔记链接`，全文预算 1.5k tokens；超限降级为索引 + 召回提示（不截断正文）。
3. 所有预算走配置键（`memory.injection.maxTokens` / `memory.index.maxLines` / `memory.index.maxBytes`），默认值对齐文章。
4. 空记忆 / 无工作区 ⇒ 零注入（保持现状）。

**改动点**：`app/src/chat/services/context/systemPromptAssembly.ts`、`packages/infra/src/memory/MemoryPromptBuilder.ts`、`MemoryTruncation.ts`、配置 schema。

**验收**：构造 200 条记忆 + 50 轮会话，注入 token 恒定在上限内；空态零注入；索引被模型实际引用（eval 用例）。

**风险**：索引过小导致"不知道有记忆" → 固定"总数 + 召回提示"兜底；A/B 对照。

---

### P0-2 治理闭环真正生效（对齐 A3/A4）

**问题**：保留上限 dry-run（`MemoryManager.ts:190-197`）；冲突只日志（`:546-569`）；`memory.md` "压缩"= 最近 20 行（`SessionMemoryManager.ts:555-585`）。

**做法**：
1. **保留上限**：保留 dry-run 默认（安全），但产出"超限报告 + 归档预览"，并新增显式开关 `memory.retention.enforce`；归档仍走 `.trash`。
2. **冲突候选**：检测结果落结构化候选 `{conflictId, oldId, newId, evidenceSeqs, suggestedAction}`（文件或 memory 域报告）；**不自动改写**（沿用既有裁定），提供 CLI/设置页审阅入口。
3. **真压缩**：`memory.md` 超过阈值时用 LLM 摘要（失败降级为**规则化抽取**：保留"目标/规则/陷阱"，删除流水账），不再"保留最近 20 行"。
4. 每条写入补齐 `confidence / verifiedAt / sourceEventSeqs / accessCount`（向前兼容：缺省视为未验证）。

**验收**：1200 条记忆 → 报告准确；冲突用例产出候选；压缩后关键规则 100% 保留（用例锁定）；旧文件无字段仍可读。

---

### P1-1 向量持久化 + 检索调参（对齐 A7）

**问题**：向量未落库（`MemoryStore.ts:495-649`）；MMR/衰减默认关、权重固定。

**做法**：
1. 启动 `loadVectorIndex()`、写入 `saveVectorIndex()`（按 `contentHash` 增量），提供"重建索引"维护任务；schema 版本化。
2. 检索参数可配：`weight.keyword/vector`、`decay.halfLife`、`mmr.lambda`、`minScore`、按 `type` 的 top-K 配额。
3. 排序引入 `accessCount`（被召回次数）与 `verifiedAt`（近期验证优先）；被纠错/过期的条目降权。
4. 统一截断与去重均复用 `MemoryTruncation` / `MemoryManager` 既有实现（CS01）。

**验收**：重启后同 query 命中集合稳定；检索 p95 延迟 ≤ 现状 +10%；eval 集提升；参数默认值保持"零行为变更"（先关后开）。

---

### P1-2 统一记忆检索入口（对齐 A6"检索是底座"）

**问题**：`memory_search` 仅 MCP；主 Agent 只有 `recall_memory`；session/global 两套路径。

**做法**：
1. 收敛为单一服务 `searchMemory({ scope: 'session'|'global'|'all', query, type?, timeRange?, limit })`；`recall_memory` 增加 `scope/type` 参数；MCP 复用同一实现。
2. transcript（`events.jsonl`）检索作为**兜底**：记忆无命中时返回"原始事件引用"（只引用 seq，不搬全文）。
3. 所有回退（向量失败→关键词→transcript）结构化记录 `fallbackReason` 供观测。

**验收**：同 query 三 scope 行为一致；回退路径可观测；无记忆时 transcript 兜底不误报。

---

### P2-1 Dreaming v2：四段流水线（对齐 A6）

**问题**：现有 dream 只做"合并精炼"，缺纠错、表示、补洞、上提预算。

**做法**（每段可独立开关）：
1. **Validate（纠错）**：抽样笔记 → 对照 `events.jsonl` 证据 → 更新 `verifiedAt/confidence`；与事实冲突的笔记**生成候选**（不自动覆盖），并标 `stale`。
2. **Consolidate（合并）**：相似度 0.85 去重 + 类型化归并（规则/事实/偏好/陷阱）。
3. **Represent（表示）**：维护 wiki 索引页（主题页 + 链接），**链接完整性二遍**：修悬空链接、补缺失页、加索引页；设体积上限（≤ 源记忆总量 × 1.2，超出则强制抽象）。
4. **Promote（上提）**：按 `accessCount + confidence + 近期性` 选少量条目上提到顶层索引；严格预算与失效期；下降层留链接。

**调度**：夜间窗口 + 空闲心跳；按"访问频率 / 变化频率"决定优先级（文章：把算力花在易变/常访问的记忆上）；单次预算（调用数、时长）可配。

**验收**：构造"错误地点笔记 → dreaming 对照 transcript 纠正"用例；悬空链接数 → 0；wiki 体积不超源；上提后注入仍在预算内。

---

### P2-2 学习闭环与目标聚焦（对齐 A4/A5）

**做法**：
1. 规则笔记 schema：`rule / whyTrue / evidenceSeqs / traps / testedAt`；写入模板由工具或提示统一。
2. 会话/项目级 `memoryPurpose`（coding / 研究 / 客服…）：只告诉"记忆用来干什么"，不预设硬规则（文章实测"只记失败"会伤强模型表现）。
3. 失败 → 理论 → 验证 → 规则 的闭环落到工具/提示层，产出可被 evaluator 消费的结构化记录。

**验收**：规则笔记字段完整率；闭环用例（错误 → 理论 → 验证 → 规则）能复现。

---

### P3 评估与团队记忆

1. **内部 memory eval**（新增 `app/tests/memory/eval/` 或脚本）：跨会话事实召回、过期纠正、重复抑制、token 成本、注入遵循度五项；作为 P0–P2 的验收基线。
2. **团队记忆**：当前 `TeamMemorySyncService` 是 `setTimeout` 模拟（`TeamMemorySyncService.ts:70-143`）——先**显式标注/关闭**，避免被当作既有能力；真实同步与冲突消解单独立项。
3. **安全与来源**：记忆带 `owner / source`；注入时标注"来自记忆，可能过期"；promotion 前复用既有密钥扫描（`memory/index.ts:120-132`）。

---

## 5. 分阶段路线

| 阶段 | 范围 | 门禁 / 验收 |
|---|---|---|
| Phase 1 | P0-1 + P0-2（索引接线、注入预算、治理报告/真压缩） | 注入 token 预算测试、空态零注入、治理用例、`typecheck` + `tests/memory` |
| Phase 2 | P1-1 + P1-2（向量持久化、检索调参、统一入口） | 重启一致性、eval 集、延迟基线 |
| Phase 3 | P2-1 + P2-2（Dreaming v2 四段、规则闭环） | 纠错/悬空链接/体积上限用例 |
| Phase 4 | P3（eval 常态化、团队记忆处置） | eval 报告入库；模拟实现标注/关闭 |

每阶段独立提交；**先接线（索引/字段/开关）→ 观察 → 再替换旧路径**，不一次性删旧实现。

---

## 6. 明确不做 / 边界

- 不改模型权重、不把"上下文内学习"当记忆（文章定义边界）。
- 冲突**不自动改写**（沿用 `memory-conflict-detection.md` 裁定），只产候选。
- 不在会话热路径做全库相似度扫描（保持"空闲期分片"）。
- 不把工具输出、文件内容、每回合可重读的运行时状态写入记忆（对齐 A3）。
- 不引入第二套截断/去重/检索实现（CS01：复用 `MemoryTruncation` / `MemoryManager` / `MemoryRetriever`）。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 注入变小 → 模型漏用记忆 | 索引尾部固定"总数 + 召回提示"；eval 对照；配置可回退到全文 |
| 全局相似度去重/冲突扫描耗时 | 分片 + 空闲窗口 + 单次上限；dry-run 观测后再开 |
| 向量落库 schema 变更 | 版本化 + 可重建；失败回退关键词检索 |
| dreaming 成本 | 夜间窗口 + 调用/时长预算 + 按访问频率调度 |
| 团队记忆误用 | 先标注模拟实现并默认关闭，真实同步另立项 |

回滚粒度：每阶段独立提交；P0-1 的**回退路径 = 配置键**（把 `memory.injection.maxTokens` 调大即回到全文注入，
`memory.index.maxLines/maxBytes` 调大即放宽索引），无需改代码。

---

## 8. 实施记录（Phase 1，2026-11-25）

### 8.1 P0-1 顶层索引接线 + 分层注入

| 项 | 落点 | 要点 |
|---|---|---|
| 索引生成 | `MemoryStoreImpl.updateMemoryIndex()` | 改为**紧凑索引**（每条一行 `- [标题](id.md) — 钩子`）；原实现每条占 8+ 行，200 行只装得下约 25 条 |
| 索引重建 | `MemoryManager.runMaintenancePass()` / `cleanupExpiredMemories()` | 复用既有全量快照（新增可选 `snapshot` 参数），**不重复扫盘**；启动期清理即重建 ⇒ 注入层不必等首次空闲 |
| 索引注入 | `buildMemoryIndexSection()`（`MemoryPromptBuilder.ts`） | 读 `<memory>/global/MEMORY.md` → `truncateEntrypointContent`（≤200 行 / 25KB）→ 尾部固定「共 N 条 + recall_memory 提示」；缺失/空/无条目 ⇒ 空串 |
| 段接线 | `systemPromptAssembly.ts` 新增 `memoryIndex` 动态段 | 空态零注入；上限可用配置键覆盖 |
| 会话记忆预算 | 新增 `app/src/chat/services/context/sessionMemoryInjection.ts` | 预算内原文；超预算**降级为索引 + 召回提示**（不截断正文、不搬运正文） |
| 配置键 | `memory.index.maxLines` / `memory.index.maxBytes` / `memory.injection.maxTokens` | 默认 200 / 25000 / 1500（对齐文章 A8） |

**如实边界**：
- `buildMemoryIndexSection` 每轮同步读一次 `MEMORY.md`（≤25KB）；索引由维护期/清理期重建，写入新记忆后到下次重建前索引可能短暂滞后（下一次空闲维护即更新）。
- 段类型：`memoryIndex` 经 `DANGEROUS_uncachedSystemPromptSection` 注册（装配器只接受动态段），未单列 stable 分区 —— 内容本身低频变化，但**不宣称**已获得前缀缓存收益。

### 8.2 P0-2 治理闭环（1–3）

| 项 | 落点 | 要点 |
|---|---|---|
| 保留上限开关 | `memory.retention.enforce`（默认 `false` = dry-run） | dry-run 也落 `retention-report.json`（limit/total/overflow/enforced/archived/candidates） |
| 冲突候选 | `runMaintenancePass` → `conflict-candidates.json` | 结构化候选（id 双方/类型/subject/confidence/detectedAt），**不自动改写** |
| 真压缩 | `SessionMemoryManager._compactMemoryFile` | 改为结构化抽取：决策/待办/摘要**全保留**；其余按类型各留最近 15 条，总量预算 60 |

### 8.3 P1-1 向量持久化（Phase 2）

| 项 | 落点 | 要点 |
|---|---|---|
| 端口 | `MemoryVectorPersistencePort`（`MemoryRetriever.ts`） | 检索器只依赖窄端口；生产由 `MemoryStoreImpl`（SQLite `memory_vectors`）注入 ⇒ 单测可注入桩 |
| 启动恢复 | `MemoryRetrieverImpl.loadPersistedVectors()` | 构造期异步恢复（幂等、共享同一 Promise）；只填**缓存未命中**条目，模型不匹配由使用侧判 `cached.model === currentModel` ⇒ 自动重算 |
| 写入 | `persistVector()`（预取 / 相似度搜索两条计算路径） | 只写新算出的非空向量（fire-and-forget，失败只记 warn，不影响检索） |
| 删除 | `removeFromIndex()` | 同步清进程内缓存 + 删除持久行（避免删除/归档后旧向量被恢复） |
| 观测 | `getVectorCacheSize()` | 进程内向量缓存条数 |

**说明**：`memory_vectors` 表与 `load/save/deleteMemoryVector` 原已存在但零消费者（见 §2），本项是**接线**而非新造。
`memory.search` 配置（hybrid 权重 / minScore / mmr / temporalDecay / typeQuota）由 `loadMemorySearchConfig()` 读取。

**检索参数接线（P1-1-2，2026-11-25）**：`hybridSearch` 两条路径（纯关键词 / 混合）统一走
`applyRankingAdjustments`（时序衰减 → MMR → 类型配额）。三者**默认全关**，全关时原样返回（不重排）
⇒ 零行为变更。类型配额键 = `metadata.type`（`query.typeQuota`，达到配额跳过、不回填）。
MMR 需查询向量与候选两两相似度（N² 次嵌入），仅在显式开启且嵌入可用时执行。

**明确未做（P0-2-4，延后到 Phase 3）**：`confidence / verifiedAt / sourceEventSeqs / accessCount` 字段的写入与持久化。理由：当前无消费者，属"未接线项"（`dead-code-and-unwired-items-rulings.md`）；Phase 3 的 Validate/Promote 才真正读取它们，届时同批加字段 + frontmatter 读写 + 用例。

---

## 9. 证据索引（关键文件）

- 注入：`app/src/chat/services/context/systemPromptAssembly.ts:237-283`；`packages/infra/src/memory/MemoryTruncation.ts:5-6`；`packages/infra/src/memory/FrozenSnapshotService.ts:29-30`
- 索引未接线：`packages/infra/src/memory/MemoryPromptBuilder.ts:212`；`packages/infra/src/memory/teamMemPrompts.ts:43`
- 会话记忆：`packages/service/src/session/memory/SessionMemoryManager.ts:84-92,263-311,541-585`
- 长期库：`packages/infra/src/memory/stores/MemoryStore.ts:495-649,668-674,762-765`
- 检索：`packages/infra/src/memory/retrievers/MemoryRetriever.ts:79-103,1159-1215`；`packages/infra/src/memory/MemoryManager.ts:727-815`
- 治理：`packages/infra/src/memory/MemoryManager.ts:190-197,450-487,512-569,1029-1035`
- 梦境：`packages/infra/src/memory/consolidation/MemoryDreamService.ts:234`；`app/src/entrypoints/init.ts:693-705`
- 团队记忆模拟：`packages/service/src/services/teamMemorySync/TeamMemorySyncService.ts:70-143`
- 既有裁定：`.trae/specs/memory-conflict-detection.md`；`.trae/specs/dead-code-and-unwired-items-rulings.md:63-70,99`
