# Spec：护栏双侧闭环（P26-2）

> 版本 1.6 ｜ 创建 2026-10-07 ｜ 状态：🟢 **A1（不可见 Unicode 三份实现归并）已实施** · 🟢 **A2（`OUTPUT_GUARD` 常开评估）已完成（结论：不翻默认）** · 🟢 **PC-1（护栏结果前端可见 = A2 的 P3 前置）已实施** · 🟢 **A2 前置 P1/P2/P4 已实施 + P5 已量化（§10）** · 方案 B 按 D10=a 不实施 —— 见 §9 / §10 实施记录
> 来源：台账 `dev_docs/任务计划-20261004.md` §26.2-**A6** 残余（"输入侧 3 检测器仍未统一接口 / 输出侧默认关"）⇒ §26.5 **P26-2**
> 前置：输出侧内容护栏已由 **13-P2-1（2026-10-05）** 落地（`core/outputGuard` + `chat/outputGuards`）
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ **CS01（归一化）** / **CS03（回退最小化）** / CS02 / R12-1（防 CS03 滥用）；对标《Agentic Design Patterns》Ch.18 Guardrails

---

## 1. Problem Statement（回仓取证，file:line 为 2026-10-07 实测）

### 1.1 输出侧：**结构完整、默认关闭**

| 设施 | 证据 |
|---|---|
| 契约 + 管线 + 注册表（core） | `core/outputGuard/types.ts`（`OutputGuard{name,priority,check}` / `verdict{pass\|redact\|block}`）· `registry.ts`（`runOutputGuards` 纯函数管线 + `OutputGuardRegistry` + `getOutputGuardRegistry()`）· `index.ts` |
| 具体护栏（app） | `chat/outputGuards/sensitiveContentGuard.ts`（PII 打码/敏感拦截）· `injectionEchoGuard.ts`（注入回显，复用 `PromptInjectionDetector`）· `index.ts`（`registerDefaultOutputGuards()`，`ChatManager` 构造调用） |
| 开关 | `core/featureFlags.ts:251 OUTPUT_GUARD: false` · `:256 OUTPUT_GUARD_BLOCK: false` |

⇒ **缺口**：`OUTPUT_GUARD=false` ⇒ 生产路径**未启用**（`registerDefaultOutputGuards` 幂等但注册后管线空跑？—— 实测：开关判定在护栏内部，注册不产生行为）。**未评估"常开"可行性**是残留项之一。

### 1.2 输入侧：**3 套检测器，形态各异、无共同接口**

| # | 检测器 | 落点 | 入参 / 出参 | 同步性 | 现有调用点 |
|---|---|---|---|---|---|
| 1 | `CronInjectionScanner` | `chronos/CronInjectionScanner.ts:118` | `scan(prompt: string, mode?: 'strict'\|'relaxed'): ScanResult` | **同步** | `tools/ChronosTool/CronCreateTool.ts:150` |
| 2 | `AutoModeClassifier` | `permission/classifiers/AutoModeClassifier.ts:91`（`IAutoModeClassifier:46`） | `classify(toolName, input, messages): Promise<ClassifierDecision>` + `isAllowlistedTool(name)` | **异步** | 权限链（`auto-mode-classifier-manager.ts`） |
| 3 | `PromptInjectionDetector` | `security/injection/PromptInjectionDetector.ts:316`（`detect(userInput): InjectionDetectionResult`，`:565` 单例） | 文本 → `InjectionDetectionResult` | **同步** | `workspaces/WorkspaceScanner.ts:197` · `ai/prompts/SystemPromptBuilder.ts:30` · `chat/outputGuards/injectionEchoGuard.ts:26` |

⇒ 缺口：**无共同接口/注册表**（`core/outputGuard/types.ts:19-20` 已如实记录"本轮只落地输出相位，输入侧 3 套检测器不动"）。

### 1.3 ★ 顺带发现：**「不可见 Unicode」有 3 份独立实现**（CS01 真实缺口）

| # | 实现 | 证据 |
|---|---|---|
| 1 | `INVISIBLE_CHARS` | `chronos/CronInjectionScanner.ts:91`（`checkInvisibleUnicode` `:97`） |
| 2 | `INVISIBLE_UNICODE_RANGES` | `security/injection/UnicodeSanitizer.ts:20`（`:216/271/295` 消费） |
| 3 | `INVISIBLE_UNICODE_RANGES` | `security/injection/PromptInjectionDetector.ts:193`（`:485` 消费） |

⇒ **同域模式表三份**，属 CS01「禁止重复造轮子」的实证缺口（与"是否统一注册表"**正交** —— 无论选哪个方案都应归一）。

### 1.4 "统一输入护栏"是否已有真实消费者？—— **实测：无**

- 检索：无任何入口"遍历输入护栏集合"；三者各自在**专用链路**被点对点调用（上表）。
- ⇒ 若仅因"形态不统一"而建注册表，**落地即死抽象**（无消费者）—— 正是 **R12-1（防 CS03 滥用）** 所指形态。

---

## 2. 设计约束（先于方案）

- **CS03 / R12-1**：**"统一注册表"必须先有真实消费者**，否则不建。这与"归一化重复实现"（§1.3）是**两件事**，不得混为一谈。
- **CS01**：§1.3 的三份实现**应当归并**（有无消费者都成立）。
- 非目标：不改 `PromptInjectionDetector` 的**检测语义/阈值**（安全策略，另立专项）；不引入 LLM 检测；不新增依赖；不新建 DB 表。

---

## 3. 方案

### 3.1 方案 A（**推荐**）：归一化 + 常开评估（**不建统一注册表**）

**A1. 归并「不可见 Unicode」三份实现**（CS01，必做）

- 单一事实源落 **core**（`security/injection` 属 infra，`chronos` 属 infra ⇒ 双向合法；但 `UnicodeSanitizer` 已是既有"清洗"权威）：
  - **候选落点**：`security/injection/UnicodeSanitizer.ts` 暴露**稳定的模式表**（`INVISIBLE_UNICODE_RANGES` + 判定函数），另两处改为引用。
  - ⚠️ 落点须先核层：`CronInjectionScanner`(infra `chronos`) → `UnicodeSanitizer`(infra `security`) = **infra→infra（同层）**，合法；`PromptInjectionDetector` 与 `UnicodeSanitizer` 同目录同层，合法。
- **行为保真**：三份表若**不完全相同**，须先 diff 出并集/差异（实测范围不同 ⇒ 归并会**改变检测半径**）⇒ **本文档不预设相同**，落地前先做逐项对比并把结论写入实施记录（CS06）。

**A2. `OUTPUT_GUARD` 常开可行性评估**（P26-2 的"②"）

| 子项 | 内容 |
|---|---|
| 现状 | 默认 `false`；开启后 `sensitive_content` 会把**邮箱/卡号打码**（可见行为变更） |
| 待评估 | ① 误伤率（打码是否命中正常内容）；② 与 `guardFinalOutput` 的复检顺序是否稳定；③ 性能（同步正则，无 IO） |
| 产出 | 一份**短评估结论**（可只落台账），据此决定是否翻转默认值 —— **默认值翻转属产品裁定**，不在本 spec 自行决定 |

**工作量**：小（A1 归并 + A2 评估）。**风险**：低。

### 3.2 方案 B（**仅当**出现真实消费者才做）：统一输入护栏注册表

- **必须先命名的消费者**（否则不做）：**入站文本边界**（HTTP `handleChatCompletions` `chat-handlers.ts:185` / 渠道 `messageRouter.ts:661`）跑一次 `runInputGuards(text)`。
- 契约（**core**，镜像 `outputGuard` 形态）：`InputGuard{name, priority, phase, check(payload)}`，`phase: 'text'`（**只收文本相位**）；`AutoModeClassifier` 属 **tool-call 相位 + 异步** ⇒ **不纳入**（语义不同，纳入即假统一）。
- 收编范围：`PromptInjectionDetector`（文本）+ 归一化后的 `CronInjectionScanner` 模式（**若其模式库对普通入站文本适用**，须先取证 —— 它是为 cron prompt 设计的）。
- ⚠️ **本方案的收益需先论证**：若入站文本已由 `SystemPromptBuilder:30` 检测过，则注册表**只是换了个调用壳**（零增量）⇒ 高概率不立项。

---

## 4. 决策点（**已裁定 D9/D10**；D11 未裁定）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D9** | §1.3 三份「不可见 Unicode」是否归并 | (a) **归并**（先 diff 再合）／(b) 不归并 | **(a)** —— CS01 硬要求；与注册表无关 |
| **D10** | 是否建"统一输入护栏注册表" | (a) **不建**（方案 A）／(b) 建（方案 B，须先定消费者） | **(a)** —— 无真实消费者，建则死抽象（CS03/R12-1） |
| **D11** | `OUTPUT_GUARD` 默认值是否翻转为 `true` | (a) **先评估、暂不翻**／(b) 翻为 `true`／(c) 维持 `false` 归档 | **(a)** —— 翻默认值＝用户可见行为变更，须产品裁定 |

> **✅ 裁定（2026-10-07，用户）**：**D9 = (a) 归并为单一实现** · **D10 = (a) 不建统一输入护栏注册表**。
> **⚠️ D11 本轮未裁定** —— 本批按 §3.1-A2 **只产出"常开评估结论"**；`OUTPUT_GUARD` 默认值是否翻转，留待产品据结论另行裁定（**本批不翻转**）。
> ⇒ 实施范围 = **§3.1-A1 归并（必做）+ §3.1-A2 常开评估（产出结论）**；**§3.2 方案 B 不实施**；影响文件仅 #1–#4。

---

## 5. 影响文件（预计，随裁定）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/security/injection/UnicodeSanitizer.ts` | 改（D9=a）：暴露**单一**模式表 + 判定函数 |
| 2 | `app/src/security/injection/PromptInjectionDetector.ts`（`:193/:485`） | 改：引用 #1，删本地表 |
| 3 | `app/src/chronos/CronInjectionScanner.ts`（`:91/:97`） | 改：引用 #1，删本地表 |
| 4 | `app/tests/security/*`（+ `tests/chronos/*`） | 新建/扩：三处归并后**行为等价**断言（用原三份表各自的正/反例） |
| 5 | （仅 D10=b）`app/src/core/inputGuard/{types,registry,index}.ts` | 新建契约 + 注册表（镜像 `outputGuard`） |
| 6 | （仅 D10=b）`app/src/security/injection/inputGuardRegistration.ts` 或 chat 组合根 | 新建：注册文本护栏 |
| 7 | （仅 D10=b）`chat-handlers.ts:185` / `messageRouter.ts:661` | 改：入站边界调用 `runInputGuards` |
| 8 | （仅 D11=b）`app/src/core/featureFlags.ts:251` | 改：`OUTPUT_GUARD` 默认值 |

---

## 6. 验收

| 项 | 标准 |
|---|---|
| 归并（D9=a） | 全仓 `INVISIBLE_CHARS` / 重复 `INVISIBLE_UNICODE_RANGES` 实现 **≤1 处**；原三份用例**全过**（行为等价，或差异已显式记录并测试锁定） |
| 常开评估（D11=a） | 产出评估结论（误伤/顺序/性能）；**默认值未变** |
| 统一注册表（D10=b） | 入站边界调用可观测；`FEATURE_*` 默认关时零行为变更 |
| 不建注册表（D10=a） | `inputGuard` **0 命中**；`core/outputGuard/types.ts` 的"输入侧不动"注释**更新为"经评估维持不统一（原因）"** |
| 回归 | `typecheck` 0 · `lint:arch` 不新增违规 · `lint:doc-code` 通过 · 全量 `bun test` 0 fail |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行；D9/D10/D11 裁定前不动码 |
| GR01 基础设施复用 | ✅ 归并复用 `UnicodeSanitizer`；不新建检测原语 |
| **CS01 归一化** | ✅ **本 spec 的 §1.3 即其产物**（三份同域实现是既有缺口，非本轮新增） |
| CS02 状态判定 | ✅ 相位/动作用枚举，非文案 |
| **CS03 回退最小化** | ✅ **明确拒绝"无消费者的注册表"**（D10 建议 a） |
| CS04 零 Mock | ✅ 无 mock |
| CS05 根因优先 | ✅ 根因分两条：**重复实现**（归并）与**无共同消费者**（不建表）—— 不混为一谈 |
| R12-1 防 CS03 滥用 | ✅ 本 spec 是该规则的**首个应用实例**（§1.4 消费者假设检验） |
| R06-008 分层 | ✅ 归并在 infra 同层；D10=b 时契约落 core、注册落 app |

---

## 8. 风险与边界（如实）

1. **归并非等价改造**：三份 Unicode 范围**可能不同**（`CronInjectionScanner` 为 cron prompt 设计）⇒ 归并**可能改变检测半径**，必须先 diff + 用原例回归，**不得以"看起来一样"直接合**。
2. **"统一注册表"大概率无收益**（§3.2 末）：入站文本若已被 `SystemPromptBuilder:30` 检测，则注册表只是换调用壳 ⇒ 建议 D10=a；如坚持 b，须先给出**增量消费点**。
3. **默认值翻转（D11=b）是用户可见变更**：开启后邮箱/卡号被打码 ⇒ 须产品裁定，不在本 spec 范围。
4. **本文档不含代码改动**；实施后须回填 §6 验收实测 + 台账 §26.5 状态。

---

## 9. 实施记录

### 9.1 A1 —— 不可见 Unicode 三份实现归并（**已落地 2026-10-07，提交 `f43eb5b25`**）

**diff 取证（落地前逐项对比，CS06）**

| 实现 | 形态 | 覆盖 |
|---|---|---|
| `security/injection/UnicodeSanitizer.ts`（17 项表） | `{name,start,end,description}[]` | `200B/200C/200D/FEFF/200E/200F/202A–202E/2060/2061–2064/00AD/3164/2800/FFFC` |
| `security/injection/PromptInjectionDetector.ts`（同形表） | 同上 | **与本表逐字相同** ⇒ 直接删副本 |
| `chronos/CronInjectionScanner.ts`（`INVISIBLE_CHARS` 正则） | regex | `200B–200F/202A–202E/2060–2069/FEFF` ⇒ **多 `2065–2069`**、**少 `00AD/3164/2800/FFFC`** |

⇒ **判定：三份不等价**。并集 = 原 17 项，其中 `Invisible Separator` 由 `2061–2064` **扩为 `2061–2069`**。

**落地（5 文件 + 1 测试）**
- `UnicodeSanitizer.ts`：`INVISIBLE_UNICODE_RANGES` 导出为**全仓单一事实源**（并集）+ 新助手 `isInvisibleCodePoint` / `containsInvisibleChars` / `countInvisibleChars`；类内两处循环收敛到助手（`getInvisibleCharacterDetails` 保留原循环以取 `name`）。
- `PromptInjectionDetector.ts`：**删除**本地 17 项副本，改 `import { INVISIBLE_UNICODE_RANGES } from './UnicodeSanitizer'`（`scanInvisibleChars` 消费点不变）。
- `CronInjectionScanner.ts`：**删除** `INVISIBLE_CHARS` 正则，改 `countInvisibleChars`（威胁名 `invisible_unicode` 与两处文案**逐字不变**）。
- 出口：`security/injection/index.ts` + `security/index.ts` 增 4 值导出 + `InvisibleUnicodeRange` 类型导出。

**⚠️ 行为变化（如实，已由测试锁定）**
- `CronInjectionScanner`：新增检出 `00AD`/`3164`/`2800`/`FFFC`（**更严**，可能新增误报）；`2066–2069` 仍覆盖（**无漏检回退**）。
- `UnicodeSanitizer` / `PromptInjectionDetector`：新增处理 `2065–2069`（**更严**，覆盖方向隔离符 ⇒ bidi 欺骗面）。

**测试**：新建 `app/tests/security/invisibleUnicode.test.ts`（**7 例**：表为并集 / 助手覆盖并集 / 负例不误判 / 逐字符计数 / Sanitizer 移除「既有 + 新增面」/ Detector 检出 / Cron 文案逐字不变 + 新增面）。既有 `tests/tools/SecurityTools.test.ts`（`200B` 正例）**未改、通过**。

**门禁（全绿）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0** · `lint:size` **0 错 / 470 警告**（471 → 470：删副本使 `PromptInjectionDetector.ts` 回落阈值下）/ 8 例外 · 全量 `bun test` **505 files / 4759 pass / 21 skip / 0 fail**（+1 文件 / +7 例，逐数吻合）。

**未做（明确）**：§3.1-**A2**（`OUTPUT_GUARD` 常开评估）仍 open；§3.2 **方案 B（统一输入护栏注册表）按 D10=a 不实施**。

### 9.2 A2 —— `OUTPUT_GUARD` 常开可行性评估（**已评估 2026-10-07**）

> 范围：**只评估、不翻默认值**（D11 未裁定 ⇒ `featureFlags.ts:251` 维持 `OUTPUT_GUARD: false`）。**本批无代码改动。**

**① 现状取证（回仓）**

| 项 | 事实 |
|---|---|
| 开关 | `featureFlags.ts:251` `OUTPUT_GUARD: false`（默认关）；`:256` `OUTPUT_GUARD_BLOCK: false` |
| 注册 | `chat/outputGuards/index.ts:34` —— `if (!feature('OUTPUT_GUARD')) return;` ⇒ **默认不注册任何护栏**（零回归） |
| 护栏 1 | `sensitive_content`（priority 10）：`SensitiveDataService.sanitize()` 命中 ⇒ **redact**（默认）或 **block**（需 `OUTPUT_GUARD_BLOCK`） |
| 护栏 2 | `injection_echo`（priority 20）：**永不阻断**（`action:'pass'`，仅 info/warn）⇒ 常开**零行为风险** |
| 接线 | `streamMessageFlow.ts:1926` / `ChatOrchestrator.ts:873` 注入 `getOutputGuardRegistry().list()` ⇒ **已接主链路**（真实生效面） |
| 作用域 | 仅**助手终稿**（`finalOutputGuard.ts:17` 自陈）：**流式 chunk、工具返回值、文件写入**均**不受**护栏约束 |

⇒ **唯一有行为后果的只有 `sensitive_content`**，其行为完全由 `SensitiveDataService.SENSITIVE_PATTERNS`（**仅 4 条**）决定。

**② FP 量化（以本仓自身语料为测试集，2026-10-07 实测）**

| # | 模式 | 本仓实测命中 | 判定 |
|:--:|---|---|---|
| 1 | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z\|a-z]{2,}\b`（email） | `190615273@qq.com`（MIT 协议头）**≥202 处 / ≥200 文件**（`head_limit` 截断；实测 ≈ 每个 `.ts` 文件 1 处 ⇒ 与 `app/src` 源文件总数同量级） | ⚠️ **与仓库规则直接冲突** —— `project_rules.md §1.2` **要求** Rust 文件必须带 MIT 头、TS 建议带；常开后**模型新建文件的协议头会被 `[REDACTED]`**（作者邮箱被抹），即**模型无法产出合规文件** |
| 4 | `\b(?:api[_-]?key\|secret[_-]?key\|password\|token)\s*[:=]\s*\S+`（secrets） | **722 处 / ≥200 文件** | ⚠️ **本仓领域即"密钥/令牌管理"**（`oauth/services/TokenManager.ts` 18 处、`channels/secrets/ChannelSecretStore.ts` 12 处…）⇒ 该模式命中**主流正当内容**；且**不区分真实密钥与字段名/占位符**（`password: ''`、`token: string` 亦命中）⇒ **FP 极高、真阳性低**（它不识别 `sk-`/`ghp_`/`AKIA` 等真实前缀） |
| 2/3 | SSN `\d{3}-\d{2}-\d{4}` / card `\d{4}-\d{4}-\d{4}-\d{4}` | 中文/本仓语境命中低 | FP 低，但**真阳性亦低**（无 Luhn 校验 ⇒ 无关 16 位串同样被抹） |

**③ 结构性代价（常开前必须知悉）**

1. **安全覆盖面被高估**：仅护栏**终稿**；真实泄漏路径（工具把 `.env` 读出并写入文件 / 流式已发出的 chunk）**不经此护栏**。
2. **静默改写**：调用方仅记日志，`redacted`/`blocked` **不下发**前端（见台账 §27.3-**PC-1** 取证）⇒ 用户只见"正文被换过"，无法区分"模型就这么答"与"被打码"。
3. **不可逆落盘**：打码文本经 `updateMessageBlocks` 落盘 ⇒ 历史消息与模型上下文**永久变为 `[REDACTED]`**，且护栏前原文**无独立留痕**（与 §1.6「模型可见 ⇔ 已落盘」的可重建精神相悖）。

**④ 结论与建议**

> **结论：现阶段不建议翻转默认值**（维持 `OUTPUT_GUARD=false`）。
> 理由：唯一有效护栏的模式库**以字段名/占位符为主**（真阳性低），却与本仓两条**最高频正当内容**正面冲突（MIT 协议头作者邮箱 ≥200 文件、密钥/令牌字段 722 处）；叠加"仅终稿 + 静默改写 + 不可逆落盘"三项结构性代价 ⇒ **常开的净收益为负**。

**若未来要常开，前置条件（最小集，按重要性排序）**

| # | 前置 | 说明 |
|:--:|---|---|
| P1 | **收窄 secrets 模式为"值形态"判定** | ✅ **已完成（2026-10-07）** —— 改为**复用**既有 gitleaks 式规则表（provider 前缀 + 值长度下限），**删掉字段名正则**；见 §10 |
| P2 | **豁免 MIT 协议头邮箱** | ✅ **已完成（2026-10-07）** —— **按行**豁免含 `Copyright` / `©` 的行（**不硬编码作者邮箱**）；见 §10 |
| P3 | **先落地 PC-1**（护栏结果前端可见 + 原因） | ✅ **已完成（2026-10-07）** —— 见 §9.3；否则不得**静默**改写用户可见内容 |
| P4 | **补"护栏前原文"留痕** | ✅ **已完成（2026-10-07）** —— 新增会话事件 `validation/output_guard_applied`（**默认仅元数据**：动作 / 护栏名 / 原文长度 / 原文 SHA-256；**原文需 `OUTPUT_GUARD_KEEP_ORIGINAL=true`**）；见 §10.6 |
| P5 | **量化门槛** | 🟡 **已量化（2026-10-07）**：本仓语料（`app/src`+`client/src`+`app/docs` 共 **4798** 文件）实测「会改写内容的文件」**1364 → 47（−96.6%）**；**是否"达标"（可否翻默认）仍属 D11 产品裁定**，见 §10.3 |

⇒ **P1/P2/P3/P4/P5-量化 已完成**。D11 仍**未裁定**（`OUTPUT_GUARD` 维持 `false`）—— §9.2④ 原列"前置条件（最小集）"**五项已全部消除**（P5 已量化，达标与否留待产品裁定），翻默认的**技术障碍已清空**，余下的**纯属 D11 产品裁定**。

### 9.3 PC-1 —— 护栏结果前端可见（**A2 的 P3 前置**；用户裁定「通知 SSE」）—— 🟢 **已落地 2026-10-07**

**背景（= 台账 §27.3-PC-1）**：`OUTPUT_GUARD` 命中后，调用方以安全文本**替换**已流出正文
（`updateMessageBlocks`）并只落 `logger.warn/info` ⇒ 前端**无任何字段/事件**（`redact|blockReason|outputGuard`
0 命中）⇒ 用户看到"语义不同的替代文本"却**不知**被阻断/打码 —— 即 §9.2④-2「静默改写」。

**落点（实测回仓）**

| # | 落点 | 改动 |
|:--:|---|---|
| 1 | `chat/outputGuards/liveEvents.ts` | **新建**：`OUTPUT_GUARD_SSE_EVENT = 'system:output_guard'` + `OutputGuardNotice`/`Action` + 纯函数 `buildOutputGuardNotice()`（`blocked` 优先 `redacted`，皆否 ⇒ `null`）+ `buildOutputGuardPayload()`（JSON 安全）+ `emitOutputGuardNotice()`（**懒加载** `@modules/infrastructure#broadcastEvent`）+ 便捷入口 `notifyOutputGuardResult()` |
| 2 | `chat/outputGuards/index.ts` | 转出 #1 的 5 值 + 2 类型 |
| 3 | `chat/orchestrator/streamMessageFlow.ts`（流式，无工具回合终稿） | 护栏分支后**单点调用** `notifyOutputGuardResult(session.id, assistantMessage.id, guardResult)`（未命中 ⇒ 内部不下发） |
| 4 | `chat/orchestrator/ChatOrchestrator.ts`（非流式，同上） | 同上 |
| 5 | `client/src/stores/outputGuardStore.ts` | **新建**：按 **`messageId`** 记录 `{ action, at }`；非法载荷忽略 |
| 6 | `client/src/hooks/useNotificationSSE.ts` | 订阅 `sseService.on('system:output_guard')` → store（复用既有单一事件源，遵 TB-5） |
| 7 | `client/src/components/ChatArea/OutputGuardTag.tsx` | **新建**：**消息级**小标签（阻断=红 / 打码=琥珀；🛡️ + 可读文案） |
| 8 | `client/src/components/ChatArea/ChatMessageList.tsx` | 在**每条助手消息**的 `data-msg-id` 容器内渲染 #7（按 `message.id` 索引） |
| 9 | `client/src/i18n/locales/{zh,en}.ts` | `chat.outputGuardBlocked` / `chat.outputGuardRedacted`（**双语同批**，PC-4；**去技术化**，PC-5） |
| 10 | `app/tests/chat/outputGuardLiveEvents.test.ts` | **新建（5 例）**：事件名逐字契约 / 阻断优先 / 仅打码 / 未命中⇒null / 载荷仅三字段 |
| 11 | `client/src/tests/outputGuardStore.test.ts` | **新建（3 例）**：按消息记录 / 非法载荷忽略 / 重复事件收敛 |

**语义细节（如实）**
- **只发动作，不发原因原文**：载荷仅 `{ sessionId, messageId, action }`。**不发** `blockReason` 原文与护栏名 ——
  ① PC-5（去技术化，不暴露内部串）；② 避免前端耦合后端护栏标识符（新增护栏不需改前端）。
  原文/护栏名仍由调用方 `logger` 留痕（可诊断）。
- **消息级而非会话级**：命中发生在**具体一条助手终稿**上 ⇒ 标注挂在 `messageId`（对齐 `WatermarkTag` 的"结构化标记驱动"形态），
  不用会话级横幅（后者无法指认是哪条）。
- **覆盖范围 = 既有护栏作用域**（终稿；流式 chunk / 工具返回值 / 文件写入**不受**护栏约束，见 §9.2①）⇒ 标注亦只可能出现在终稿消息上。
- **不触发 §1.6 红线**：本通道只发 UI 通知，**不含任何"模型可见输入"** ⇒ 无需新增 `LiriEventType`/载荷/登记三处同步。
- **不做（明确）**：**刷新后仍显示**（SSE 为瞬时通道，重载即丢）—— 属"留痕/持久化"范畴，与 **P4**（护栏前原文留痕）同域，另立；
  亦**不做**单条关闭按钮（信息性标注，无状态可关）。
- 开关沿用 `OUTPUT_GUARD`（默认关）⇒ 默认下**不会**产生本事件（无护栏命中即无通知）。

**门禁（全绿）**：`typecheck`（app + client）**0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0** · `lint:size` **0 错 / 470 警告 / 8 例外（基线）** · `lint:doc-code` **18 断言一致** · 全量 `bun test`（app）**510 files / 4796 pass / 21 skip / 0 fail** · `vitest`（client）**60 files / 521 pass**。

**前置清单更新**：**P3 ✅ 已完成**；当时剩余 **P1 / P2 / P4 / P5** 仍 open（后已由 §10 全部完成）。

---

## 10. A2 前置 P1 + P2 实施 · P4 留痕 · P5 量化（2026-10-07）

> 授权：用户「按链路已定顺序继续」（P3 已完成 ⇒ 继 P1→P2；P4 由用户裁定「**默认元数据 + 开关放行原文**」）。**不翻任何默认值**（D11 仍属产品裁定）。

### 10.1 落点（实测）

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `security/services/SensitiveDataService.ts` | 内部重构为**统一打码器清单** `REDACTORS = [redactEmails, redactPii, redactSecretsFully]`：**P1** 删掉字段名 secrets 正则（`(?:api[_-]?key\|secret[_-]?key\|password\|token)\s*[:=]\s*\S+`）⇒ 改**复用** `memory` 侧规则表；**P2** 新增按行豁免（含 `Copyright`/`©` 的行跳过邮箱打码）；`sanitize` / `detectSensitiveData` **共用同一清单** |
| 2 | `memory/scanners/MemorySecretScanner.ts` | 新增 `redactSecretsFully(content, placeholder?) → { text, hit }`（**整段**遮蔽；与既有 `sanitizeSecrets` 的"保留首尾 4 字符"不同）—— 使 `SensitiveDataService` 能**复用规则表**而非自建第二套（CS01） |
| 3 | `memory/index.ts` · `security/scanner/secret/index.ts` | 转出 `redactSecretsFully` |
| 4 | `app/tests/security/sensitiveDataPatterns.test.ts` | **新建 13 例**（P1 收窄 / 真实形态命中 / P2 三种豁免与反例 / **口径同源** / **连续调用稳定** / PII / 总开关） |

**同批顺带修正（如实）**：旧 `detectSensitiveData()` 用 `/g` + `.test()` ⇒ `lastIndex` 残留会**交替误判**（`final-output-guard-no-tool-turns.md` 已记为既存缺陷）。重构后判定与打码**同源**（同一 `REDACTORS` 的 `hit`）⇒ 该缺陷消除，并有用例锁定"连续三次结果稳定"。

### 10.2 口径变化（逐条，含**行为变更**）

| 输入 | 旧行为 | 新行为 | 判定 |
|---|---|---|---|
| `password: ''` / `token: string` / `api_key: process.env.X` / `const api_key = config.apiKey` | **打码**（FP） | **不打码** | ✅ P1 目标 |
| `AKIA…` / `ghp_…` / `sk_live_…` / `xoxb-…` / JWT / `Bearer xxx` / SSH 私钥头 / `mongodb://…` | 部分不打码 | **打码**（provider 前缀/形态） | ✅ **覆盖面反而扩大** |
| `// Copyright (c) 2026 190615273@qq.com` | 邮箱被打码（与 §1.2 冲突） | **保留** | ✅ P2 目标 |
| 正文邮箱（非协议头行） | 打码 | **照常打码** | ✅ 不变 |
| `password: hunter2hunter2` | 打码 | 打码（**整段**替换，含字段名 —— 复用规则表的既有语义） | ➖ 语义微变（替换范围） |

### 10.3 P5 量化（**临时脚本取证后删除**，口径与 `toolEffects.ts` 取证先例一致）

范围：`app/src` + `client/src` + `app/docs` 的 `**/*.{ts,tsx,md}`，共 **4798** 文件。

| 指标 | 旧 | 新（P1+P2） | 变化 |
|---|---:|---:|---|
| **会改写内容的文件数**（`sanitize()` 后文本变化） | **1364** | **47** | **−96.6%** |
| 邮箱命中行 | 1239（其中**协议头行 1234**、正文 5） | 5 | 协议头 1234 行**豁免** |
| secrets 字段名模式命中文件 | 174 | — | 该模式**已删除** |
| 值形态规则命中文件 | — | 42（`bearer-token` 23 · `generic-secret` 21 · `database-url` 1） | — |

⇒ **FP 大幅下降**（对 `app/src` 全量的改写面从 28.4% 降到 **约 1.0% 的文件**）。

### 10.4 残留与边界（如实）

1. **残留 FP 42 文件**：主要来自**被复用规则表**的 `bearer-token`（`Bearer <token>` 在文档/测试里大量出现）与 `generic-secret`（长占位符 ≥8 字符无法与真口令区分）。**本批不擅自收紧** —— 该表是 `memory` 侧共享的**唯一事实源**，收紧需**跨模块协同**（否则记忆同步口径漂移）。
2. **覆盖边界（P1 裁定的有意结果）**：`token: <长值>`（**无** provider 前缀）不再命中 —— 但 `Bearer xxx` / JWT / 各 provider 前缀仍覆盖。
3. **输入侧同受影响**：`SensitivePatterns` 同时驱动 `ChatManager.streamMessage` 的**用户输入**脱敏 ⇒ 本批也**减少**"用户自己发的消息被改写"的情况（例：消息里写 `api_key: process.env.X` 不再被改写）；这是**预期改善**，非副作用。
4. **P4 已由 §10.6 补齐**（护栏前原文留痕）；**D11**（是否翻默认）**仍未裁定** —— 本批**未改** `OUTPUT_GUARD` 默认值（维持 `false`）。
5. **未做真机端到端**：本批为单元级 + 语料量化；**未**在开启 `OUTPUT_GUARD=true` 的真实会话中观察打码呈现（P3 的前端链路已就位，见 §9.3）。

### 10.5 门禁（全绿）

`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0 · 动态跨层引用 41（未增）** · `lint:size` **0 错 / 470 警告 / 8 例外（基线）** · `lint:doc-code` **18 断言一致** · 全量 `bun test`（数值见台账 §26.5-P26-2）。

---

### 10.6 P4 —— 护栏前原文留痕（**用户裁定「默认元数据 + 开关放行原文」**）

**背景（= §9.2④-3）**：护栏命中后调用方以安全文本 `updateMessageBlocks` **替换**已流出正文
⇒ 历史消息与模型上下文**永久**变为打码文本。护栏**前**原文**无独立留痕** ⇒（a）"这次改写是否误伤"
（P1/P2/P5 的 FP 排查）与（b）"当时模型到底说了什么"（§1.6 可重建精神）**都无法回答**。

**留痕形态（用户两选一裁定）**：**默认只记元数据**（动作 / 命中护栏名 / 原文长度 / **原文 SHA-256**）——
可审计"发生过改写"、可对同一原文比对去重，但**不把刚打码的内容再落盘**；
仅 `OUTPUT_GUARD_KEEP_ORIGINAL=true`（**显式 opt-in**）时才附 `originalText`（可完全重建，FP 排查用）。

**落点（实测）**

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `shared/events/eventNames.ts`（**单一事实源**） | `LIRI_EVENT_NAMES` 新增 `'validation/output_guard_applied'`（含隐私取舍注释） |
| 2 | `app/src/session/types/eventPayloads.ts` | `LiriEventMap` 新增同名载荷：`{ action, messageId, guards[], originalLength, originalSha256, originalText? }` |
| 3 | `app/src/session/types/knownEventTypes.ts` | `ALL_SESSION_EVENT_TYPES` 登记（**穷尽断言**编译期强制，漏登记 ⇒ `TS2322`） |
| 4 | `client/src/types/events.ts` | **镜像**同名载荷（由 `event-contract-parity` / `eventTypeParity` 双测守卫） |
| 5 | `app/src/core/featureFlags.ts` | 新增 `OUTPUT_GUARD_KEEP_ORIGINAL: false`（含"开启即接受未打码内容落入本地事件日志"注释） |
| 6 | `app/src/chat/finalOutputGuard.ts` | `FinalOutputGuardResult` 新增 `originalText: string`（三处 return 补齐）；新增**纯函数** `buildOutputGuardAuditPayload(result, messageId, keepOriginal)`（未命中 ⇒ `null`；阻断优先；护栏名 `Set` 去重；`createHash('sha256')`） |
| 7 | `app/src/chat/outputGuards/liveEvents.ts` | 新增 `appendOutputGuardAudit(append, sessionId, messageId, result)`：构造**完整 `LiriEvent` 信封**（`schemaVersion:1 / seq:0`（落盘口原子分配）`/ time / sessionId`，与 `ReActToolLoop._emitValidationInjected` 同范式）→ `await` 落盘；**失败必 `logger.warning`**（CS03-002） |
| 8 | `app/src/chat/outputGuards/index.ts` | 转出 `appendOutputGuardAudit` + `AppendAuditResult` |
| 9 | `chat/orchestrator/streamMessageFlow.ts`（L2019）· `ChatOrchestrator.ts`（L954） | 两处终稿点，`notifyOutputGuardResult(...)` **之后** `await appendOutputGuardAudit((event) => host.appendStreamEvent(session.id, event), …)` |
| 10 | `app/tests/chat/outputGuardAudit.test.ts` | **新建 7 例**：默认不含 `originalText` / 开关开才附原文 / 未命中 ⇒ `null` / 阻断优先 + 护栏名去重 / 落盘成功 `true` / 落盘失败 `false`；含 **sha256("abc") 已知向量**（证明哈希口径，非自证） |

**同批（开关登记，防单边改）**：`scripts/check-doc-code-consistency.js` 的 `SAFETY_SWITCHES` **10 → 11 项**（新增 `OUTPUT_GUARD_KEEP_ORIGINAL`，`def: false`）；`.trae/rules/project_rules.md §1.4` 表同步新增该行 + 清单规模注记改 **11 项**（版本 **v7.18.0**）—— 三者（代码字面值 ∩ 规则表 ∩ 断言表）**逐项对偶**，单边改动即 CI 阻断。

**两条通道的分工（故意分开，如实）**：SSE 通知（§9.3 PC-1）是 **best-effort**（丢了只影响提示条，不 `await`）；
本审计事件是**持久事实**（`await` + 失败留痕）。二者**互不替代**：前者让用户**当下**知道被改写，后者让事后**可审计/可重建**。

**边界（CS03，不做项）**
- **不做明文默认落盘**：用户裁定"不把刚打码的内容写回磁盘" ⇒ `originalText` 是**显式 opt-in**，且开启语义已在开关注释与 spec 中如实标注风险。
- **不做"原文另存文件"**：与"事件即事实源"（§1.6）一致 —— 沿用既有 `events.jsonl`，不新增存储形态（CS01）。
- **不做前端展示**：log-only（不入消息 surface）；`originalText` 若入消息就等于把刚打码的内容又写回模型上下文，与本事件目的**相反**。
- **开关沿用 `OUTPUT_GUARD`**：护栏不命中 ⇒ 不产生本事件（`buildOutputGuardAuditPayload` 返回 `null`），故默认下**零新增事件**。
