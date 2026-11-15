# Spec（红线）：`prompt_snippet` 注入面

- **状态**：🔴 **仅设计，不落地代码**（2026-11-15）。开工前须先裁定 §7 的待决项。
- **来源**：`.trae/specs/learning-feedback-loop.md` §5-M9（把学习候选变成**可注入提示片段**）
- **性质**：本面会**直接改变模型行为** ⇒ 比 SOP / 语料更危险，单独设红线，不并入主 spec 的自动推进。

---

## 1. 为什么单独设红线

现有闭环里所有产物都「不改变模型行为」：候选是本地台账、种子是待人工补期望的语料、SOP 走人工批准后由技能系统加载。
`prompt_snippet` 不同 —— 它把一段**自由文本**拼进 system prompt，等于让「学习 → 模型行为」直连。风险点：

1. 可覆盖/稀释既有约束（含安全与工具协议）；
2. 击穿 provider 端 prompt 缓存（前缀抖动 ⇒ 成本与延迟双升）；
3. 无来源、无到期、无回滚 ⇒ 事后无法归因；
4. 一段坏片段可同时污染**所有会话**（作用域越界）。

## 2. 注入面取证（全部回仓核对）

| 事实 | 证据 |
|---|---|
| 装配唯一入口 | `packages/service/src/services/prompt/PromptAssembler.ts:175` `assembleSystemPrompt()` |
| 段序唯一事实源 | `packages/infra/src/constants/systemPromptSections.ts:137-163` `SECTION_NAMES`（23 段，**无安全/红线段**） |
| 缓存切分 | 同文件 `:81` `CACHE_BOUNDARY`；`PromptAssembler.ts:322-338` 按 `cacheBreak` 分「稳定段 / 动态段」再拼 |
| 动态段的硬约束 | 必须用 `DANGEROUS_uncachedSystemPromptSection(...)`（`systemPromptSections.ts:87-105`）并写明破坏缓存的理由 |
| 末端安全闸 | `app/src/ai/prompts/SystemPromptBuilder.ts:25-44`：Unicode 清洗 + 注入检测，critical ⇒ 抛 `PROMPT_INJECTION_DETECTED` |
| 既有「可编辑注入面」 | AGENTS.md / TOOLS.md（`WorkspaceScanner.ts:37-38` 12k/60k + 注入扫描）；SOUL.md / USER.md（**无上限、无扫描**）；memory（200 行/25KB）；演化 overlay（4k，超限**不注入**）；prompt 覆盖（manifest 白名单 + 64KB）；`custom.md`（**无上限、无白名单，追加在末尾**） |
| prompt 门禁口径 | `PromptValidator.ts:440-441` 只比「译文/源文 token 比」（1.5× warn / 2× error）⇒ **不是绝对上限**；运行期动态预算默认不裁剪（`PromptAssembler.ts:514-521`） |
| 安全段优先序 | **全仓不存在**「安全段必须最前/不可覆盖」的约定；`ProviderPromptPlugin.ts:15` 允许覆盖 `toolUse`；`mode=none` 时只剩 `identity`（`promptSectionLayers.ts:162-166`） |

> 结论：安全不能靠"排在前面"保证。红线必须落在**结构约束 + 内容校验 + 关闭开关**上。

## 3. 目标 / 非目标

**目标**
- **G1 只增不改**：片段是**追加**的动态段，永不替换/删除任何既有段，也不得包含可被解释为"忽略上述约束"的措辞。
- **G2 全链可归因**：每条生效片段都能追到「候选 id + 归因证据 + 批准人 + 时间 + 到期」。
- **G3 一键回滚**：撤销后**下一轮**即不再注入；历史版本保留。
- **G4 不破坏缓存**：只在动态区注入，稳定前缀逐字不变（有测试钉住）。
- **G5 默认关闭**：配置开关缺省 `false`，代码合入本身不改变任何现有行为。

**非目标（明确不做）**
- **N1** 不做自动生成/自动生效（必须人工批准）。
- **N2** 不替换 `SOUL.md` / `USER.md` / AGENTS.md / prompt 覆盖等既有面（避免第三套"人格/规则"来源）。
- **N3** 不允许片段定义新工具名、新协议标签、新事件类型。
- **N4** 不在读取路径调用模型（纯字符串装配）。
- **N5** 不引入新的 system prompt 静态段（避免缓存前缀变化）。

## 4. 设计

### 4.1 注入位置与形式

- 新增一个**动态段** `promptSnippet`（`cacheBreak: true`，reason 必写）：
  - 位置：全部稳定段之后（`CACHE_BOUNDARY` 之后），`custom.md` **之前**；
  - 形式：单块包裹，便于机器识别与回滚：

```
<!-- PROMPT_SNIPPET:BEGIN id=<snippetId> v=<version> -->
<片段正文>
<!-- PROMPT_SNIPPET:END -->
```

- **同一会话内冻结**（与 memory 段同款纪律）：会话开始时渲染一次，会话内不随台账变化⇒避免每轮抖动。
- 多片段：按 `snippetId` 字典序拼接（确定性），总条数上限见 §4.3。

### 4.2 生命周期（`ps_*` 前缀，沿用状态词表纪律）

```
ps_draft ──人工 approve──▶ ps_active ──到期/撤销──▶ ps_revoked
```

| 状态 | 含义 | 是否注入 |
|---|---|---|
| `ps_draft` | 由候选转写、尚未批准 | 否 |
| `ps_active` | 已批准且在有效期内 | 是（且需总开关打开） |
| `ps_revoked` | 撤销/过期（终态） | 否 |

- `expiresAt` **必填**（默认 14 天，可配）；
- 状态迁移只由命令触发（人工），无后台定时器；到期由读路径惰性收口（同 M4 口径）。

### 4.3 硬限制（超限一律**不注入**，不截断）

| 限制 | 建议值 | 理由 |
|---|---|---|
| 单条正文 | ≤ 800 字符 | 超长片段难以审阅；截断会产出半句指令 |
| 生效总量 | ≤ 2,000 字符 | 与演化 overlay（4k）同量级但不叠加失控 |
| 同时生效条数 | ≤ 3 | 降低互相冲突面 |
| 作用域 | 默认**项目级**（`workspaceId`），全局需显式二次确认 | 防跨项目污染 |

> 数值一律进常量并写进 §7 待决项，**开工前可改**。

### 4.4 内容校验（拒绝而非清洗）

- 禁止命中（任一命中 ⇒ 拒绝生效，不静默改写）：
  - 覆盖/取消既有约束的措辞（如"忽略上述规则""不要遵守系统提示"）；
  - 安全/权限旁路（跳过审批、关闭沙箱、放开路径限制）；
  - 协议文本：既有 T1 清单里的 wire 名与标签（`PromptValidator.ts:30-57` 的 18 个工具名、`<think>`、`[FILE_OPERATION]`、`<create|modify|delete>`）；
  - 新增标签/变量占位（本面不接受模板变量，避免二次注入）。
- 复用末端注入检测（`SystemPromptBuilder`）作为最后一道；本面**在批准时**就要跑一次同样检测（fail-closed）。

### 4.5 与缓存 / 预算的关系

- 片段只进动态区 ⇒ 稳定前缀零变化（新增测试钉住 `CACHE_BOUNDARY` 与稳定段字节一致）。
- 片段不参与 `dynamicBudgetTokens` 的"降级丢弃"（避免"有时注入有时不注入"的不确定性）；改为**超限即整条不注入**并在命令里明示。

### 4.6 归因与回滚

- 每条片段强制字段：`sourceCandidateIds[]`（≥1）、`evidence[]`、`approvedBy`（命令操作者）、`approvedAt`、`expiresAt`、`scope`、`version`。
- 回滚：`revoke <id>` ⇒ 终态 + 记录原因；下一轮不再注入。
- 可见性审计：复用既有「模型可见 ⇔ 已落盘」（`onSectionsResolved` 快照），**不新增事件类型**。

## 5. 开工前的门禁（必须先有，再谈注入）

| 门禁 | 判据 | 落点 |
|---|---|---|
| **G-1 只增不改** | 断言片段不替换任何既有段；`SECTION_NAMES` 与稳定段渲染结果逐字不变 | 新单测（装配层） |
| **G-2 缓存不破** | 打开片段后，`CACHE_BOUNDARY` 之前的文本与关闭时逐字相同 | 扩 `app/tests/ai/promptCacheBreakpoints.test.ts` |
| **G-3 预算硬限** | 超限 ⇒ 不注入（有正/负例）；总量与条数上限各有断言 | 纯函数单测 |
| **G-4 内容红线** | 每类禁用措辞各有 1 条必拒样本 + 1 条合法样本（不得错杀） | 纯函数单测（固定语料） |
| **G-5 默认关闭** | 开关缺省 `false`；关闭时装配结果与今天逐字一致 | 装配层测试 |
| **G-6 协议文本** | 若片段含任何新增标签/枚举 ⇒ 纳入 T1 清单（`lint:prompt-t1`） | 门禁脚本 |
| **G-7 无密钥** | 与既有注入检测同口径 + 常见密钥形态正则 | 批准期校验 |

## 6. 分步落地（每步独立提交、可停在任一步）

| 步 | 内容 | 行为变更 |
|---|---|---|
| **S1** | 台账 + 纯函数（校验/渲染/预算/过期），**不接线** | 零 |
| **S2** | `/learn snippet list/show/preview`（只预览渲染文本，不注入） | 零 |
| **S3** | 装配层接一个**默认关闭**的动态段 + kill switch + 上述 G-1/G-2/G-5 | 开关打开才变 |
| **S4** | 到期惰性收口 + 观察期度量（复用 `/sop observe` 的 join 口径） | 零（只读） |

> 与 M1 同款纪律：**先只读、后写；先默认关闭、后按需打开**。

## 7. 待决项（开工前必须由人裁定）

1. **注入位置**：`custom.md` 之前 vs 之后？（本 spec 默认"之前"）
2. **作用域**：仅项目级、还是允许用户级全局？（默认仅项目级）
3. **额度**：单条 800 / 总量 2000 / 条数 3 是否合适？
4. **有效期**：默认 14 天是否合适？到期是"不注入"还是"自动转 `ps_revoked` 并提示"？
5. **命令归属**：`/learn snippet ...` 还是新开 `/snippet ...`？
6. **与 evals 联动**：是否要求片段生效前先有对应 `learning-case-*` 语料通过 `--gate`（更强，但把两条链耦合）？

## 8. 反例（明确不做）

- ❌ 把候选正文直接拼进 system prompt（无批准、无长度、无归因）；
- ❌ 复用 `SOUL.md` / `custom.md` 承载片段（无白名单、无审计、无到期）；
- ❌ 用稳定段承载（每轮变化 ⇒ 击穿缓存）；
- ❌ 超限时截断（半句指令比不注入更危险）。

## 9. 与既有能力的关系

| 既有 | 本 spec 的用法 |
|---|---|
| `PromptAssembler` 动态段机制 | 唯一承载方式（`cacheBreak: true`） |
| `SystemPromptBuilder` 注入检测 | 批准期与装配期各跑一次（fail-closed） |
| `promptEvolution`（4k overlay） | **不合并**：那是演化产物，本面是候选产物，两者互不覆盖 |
| `SkillInjectionService` | 不并入：技能走 user message，本面走 system 动态段 |
| `learning-feedback-loop.md` M1~M8 | 片段来源只能是已批准候选（`lc_approved`） |
