# Liri 记忆系统优化方案（草案 · 2026-11-25）

> 来源：Anthropic《The components of agent memory》（2026-11-06，本地 HTML 已读）+ 本仓记忆子系统实测取证。
> 状态：**实施完成（2026-11-25）** —— P0-1/P0-2(1–3)/P1-1/P1-2/P2-1/P2-2(用途)/P3 均已落地，逐项见 §8.1–§8.8；
> 明确未做项与原因见 §8.6（团队真实同步）、§8.7（规则笔记闭环）、§8.8（注入遵循度，需模型在环）。落地时按阶段拆独立提交，遵循 `code-deletion.md` CD05（先接线、再观察、后删旧路）。
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
- `buildMemoryIndexSection` 每轮同步读一次 `MEMORY.md`（≤25KB）。索引重建：**写入后**由
  `MemoryManager.markMemoriesChanged()` 防抖重建（200ms 合并，批量写入只重建一次），
  另有维护期/清理期兜底 ⇒ 不再出现"写入后到下次空闲维护前索引滞后"。
- 段类型：`memoryIndex` 经 `DANGEROUS_uncachedSystemPromptSection` 注册（装配器只接受动态段），未单列 stable 分区 —— 内容本身低频变化，但**不宣称**已获得前缀缓存收益。

**2026-11-25 第 2 批补充**（见 `预存错误与待处理问题.md` 同批次）：
- `memoryContext` 补登记 `visibleIn: ['full','conversation','local']` —— 原未登记 ⇒ 桌面聊天
  （`mode=conversation`，本地模型 `local`）从不注入记忆摘要，`getMemorySummaries` +
  冻结快照链路空转；
- 写入（create/update/delete/deleteAll）后立即 `unfreezeAll()` —— 冻结快照不再最长 1h 注入旧内容；
- `CoreHooks.updateMemoryIndex` 空实现（`setTimeout` + 假成功日志）已删除：索引重建收敛到写入侧；
  `memory.post-save` 事件当前零发射方（`MemoryHookDispatcher` 为预留端口）。

### 8.2 P0-2 治理闭环（1–3）

| 项 | 落点 | 要点 |
|---|---|---|
| 保留上限开关 | `memory.retention.enforce`（默认 `false` = dry-run） | dry-run 也落 `retention-report.json`（limit/total/overflow/enforced/archived/candidates） |
| 冲突候选 | `runMaintenancePass` → `conflict-candidates.json` | 结构化候选（id 双方/类型/subject/confidence/detectedAt），**不自动改写** |
| 真压缩 | `SessionMemoryManager._compactMemoryFile` | 改为结构化抽取：决策/待办/摘要**全保留**；其余按类型各留最近 15 条，总量预算 60 |

**P0-2-4 字段（部分落地，2026-11-25）**：`verifiedAt` 已加入 `MemoryMetadata` 并完成 frontmatter
读写（消费者 = P2-1 Validate 写入 + Promote 排序）。`accessCount` 已同批闭环（2026-11-25）：
`getRelevantMemories` 返回前对实际返回条目 `+1` 并落盘（**不改正文、不刷新 `updatedAt`**），
索引 Promote 排序消费该值。`confidence / sourceEventSeqs` 仍未引入 —— 当前无消费者，
按"未接线项不得当作能力"延后。

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

### 8.4 P1-2 检索入口参数面（Phase 2，进行中）

| 项 | 落点 | 要点 |
|---|---|---|
| `scope` | `RecallMemoryTool` 新增参数 | `auto`（默认，保持旧行为）/ `session` / `team`（团队记忆，共享目录）/ `global` / `all`；`global` 让主 Agent 在**有会话上下文时**也能跨会话检索 |
| `type` | 同上 | 按记忆类型过滤（会话项 `type`、全局长库 `metadata.type`），过滤时请求 `limit*3` 再截断 |
| `all` 合并 | 同上 | 会话在前、全局在后，按 `content` 去重，总数受 `limit` 约束 |
| 回退观测 | `logger.info('recall_memory 检索完成')` | 结构化 `fallbackReasons`：`no-session-context` / `session-search-failed` / `global-manager-unavailable` / `global-search-failed` |
| 可测性 | `RecallMemoryTool.create(deps?)` | 可选注入会话/全局解析器（缺省走真实实现）⇒ 单测无需模块级 mock |

**统一服务（2026-11-25 第二批）**：收集逻辑已收敛到 `app/src/tools/memorySearchService.ts#searchMemory` ——
`recall_memory` 与 MCP `memory_search` 共用（MCP 固定 `scope=global`，展示层格式不变）；
服务返回 `{scope, hits, fallbackReasons}`，`hits` 跨源统一（含 `id/name/tags/sessionId` 供展示层使用）。

**transcript 兜底（2026-11-25 第三批）**：服务在「会话相关范围 + 记忆零命中」时回退到
`SessionGateway.searchTranscript`（经 `getCoreAPI()` 懒取，工具运行期已初始化；MCP 无会话上下文不触发）。
命中以 `source=transcript` + `role` + `seq` 返回；`seq` 取 `UnifiedMessage.lastEventSeq`
（**消息写盘时刻的会话事件 seq**，不是"该条消息的精确事件 seq"）；内容压成 ≤160 字符单行。
回退原因新增 `transcript-fallback` / `transcript-no-hits` / `transcript-unavailable` / `transcript-search-failed`。

**下沉 infra（2026-11-25，P2-2 收口）**：唯一实现移入
`packages/infra/src/memory/services/MemorySearchService.ts` —— `searchMemory`（会话/团队/全局）
与 `advancedSearchMemories`（tags/type/日期/priority + createdAt|updatedAt 排序）同处一模块；
`app/src/tools/memorySearchService.ts` 退化为**适配层**（只注入会话记忆与 transcript 兜底）。
`recall_memory` 直接动态导入 infra（不再跨层动态引用 app）；`MemoryTool` 走
`SearchToolImpl.advancedSearch` 委托同一实现，旧的"全量读盘 + 内存过滤"重复实现已删除。

**如实边界**：
- transcript 兜底目前只在 `recall_memory` 生效（MCP `memory_search` 无会话上下文，不涉及）；
- `MemoryTool` / `MemoryGetTool` / `UnifiedSearchTool` 仍未注册进工具注册表（本次只收口实现，不改注册面）。
  **2026-11-25（记录 #13）**：三者已按 `code-deletion.md` CD05 标 `@deprecated`（说明"未注册、真实入口为
  `recall_memory` / MCP `memory_search`"），观察期后再按 CD01–CD06 决定删除或接线；`MemoryTool.name='memory_search'`
  与 MCP 工具同名，未经评估不得直接注册。

### 8.5 P2-1 Dreaming v2（Phase 3，进行中）

| 阶段 | 状态 | 落地 |
|---|---|---|
| **Promote（上提）** | ✅ **lite 已落地** | `updateMemoryIndex` 排序改为「置顶 → importance 降序 → updatedAt 降序」，且**已过期（`expiresAt` 已到）条目不上榜** ⇒ 注入层 200 行窗口优先装高价值条目 |
| Validate（纠错） | ✅ **lite 已落地** | app 侧注入证据提供者（`setMemoryEvidenceProvider` → 会话网关 `searchTranscript`）；空闲期抽样 ≤5 条"有来源会话、未验证"记忆，命中同文即写 `metadata.verifiedAt`（**不改写正文**），结果落 `validation-report.json`；未命中不标记 stale |
| Consolidate（合并） | 既有（不改） | 空闲期相似度去重 + 类型化归并已存在（`runMaintenancePass`） |
| Represent（表示） | ✅ **已落地** | `MemoryWikiService.rebuildMemoryWiki`：`<memory>/global/wiki/` 下按**记忆类型**生成主题页 + `INDEX.md`；**链接完整性**（目标文件不存在则不写该链接，`droppedLinks` 计数）+ 二遍清理（只删首行为生成标记的旧页，用户手写文件不动）；**体积上限** = `max(源正文 × 1.2, 4KB)`，超出则退化为无钩子并标 `truncated`；维护期重建、内容未变不重写；门禁 `memory.wiki.enabled`（默认 true） |

**如实边界**：
- Validate 的精度受会话检索能力限制：`searchTranscript` 是"包含 probe"的精确子串匹配 ⇒
  **只有逐字引用原文**的记忆才会被确认，摘要式记忆通常保持"未验证"（不误伤、不自动改写）。
- Promote 现用 `isPinned / importance / accessCount / verifiedAt / updatedAt`；
  `confidence / sourceEventSeqs` 仍未引入（无消费者前不提前写 schema）。
- `accessCount` 只有**索引 Promote 排序**一个消费者；检索重排（时序衰减 / MMR / 类型配额）
  **尚未**使用它（不把计数当作检索质量信号）。
- Represent 产出的 wiki **不进入系统提示**（注入仍只读 `MEMORY.md`，见 §8.1）：它是浏览/后续 dreaming 的
  表示层；"链接完整性"由生成时校验 + 生成标记清理共同保证，不额外引入死链修复任务。

### 8.6 P3 处置（Phase 3，2026-11-25）

| 项 | 状态 | 落地 |
|---|---|---|
| **团队记忆模拟实现** | ✅ 已标注 | `TeamMemorySyncServiceImpl` 标 `@deprecated` + `readonly simulated = true` + 构造期 `process.emitWarning`；日志统一加 `(simulated)`，`syncTeamMemory` 明确"未传输任何数据"；**保留**不删（`code-deletion.md` CD07：团队能力属运行时/配置驱动面） |
| **记忆来源与新鲜度** | ✅ 已标注 | 注入层统一提示"来自记忆库，**可能已过期**；与当前代码/用户说法冲突时以当前事实为准"：`memoryIndex` 段尾行、会话记忆原文模式与降级索引模式各一处 |
| **eval 常态化** | ⚠️ 部分（2026-11-25） | 确定性用例已入库（注入预算/检索/治理/压缩/校验）；注入遵循度已落 `packages/evals` 任务（模型在环，手动运行，不进 CI）；跨会话任务级评测集仍未建 |
| **团队记忆真实同步** | 📄 方案已补齐（待评审） | 方案见 [team-memory-sync.md](./team-memory-sync.md)：服务端契约（端点/鉴权/412·409/分页/幂等/墓碑/审计，2026-11-25 补）+ 客户端差距清单（C1–C7）+ 分阶段拆解（Phase 2N-0…2N-5）；共享目录版已实现，网络版**未改运行时**，3 项决策仍待拍板 |

### 8.7 P2-2 记忆用途与学习闭环（Phase 3，部分）

| 项 | 状态 | 落地 |
|---|---|---|
| **记忆用途** | ✅ 已落地 | 解析优先级：`session.metadata.memoryPurpose` > `config.json#memory.purpose` > 空；非空才注入 `memoryPurpose` 段（只给软引导："只记录与该用途相关的长期事实/规则/陷阱"），**不预设**"只记失败"等硬规则（对齐 A5）；空 ⇒ 零注入 |
| 规则笔记 schema | ✅ 已落地（2026-11-25） | `MemoryMetadata.ruleNote: {rule, whyTrue?, evidenceSeqs?, traps?, testedAt?}` + frontmatter 往返；写入方 = MCP `memory_write`（提供 `rule` 即落 `ruleNote`，type 记 `rule`）；读取方 = 维护期 `rule-notes-report.json`（完整率 / 字段缺失计数 / 不完整样本 ≤5） |
| 失败→理论→验证→规则闭环 | ✅ 已落地（2026-11-25） | 规则+理论=写入方（MCP `memory_write` / 轮末自动提取）；验证=维护期 Validate 命中同文即写 `ruleNote.testedAt`（与 `verifiedAt` 同批，不改正文）；规则=完整性报告消费。**自动提取已接线但默认关闭**：`ChatManager.extractMemoryFromChat`（两条流水线共同收口）调 `maybeExtractTurnMemories`，门禁 `memory.autoExtract.enabled=false`；开启后按文本信号提取（不含 `tool_use` 块，如实边界） |

### 8.8 P3-1 记忆 eval 基线（确定性，2026-11-25）

新增 `app/tests/memory/eval/memoryEval.test.ts`，用临时目录跑**真实组件**（不 mock 检索/治理）：

| 指标 | 用例 |
|---|---|
| 跨会话事实召回 | 3 条记忆 + 查询 ⇒ 已知事实进入 top-K |
| 新旧事实纠正 | 60 天前的旧分支 vs 今天的新分支 ⇒ 新事实排前 |
| 重复抑制 | 两条同文条目 ⇒ 空闲维护去重后仅剩 1 条 |
| token 成本 | ④a 会话记忆超预算降级为索引且体积受控；④b 索引层 200 行截断；④c 检索条数受 limit 约束 |

**注入遵循度（模型在环，2026-11-25 已落地为独立 eval 任务，不进 CI）**：
`packages/evals/src/evals/tasks/memory-injection.ts`（id `memory-injection-adherence`）——
沙箱 `<LIRI_DATA_DIR>/memory/global/MEMORY.md` 预置"最后一行必须写 `EVAL_MEMO_RULE`"的规则，
再用无关任务（写一行问候语）观察是否遵循；判分 = L1 环境终态（文件最后一行），不看模型自述。
运行：`bun run eval -- --model=<模型名> --k=4 --task=memory-injection-adherence`。
任务定义自检见 `app/tests/memory/memoryInjectionEvalTask.test.ts`（不需要模型）。

**未纳入确定性基线**：注入遵循度必须真实模型在环，不在 `memoryEval.test.ts` 里冒充通过。

### 8.9 配置键与未做清单（收口，2026-11-25）

| 配置键 | 默认 | 作用 |
|---|---|---|
| `memory.injection.maxTokens` | 1500 | 会话记忆注入预算；超限降级为索引 |
| `memory.index.maxLines` / `memory.index.maxBytes` | 200 / 25000 | 顶层索引（`MEMORY.md`）注入上限 |
| `memory.retention.enforce` | `false` | 保留上限真归档；`false` = dry-run（仍落报告） |
| `memory.wiki.enabled` | `true` | 维护期重建 wiki 表示层 |
| `memory.purpose` | 空 | 记忆用途（软引导）；会话 `metadata.memoryPurpose` 优先 |
| `memory.autoExtract.enabled` | `false` | 轮末自动提取记忆（正则信号 → 长期记忆）；默认关，开启后每轮最多写 `ExtractMemories` 上限条 |

**未做（需先定范围，非技术阻塞）**：
- 规则笔记 schema 与「失败→理论→验证→规则」闭环的**自动提取侧调优**（已接线且默认关；开启后的精度/去重仍需真机观察）；
- 团队记忆真实同步（服务端、鉴权、冲突消解、审计）；
- 注入遵循度评测的**真机取数与基线**（任务已落地，需配模型跑 `--task=memory-injection-adherence`）。

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
