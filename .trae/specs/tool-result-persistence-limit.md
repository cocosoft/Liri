# 工具结果持久化限额（`messages.jsonl` 体积治理）—— 需求与设计

- **建档**：2026-10-02（承接 D-232 / D-233 / D-234 的续查）
- **状态**：**待取证（T1） → 待评审 → 待实施**
- **关联**：`dev_docs/error_repairs/预存错误与待处理问题.md`（D-232 续查 · D-234）
- **一句话**：「工具结果限额」的**三层防御已存在，但只作用于上下文（请求侧）**；本 spec 处置的是**持久化侧** —— 让 `messages.jsonl` 中的 `tool_result` 消息与请求同口径（只存 preview + 路径引用，全量仅存 `tool-results/*.txt`），以根治会话文件膨胀。

---

## 1. 取证（先证「已有什么」，避免重造 — CS01）

### 1.1 已有机制（**禁止另建**）

| 层 | 位置 | 阈值 / 行为 |
|---|---|---|
| 一级：工具内 cap | 各工具 `maxResultSizeChars` | 工具自身截断 |
| **二级：单条超限落盘** | `app/src/tools/services/ToolResultPersister.ts` | `SINGLE_RESULT_LIMIT_CHARS = 50_000` ⇒ 落 `~/.pyapp/data/tool-results/{toolCallId}.txt`，上下文替换为 `PREVIEW_CHARS = 8_000` + `buildPathRefNotice()` 路径引用（模型可 `read_file` 读全量） |
| 三级：单轮聚合 spill | 同上 | `TURN_BUDGET_CHARS = 200_000` |
| 请求侧再截断 | `chat/services/ChatHelper.ts#truncateToolResult` | `TOOL_RESULT_MAX_LENGTH = 8000`（单一事实源已于 D-234 移至 `utils/toolResultLimits.ts`） |
| 估算侧口径 | `ai/tokenizer/TokenEstimator.ts#contentForEstimate` | D-234：已与请求侧对齐 |
| 保留策略 | `session/ArtifactRetention.ts` | `tool-results/*.txt` 按天保留（可配） |

**实测**：`~/.pyapp/data/tool-results/` 已有 **203 文件 / 38.21MB** ⇒ 二级/三级**确在运行**。

### 1.2 真缺口（实盘证据）

- 样本会话 `session_mujh93m0ozq1ctj9s6f`：`messages.jsonl` = **30.43MB / 2380 行**（`events.jsonl` 另 26.57MB）；
  行长 **MAX = 13,981,637 字符（≈14MB）**，AVG = 12,761，**>10K 的行 274 条**。
- 最大的三条**全部是** `{"type":"tool_result","role":"tool"}`（14MB / 2.2MB / 2.1MB）。
- 14MB 那条的 `value` 形如 `{"matches":["call_00_…txt:2: <整行>"]}` ⇒ 是对**已落盘 `tool-results/*.txt` 的检索结果**
  （外置文件被工具**读回**、整行返回）。
- ⇒ **缺口本质 = 限额只在「请求/上下文侧」生效，`messages.jsonl` 仍持久化原文**（与 D-234 发现的
  `truncateToolResult` 仅作用请求侧，属**同一类**缺陷）。

**影响**：① 会话文件 30MB（磁盘 + 每次加载的解析与内存）；② D-232 的 70s 阻塞即由此放大（估算已修，但输入体积仍在）；
③ 备份 / 导出 / FTS / semantic-index 成本同步放大。

### 1.3 T1 取证结论（**已完成 2026-10-02** — CS06 证据驱动）

**判定：(a) 顺序/对象问题**（**非旁路**）。证据（以样本会话回放，与日志时间窗无关）：

| 核验 | 结果 |
|---|---|
| `tool-results/` 实盘 | **203 文件 / 38.21MB** |
| 样本会话 `tool_result` 消息 | **2241 条，全部带 `metadata.toolCallId`** |
| `content > 200,000`（>3× 二级阈值） | **6 / 6 已落盘 = 100%** |
| `content > 50,000`（超二级阈值） | **9 / 10 已落盘 = 90%** |
| `content > 8,000`（仅超请求侧阈值） | 10 / 217 = 4.6%（**符合预期**：二级阈值是 50,000，此区间本不触发） |
| 关键样本 | 14MB 消息 `metadata.toolCallId = call_01_UfMuqamG5yahdnoVKhuE7255`，且 `tool-results/call_01_UfMuqamG5yahdnoVKhuE7255.txt` **存在（5.43MB，该目录最大）** ⇒ **落盘与原文并存** |

⇒ **二级/三级防御确在运行**；缺口是**持久化用了未改写的对象**（限额只在上下文侧生效）。

**🆕 T1 附带发现（→ T5，待查，非本 spec 主范围）**：1 条 `52,277` 字符（`call_00_qej1HrTs7H1KF5xENANE6775`）**未落盘**，
恰在 `SINGLE_RESULT_LIMIT_CHARS = 50,000` 边缘 ⇒ 疑为**阈值比较口径**（含/不含包装、或对 `data` 与 `result` 二选一的长度判定差异）
或该路径未触发。已登记 `预存错误与待处理问题.md`。

---

## 2. 目标 / 非目标

**目标**：`messages.jsonl` 中**单条 `message.content` 有可解释上限**（默认与请求口径一致：`≤ preview + 路径引用`）；
全量仍可经 `tool-results/*.txt`（+ `events.jsonl`）恢复。

**非目标**：① 不改压缩策略与阈值；② 不改工具输出语义；③ **不动 `events.jsonl`**（`project_rules §1.6`「模型可见 ⇔ 已落盘」红线：可重建性必须保留）；
④ 不做历史会话迁移（本项目无正式用户，`§1.3` 无兼容负担）——除非 T1 显示迁移成本极低。

---

## 3. 方案（最小改动）

> **T1 已定论 (a)** ⇒ **采用 §3.1**（§3.2 作废，仅留作记录）。

### 3.1 ✅ 定稿（T1 ⇒ (a) 顺序/对象问题）
在**持久化入口**（`_addAndPersistMessage` 同一批数据流）**对 `tool_result` 消息应用与二级防御相同的改写**：
- 复用 `ToolResultPersister` 的既有常量与 `buildPathRefNotice()`（**不新增阈值、不新写实现**）；
- 落盘沿用 `toolResultPath(toolCallId)`，回读协议不变（`read_file` 该路径）。
- 实现要点：**单一改写函数 + 单一入口**（禁止在多个写入点各自复制规则 —— CS01）。

### 3.2 ~~若 T1 ⇒ (b) 旁路~~（**已作废**：T1 判定为 (a)，非旁路）
把该旁路**接到既有二级/三级防御**（即调用 `persistToolResult` / 同口径改写），而非为旁路新增限额。

### 3.3 读取侧补充（可选项，待裁定）
`read_file` 读取 `tool-results/*.txt` 时不设限，是"读回即膨胀"的上游。可评估：
**读取侧同样返回 preview + 提示分片读取**（或对 `tool-results/` 目录的**整行检索**做行长截断）。
⚠️ 该改动会影响"模型按需读全量"的能力，**须用户裁定**，默认**不做**。

---

## 4. 验收（可测）

1. **单条上限**：在新会话中制造 >50,000 字符的工具结果 ⇒ `messages.jsonl` 该条 `content` 长度 ≤ `PREVIEW_CHARS + 路径引用`（含文件名长度），**且** `tool-results/{id}.txt` 存在且内容完整。
2. **可重建**：`read_file` 该路径可读回全量；`events.jsonl` 侧信息不缺失（§1.6 红线）。
3. **膨胀停止**：样本会话不再增长（同会话追加工具结果后，`messages.jsonl` 增量 ≈ preview 量级，而非原文字节数）。
4. **门禁矩阵**：`bun run typecheck` = 0 · `bun run lint:arch` 违规 0 / 已豁免 0 · 相关 `bun test` 全绿。
5. **回归**：`bun test`（token/compaction/chat 相关套件）全绿；D-233/D-234 的估算口径不回归（`estimateMessagesTokensCooperativeFromTail` 行为不变）。

---

## 5. 合规检查表

| 规则 | 检查点 | 状态 |
|---|---|---|
| `project_rules §1.6` 红线 | 模型可见输入仍可从事件日志重建（**不改 `events.jsonl` 语义**） | 待实施后核 |
| `project_rules §1.13` / §1.4.1 | 路径一律 `resolveDataSubDir('tool-results')`，禁自建目录/拼接 | 设计已符合（复用既有函数） |
| `project_rules §1.3` | 无需向后兼容层（无正式用户） | ✅ |
| `coding-standards CS01` | **复用** `ToolResultPersister` 既有常量与函数，**不新增第二套阈值** | 设计即遵循 |
| `coding-standards CS03` | 落盘失败（磁盘满等）不得静默：须 `handleError` 且**保留原文**（不得因落盘失败而丢内容） | 待实施 |
| `coding-standards CS04/CS06` | 无 mock；T1 未取证不动代码；结论均附证据 | ✅ |
| `architecture-compliance R01` | 实现落在 `services`/`tools`（infra/service 层），调用方在 app 层 ⇒ 方向合法 | 待实施后 `lint:arch` 核 |
| `architecture-compliance R04-001` | 若改动使既有文件超长（>1000 行例外清单）须同步评估 | 待实施后核 |
| `layer-inversion spec` | 不新增跨层边（`lint:arch` 0 违规 / 0 豁免为门禁） | 待实施后核 |

---

## 6. 不在范围 / 未验（如实）

- **历史会话的 30MB 文件**：本 spec 不迁移（不删除、不重写）；如需清理，另立一次性运维项。
- **`events.jsonl` 26.57MB**：与本 spec 不同物（事件日志按红线保留），仅记录现状。
- **读取侧限额（§3.3）**：默认不做，需用户裁定。
- **T1 取证结论**：**未完成** ⇒ 本 spec 的方案（§3.1/§3.2）**尚未定稿**，不得据此直接实施。

---

## 7. 实施记录（待补）

| 任务 | 内容 | 状态 |
|---|---|---|
| **T1** | 取证：原文写入路径 = 顺序问题 (a) 还是旁路 (b) | ✅ **已完成（2026-10-02）⇒ 判定 (a)**（证据见 §1.3；`tool-results/` 203 文件；>200K 的 6/6 已落盘、>50K 的 9/10；14MB 样本的 `toolCallId` 有对应 5.43MB 落盘文件） |
| T2 | 按 (a) 实施最小改动：持久化入口复用既有改写（单一改写函数 + 单一入口） | ✅ **已完成（2026-10-02）**：`ToolResultPersister.ts` 新增 `shrinkToolResultMessageForPersistence()`（复用同模块常量/`persistToolResult`/`buildPathRefNotice`；幂等；≤阈值零开销；非 JSON 不动）· `tools/index.ts` 增补导出 · `ChatManager._addAndPersistMessage`（17 处调用的**唯一落盘通道**）接入。合成超限消息验证：`200,035 → 8,155` 字符（**4.08%**）· `JSON_OK` · `HAS_NOTICE` · **幂等** · 小消息/非工具消息**不动**。类型适配：`Message.type` 为枚举 ⇒ 改由内容结构判定 + 复用 `SINGLE_RESULT_LIMIT_CHARS`（初版 `=== 'tool_result'` 触发 `TS2367`，已被 typecheck 捕获） |
| T3 | 验收矩阵（§4 五项）+ 复跑门禁 | ⚠️ **部分完成**：`typecheck` = **0** · 架构门禁 `bun scripts/lint-architecture.ts` **退出码 0**（仅既有 2 条 warning）· 定向单测 `src/ai src/tokenBudget src/chat` **90 pass / 0 fail** · 集成套件 `bun test tests` = **4069 pass / 19 skip / 2 fail** —— 2 条失败经定位为**预存夹具失效**（见下「非本次引入」），非本 spec 引入；**§4 第 1/3 项的端到端（新会话制造 >50,000 结果后核 `messages.jsonl`）未做**（需真实会话跑一轮） |
| T4 | 同步 `预存错误与待处理问题.md` 并更新本 spec 实施记录 | ✅ **已完成（2026-10-02）**：记 D-236（T2 实施+验证）与 D-237（预存夹具失效） |
| **T5** | 🆕 T1 附带发现：1 条 `52,277` 字符未落盘（`call_00_qej1HrTs7H1KF5xENANE6775`）⇒ 查 `SINGLE_RESULT_LIMIT_CHARS` 的**比较口径**（含包装？`data` vs `result` 判定差异？）或该路径未触发 | 未开始 |

#### ⚠️ T3 中发现的**非本次引入**失败（→ D-237，已记录）

`bun test tests` 的 2 条 `fail` 均出自 `app/tests/evals/sourceTaskSpecs.test.ts`：
`src-dedupe-tool-call-blocks` 规格仍固定 `app/src/chat/utils/chatBlocks.ts`，而该文件**已在前序批次下沉**为
`app/src/utils/chatBlocks.ts`（夹具未同步）⇒ 报「源文件不再满足资格线」与 `ENOENT`。**属早前批次遗留的红**，
修复方式为**同步该夹具的 `sourcePath`**（1 行级），**待你裁定**是否纳入本批。

**✅ 已处置（方案甲，2026-10-02）**：路径同步后 `ENOENT` 消除，但候选断言仍失败 ⇒ 续查确认为**规格前提消失**（候选扫描为目录限定：`DEFAULT_SOURCE_DIRS = ['app/src/chat','app/src/query','app/src/tools']`，`utils/` 不在其中）⇒ 依「源文件迁移 ⇒ spec 同步生命周期」**废弃该规格**（`source-derived.ts` 13→12 · 测试数量断言与标题同步 · `baseline.json` 清理该 id）。**验证**：`sourceTaskSpecs.test.ts` = **5 pass / 0 fail** · `typecheck = 0`。**未取方案乙**（扩 `DEFAULT_SOURCE_DIRS` 会放大整条 eval 流水线候选池，代价不成比例）。
