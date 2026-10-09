# Spec：`CoreAPIImpl` 拆分（C3 巨头之一 · 子 spec）

> 版本 1.2 ｜ 创建 2026-10-09 ｜ 状态：**S1 ✅ + S3 ✅ ⇒ CoreAPIImpl 1898 行（<2000，豁免 FSZ-007 已移除）；S2 待实施（可选）**
> **来源**：`.trae/specs/large-file-split.md` §4（巨头须各自子 spec）· `scripts/layer-exceptions.json` FSZ-007
> **关联规则**：GR15 · CS01（纯搬迁、不改语义）· CS03 · CS06（证据驱动）· **R04-001（>2000 行；本文件在**豁免清单**，`expiresAt 2026-11-30`）** · R03-002（模块出口）

---

## 0. ⚠️ 口径订正（CS06，2026-10-09 实测）

**行数口径以 `lint:size` 为准**（`content.split('\n')`，**含空行**）。
早前用 `(Get-Content).Lines` / `Measure-Object -Line` 测得的 2354 / 1969 **均少算空行**（后者一度让我误判"已 <2000"）。
权威值：移动前约 **2522**（豁免登记值）→ 移动后 **2148**（`lint:size` 实测）。

---

## 1. 证据（实测，2026-10-09）

| 事实 | 证据 |
|---|---|
| 当前 **2354 行** | `(Get-Content CoreAPIImpl.ts \| Measure-Object -Line).Lines` |
| 豁免登记 `lines: 2522`（2026-08-09 登记值，**已过时**） | `scripts/layer-exceptions.json` FSZ-007（`targetLines 2000`） |
| **已被部分拆分**（B1–B4，2026-10-05）：`DomainSnapshotOps`（零宿主依赖）· `SessionMessagesRead` · `MessageMutation` · `SessionTitling`（均**外迁类 + deps 端口**） | `runtime/api/{domainSnapshotOps,sessionMessagesRead,messageMutation,sessionTitling}.ts`；`CoreAPIImpl` 内为**薄转发**（如 `return this.domainSnapshotOps.listDreamCycles(params)`） |
| 另有 ~25 个 `*Ports.ts` **类型契约**文件（非实现） | `runtime/api/*Ports.ts` |

**结论**：该文件的拆分**范式已确立**（外迁类 + deps 端口 + 薄转发）；剩余体量集中在 **LLM 对话主路径**。

---

## 2. 剩余体量（实测行号）

| 区段 | 行号 | 规模 | 说明 |
|---|---|---|---|
| `ensureLLMClientInitialized` | 440–554 | ~115 | LLM 客户端懒初始化（含探活/降级） |
| `resolveSmartModel` | 566–610 | ~45 | 模型解析（SmartRouter/静态路由） |
| **`chat`** | 612–712 | ~100 | 非流式入口 |
| **`chatStream`** | **713–1484** | **~770** | **流式主路径（最大单块）** |
| `executeTool` | 1485–1551 | ~66 | 工具执行（含 diff 缓存） |
| `getGitContextSnapshot`…`getProjectOpsPort` | 1552–1813 | ~260 | **已薄转发**（`domainSnapshotOps`） |
| 会话/代理/文件等 ops | 1814–2470 | ~650 | 部分已薄转发（B2/B3/B4）；其余为实实现 |

⇒ **`chatStream` 单块即 ~770 行**：抽出后 2354 → **~1584**，**低于 2000 ⇒ 可移除 R04-001 豁免 FSZ-007**。

---

## 3. 拆分计划（切片；**风险优先排序** + 每片独立评审 + 全量回归）

### S1（首选，**风险更低**）：session/agent/file ops → `runtime/api/sessionAgentOps.ts`

- **范围**：`listTools`/`getTool`（1813–1858）· `createSession`/`forkSession`/`getSession`/`_resolveSessionSource`/`listSessions`/`searchMessagesFTS`/`listLiteSessions`/`deleteSession`/`clearAllSessions`/`switchSession`/`compactSession`/`pruneSessions`/`renameSession`/`setPreliminaryTitle`/`shouldAutoTitle`/`updateSessionMeta`/`generateSessionTitle`/`getCurrentSession`（1860–2336）· `executeAgentTask`/`getAgentProgress`/`convertFile`/`detectFileType`（2337–2434）≈ **620 行**。
- **为何先于 `chatStream`**：本段为**会话/工具/文件查询类**操作，无流式编排/工具循环/压缩，语义简单 ⇒ 搬迁风险显著低于主路径。
- **`SessionAgentOpsDeps`（惰性 getter，对照 B2/B3/B4）**：`getToolManager()` · `getChatManager()` · `getSessionManager()` · `getSessionTitling()` · `getSessionMessagesRead()` · `getMessageMutation()` · `getCoordinator()` · `getConverterEngine()` · `getFileTypeDetector()`（+ 私有 `resolveSessionSource(session)`）。
  ⚠️ **精确清单以搬迁时实测 `this.` 为准**（本 spec 不臆造，CS06）。
- **预期规模**：2354 → **~1734 ⇒ <2000，可移除 R04-001 豁免 FSZ-007**。
- **验收**：`typecheck` ✅ · 全量 `bun test` ✅ · `lint:size` **例外 8 → 7**（并移除 `layer-exceptions.json` FSZ-007）。

### S2：`chatStream` → `runtime/api/chatStreamOps.ts`（**风险较高**）

- 实测 `this.` 依赖面（**仅 6 个宿主成员**）：`chatManager`(838/1136/1145/1294/1306/1356/1357/1402/1403) · `sessionTitling`(802/807/1022/1345/1443) · `ensureLLMClientInitialized()`(729) · `resolveSmartModel()`(812) · `_modelName` 写(825) · `_fileOldContentCache`(913/1035/1038/1058)。
- 另有模块级依赖（`getOTelTracing`/`logger`/`STATUS_TYPE`/`fs`/`computeUnifiedDiff`/`eventNotificationService` 等）随方法一并迁入。
- **`chatStream`** 变为薄转发：`return yield* this.chatStreamOps.chatStream(request);`

### S3：`chat` + `ensureLLMClientInitialized` + `resolveSmartModel` → `runtime/api/llmChatOps.ts`

---

## 4. 风险与回退

- **风险**：`chatStream` 是渠道/client 共用主路径（`/v1/chat/stream` + `messageRouter`），逻辑含工具循环/压缩/持久化编排 ⇒ **任何搬运偏差都会影响主流程**。
- **缓解**：① 逐行搬迁（不改逻辑）；② `typecheck` + 既有 `chatStream` 契约测试 + **全量 5137 测试**兜底；③ 单独提交、独立评审、可整体回退（薄转发保留原签名）。
- **开关**：不需要灰度开关（**零行为变更**的纯搬迁）。

---

## 5. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 | 纯搬迁；复用既有"外迁类 + deps 端口 + 薄转发"范式（B1–B4）；**不新建第二套** |
| CS03 | 不新增回退分支；仅移动代码 |
| CS06 | 行号/规模/豁免值**均实测**（§1/§2）；deps 清单**以搬迁时实测 `this.` 为准**，不臆造 |
| GR15 | 本 spec 先行 |
| R04-001 | S1 后 **<2000 ⇒ 移除豁免**（不新增例外） |
| R03-002 | 对外仍为 `@modules/runtime/api`（`CoreAPI` 接口不变） |

---

## 6. 实施记录

| 切片 | 状态 | 备注 |
|---|---|---|
| S1 `sessionAgentOps.ts`（会话/工具/代理/文件 ops + `executeTool`，~680 行外迁） | ✅ 2026-10-09 | 2522→2148（未过 2000） |
| S3 `llmChatOps.ts`（`ensureLLMClientInitialized` + `resolveSmartModel` + `chat`，~256 行外迁） | ✅ 2026-10-09 | 2148→**1898 ⇒ <2000**；**豁免 FSZ-007 已移除（8→7）** |
| S2 `chatStreamOps.ts`（~770 行，**风险较高**） | ⏳ 未实施（**可选**） | 达标已由 S1+S3 完成 ⇒ S2 转为**可维护性**性质 |

**S1 验证**：`typecheck` ✅ · 全量 `bun test` 5137 pass/0 fail · `lint:arch` ✅ 0 错 · `lint:size` ✅ 0 错。
**S3 验证（2026-10-09）**：`typecheck` ✅ · 全量 `bun test` **5137 pass / 36 skip / 0 fail** · `lint:arch` ✅ 0 错 · `lint:size` ✅ 0 错（**7 例外**，FSZ-007 已移除）· `lint`(eslint) ✅ 0 errors。
**S3 落点**：`app/src/runtime/api/llmChatOps.ts`（`LlmChatOps` + `LlmChatOpsDeps`（含 `isLlmReady/setLlmReady`、`getSmartRouter/setLastRouteDecision` 读写端口）+ `LlmChatRouter` 窄契约）；`CoreAPIImpl` 侧 `warmupLLM`/`chatStream` 改经 `this.llmChatOps.*`；
**教训**：`shouldAutoTitle` 虽为 private，但被 `tests/runtime/coreapi-title-lifecycle.test.ts` 经实例访问 ⇒ 搬迁时须保留同名转发（已补）。

### ✅ 顺带发现（预存 lint 警告）→ **已登记台账 L-5**（2026-10-09）

`bun run lint`（`eslint src --ext .ts`）实况 **0 errors / 56 warnings**：

- **修正前一处不准确归因（CS06，2026-10-09 复核）**：S1 时曾记为「存量 prettier 违规（`bootstrap/*`·`compaction/*`·`tokenBudget/*`）」——
  **有误**。实测那 55 条 **error（prettier）全部落在本会话改动文件**（已 `eslint --fix` 清零）；上述三目录的是 **warning**，不是 error。
- **存量部分**：**56 条 warning**，全为语义类（`no-unused-vars` ×44 / `no-explicit-any` ×12），分布于 **17 文件 / 3 目录**；
  逐文件 `git log -1` 证明最后修改均早于本会话（09-30 ~ 10-08）⇒ **非本次引入**。
- **登记**：`dev_docs/error_repairs/预存错误与待处理问题.md` **§L-5**（含文件清单、取证、处置与建议）。
- **门禁影响**：warning **不阻塞**（`lint` 退出码 0）⇒ CI 不会红；`no-explicit-any` 9 处建议并入 **C2-O2「事件载荷去 `any`」** 专项同批处置。
