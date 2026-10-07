# Spec：护栏双侧闭环（P26-2）

> 版本 1.2 ｜ 创建 2026-10-07 ｜ 状态：🟢 **A1（不可见 Unicode 三份实现归并）已实施（2026-10-07）** · 🟡 **A2（`OUTPUT_GUARD` 常开评估）待做** · 方案 B 按 D10=a 不实施 —— 见 §9 实施记录
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
