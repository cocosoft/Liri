# 知识加工流水线前端可视化方案（方案 B：真实阶段广播 · v7 执行版）

> 代码基线：`E:\PY\Documents\CODES\PY_APP`
> 目标：让前端真实呈现知识库"入料 → 编译 → 索引 → 检索"的**阶段级实时进度**，而非伪动画。
> v1 可行性 → v2 锚点对齐 → v3 硬伤补齐 → v4 复查合并 → v5 穷举收尾 → v6 锁作用域修正 → **v7 执行版**。
> **v7**：合并第五轮复查（G27/G28/G29），其中 **G28 经实测确认且严重**（lint 依赖 index.md → 推翻 v6 的"整块后移"）；**G27 是 v6 代码样本自身引入的 TDZ**；并落实全部待决策项（§0.1）。
>
> **执行状态（2026-09-11）**：批次 0 + 批次 1（后端）+ 批次 2（前端）+ **§4.4 血缘视图** 均已落地，并已完成**现场运行时验证**。
> 静态验证：双端 `tsc --noEmit` 0 错误 · ESLint 0 error · **`bun test`（默认配置，无 `--timeout`）113/113 通过 / 15 文件**（含新增 `compileProgressTracker.test.ts` 8/8 与 `knowledgeCompileStatus.contract.test.ts` 3/3，并顺带修掉预存 M1 测试 hook 超时）· 前端生产构建通过。
> **现场验证**（后端已热重启加载新代码，真实编译进行中，172 个 raw 文件）：
> - ✅ HTTP 契约：`/v1/knowledge/compile-status` 返回 `sessionId/seq/phase/phases[]`，9 阶段齐全
> - ✅ 阶段机推进：`scanning=done(0ms) → cleaning=done(1ms) → compiling=running`，`detail` 19→24→26 递增
> - ✅ `seq` 单调且只在真实变化时递增（500ms 节流生效：15s 无文件完成时 seq 不变）
> - ✅ **G6 现场命中**：编译中 POST `/v1/knowledge/compile` → `{success:true, started:false, busy:true}`（改动前会返回 `started:true`，前端显示假"编译中"）
> - ⏳ **待观察**：`phase ∈ {linting, graph_extract, …, indexing}` 期间 `status === 'compiling'`（生命周期解耦判据）——需 172 文件的编译主循环跑完才进入尾部阶段
> 修复补充：**EISDIR 已修复**（发布侧改传具体页面路径，订阅侧支持批量），修复后需一次完整编译走到 `indexing` 阶段方可看到语义索引更新。
> 修复补充（2）：**空闲态复盘已修复**。原 60s 复位会清空 `phases[]`/`result`，导致流水线页 60 秒后只能显示"暂无编译会话"（§4.1 的"显示上次编译结果摘要"无法达成）。
> 修法：新增独立字段 `lastSession: CompileSessionSummary`（含 `outcome/finishedAt/durationMs/result/lastError/phases[]`），**60s 复位不清除**，仅在下次会话结束时替换 —— **不改 `status` 语义**（陈旧的 `done` 会让新触发的编译被误判为"瞬间完成"，`useCompilePolling` 已针对该竞态加固，动它会引入回归）。前端空闲态自动回落到 `lastSession` 复现 stepper 与指标。
> 落盘：`lastSession` 已持久化到 `resolveDataSubDir('knowledge')/compile-last-session.json`，启动时自动恢复（**跨进程重启保留复盘数据**）。路径**懒解析**以便测试用 `setUserDataDirOverride` 沙箱化；写入 best-effort（失败仅告警，绝不影响编译收尾）；文件缺失/损坏视为无历史（返回 null 不抛错）。
> 修复补充（3）：**指定文档编译已实现**（`CompileOptions.onlyFiles` + `POST /v1/knowledge/compile {files}` + 两个入口：待编译列表逐行「编译」按钮 / 流水线页多选）。关键：`onlyFiles` **只裁剪主循环目标**，全量 `rawFiles` 仍用于「清理孤儿产物」与「快照基底」（否则未参与编译的文件会被误判为已删除：产物被清 + 快照被覆盖）；目标文件视为强制重编。
> **现场根因（2026-09-11）**：编译普遍失败的真正原因**不是文件变更与否**，而是 `knowledge_compile` 映射的私有化模型不可达 —— `app.log` 实录 `"私有化部署换取 appKey 失败: Unable to connect"` → 每个文件 `compiled` 失败 → `pagesCreated=0` → **尾部阶段全部 gated（即用户看到的"未触发"）**。这是网络/配置问题，非代码问题。
> 修复补充（4）：**编译失败原因已可观测**。原 `result` 只返回 `errors` 计数，失败原因仅存于日志 → 前端无法解释"为什么失败"。现 `result.errorSamples`（后端截断前 5 条）随 `compile-status` 与 `lastSession` 一并透出，流水线页显示红色横幅列出具体原因（含文件路径）。
> 现场实证（2026-09-11）：`errorSamples: ["...\\raw\\test_append.txt: 私有化部署换取 appKey 失败: Unable to connect. Is the computer able to access the url?"]` —— 错误文本已端到端可见。

---

## 〇、变更摘要

### 0.0a v7 变更（本轮，含决策冻结）

| 编号 | 级别 | 问题 | v7 处置 |
|---|:---:|---|---|
| **G28** | 🔴 高 | **v6 的"整块后移"错了**。实测 `WikiLinter` 的孤儿页检查读 `index.md`（`lint/WikiLinter.ts:98` `join(wikiDir,'index.md')`，:119-126 判 `[[pageName]]` 引用）。v6 把 `updateIndexMd` 与 publish 一起后移 → lint 拿**上一版** index.md → 新编译页**全被判为孤儿**，且这批假告警还要回填 `lintScore` | **D2 拆两段**：`updateIndexMd()` **保留原位**（lint 的前置依赖）；只把 `appendLog + publish` 后移为 indexing |
| **G27** | 🔴 高 | v6 代码样本自身引入的 **TDZ**：`const lineage` 在 `try` 内声明，`finally` 里 `lineage.close()` —— 若 `graph.init()` 先抛，`lineage` 未声明即被求值 → `ReferenceError`（同步异常，`.catch()` 拦不住），且**替换掉原始错误** | §3.3 改为 `let lineage: LineageStore \| null = null` 提到 try 前 + `lineage?.close()` |
| **G29** | 🟠 高 | `abortCompileProgress` 把 `status` 置 `done` 且**无 60s 重置**；而约束 4 要求 `finishCompileSession` 见 `status!=='compiling'` 即 return。方案未写明 `beginCompileSession` 要把 `status` 置回 `'compiling'` → 中止一次后 G23 死锁换个形式复发 | §3.1 函数说明显式写 `status='compiling'`；`abortCompileProgress` 补 60s 重置（与 finish 对称）；§五 补独立验收项 |
| 建议 1 | 🟢 | EISDIR 改动面被高估 | 修正：**发布侧仅 2 处**（`publishKnowledgeChanged` 辅助函数 + `KnowledgeCompiler.ts:410` 直发点），订阅侧 4-5 处需支持数组并**批处理一次** |
| 建议 2 | 🟢 | `scanning`/`cleaning` 在前端闪烁几十毫秒 | 采纳：后端保持 9 阶段语义，**前端渲染合并为"准备"节点**（展开看明细），不动后端契约 |

**§0.1 决策冻结（本次执行采用）**

| 决策 | 取值 | 理由 |
|---|---|---|
| **D-p** 入口定位 | **D-p1 独立 Tab「加工流水线」**，置于 `knowledge` 之后 | 过程 vs 结果分工；语义索引 Tab 已确认正常 |
| **D-r** EISDIR 范围 | **已纳入并修复**（2026-09-11） | 实测修复面仅 **2 个文件**：`SemanticIndexUpdater`（订阅侧支持 `filePaths[]` 批量）+ `runKnowledgeCompile`（发布侧改传具体页面路径）。另 3 个订阅者（KnowledgeRouter / init.ts×2 / IndexManager）不读 `filePath`，无需改动；`deleted` 单文件流程保持兼容 |
| **G6** busy 返回码 | **200 + `busy:true`**（不改用 409） | 语义是"请求成功但未启动"，且不与既有 `triggerRes` 契约冲突 |
| `scanning` 是否保留 | **后端保留 9 阶段**；前端合并 `scanning+cleaning` 为「准备」节点 | 见建议 2 |

### 0.0b v6 变更（v6 轮）

| 编号 | 级别 | 问题 | v6 处置 |
|---|:---:|---|---|
| **G25** | 🔴 高 | **本方案自身引入的硬伤**：§3.3 把 `acquireCompileLock()` 放在 `try` 之前，而 `await graph.init()`(:1129) / `schemaLoader.loadAll()`(:1137) / `await lineage.init()`(:1142) 全在 `try`(:1152) 之外 —— 任一抛错即跳过 finally，`releaseCompileLock()` 永不执行 → **此后所有编译永久返回 `busy`** | §3.3 改为 acquire 后**立即** `try {`，把 1128-1273 整体包入 |
| **G26** | 🟠 高 | 旧 4 事件载荷**不含 `phases[]`**，若前端把它们也写入同一份 `phases` 状态，会与轮询/新事件的全量快照互相覆盖 → **阶段回退**（正是 §1.4 要消除的现象） | §3.1 约束 12 + §4.1 来源规则：`phases[]` 唯一来源是新事件与轮询 |
| **C15** | 🟡 中 | **G5 归因错误**：`startCompileProgress`(:233) 在空库早退(:230) **之后**，既有代码下 `currentProgress` 保持 `idle` —— "空库卡 running"是**方案引入的风险**，不是既有缺陷 | 改用**插入点消解**：`beginCompileSession()` 钉在空库早退之后（A1/B4），**删除 B1 的 skipPhase 补丁**；`scanning` 记为瞬时阶段 |
| **C16** | 🟡 中 | "提前 return"与"异常中止"两种未收口原因未区分 | §3.2-B 补 settle 语义边界；并修正复查"C 条"的场景误判（见 §0.0 附注） |
| 建议 D | 🟢 低 | `quality` 不是死字段而是**死能力**；`WikiLinter` 已产出 `{error,warning}`，`lintScore` 天然可算 | 采纳：批次 0 改为 **lint 后回填**（约 5 行），`consecutiveFails` 延后 |
| 建议 E | 🔴 高（展示层） | EISDIR 让语义索引那一路**一直静默失败**，而 `indexing` 会显示"已触发，后台处理中" → **展示假成功态** | ✅ **已修复**（见 D-r）：改传具体页面路径；UI 的「语义索引需手动重建」提示保留为兜底说明 |

**§0.0 附注（修正复查"修正 C"的场景）**：复查称"graph 在 `compile()` 内提前 return 时，record/rule/chunk 三段没跑却会被标成 `skipped('aborted')`，语义错了"。
实测不成立：`graph` 的 `return result`（:461/:468）只退出 `compile()`，**`runKnowledgeCompile` 会继续执行 K2/K3/R4**（:1152 起），它们照常进入各自的 `enterPhase`。因此不会被误标。
但**底层要求成立**：settle 的"原因"必须区分 —— 门控未过 → `gated`；因中止而未获评估 → `aborted`。已写入 C16。

### 0.1 P7–P11 处置（v5，含证据与修正）

| 编号 | 复查意见 | 本轮复核 | 处置 |
|---|---|---|---|
| **P7** | §3.2 的 `linting` 锚点条件不完整 → 卡 `running` | ✅ **成立**。实测 [KnowledgeCompiler.ts:415-416](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeCompiler.ts#L415-L416) 是**复合条件** `if (shouldLint && result.pagesCreated > 0)`；且该块是 `try/catch`（436-441）**无 finally** | 新增 **G20**：锚点挂整个 if 块 |
| **P8** | `seq` 去重缺 `sessionId` 维度 → 第二次编译前端不动 | ✅ **成立**。[CompileProgressTracker.ts:92-103](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/CompileProgressTracker.ts#L92-L103) 的重置是**整体替换对象**，新字段易被清零 | 新增 **G24**：`sessionId`/`seq` 全局单调不归零 + 前端判据加 sessionId 维度 |
| **P9** | `graph_extract` 还有第 4 层门控未覆盖 | ✅ **成立**（较复查描述更严重，见 N1） | 新增 **G19** |
| **P10** | §3.2 未列 `updateCompileProgress` 的改点 | ✅ **成立，但数量修正**：实测 **5 处**（292/304/328/372/378），非复查所称 6 处 | 新增 **G21** |
| **P11** | `abort` 路径既不 settle 也不跑断言 | ✅ **成立**（细节修正见 N2） | 新增 **G22** |
| **N1** | G18 声称"穷举 8 个收尾点"实际漏 3 条 graph 非进入路径 | ✅ **成立**。实测 3 条：`447` / `452` / `456` | 撤回"已穷举"表述（G19） |
| **N3** | `sessionTerminated` 未在新会话复位 → 一次中止后永久失效 | ✅ **成立**。§3.1 约束 2 确未写复位 | 新增 **G23** |
| **N4** | 同 P8 | 同 P8 | 同 G24 |
| — | §2 表格对 graph 的门控与 §3.2 执行锚点**两套标准**（linting 做对了、graph 没做） | ✅ 成立 | §3.2 重构为统一清单 |

### 0.2 对复查细节的两处修正（证据驱动）

**修正 1（N2 细节）— 无 provider 分支不是 `cleaning=running`，而是 `compiling=pending`**

复查称"`scanning`=done、`cleaning`=**running**、`compiling`=pending"。实测顺序不支持：

```
258  const cleanedCount = await this.cleanupDeletedRawFiles(...)   ← cleaning 已执行
261  if (cleanedCount > 0) { logger.info(...) }                    ← cleaning 收口点
266  if (!resolvedModel && providerRegistry.size === 0) {          ← provider 检查在 cleaning 之后
271    abortCompileProgress(errMsg);
272    return result;
275  for (const rawFile of rawFiles) {                             ← compiling 从未进入
```

→ 真实残留状态是 **`scanning`=done、`cleaning`=done、`compiling`=pending**。
→ 危害同样成立（`compiling` 永久"待执行"，且 abort 路径无断言），但**修法要针对 `pending` 兜底**，不是"running 兜底"。这直接影响 G22 的实现（见 §3.1 约束 9）。

**修正 2（P10 数量）— `updateCompileProgress` 是 5 处不是 6 处**

```
grep -n "updateCompileProgress\(" app/src/knowledge/KnowledgeCompiler.ts
→ 292 / 304 / 328 / 372 / 378        （共 5 处，与 §1.2 一致）
```

### 0.3 本轮采纳的结构性建议

复查建议：**"在 §3.2 一次性做一张全量 `return`/调用/异常点清单收尾，比逐轮打补丁省力"** —— 已采纳。§3.2 重构为四类：

| 清单 | 内容 | 数量 |
|---|---|---|
| **A. 门控进入点** | 每个阶段"最终要么 enter、要么 skip"，含 graph 的 4 层门控 | 9 阶段 / 14 条分支 |
| **B. 收尾必达点** | 所有 `return` / `catch` / `finally` 的 settle 动作 | 11 处 |
| **C. 进度上报点** | `updateCompileProgress` → `updatePhaseDetail` | 5 处（G21） |
| **D. 整块迁移点** | finish 块 / index+log+publish 块 | 2 块 |

> 后续若再有第四轮复查，应只针对这四类清单逐行核对，而不是重新通读全文。

---

## 一、代码复核结论

### 1.1 致命缺陷：`finish` 早于 **9 个动作**

`KnowledgeCompiler.compile()` 在 [KnowledgeCompiler.ts:386-390](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/KnowledgeCompiler.ts#L386-L390) 调用 `finishCompileProgress()`。其后的完整动作清单：

| # | 动作 | 代码位置 | 归属阶段 |
|---|---|---|---|
| 1 | `saveCompileState(newState)` | 393 | `compiling` 尾部落盘 |
| 2 | `indexManager.updateIndexMd()` | 397 | `compiling` 尾部落盘（**lint 依赖 index.md，不可后移 —— G28**） |
| 3 | `indexManager.appendLog({action:'compile'})` | 398-404 | **indexing** |
| 4 | `publish('knowledge:changed')` → 倒排重建 + 语义索引 | 407-410 | **indexing**（触发语义态） |
| 5 | `WikiLinter.run()` | 415-442 | `linting` |
| 6 | `GraphExtractor.extract()`（≤50 页） | 447-548 | `graph_extract` |
| 7 | K2 字段级记录抽取 | 1152-1186 | `record_extract` |
| 8 | K3 规则抽取 + 全表冲突扫描 | 1188-1244 | `rule_extract` |
| 9 | R4 原文分块刷新 | 1246-1273 | `chunk_refresh` |

**后果**：前端收到 `knowledge:compile:completed`（Label 变"📚 编译完成"，5 秒后从顶栏移除）时，后端仍有 **9 个动作**在跑。

### 1.2 进度模型无阶段维度

`CompileProgressTracker.ts`（模块级单例，**全文 120 行已读**）当前模型扁平（[CompileProgressTracker.ts:11-31](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/CompileProgressTracker.ts#L11-L31)）：

```
status: 'idle' | 'compiling' | 'done'
current / total / startedAt / lastError / result{compiled,skipped,errors}
```

`current` 语义是"已处理文件数"，写入点为 **292 / 304 / 328 / 372 / 378**（共 5 处），无法表达 lint、图谱、record/rule 抽取、分块、索引落账这些"无文件计数"的耗时动作。

### 1.3 语义索引写入是事件驱动的异步旁路（关键约束）

**（a）EISDIR —— ✅ 已修复（2026-09-11）**：原 `publish` 的 `filePath` 是知识库**根目录**，而 `SemanticIndexUpdater` 的 `appendIndex()` 对其 `readFile(目录)` → `EISDIR` → 被 catch 后走 `handleError` **静默失败**。
**修复**：发布侧改传 `filePaths: result.compiledFiles`（本次编译产出的具体页面），订阅侧支持 `filePath | filePaths[]` 双形（`deleted` 单文件流程保持兼容）。
**修复前实测证据**：`/v1/semantic/index/status` 的 `lastIndexedAt` 比当前时间早约 **43 小时**，而期间多次编译在跑 → 语义索引确实长期空转。

**（b）订户耦合**：

| 订户 | 位置 | 行为 |
|---|---|---|
| SemanticIndexUpdater | SemanticIndexUpdater.ts:111 | 增量索引单文件 |
| IndexManager | IndexManager.ts:89 | 重建 index.md |
| KnowledgeRouter | KnowledgeRouter.ts:207 | **全量倒排索引重建** |
| init.ts ×2 | entrypoints/init.ts:761, 810 | 运行时联动 |

**（c）发布侧同样广**：~6 处 —— KnowledgeCompiler.ts:407、KnowledgeBaseWriter.ts:139/211、KnowledgeDeleteTool.ts:241/285，外加辅助函数 `publishKnowledgeChanged`（knowledge-handlers.ts:33-38，被 **9 处**复用：617/670/708/1811/1850/1905/2017/2233/2276）。

→ **设计边界**：`indexing` 保持**"已触发"语义态**（无百分比）。EISDIR 若修，须走"批量载荷 `filePaths[]`"重构，改动面 = 5 订户 + 6 发布点 + 1 辅助函数，属独立工作流；**严禁**逐页 publish（会引发 N 次全量重建）。

### 1.4 并发编译：跨触发源无互斥

| 触发源 | 位置 | 互斥情况 |
|---|---|---|
| 手动 HTTP | knowledge-handlers.ts:1232 `setImmediate` | ❌ 无 |
| 定时调度器 | LocalHTTPServiceHelpers.ts:346-354 | ✅ **自洽**（`executeCompile` :156-157 单点守门） |
| 文件变更延迟 | KnowledgeCompileScheduler.ts:132-143 `delayTimer` | ✅ 同上（→ `executeCompile`） |
| 梦境 | AutoDream.ts:520 | ❌ 无 |
| Chronos 维护 | knowledgeMaintenance.ts:101 | ❌ 无 |

> **C12**：v1/v2 的"delayTimer 与 intervalTimer 不互斥"已撤回。两者都汇入 `executeCompile()`，`if (this.state === 'running') return`（:157）是共同守门。**缺口只在跨触发源**。

`useCompilePolling.ts:25` 的 `compilingGlobal` 只是**前端 UI 层**守卫，覆盖不了后端 4 个触发源。

### 1.5 前端既有资产

| 资产 | 路径 | 状态 |
|---|---|---|
| Tab 骨架 | KnowledgePage.tsx:48-49, 387-394, 660-667 | 6 个 Tab，URL `?tab=` 驱动 |
| Tab 渲染块 | KnowledgePage.tsx:1201-1245 | `display: none` 常驻挂载 |
| 语义索引页 | `client/src/components/views/SemanticIndexPage.tsx` | **正常**（走 `semanticService`，见 §1.6） |
| 待编译面板 | PendingCompilePanel.tsx | 文件列表 + 编译按钮 + 进度 |
| 轮询状态机 | useCompilePolling.ts | `IDLE_RETRY_LIMIT=30`、`PROGRESS_DEADLINE=30min`、`compilingGlobal` |
| SSE 进度链 | operationProgressStore.ts:109-161 | 监听 4 个事件，label 硬编码 |
| 服务层 | knowledgeService.ts:390-416 | `getCompileStatus` 类型硬编码 6 字段 |
| 图数据 | graphService.ts:35-36 | `/v1/knowledge/graph/edges` + `/stats` |
| **血缘接口** | knowledge-routes.ts:256 → `GET /v1/knowledge/lineage` | **后端已实现，前端零调用**（G12） |
| 事件注册 | sseService.ts:321 | `on(event: string)` 自由字符串，新增事件零改类型 |

### 1.6 死接口（定论 + 来历证据链）

```
真实路由  : memory-files-routes.ts:210-229  → 前缀 /v1/semantic/*（含 GET /v1/semantic/index/status）
死接口    : /v1/knowledge/semantic-index     → grep app/src 0 匹配
```

**定论**：
- `grep -rn "getSemanticIndex" client/src app/src` → **仅 1 处命中**：`knowledgeService.ts:629`（定义处），**零调用方** → 死代码，可直接删。
- [SemanticIndexPage.tsx:2](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/views/SemanticIndexPage.tsx#L2) 导入的是 `semanticService`，走 `getStatus()/startBuild()/getBuildTask()/clearIndex()/search()`（37/56/72/118/136）→ **语义索引 Tab 未失效**。

**来历（本轮新增，落档可查）**：这是**另一个旧计划的半落地遗留**——

```
dev_docs/dailys/20260724/knowledge-base-frontend-optimization-plan.md
  :69   W11「SemanticIndexPage 无 loading/空状态且直接 fetch」，方案要求统一走 knowledgeService
  :450  "在 knowledgeService 中新增 getSemanticIndex()"
  :454  async getSemanticIndex(): Promise<SemanticEntry[]>
  :459  "SemanticIndexPage 改为调用 knowledgeService.getSemanticIndex()"
```

→ 计划要求"新增方法 + 改调用方"，**只落地了方法定义、没落地调用方**；后续 SemanticIndexPage 改走了 `semanticService`（正确路径），于是 `getSemanticIndex` 成了孤儿。删除它是在清理历史欠账。

### 1.7 结构性缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| G1 `compile()` 在 try 之外 | KnowledgeCompiler.ts:1148 vs `try`:1152 | compile() 抛异常 → finally 不执行 → 进度永久 `compiling` |
| G2 尾部阶段有前置门槛 | 1154 / 1189 / 1249 等 | 无新页面时 3 个阶段根本不进入 |
| G3 图谱 2 条提前 return | 457-461 `busy`、464-468 `memory` | 直接 `return result`，不落任何状态 |
| G4 无 session 生命周期概念 | `startCompileProgress`(233) vs `finishCompileProgress`(386) | 会话边界必须上移 |

### 1.8 死代码 / 死字段

| 对象 | 位置 | 复核结论 | 复现命令 |
|---|---|---|---|
| `getSemanticIndex()` | knowledgeService.ts:629 | 零调用方 → 可直删（来历见 §1.6） | `grep -rn "getSemanticIndex" client/src app/src` |
| `CompileResult.quality` | KnowledgeCompiler.ts:141 | 声明后全文件无赋值 → **死能力**（`lintScore`/`hasWarnings`/`consecutiveFails` 整块未落地）；`WikiLinter` 已产出 `{error,warning}`（:419-420），`lintScore` 天然可算 → **建议回填**（§五 批次 0） | `grep -n "quality" app/src/knowledge/KnowledgeCompiler.ts` |

---

## 二、阶段模型设计

| # | phase | 代码锚点 | 进度语义 | 门控条件（不满足 → `skipped`） |
|---|---|---|---|---|
| 1 | `scanning` | `collectRawFiles()` | 无（**瞬时阶段**，C15） | 恒执行（会话起点在空库早退**之后**，无需 `skipPhase`） |
| 2 | `cleaning` | `cleanupDeletedRawFiles()` | `cleanedCount` | 恒执行 |
| 3 | `compiling` | 主循环 + `saveCompileState` 尾部落盘 | **N/M（唯一文件级进度）** | 恒执行 |
| 4 | `linting` | `WikiLinter.run()` | 无（可报 error/warning 数） | **`shouldLint && pagesCreated>0`（复合，G20）** |
| 5 | `graph_extract` | 447-548 | 页级 N/M（上限 50） | **4 层门控，见 §3.2-A（G19）** |
| 6 | `record_extract` | 1152-1186 | 页级 N/M | `pagesCreated>0 && recordSchemas.size>0 && compiledPages.length>0` |
| 7 | `rule_extract` | 1188-1244 | 页级 N/M + 全表扫描 | `pagesCreated>0 && ruleSchemas.size>0` |
| 8 | `chunk_refresh` | 1246-1273 | 文档级 N/M（仅 .pdf/.xlsx/.xls） | `compiledRaws` 含 locator 扩展名 |
| 9 | `indexing` | `finalizeIndexLog()` + `publish`（整块后移，G15） | 无进度（`triggered` 语义态） | `pagesCreated>0` |

**跳过原因枚举（v5 扩为 6 值）**

```
type PhaseSkipReason = 'gated' | 'busy' | 'memory' | 'truncated' | 'empty' | 'aborted';
```

- `busy` — `graphExtractRunning` 互斥；`memory` — `isMemoryUnderPressure()`
- `truncated` — 超 50 页截断（阶段仍算完成，但标记截断）
- `gated` — 前置门控未满足；`empty` — 目标集合为空（含空库早退）
- **`aborted` — 会话被中止时的统一兜底（G22，v5 新增）**

### 2.1 状态迁移矩阵

```
合法：
  pending  → skipped      // 门控不满足 / 空集 / busy / memory
  pending  → running      // enterPhase
  running  → done
  running  → skipped      // 运行中放弃（memory 中断 / abort 兜底）
  running  → triggered    // 仅 indexing
  pending  → skipped      // abort 兜底（G22）

非法（开发期 assert）：
  done→running、skipped→done、done→skipped、triggered→done、skipped→running
```

> **G16**：`triggered` 是**独立终态**，`finishCompileSession` 只做 `running → done` 收口，**不得**把 `triggered` 折成 `done`——否则 G10 白做。

> ⚠️ **必须支持 `pending→skipped`**：graph 的 busy/memory 分支发生在 `enterPhase('graph_extract')` **之前**。

---

## 三、后端设计

### 3.1 `CompileProgressTracker.ts` 改造

```ts
export type CompilePhase =
  | 'scanning' | 'cleaning' | 'compiling' | 'linting' | 'graph_extract'
  | 'record_extract' | 'rule_extract' | 'chunk_refresh' | 'indexing';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'skipped' | 'triggered';
export type PhaseSkipReason = 'gated' | 'busy' | 'memory' | 'truncated' | 'empty' | 'aborted';

export interface PhaseSnapshot {
  phase: CompilePhase;
  status: PhaseStatus;
  skipReason: PhaseSkipReason | null;
  startedAt: number | null;
  durationMs: number | null;
  detail: { current: number; total: number } | null;
}

export interface CompileProgress {
  // ── 既有 6 字段（不改语义）──
  status: 'idle' | 'compiling' | 'done';
  current: number; total: number;
  startedAt: number; lastError: string | null;
  result: { compiled: number; skipped: number; errors: number } | null;
  // ── 新增 ──
  sessionId: number;               // 全局单调，**重置不归零**（G24）
  seq: number;                     // 全局单调，**重置不归零**（G24）
  phase: CompilePhase | null;
  phases: PhaseSnapshot[];
}
```

**函数**

```ts
export function beginCompileSession(): void                    // 初始化 9 阶段 pending；sessionId++；**status='compiling'（G29）**；**复位 sessionTerminated=false（G23）**
export function setSessionTotal(total: number): void
export function enterPhase(phase: CompilePhase, detail?: { current: number; total: number }): void
export function updatePhaseDetail(current: number, total: number): void   // 取代 updateCompileProgress（G21）
export function completePhase(): void
export function skipPhase(phase: CompilePhase, reason: PhaseSkipReason): void
export function markTriggered(phase: CompilePhase): void        // G10/G16：indexing 专用
export function settleUnfinishedStages(reason: PhaseSkipReason): void     // G22：把 pending/running 统一置 skipped
export function finishCompileSession(result: {...}): void       // 幂等；只折叠 running→done；调 assertPhasesSettled
export function flushPhaseBroadcast(): void
// abortCompileProgress(error) 改造：见约束 9（G22）
// updateCompileProgress / startCompileProgress / finishCompileProgress 三个旧导出**删除**（G21）
```

**必须满足的 10 条约束**

1. **状态迁移受控**：每次迁移过 §2.1 矩阵，非法迁移开发期 assert。
2. **幂等收尾 + 新会话复位**（C7 + **G23**）：内部 `sessionTerminated` 标记；`abortCompileProgress` 置位后 `finishCompileSession` 直接 return，**不覆盖** `lastError`；**`beginCompileSession` 必须复位 `sessionTerminated = false`** —— 否则"第一次编译因无 provider 中止 → 此后每一次编译都不收尾 → 进度永久停在 compiling"，比 G1 更稳定的死锁。
   **另需（G29）显式写 `currentProgress.status = 'compiling'`** —— `abortCompileProgress` 把 status 置 `done` 且**没有** 60s 重置（与 finish 不对称），若不复位，下一轮 `finishCompileSession` 会被约束 4 的守卫直接 return。同时给 `abortCompileProgress` 补一个 60s 重置（与 finish 对称）。
3. **不折叠 `triggered`**（G16）：`finishCompileSession` 只把 `running` 收口为 `done`。
   **也不自动 settle `pending`** —— 正常路径下每个阶段都应由自己的门控 enter/skip（§3.2-A 清单）；终局若仍有 `pending` 残留，说明上游漏了门控评估，属**缺陷信号**，由 `assertPhasesSettled` 报错暴露，而非静默修复（静默修复会让缺陷永久隐形）。
4. **未启动保护**：`finishCompileSession` 开头 `if (status !== 'compiling') return;`。
5. **`sessionId`/`seq` 全局单调，重置不归零**（**G24**）：60s 重置**只清** `status/current/total/startedAt/lastError/result/phases`，**保留** `sessionId`、`seq`（取当前值继续递增）。若沿用 `currentProgress = {…}` 整体替换写法把两字段清零，前端 `seq` 去重会把新一轮事件**全部丢弃**，stepper 一动不动。
6. **`sessionId` 归属重置**（G7）：60s 重置定时器闭包捕获启动时 `sessionId`，条件为 `sessionId === capturedId && status === 'done'`。
7. **节流只作用于 detail 心跳**（G11）：状态迁移（enter/complete/skip/markTriggered/settle）→ **立即广播**；仅 `updatePhaseDetail` 心跳 → 500ms 合并；终态前 `flushPhaseBroadcast()`。
8. **`seq` 单调递增 + 全量快照**（G11）：

```ts
broadcastEvent('knowledge:compile:phase', {
  seq, sessionId, phase, status, label, skipReason, startedAt, detail,
  current, total, phases,          // ← 全量快照，前端整体替换而非 patch
});
```

9. **abort 路径同样 settle + 同样断言**（**G22**）：

```ts
export function abortCompileProgress(error: string): void {
  // ① 先把未收口的阶段统一置 skipped('aborted')（含 pending 与 running）
  settleUnfinishedStages('aborted');
  currentProgress.status = 'done';
  currentProgress.lastError = error;
  sessionTerminated = true;
  flushPhaseBroadcast();
  assertPhasesSettled('abort');     // ② 断言在 abort 路径也要跑
  broadcastEvent('knowledge:compile:aborted', { error });
}
```

> 注意：无 provider 分支（266-273）属于**正常 return**（不 throw），其残留是 `compiling=pending`（§0.2 修正 1）。因此 `settleUnfinishedStages` 必须同时处理 `pending` **和** `running`。

10. **`phaseSettled` 断言抽为独立函数**（G17 + G22）：`assertPhasesSettled(trigger: 'finish' | 'abort')` 遍历 `phases[]`，若仍有 `pending`/`running` → `logger.error` 打全量快照。由 `finishCompileSession` 与 `abortCompileProgress` **两条路径分别调用**（v4 只在 finish 内，导致 abort 路径无断言）。

**原 4 个事件（started/progress/completed/aborted）的名称与载荷完全不变** → `operationProgressStore.ts:109-161` 零破坏。

> ⚠️ 但它们的载荷**不含 `phases[]`**（G26）：前端若把旧事件也写进同一份 `phases` 状态，会与轮询/新事件的全量快照互相覆盖，产生"阶段回退"。来源规则见 §4.1。

11. **两类 settle 的语义边界**（**C16**）：
    - **门控未过**（阶段被评估过但条件为假）→ 由该门控自己调 `skipPhase(phase, 'gated' | 'empty' | 'busy' | 'memory')`
    - **因中止而未获评估**（异常跳出，后续门控根本没执行）→ 由 `settleUnfinishedStages('aborted')` 兜底
    - ❌ 禁止用 `settleUnfinishedStages` 覆盖已评估的门控结果（会把 `gated` 错标成 `aborted`）

12. **`phases[]` 的单一来源**（**G26**）：仅 `knowledge:compile:phase` 事件与 `GET /v1/knowledge/compile-status` 可写入；旧 4 事件只作**终态信号**，不得触碰 `phases`。

### 3.2 `KnowledgeCompiler.compile()` 全量锚点清单（四类）

> **C10 强制约定**：锚点以**符号名 + 代码原文**为主键，行号仅作辅助（本文件存在 ±1 漂移）。

#### A. 门控进入点（每阶段"要么 enter、要么 skip"，不允许两者皆无）

| # | 阶段 | 判据（代码原文） | 真 → | 假 → |
|---|---|---|---|---|
| A1 | `scanning` | 恒（**会话起点**） | **`beginCompileSession()` + `enterPhase('scanning')` + `completePhase()` 三连，钉在 `startCompileProgress(rawFiles.length);` 的原位置（即空库早退 `if (rawFiles.length === 0) return result;` 之后）** —— C15：用插入点消解空库问题；`scanning` 记为瞬时阶段 | — |
| A2 | `cleaning` | 恒 | `enterPhase('cleaning')`（置于 `cleanupDeletedRawFiles(` 之前） | — |
| A3 | `compiling` | 恒 | `enterPhase('compiling', { current: 0, total: rawFiles.length })`（置于 `for (const rawFile of rawFiles)` 之前） | — |
| A4 | `linting` | **`if (shouldLint && result.pagesCreated > 0) {`（复合条件，G20）** | `enterPhase('linting')` 置于该 if 内第一行 | `skipPhase('linting','gated')` 置于 `} else {` |
| A5a | `graph_extract` | `if (this.graphExtractor && result.totalFound > 0) {` | 继续 A5b | `skipPhase('graph_extract','gated')`（G19） |
| A5b | `graph_extract` | `if (incremental \|\| !hasKnowledgeEdges) {` | 继续 A5d | `skipPhase('graph_extract','gated')`（G19） |
| A5c | `graph_extract` | `if (pagesToExtract.length > 0) {` | 继续 A5e | `skipPhase('graph_extract','empty')`（G19/P9） |
| A5d | `graph_extract` | `if (this.graphExtractRunning) { … return result; }` | `skipPhase('graph_extract','busy')` 后 `return` | 继续 A5e |
| A5e | `graph_extract` | `if (isMemoryUnderPressure()) { … return result; }` | `skipPhase('graph_extract','memory')` 后 `return` | 继续 |
| A5f | `graph_extract` | `const limited = pagesToExtract.slice(0, GRAPH_EXTRACT_MAX_PAGES);` **之后** | `enterPhase('graph_extract', { current: 0, total: limited.length })` | — |
| A6 | `record_extract` | `pagesCreated>0 && recordSchemas.size>0 && compiledPages.length>0` | `enterPhase('record_extract', {0, compiledPages.length})` | `skipPhase('record_extract','gated')` |
| A7 | `rule_extract` | `pagesCreated>0 && ruleSchemas.size>0` | `enterPhase('rule_extract', {0, compiledPages.length})` | `skipPhase('rule_extract','gated')` |
| A8 | `chunk_refresh` | `compiledRaws` 含 `.pdf/.xlsx/.xls` | `enterPhase('chunk_refresh', {0, raws.length})` | `skipPhase('chunk_refresh','gated')` |
| A9 | `indexing` | `result.pagesCreated > 0` | `enterPhase('indexing')` → `compiler.appendCompileLog(result)` → `publish` → `markTriggered`（**不含 `updateIndexMd`**，见 D2a/G28） | `skipPhase('indexing','gated')` |

> **A5 的 4 层门控是本轮最大修正（G19）**：v4 只处理了 busy/memory，A5a/A5b/A5c 三条路径下 `graph_extract` 既没 enter 也没 skip → 永久 `pending` → 前端显示"待执行"（灰），正是 G2 要消除的错误。`phaseSettled` 断言只能报警、**不能修复 UI**。

> **A4 是本轮第二大修正（G20）**：v4 把锚点写成"`const shouldLint …` 之后判断"，实现者若按字面写 `if (shouldLint) … else …`，遇到 `shouldLint=true` 但 `pagesCreated===0`（全部跳过、无新页）时会 `enterPhase` 却永不 `completePhase` → `linting` 卡 `running`。锚点必须**引用 416 的完整表达式**。此外该块是 `try/catch`（436-441）**没有 finally**，`completePhase()` 应放在 442 的 `}` 之后、仍在 A4 的 if 块内。

#### B. 收尾必达点（所有 return / catch / finally 的 settle）

| # | 位置（代码原文） | settle 动作 | 说明 |
|---|---|---|---|
| B1 | `if (rawFiles.length === 0) return result;` | **无需任何 settle**（会话尚未开始 —— C15：`beginCompileSession()` 钉在其后，空库不产生会话） | **v5 的 G5 补丁已删除** |
| B2 | `if (!existsSync(this.rawDir)) return result;` | 无需（同样在会话起点之前） | — |
| B3 | `abortCompileProgress(errMsg); return result;`（无 provider） | `abortCompileProgress` 内部统一 settle（约束 9） | G22；残留为 `compiling=pending` |
| B4 | `startCompileProgress(rawFiles.length);` 处 | `beginCompileSession()` + `enterPhase('scanning')` + `setSessionTotal(rawFiles.length)` + `completePhase()` | 原函数删除；见 A1 |
| B5 | `if (cleanedCount > 0) { logger.info(...) }` 之后 | `completePhase()`（cleaning 完成） | — |
| B6 | 主循环 `}` + `await this.saveCompileState(newState);` 之后 | `completePhase()`（compiling 完成） | — |
| B7 | lint 块 `}`（442） | `completePhase()`（linting 完成，仍在 A4 的 if 内） | G20 |
| B8 | graph `finally { this.graphExtractRunning = false; }` | `completePhase()`（graph 完成） | — |
| B9 | graph 外层 `catch`（`handleError(... 'graph_extract')`） | `skipPhase('graph_extract','gated')` | 避免停留 running |
| B10 | K2 / K3 / R4 各自 `finally` | `completePhase()`；门控不满足时 `skipPhase(..., 'gated')` | — |
| B11 | 会话终局 | `finishCompileSession` → `assertPhasesSettled('finish')`；abort → `assertPhasesSettled('abort')` | G17 + G22 |

> **C16 — settle 语义边界**：`settleUnfinishedStages('aborted')` 只负责"**因中止而未获评估**"的阶段（异常跳出，后续门控根本没跑）；
> 已被评估但条件为假的门控，由其自身 `skipPhase(..., 'gated' | 'empty' | 'busy' | 'memory')` 负责。
> ❌ 不得用 `aborted` 覆盖已评估的门控结果。
>
> 另：`graph` 的 `return result`（B 类之外的两条）只退出 `compile()`，**不阻断** `runKnowledgeCompile` 的 K2/K3/R4 —— 它们照常进入各自的 `enterPhase`，不属"未获评估"。

#### C. 进度上报点（G21，共 5 处）

| # | 原调用（代码原文） | 迁移为 |
|---|---|---|
| C1 | `updateCompileProgress(result.compiled + result.skipped);` @292 | `updatePhaseDetail(result.compiled + result.skipped, rawFiles.length)` |
| C2 | 同上 @304 | 同上 |
| C3 | 同上 @328 | 同上 |
| C4 | 同上 @372 | 同上 |
| C5 | `updateCompileProgress(result.compiled + result.skipped, errMsg);` @378 | `updatePhaseDetail(...)` + 保留 `lastError` 语义（错误由 `handleError`/日志承载） |

> **必须一并删除 `updateCompileProgress` 的导出**：否则要么编译期报"未使用/未定义"、要么新旧双轨导致 `current/total` 与 `phases[].detail` 不同步。

#### D. 整块迁移点

| # | 原块 | 处置 |
|---|---|---|
| D1 | `finishCompileProgress({ ... })`（386-390） | **删除**（宣告权上移 §3.3） |
| D2a | `await this.indexManager.updateIndexMd();`（397） | **保留原位** —— G28：`WikiLinter` 读 `index.md` 判孤儿页（WikiLinter.ts:98/119-126），必须在其之前刷新，否则新编译页全被判孤儿 |
| D2b | `await this.indexManager.appendLog({...});` + `globalEventBus.publish('knowledge:changed', {...});`（398-410） | **整块删除**，封装为 public `appendCompileLog(result)`，由 `runKnowledgeCompile` 在 A9 调用（G15） |

### 3.3 `runKnowledgeCompile` 改造（最关键）

```ts
export async function runKnowledgeCompile(aiService, options): Promise<CompileResult> {
  if (isCompileRunning()) {                          // §3.4
    logger.warn('已有编译在运行，本次触发跳过');
    return { ...emptyResult, busy: true };
  }
  acquireCompileLock();
  let result: CompileResult | null = null;
  let lineage: LineageStore | null = null;        // ★ G27：必须在 try 外声明，否则 finally 求值触发 TDZ
  let aborted = false;
  try {
    // ★ G25（v6 修正）：以下 8 个动作原在 try 之外（:1128-1147），任一抛错即跳过 finally
    //   → releaseCompileLock() 永不执行 → 此后所有编译永久返回 busy。
    //   故本 try 必须紧贴 acquire 开始，覆盖原 1128-1273 全部逻辑。
    const graph = new KnowledgeGraph();
    await graph.init();                            // ← 原 1129：曾裸奔（DB 不可用即裸抛）
    const schemaLoader = new SchemaLoader();
    const schemaDir = schemaLoader.getSchemaDir();
    const hasGraphSchema =
      existsSync(join(schemaDir, 'entities.yaml')) || existsSync(join(schemaDir, 'edges.yaml'));
    const graphSchemas = hasGraphSchema ? await schemaLoader.loadAll() : undefined;  // ← 原 1137
    lineage = new LineageStore();                  // ★ G27：赋值（不再用 const 声明于 try 内）
    await lineage.init();                          // ← 原 1142：曾裸奔
    const graphExtractor = new GraphExtractor(aiService, graph, graphSchemas);
    const compiler = new KnowledgeCompiler(aiService, graphExtractor, { lineage });

    result = await compiler.compile(options);       // 修 G1：移入 try

    // K2 / K3 / R4：各自 settle（B10）

    // A9 indexing：G15 —— index.md/log/publish 整块作为最后一个阶段
    if (result.pagesCreated > 0) {
      enterPhase('indexing');
      await compiler.appendCompileLog(result);        // G15+G28：仅 appendLog（updateIndexMd 留原位给 lint）
      globalEventBus.publish('knowledge:changed', { action: 'updated', filePath: knowledgeRoot });
      markTriggered('indexing');                     // G16：独立终态
    } else {
      skipPhase('indexing', 'gated');
    }
  } catch (err) {
    aborted = true;
    abortCompileProgress(err instanceof Error ? err.message : String(err));  // G22：内部 settle + 断言
    await handleError(err, { module: 'knowledge:compiler', action: 'compile_session' });
    throw err;
  } finally {
    try {
      flushPhaseBroadcast();
      if (!aborted) {
        finishCompileSession(result ? {                  // 内含 assertPhasesSettled('finish')
          compiled: result.compiled, skipped: result.skipped, errors: result.errors.length,
        } : undefined);
      }
    } catch (e) {
      void handleError(e, { module: 'knowledge:compiler', action: 'session_finalize' });
    } finally {
      releaseCompileLock();                          // 修 G8：最内层 finally
      await lineage?.close().catch(() => {});          // ★ G27：TDZ 安全（lineage 可能仍为 null）
    }
  }
  return result;
}
```

**`KnowledgeCompiler` 新增方法（G15）**

```ts
/** 收尾落账：仅追加 log.md。G28：updateIndexMd 必须留在 compile() 内、lint 之前，不可迁出 */
async appendCompileLog(result: CompileResult): Promise<void> {
  await this.indexManager.appendLog({
    timestamp: Date.now(), action: 'compile', source: 'KnowledgeCompiler', pages: [],
    detail: `many-to-many 编译: ${result.compiled} 个源文件 → ${result.pagesCreated} 个页面`,
  });
}
```

> **为什么不是"publish 后移即 indexing 开始"**：那样 stepper 上 indexing 只覆盖 `publish` 一瞬，而真实的 `updateIndexMd`（重写整个 index.md）+ `appendLog`（落盘）耗时被算进了前面的 `compiling`，用户看到的阶段耗时是错的（G15）。

### 3.4 全局互斥 + `busy` 回传（G6）

```ts
let compileLock: Promise<void> | null = null;
export function isCompileRunning(): boolean { return compileLock !== null; }
```

**G6 —— busy 必须能被前端看见**：`handleKnowledgeCompile` 现在**无条件**返回 `{success:true,started:true,async:true}`（knowledge-handlers.ts:1243-1251）→ `setImmediate` 内检测到锁后返回的 `{busy:true}` **无人消费** → 前端进入 30s"等启动"循环，顶栏显示"📚 编译知识库"——用户以为在编译，其实什么都没跑。

```ts
// 202 之前先同步判锁
if (isCompileRunning()) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, started: false, busy: true,
    message: '已有编译任务在运行，请等待完成' }));
  return;
}
setImmediate(async () => { … });
```

前端 `useCompilePolling.start()` 阶段 A 之前先读 `res.busy`，命中直接 `onResult({ message:'已有编译任务在运行', hasError:false })` 并跳过轮询。

**调用方适配**

| 调用方 | 处置 | 已确认 |
|---|---|---|
| knowledge-handlers.ts:1232 | 改为同步判锁 + busy 回传 | ✅ |
| LocalHTTPServiceHelpers.ts:346-353（scheduler） | `busy` 时不 `recordBackgroundTask(complete)` | ✅ **C13**：`compileFn` 无中间层，`busy` 可达 |
| AutoDream.ts:520 / knowledgeMaintenance.ts:101 | 读 `busy` 后早退，不当作失败 | ✅ |

`CompileResult` 新增 `busy?: boolean`（可选是刻意的：正常路径不置位；与 C8 的"HTTP 契约不做兼容层"不冲突）。

> **P4 附注（不改造）**：`broadcastEvent` 出口已定位到 `LocalHTTPServiceSSE.ts:65`（解析链：`@modules/infrastructure` → `infrastructure/index.ts:28` → `http/index.ts:27-32` → `LocalHTTPServiceSSE`），与现有 4 个编译事件同路径，已被前端 `operationProgressStore` 端到端验证。**不引入新 DI**（违反 CS03 回退最小化与外科手术式修改）。

### 3.5 HTTP 端点契约

`GET /v1/knowledge/compile-status`（knowledge-handlers.ts:1262-1276，当前是 `JSON.stringify(getCompileProgress())`，**无需改 handler**）✅

```json
{
  "status": "compiling",
  "sessionId": 42, "seq": 187,
  "current": 7, "total": 12,
  "startedAt": 1757500000000,
  "lastError": null, "result": null,
  "phase": "graph_extract",
  "phases": [
    { "phase": "scanning",       "status": "done",      "skipReason": null,        "durationMs": 120,  "detail": null },
    { "phase": "cleaning",       "status": "done",      "skipReason": null,        "durationMs": 40,   "detail": null },
    { "phase": "compiling",      "status": "done",      "skipReason": null,        "durationMs": 14200,"detail": { "current": 12, "total": 12 } },
    { "phase": "linting",        "status": "skipped",   "skipReason": "gated",     "durationMs": null, "detail": null },
    { "phase": "graph_extract",  "status": "running",   "skipReason": null,        "durationMs": null, "detail": { "current": 18, "total": 50 } },
    { "phase": "record_extract", "status": "pending",   "skipReason": null,        "durationMs": null, "detail": null },
    { "phase": "rule_extract",   "status": "pending",   "skipReason": null,        "durationMs": null, "detail": null },
    { "phase": "chunk_refresh",  "status": "pending",   "skipReason": null,        "durationMs": null, "detail": null },
    { "phase": "indexing",       "status": "pending",   "skipReason": null,        "durationMs": null, "detail": null }
  ]
}
```

编译结束与中止两种终态：

```json
{ "phase": "indexing", "status": "triggered", "skipReason": null }     // 正常完成（G16）
{ "phase": "graph_extract", "status": "skipped", "skipReason": "aborted" }  // 中止兜底（G22）
```

新增 SSE 事件（**全量快照 + `sessionId` + `seq`**）：

```
event: knowledge:compile:phase
data: {"sessionId":42,"seq":187,"phase":"graph_extract","status":"running","label":"图谱提取",
       "detail":{"current":18,"total":50},"skipReason":null,"startedAt":1757500014664,
       "current":12,"total":12,"phases":[...]}
```

---

## 四、前端设计

### 4.1 新增文件（3 个）

**`client/src/components/Knowledge/Pipeline/PipelineStepper.tsx`**
- 横向 9 段，五态：`已完成` / `进行中`（脉冲环+N/M） / `已触发`（indexing 专用，文案「已触发，后台处理中」） / `已跳过`（灰黄+原因） / `待执行`（灰）
- 跳过文案：`gated → "未触发"`、`busy → "任务占用"`、`memory → "内存水位"`、`truncated → "已截断"`、`empty → "无数据"`、`aborted → "已中止"`
- Props：`{ phases: PhaseSnapshot[]; phase: CompilePhase | null }`

**`client/src/components/Knowledge/Pipeline/KnowledgePipelinePage.tsx`**
- 容器：顶部 stepper + 中部阶段详情卡 + 底部四宫格指标 + 底部血缘树（§4.4）
- 数据源（全部既有接口）：
  - `knowledgeService.getCompileStatus()` → 阶段态
  - `knowledgeService.getRawFiles()` → 入料量（`{files, totalCount}`）
  - `knowledgeService.health()` → 质量分（**不是 `getHealth()`**，knowledgeService.ts:513）
  - `graphService.getStats()` → 图谱规模
  - `GET /v1/semantic/index/status` → 索引条目数（**不要用 `getSemanticIndex()`**）；字段 `{exists, docCount, chunkCount, sizeBytes, provider, model, lastIndexedAt}`
  - `GET /v1/knowledge/lineage` → 血缘（§4.4）
- 空闲态：上一次编译结果摘要 + "全部编译"按钮（复用 `useCompilePolling().start`，含 §3.4 的 busy 处理）

**`client/src/components/Knowledge/Pipeline/useCompilePhaseStream.ts`**
- 订阅 `knowledge:compile:phase` + 4 个既有事件，**整体替换**本地 `CompileProgress`（不 patch）
- **乱序防护（G24 升级，含 sessionId 维度）**：

```ts
if (evt.sessionId === local.sessionId && evt.seq <= local.seq) return;  // 同会话内去重
// sessionId 变化 → 无条件接受，并把本地 seq 重置为 evt.seq
```

- **SSE 兜底**：SSE 未连接或 5 秒无事件 → 降级 1s 轮询 `getCompileStatus()`（同一 `phases[]` 结构，两通道天然一致）
- **来源规则（G26）**：`phases[]` 的**唯一来源**是新事件 `knowledge:compile:phase` 与轮询 `getCompileStatus()`；旧 4 事件**只作终态信号**（`completed` → 标记本轮结束；`aborted` → 标记中止），**不得写入 `phases`** —— 否则旧事件（无 `phases[]`）会与全量快照互相覆盖，导致阶段回退
- **常量复用（CS01）**：`POLL_INTERVAL / IDLE_RETRY_LIMIT / PROGRESS_DEADLINE` 从 `useCompilePolling.ts` 导出后 import

### 4.2 修改文件（3 个）

**`client/src/services/knowledgeService.ts`**
- `getCompileStatus`（390-416）：返回类型加 `sessionId` / `seq` / `phase` / `phases`
- 新增 `getSemanticIndexStatus()` → `GET /v1/semantic/index/status`
- **删除 `getSemanticIndex()`（628-634）** —— 零调用方（批次 0）

**`client/src/stores/operationProgressStore.ts`**
- `OperationProgressState` 加 `compilePhase: CompilePhase | null`
- 新增 `knowledge:compile:phase` 监听，label 升级：`📚 编译知识库 · 图谱提取 (18/50)`；跳过显示 `📚 编译知识库 · 规则抽取（未触发）`；triggered 显示 `📚 编译知识库 · 索引与落账（已触发）`
- 既有 4 个监听（109-161）**不改行为**

**`client/src/components/views/KnowledgePage.tsx`**

| 位置 | 改动 |
|---|---|
| `type KnowledgeTabKey` | 追加 `\| "pipeline"` |
| `TAB_KEYS` | 追加 `"pipeline"` |
| `tabs` | 追加 `{ key: "pipeline", label: "加工流水线" }` |
| 渲染块（照 1201-1209 的 `display` 模式） | 追加 `<KnowledgePipelinePage />`，保持常驻挂载 |

### 4.3 入口定位（待确认 D-p）

- **D-p1（推荐）**：独立 Tab「加工流水线」置于 `knowledge` 之后。分工：**流水线 = 过程**（阶段/进度/跳过原因/血缘）；**语义索引 = 结果**（条目/查询/重建）。
- **D-p2**：不新增 Tab，stepper 作 `knowledge` Tab 顶部常驻状态条。
- **D-p3**：并入语义索引 Tab 上半部。

> §1.6 已确认语义索引 Tab 正常，故 D-p1 与它**不重复**，仅相邻。

### 4.4 血缘视图（G12）

`GET /v1/knowledge/lineage`（knowledge-routes.ts:256）支持 `docPath` 正查 + `artifactType+artifactId` 反查，`LineageStore` 记录 `raw → page → record/rule/node` 全链并绑 `compileVersion`。

- **位置**：PipelinePage 底部「本次编译血缘」折叠面板（与 stepper 并列的第二维度）
- **交互**：左侧选一个本次编译的 raw → 右侧树展开其 `page → record / rule / node` 后代，节点标注 `artifactType` 与版本
- **与 stepper 的关系**：stepper 回答"现在跑到哪一步"，血缘树回答"这些产物从哪来"
- **成本**：接口现成，仅需前端一个树组件 + 一次 `getLineage({ docPath })`

---

## 五、实施顺序与验收（含完成状态）

> 标记：**✅ 已验证**（附证据） · **⚠️ 等价路径/已修订** · **⏳ 未验证**（附原因与补验方式）
> 核对时间：2026-09-11

### 批次 0（前置，独立缺陷）—— ✅ 全部完成
1. ✅ 删 `getSemanticIndex()` 死代码（零调用方，复现命令见 §1.8）
2. ✅ `CompileResult.quality` **回填**（建议 D）：lint 后写入 `{ lintScore, hasWarnings, consecutiveFails: 0 }`（`consecutiveFails` 按计划延后）
3. ✅ `bun run typecheck` 双端 0 错误

### 批次 1（后端阶段机 + 生命周期迁移 + 互斥）—— ✅ 全部完成
4. ✅ `CompileProgressTracker.ts`：类型 + 12 个函数 + 迁移矩阵 + 节流（仅 detail）+ 幂等 + G23/G24 + 约束 9/10/11/12
5. ✅ `KnowledgeCompiler.ts`：§3.2 四类清单逐条落地（A1-A9 / B1-B11 / C1-C5 / D1-D2）
6. ✅ `runKnowledgeCompile`：§3.3 结构（含 G1/G25/G27/G28）
7. ✅ 全局互斥 + handler 同步判锁返回 busy（G6）+ 3 处调用方适配

**验收（逐条）**

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| 1 | `phase` 依次推进；终态无 `pending`/`running` 残留 | ✅ | 现场：全量 172/172 后 9 阶段全部 settle；单测覆盖 |
| 2 | 空 raw 库 → 不产生编译会话 | ⚠️ | 等价路径已验证（指定目标未命中 → `status` 保持 `idle`、不建会话，日志 `指定文档编译跳过`）；**真正空库**需隔离数据目录，单例守卫禁止并发实例，未单独构造 |
| 3 | `shouldLint=true` 但 `pagesCreated=0` → `linting=skipped(gated)` | ✅ | 单测 + 现场多次 no-op 编译 |
| 4 | `graph_extract` 门控不满足 → `skipped(gated\|empty)` 非 `pending` | ✅ | 代码（A5a/A5b/A5c）+ 单测；现场观测到 `skipped/memory` |
| 5 | 无 provider → `compiling=skipped(aborted)` | ⏳ | 环境已配 provider，无法构造；补验方式：断网/清空 providers 后触发 |
| 6 | 中止一次后再编译，进度能走完 | ✅ | 单测（G23） |
| 7 | 中止后 `status` 能到 `done` | ✅ | 单测（G29） |
| 8 | `updateIndexMd()` 仍在 lint 之前 | ✅ | G28 已落地为"留原位"；代码位置可查 |
| 9 | 连续两次编译间隔 <60s → 第二次事件不被丢弃 | ✅ | **现场**：60s 重置后 `status=idle`、`phases` 清空，但 `sessionId=3`/`seq=54` **未归零**、`lastSession` 保留（G24 后端前提）；前端去重逻辑见 §4.1 |
| 10 | `phase==='graph_extract'` 时 `status !== 'done'` | ✅ | **现场两次观测**（生命周期解耦判据） |
| 11 | 调度器占用时点"全部编译" → `busy:true` | ✅ | **现场**：`{success:true, started:false, busy:true}` |
| 12 | 编译结束 → `indexing` = `triggered`（非 `done`） | ✅ | **现场** |
| 13 | `indexing` 的 `durationMs` 覆盖 `updateIndexMd + appendLog + publish` | ⚠️ **该项已被 G28 修订** | `updateIndexMd` 必须留在编译期（lint 依赖），indexing 只含 `appendLog + publish` → 判据应改为"覆盖 appendLog + publish" |
| 14 | 注入 `compile()` 抛异常 → 不卡死、后续编译仍能启动 | ✅ | **故障注入测试**：`mock.module` 让 `graph.init()` 抛错 → 错误上抛且二次调用仍能到达同一注入点（未被子例锁挡住） |
| 15 | 注入 `graph.init()` / `lineage.init()` 抛错 → 锁未泄漏 | ✅ | 同上测试断言 `isCompileRunning() === false`（两次调用后均成立）—— 见 `compileFaultInjection.test.ts` |

### 批次 2（前端组件）—— ✅ 全部完成
8. ✅ 3 个新文件（`PipelineStepper` / `KnowledgePipelinePage` / `useCompilePhaseStream`）+ 3 处修改 + **血缘视图** + D-p1 定位

**验收**：✅ **浏览器实测通过**（2026-09-11）——
Tab 顺序正确（知识库 / 加工流水线 / 语义索引 / …）、stepper 8 节点齐全、阶段明细 9 行状态正确（完成/未触发/耗时）、四指标卡渲染、指定文档编译区（173 个可编译复选框 + 禁用态按钮 + 说明文字）、血缘面板**实取 36 个源文档**并带产物标签（非空态）、刷新后 `lastSession` 正常恢复；
⏳ **"断线重连后无阶段回跳"**：页面刷新路径已验（状态正确无回跳）；**完全断开 SSE 后走 5s 降级轮询**的路径未单独构造。
> ⚠️ 浏览器实测**发现并已修复 1 个回归**：SSE `knowledge:compile:phase` 载荷缺 `lastSession`，而前端"整体替换"会冲掉上一会话摘要 → 空闲态文案退化为"本次编译刚结束"（见 §五·计划外补充）

### 批次 3（加固）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 9 | SSE 断线降级轮询一致性 | ⚠️ 部分 | **浏览器已验证页面刷新路径**（SSE 重连后状态正确、无回跳、`lastSession` 恢复）；"完全断线 → 5s 降级轮询"未单独构造 |
| 10 | 内存压力 → `graph_extract → skipped(memory)` | ✅ | **现场已观测**（全量编译时命中该分支） |
| 11 | 50 页截断 → `skipped(truncated)` | ⏳ | 当前库待提取页数不足 50（且因内存压力被跳过）；可用「指定文档编译」一次选 ~13 个文件造出 >50 页，**但需 ~50 次图谱 LLM 抽取**，未执行 |
| 12 | 血缘树大数据量渲染性能 | ⚠️ 部分 | **浏览器已验证功能可用**（实取 36 源文档 + 产物标签 + `+N` 省略计数）；"数百后代"规模未构造（组件已有 30 组/20 条上限 + 过滤） |

### 计划外补充（本轮实际交付，原 §五 未列）

| 项 | 状态 | 说明 |
|---|---|---|
| EISDIR 根因修复 | ✅ | 发布侧改传 `filePaths`；现场 `docCount 1485→1491`、`chunkCount 9242→9319`、`lastIndexedAt` 刷新 |
| 语义索引**批量写入**修复 | ✅ | 新增 `appendIndexBatch()`（原逐文件 → 2N 次全量重写 204MB 索引，导致接口 15s 超时） |
| `lastSession` 空闲态复盘 + **落盘** | ✅ | 60s 复位不清除；持久化到 `resolveDataSubDir('knowledge')/compile-last-session.json`；重启后仍在（现场验证） |
| 指定文档编译 | ✅ | `CompileOptions.onlyFiles` + `POST {files}` + 两个入口；规避"清理误删/快照覆盖/点了没反应"三坑 |
| 编译失败原因可观测 | ✅ | `result.errorSamples`（前 5 条）随 `compile-status`/`lastSession` 透出 + UI 红色横幅 |
| `raw-files` 目录与可编译标记 | ✅ | 跳过目录 + 返回 `compilable`（复用 `COMPILABLE_EXTENSIONS`）；现场 `926 / compilable 172` 与编译器一致 |
| 顶层 `current/total` 契约修正 | ✅ | `updatePhaseDetail` 不再让非 compiling 阶段污染顶层文件级进度（单测锁定） |
| 测试 | ✅ | 新增 `compileProgressTracker.test.ts`(11) + `knowledgeCompileStatus.contract.test.ts`(3) + `compileFaultInjection.test.ts`(1)；`bun test src/knowledge …` **114/114** |
| 预存问题 M1 修复 | ✅ | handler 集成测试 hook 超时（局部放宽 30s） |
| **SSE 载荷回归修复** | ✅ | **浏览器实测发现**：`knowledge:compile:phase` 缺 `lastSession` → 前端整体替换冲掉上一会话摘要 → 空闲态文案退化。已补 `lastSession`；**headless SSE 直读验证**：12 条 phase 事件，`data:` 行已含 `lastSession` |
| **指标口径修复** | ✅ | **浏览器实测发现**：卡片"待编译入料"用 `totalCount`（含 `.meta.json` 与不可编译文件，现场 **928**）严重高估，实际可编译仅 **173**；改用 `compilable` 计数，hint 改为"raw/ 可编译文件数" |
| 顶层计数契约（SSE 侧复核） | ✅ | headless SSE 实测同一事件内：顶层 `current:1, total:1`（文件级）、`detail:{current:2,total:3}`（页级）—— 两套计数互不污染 |

### 回滚
后端改动为追加字段 + 新增事件，原 4 事件契约不变；回滚只需还原 `CompileProgressTracker.ts` 与 `KnowledgeCompiler.ts` 两文件，前端 Tab 若保留则降级为"仅显示 idle"。

---


## 六、风险登记

| 风险 | 等级 | 处置 |
|---|---|---|
| 空库早退 → scanning 卡 running | 🟡 中（**方案引入，非既有缺陷**，C15） | 插入点消解：`beginCompileSession()` 钉在空库早退之后（A1/B4），**无需防御代码** |
| **`graph.init`/`lineage.init` 抛错 → 锁永不释放 → 后续编译永久 busy** | 🔴 高 | G25：`acquireCompileLock()` 后**立即** `try {`，原 1128-1273 全部包入 |
| **旧 4 事件无 `phases[]` → 与全量快照互相覆盖 → 阶段回退** | 🟠 高 | G26：`phases[]` 唯一来源是新事件与轮询 |
| **busy 被 202 吞掉 → 前端假编译** | 🔴 高 | G6：handler 同步判锁 + busy 回传 |
| **linting 复合条件漏 `else` → 卡 running** | 🔴 高 | G20：锚点挂 416 完整表达式 |
| **seq 去重缺 sessionId → 第二次编译前端不动** | 🔴 高 | G24：`sessionId`/`seq` 不归零 + 前端联合判据 |
| **graph 3 条非进入路径 → 停 `pending`** | 🔴 高 | G19：A5a/A5b/A5c 各补 `skipPhase` |
| **`sessionTerminated` 未复位 → 一次中止后永久失效** | 🔴 高 | G23：`beginCompileSession` 复位 |
| **abort 路径不 settle / 不跑断言** | 🟠 高 | G22：`settleUnfinishedStages` + 双路径断言 |
| **`updateCompileProgress` 5 处未迁移 → 编译期报错/双轨** | 🟠 中 | G21：C1-C5 迁移 + 删旧导出 |
| SSE/轮询双通道不一致 + 乱序回跳 | 🟠 高 | G11：全量快照 + `seq` |
| `indexing` 耗时低报（漏 updateIndexMd/appendLog） | 🟠 中 | G15：整块上移 + `finalizeIndexLog()` |
| `triggered` 被折叠成 `done` | 🟠 中 | G16：独立终态 |
| 节流吞短阶段（scanning/cleaning） | 🟠 中 | 状态迁移立即推送，仅 detail 合并 |
| `pending→skipped` 缺失 → 阶段卡待执行 | 🟠 中 | G9：迁移矩阵 + 断言 |
| `compile()` 抛异常 → 卡 compiling | 🟠 高 | G1：入 try + finally 幂等收尾 |
| finally 锁释放被阻塞 → 全局死锁 | 🟠 中 | G8：最内层 finally |
| 60s 重置清空后续编译结果 | 🟠 中 | G7：`sessionId` 归属判断 |
| 图谱提前 return → 卡 running | 🟠 高 | G3 + B8/B9 |
| `finish` 与 `abort` 双写覆盖 lastError | 🟡 中 | C7：`sessionTerminated` + 幂等 |
| ~~语义索引 EISDIR → `indexing` 展示"假成功"~~ | ✅ 已修复（2026-09-11） | 发布侧改传 `filePaths`（具体页面）+ 订阅侧批量处理；**禁止**逐页 publish（会放大 N 次全量重建） |
| `getSemanticIndex()` 死代码 | 🟢 低 | 零调用方，直接删（来历见 §1.6） |
| `CompileResult.quality` 死能力（非死字段） | 🟢 低 | 建议 D 采纳：lint 后回填 `lintScore`/`hasWarnings`（批次 0） |
| 图谱阶段长耗时阻塞 UI 感知 | 🟢 低 | 页级进度 + 50 页上限 + "已截断"提示 |
| 行号漂移致插错位置 | 🟢 低 | C10：符号名 + 代码原文为主键 |

---

## 七、一句话总结

**方案 B 的工程量八成在后端**：核心不是画 stepper，而是把 `CompileProgressTracker` 从"文件计数器"升级成"**受迁移矩阵约束、有统一 settle 与断言兜底**的阶段状态机"，并把 `finish` 的宣告权从 `compile()` 内（:386）上移到 `runKnowledgeCompile` 的 `finally`，**同时把 `compile()` 挪进 try、把 index/log/publish 整块后移成末阶段、把锁释放放进最内层 finally**。

v5 的核心增量是**"穷举"**——v4 用零散插入点，漏了三类东西：

1. **漏门控**（G19）：`graph_extract` 有 4 层门控，v4 只处理 2 层 → 另 3 条路径停 `pending`；
2. **漏调用点**（G21）：`updateCompileProgress` 的 **5 处**调用未列入迁移清单 → 会编译期报错或双轨不同步；
3. **漏 else 分支**（G20）：`linting` 的门控是复合条件且无 finally → `pagesCreated=0` 时卡 `running`。

以及两个**同源但更隐蔽的状态缺陷**：`sessionTerminated` 未在新会话复位（G23，一次中止=永久失效）、`seq` 去重缺 `sessionId` 维度（G24，第二次编译前端完全没反应）。

v5 因此把 §3.2 重构为 **A/B/C/D 四类全量清单**（14 条门控分支 / 11 处收尾点 / 5 处上报点 / 2 块迁移），后续复查应逐行核对这四类，而非重读全文。

v6 的增量中，**只有一条是 v5 自身的硬伤**：§3.3 把 `acquireCompileLock()` 放在 `try` 之前，而 `await graph.init()`(:1129) / `await lineage.init()`(:1142) 都在 `try`(:1152) 之外 ——
它们任一抛错都会跳过 finally，`releaseCompileLock()` 永不执行，**此后所有编译永久返回 `busy`**（G25）。
修法一句话：**acquire 之后立刻 `try {`，把原 1128-1273 整体包进去**。

另需正视（建议 E）：EISDIR 让语义索引那一路**一直在静默失败**，因此 `indexing = triggered` 若不加标注，展示的就是一个假成功态 —— 与"真·实时进度"的立项初衷冲突，必须在范围或文案上做出明确选择（决策 D-r）。

v6 的方法论收获：**"用插入点消解，而不是加防御"**（C15）—— 空库问题的正解是把 `beginCompileSession()` 钉在空库早退之后，而不是补一个 `skipPhase`；这与 CS03（回退策略最小化）同源。
