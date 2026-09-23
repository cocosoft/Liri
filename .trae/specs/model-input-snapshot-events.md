# Spec：模型输入快照事件（TR-12-B）

> 版本: 1.0 ｜ 创建: 2026-09-22 ｜ 状态: **已实施（2026-09-22）**
> 验收（实测）：app `bun run typecheck` **0** ｜ `bun x eslint` **0** ｜ 全量 `bun test` **3290 pass / 19 skip / 0 fail**（306 files）；client `bun x tsc --noEmit` **0** ｜ `bun x eslint` **0** ｜ `bun x vitest run` **287 pass / 0 fail**（31 files）
> 关联: GR15（Spec-Driven Development）／ GR16-002（跨模块变更必须建 Spec）／ R01（基础设施复用）／ R02（数据模型统一）／ CS01（归一化）／ CS03（回退最小化）／ CS04（零 Mock）／ CS06（证据驱动）／ project_rules **§1.6「模型可见 ⇔ 已落盘」红线（v7.12.0）**
> 来源: 轨迹模块对标 `dev_docs/20260922/trajectory-benchmark/` 的 **TR-12-B**；立项评估见 [TR-12-TR-14-决策记录.md](../../dev_docs/20260922/trajectory-benchmark/TR-12-TR-14-决策记录.md) §3.3
> 类型: **数据模型变更**（新增事件类型）+ 提示词组装层透出 + 前端轨迹读端

---

## 1. 问题（Problem Statement）

`events.jsonl` 是轨迹的唯一事实源，但**不含"模型看到了什么"**——工具清单与系统提示词均未落事件。实测（本轮，非估算）：

| 项 | 实测值 |
|---|---|
| 工具清单（全量） | **60 个 / 53,361 字符**（均 889 / 中位 766） |
| 系统提示词（基线） | **7,449 字符**（最小会话；`assembleContextualSystemPrompt`） |
| 合计固定开销 | **≈60,810 字符 ≈ 19K tokens · 每次请求都携带** |

两侧张力：

- **必须落**：§1.6 红线要求"任何进入模型请求的内容都能从事件日志重建"——工具清单与系统提示词**都是模型可见输入**；
- **不能全量落**：若每轮全量落盘，50 轮会话 ≈ **3MB** 增量（仅这两项）。

⇒ 结论：**引用式（首次全量 + 后续引用）不是优化，是可行性前提**。

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| **D1** | 新增事件类型 **`context/model-input`**，**只记录变化** | 与既有 `context/compaction`、`context/summary` 同属 `context/` 分类；语义直白（"本轮模型输入快照"） |
| **D2** | 引用字段放在**载荷内**（`refSeq`），**不复用**信封级 `sourceEventSeqs` | ⚠️ **修正决策记录 §3.3.4**：两者语义不同——`sourceEventSeqs` 是"本事件**由哪些**更早事件**合成**"（多对多，消费者为 compaction 派生器）；引用式是"内容**与**某更早事件**相同**"（一对一，去重）。混用会让既有派生器把"去重引用"误判为"合成来源" |
| **D3** | 系统提示词的分段粒度 = **既有 `SystemPromptSection.name`**（不新造分段） | `services/prompt/systemPromptSections.ts` 已提供 stable（`systemPromptSection`，`cacheBreak=false`，缓存至 `/clear`/`/compact`）/ dynamic（`DANGEROUS_uncachedSystemPromptSection`，每轮重算）显式分区；`SystemPromptReport` 已有逐段 `name/charCount/estimatedTokens/cacheBreak` |
| **D4** | 工具清单作为**一个**快照单元（不逐工具分段） | 60 个 schema 是同一请求参数整体；单工具 schema 平均仅 889 字符，逐段收益低而复杂度高 |
| **D5** | 落点**收敛为一个服务**：`RequestSnapshotService`（1 份实现 + 3 个调用点） | 3 个装配点同源（`ToolRegistry.getToolSchemas()`）；架构合规 R01 禁止三份实现 |
| **D6** | 系统提示词**逐段独立判定**：stable 段（恒定）⇒ 落 1 次后全引用；dynamic 段**内容变才落** | 避免"整段 7.4K 每轮重复"退化为每轮全量 |
| **D7** | `PromptAssembler.assembleSystemPrompt` **新增可选回调** `onSectionsResolved`，**不改返回类型** | 现签名返回 `Promise<string>`，report 仅 `logger.debug` 丢弃；回调对现有调用方**零破坏**（CS03／PY_APP §3 外科手术式修改） |
| **D8** | 去重索引 = 会话内 `hash → seq` **内存 Map**，且**可从事件日志重建** | 不引入新持久化框架（R01）；事件日志自身即索引源 ⇒ 满足"可重建" |
| **D9** | hash 复用 **`security/services/HashUtils.hashContent()`**（sha256） | 既有导出（`HashUtils.ts:11`），不新造哈希（CS01） |

**明确不做**：

| 不做 | 理由 |
|---|---|
| ❌ 落**请求头** | ① 传输层元数据，**模型看不到** ⇒ 不属 §1.6 红线范围；② 含 `Authorization` 等凭据 ⇒ 落盘即**泄密**（§1.1） |
| ❌ "只落哈希"的折中 | 哈希**不可重建**，直违红线 |
| ❌ 每轮重复落同一份快照 | 事件日志膨胀（§1 的 3MB 推演） |
| ❌ 逐工具/逐字符分段 | 收益低、复杂度高（D4） |
| ❌ 复用 `sourceEventSeqs` 表达去重 | 语义冲突（D2） |

## 3. 接口设计

### 3.1 事件载荷（`LiriEventMap['context/model-input']`）

```ts
'context/model-input': {
  /** 本轮请求的工具清单快照（内容未变时省略，用 toolsRefSeq 引用） */
  tools?: {
    /** 规范化 JSON 的 hashContent() */
    hash: string;
    /** 工具数量（读端校验/展示用） */
    count: number;
    /** 全量 schema（首次或内容变更时） */
    schemas?: unknown[];
  };
  /** 指向同会话内 hash 相同的更早事件 seq（内容未变时） */
  toolsRefSeq?: number;
  /** 系统提示词逐段快照（按既有 section name） */
  sections?: Array<{
    name: string;
    hash: string;
    /** 全量正文（首次或该段内容变更时） */
    content?: string;
    /** 指向同会话内该 section 内容相同的更早事件 seq */
    refSeq?: number;
  }>;
  /** 组装模式（对齐 PromptMode） */
  mode?: string;
  /** 既有 report 的聚合值（复用 SystemPromptReport，不重算） */
  tokens?: { stable: number; dynamic: number };
}
```

**读端还原语义**：对每个单元，`content/schemas` 存在则直接采用；否则按 `refSeq/toolsRefSeq` 取更早事件对应单元的全量 ⇒ 逐字节等价于当时请求内容。

### 3.2 服务契约（新建 `app/src/chat/services/RequestSnapshotService.ts`）

```ts
record(sessionId: string, input: {
  tools?: Array<{ name: string; /* … */ }>;
  sections?: Array<{ name: string; hash: string; content: string | null }>;
  mode?: string;
  tokens?: { stable: number; dynamic: number };
}): Promise<void>
```

- 职责：hash 计算 → 与内存索引比对 → 组装"仅变化单元"载荷 → `eventLog.append()`
- 索引：`Map<unitKey, { hash, seq }>`（`unitKey` = `'tools'` 或 `section:<name>`）
- 索引重建：会话首次 `record` 时若无索引，回读该会话 `context/model-input` 事件重建（有界：只扫该类型）
- 失败处理：与既有事件追加一致——**失败仅 warn，不阻断消息主路径**（CS03；对齐 `_appendEventsForMessage` 既有语义）

### 3.3 透出改动（最小）

`AssembleOptions` 增 `onSectionsResolved?: (sections: SystemPromptSection[], contents: (string | null)[]) => void`；在 `PromptAssembler.ts:167`（`resolveSystemPromptSections` 之后）回调一次。`MessageContextPipeline.assembleContextualSystemPrompt` 透传。

## 4. 影响文件

| 文件 | 变更 |
|---|---|
| `app/src/chat/types/events.ts` | `LiriEventType` 增 `'context/model-input'`；`LiriEventMap` 增载荷（§3.1） |
| `app/src/chat/types/knownEventTypes.ts` | `ALL_SESSION_EVENT_TYPES` 登记 —— **编译期穷尽断言强制**（漏登记 ⇒ `TS2322`） |
| `app/src/chat/services/RequestSnapshotService.ts` | **新建**（§3.2） |
| `app/src/services/prompt/PromptAssembler.ts` | `AssembleOptions.onSectionsResolved`（D7） |
| `app/src/chat/services/MessageContextPipeline.ts` | 透传回调 |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 装配点接线（`:708-711` 后） |
| `app/src/chat/orchestrator/ChatOrchestrator.ts` | 装配点接线（`:569-572` 后） |
| `app/src/chat/ChatManager.ts` | 装配点接线（`:4822-4825` 后）+ 系统提示词链路透出 |
| `client/src/types/events.ts` | 镜像新事件类型与载荷 |
| `client/src/components/Trajectory/`（Detail/Timeline） | 新增"模型输入"分区：工具清单（折叠 + 按需展开）、系统提示词逐段（stable/dynamic 标记）；**按 refSeq 解析还原** |
| `client/src/i18n/locales/{zh,en}.ts` | 新增文案（`trajectory.*`） |
| `.trae/docs/api-spec.md` | 若新增读端点则同步（当前设计**不新增端点**，复用 `/v1/sessions/{id}/events`） |

## 5. 验证

| 层 | 用例 | 结果（实测） |
|---|---|---|
| 服务单测（新建 8 例） | 首次落全量 / 内容未变 ⇒ 只 `refSeq` / 内容变 ⇒ 重新落全量 / 多段独立判定 / 索引重建 / 空输入不产事件 / 读端一跳还原 / dispose 后重建 | `tests/chat/requestSnapshot.test.ts` **8 pass** |
| 读端还原（前端 6 例） | 无事件 ⇒ null / 全量直取 / 一跳解析 / **引用超出窗口 ⇒ 留空但保留 refSeq** / 多段独立 / 取最近一次 | `resolveModelInputSnapshot.test.ts` **6 pass** |
| 类型三处同步 | `bun run typecheck`（漏登记即编译失败） | **exit 0** |
| 体积回归 | 逐段变化率实测（见下） | ✅ 见"动态段变化率" |
| 回归（全量） | `bun test`（app 全量，306 files） | **3290 pass / 19 skip / 0 fail** |
| 前端（组件级 5 例） | `trajectory-detail.test.tsx`：含全量展示 / **引用如实标注（不谎称"含全量"）** / 引用超窗如实展示 / 未传 `allEvents` 不展示 / 非该类型不展示 | **9 pass**（4 旧 + 5 新） |
| 前端（类型/静态） | `bun x tsc --noEmit` + `bun x vitest run` | **exit 0 / 287 pass**（31 files） |

**动态段变化率（实施期已实测，2026-09-22）**：

`assembleContextualSystemPrompt` 两轮对照（`turnCount` 1 → 5，最小会话），逐段比对：

| 指标 | 实测 |
|---|---|
| 活跃段数 / 总字符 | 10 段 / **5,922 字符** |
| **变化段** | **仅 `sessionContext`（28 字符）** |
| 稳定段 | identity · toolUse · toolIntegrity · shellDeclaration · taskNegotiation · userProfile · personality · contextKeepRules · imageChainRules（**5,894 字符**） |

⇒ **逐段引用式（D6）是必需的，不是优化**：若按整串 hash 引用，`sessionContext` 每轮变化会让整串 miss ⇒ 每轮重落 ≈5.9KB；逐段后每轮增量 ≈ 变化的动态段（本例 28 字符），占比 **99.5%** 的稳定段只落 1 次。

（限定：本实测为**最小会话**形态，不含 memory/知识/项目/git 段；真实会话中这些段变化属"内容本身变化"，不可避免。）

**其余诚实边界**：

- ✅ **组件级验证已补（2026-09-22）**：`trajectory-detail.test.tsx` 新增 5 例（含全量 / 引用如实标注 / 引用超窗 / 未传 `allEvents` / 非该类型）。期间发现并修正一处**措辞不准确** —— 引用被一跳还原后，UI 曾按"还原成功"显示"本轮含全量" ⇒ 改为按 `refSeq` 是否存在判定（引用式 vs 含全量），避免误导。
- ⏳ **真实浏览器端到端仍未验证**（需实际配置模型并发消息才会产生 `context/model-input` 事件）—— 属环境限制，非代码缺口。

## 6. 合规

| 规则 | 落实 |
|---|---|
| **GR15** Spec-Driven | ✅ 本 Spec 先于实现创建；未动代码 |
| **GR16-002** 跨模块建 Spec | ✅ 跨 app/client 两端 + 提示词装配层 |
| **R01** 基础设施复用 | ✅ 复用既有 `SystemPromptSection` 分区、`SystemPromptReport`、`resolveSystemPromptSections`、`hashContent`、`EventLogStorage.append`、`apiSpec` 事件读端点；**未新建**分段机制、token 计数器、哈希工具、持久化框架 |
| **R02** 数据模型统一 | ✅ 事件类型唯一来源 `app/src/chat/types/events.ts`，三处同步由编译期强制 |
| **CS01** 归一化 | ✅ 已检索：无既有"请求快照"实现；引用解析在既有事件读路径内完成 |
| **CS03** 回退最小化 | ✅ 落盘失败仅 warn（对齐 `_appendEventsForMessage`）；无"以防万一"分支 |
| **CS04** 零 Mock | ✅ 缺数据即不产事件；无默认假快照 |
| **CS06** 证据驱动 | ✅ 体积为实测；未实测项已显式标注（§5） |
| **§1.6** 红线 | ✅ 本 Spec 即该红线的直接落地；三处同步由 `bun run typecheck` 强制 |
| **§1.1** 安全 | ✅ 请求头**明确排除**（含凭据）；提示词为本地 `~/.pyapp/` 落盘 |
| **§1.6.1** 接口清单 | ✅ 不新增端点（复用既有事件读端点）；若后续新增读端点须同步 |

---

## 7. 实施记录（2026-09-22 完成）

| # | 步骤 | 状态 |
|---|---|---|
| 1 | 事件类型 + 三处同步（`LiriEventType` / `LiriEventMap` / `ALL_SESSION_EVENT_TYPES`） | ✅ `typecheck` 门禁通过 |
| 2 | `RequestSnapshotService`（hash/refSeq 去重 + 索引重建）+ 8 例单测 | ✅ |
| 3 | `PromptAssembler.onSectionsResolved` 回调 + `MessageContextPipeline` 透传（**不改返回类型**） | ✅ 零破坏既有调用方 |
| 4 | 3 个装配点接线（`streamMessageFlow` / `ChatOrchestrator` / `ChatManager.resumeStream`）+ host 接口新增 `recordToolsSnapshot` | ✅ |
| 5 | 实测动态段变化率 → 回写 §5 | ✅ 仅 `sessionContext` 变（28 字符） |
| 6 | 读端：client 类型镜像 + `resolveModelInputSnapshot`（一跳还原）+ 详情面板"模型输入"分区 + i18n（zh/en） | ✅ |
| 7 | 回归全绿 + Spec 状态 → 已实施 | ✅ app 全量 3290 pass / client 287 pass |

**实现与本文的差异（诚实记录）**：

- **每轮可能产生 2 条 `context/model-input` 事件**：工具清单在装配点、系统提示词在 `getOrAssembleSystemPrompt`，两者时机不同 ⇒ 各自调用一次 `record`（载荷字段均可选，符合 §3.1 契约）。读端取"最近一次含该单元的事件"（工具 / 提示词各自独立还原）；**轮次级严格对齐不做**（价值低、成本高）。
- **`hashContent` 经门面导出**：安全模块禁止子路径导入（eslint `no-restricted-imports`）⇒ 在 `security/index.ts` 补 `export { hashContent }`（该门面已导出同类 services，符合既有模式）。
- **引用索引只登记"含全量"的事件** ⇒ 读端 `refSeq` **一跳**即可取回，无需链式回溯（写端 `_ensureIndex` 与 `record` 均遵循此不变量）。
- **`context/model-input` 的归类无需改动**：`categorizeEvent` 按 `context/` 前缀映射为 `context` 类（`CATEGORY_TO_SOURCE.context = "system"`），前端筛选/来源自动覆盖。
