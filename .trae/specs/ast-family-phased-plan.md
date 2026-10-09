# 方案：AST 家族（G-A / G-B / G-C）**复评**与分阶段落地

> 版本 1.2 ｜ 创建 2026-10-09 ｜ 状态：🟢 **P0 已实施** · 🟢 **P1 结论：不立项（已取证支撑）** —— 与既有终局裁定 `arch-gate-watchdog-assessment.md`（B10）**一致** ｜ ➖ P2 暂不立项（用户 2026-10-09 裁定）
> 来源：`dev_docs/20261009/google ai 建议.md`（Gemini 二轮）· 计划 `dev_docs/20261009/复查任务计划.md` §2 批次 R7（R19–R25）· 台账 **L-20**
> **前置裁定（本文件不推翻）**：`.trae/specs/runtime-ast-guardrail-assessment.md`（**B7 = G-A：不立项**）· `.trae/specs/ast-semantic-chunking-assessment.md`（**B8：不立项**）· **`.trae/specs/arch-gate-watchdog-assessment.md`（B10 = G-B：不立项）** ⚠️
> 关联：`.trae/specs/dead-code-and-unwired-items-rulings.md`（未接线/死码裁定）· `.trae/specs/pathguard-registry-driven-args.md`· `.trae/specs/tool-name-compile-time-enum.md`（**AST 规则反面先例**）
> 规则：GR15 / CS01 / CS03 / CS05 / CS06 / **CD07** / R06-008

> ⚠️ **本版重要更正（如实）**：v1.0 提出 P1（门禁真解析）时**未先读** `arch-gate-watchdog-assessment.md` ⇒ 未发现该建议**已被 B10 终局裁定为"不立项"**（且其触发条件当前**未满足**）。本版已记录该冲突，P1 状态改为**待裁定**（见 §3 P1）。

---

## 1. 本轮**新增取证**（相对 2026-10-07 两份评估的**增量**，`file:line`）

| # | 新事实 | 证据 | 相对既有评估的变化 |
|:-:|---|---|---|
| 1 | **原生 FFI 通道已在跑**：`app/src` 下 **9 处真实** `require('../../../native')`（+1 处注释）—— 含 `security/bash/BashAST.ts`（Rust 解析 + TS 降级）· `security/BashSecurityAnalyzer.ts` · `tokenBudget/TokenBudgetController.ts` · `compaction/utils.ts` · `knowledge/ingestion/FileIngestionService.ts` · `tools/{FileWrite,FileEdit,FileRead,Grep}Tool` | `app/native/index.js`（`bun:ffi` `dlopen`，7 符号）· CI `cargo-build`（`.github/workflows/ci.yml:102-137`）· `app/docker/Dockerfile:22,53,94` | **成本面更新**：过去评估只说"Rust 能力 = token/bash/压缩/编码"；现有证据表明**通道已通且已被消费** ⇒ 若将来加符号是**增量**，非从零搭 FFI |
| 2 | **TS/JS 侧已有"真解析"护栏**（非仅正则）：`code_run` 的静态校验用 **`Bun.Transpiler().transformSync`（语法门禁）+ `.scan()`（枚举导入 ⇒ 拒任何非空 imports）**，正则仅作兜底 | `tools/CodeRunner/staticValidation.ts:5-6,22-39,76-102` · 调用点 `CodeRunnerTool.ts:28` | **能力面更新**：JS/TS 侧"零护栏"的说法**不成立**（B7 §2-3 已提，本轮独立复核**仍在**） |
| 3 | **`bash_ast.rs` 名不副实**：是**手写 tokenizer**，含 `&&`/`\|\|`/`\|`/`;`/`if`/`while`/`for`/`function`/`{}` 一律返回 `too_complex` | `native/src/bash_ast.rs:78-207`（`has_complex` 判定 `:204-207`） | **术语订正**：bash 侧现状是"**受限子集解析**"，**不是** AST 审计 |
| 4 | **陈旧双轨绑定**：`context/ffi/NativeBindings.ts` 加载 **`pyapp_native`** 与符号 `compress_messages_safe` / `estimate_tokens_safe` —— 与现行 `liri-native` crate **名与符号全不符**；且**全仓零消费点**（含 barrel 再导出） | 该文件 `:24-28,47-60,74-87`；grep `NativeBindings` / `compress_messages_safe` 仅命中自身 | **新登记项**（CD07 类：先摘入口） |
| 5 | **dev/CI 侧解析器齐备**：`typescript`（devDep）· `@typescript-eslint/parser` · eslint 传递的 `espree` / `acorn` | `app/package.json:179-191` · `app/node_modules/{typescript,espree,acorn,esprima}` | **G-B 的"零新依赖"条件成立**（既有评估未覆盖其 dev 侧形态） |
| 6 | **运行时依赖清单中无任何 JS/TS AST 解析器** | `app/package.json:116-178`（runtime `dependencies` 无 swc/oxc/acorn/typescript/@babel） | 与既有评估 §1-7 一致（**维持**） |

---

## 2. 复评结论（对既有裁定的**维持 / 更新**）

| 项 | 既有裁定 | 本轮复评 | 依据 |
|---|---|---|---|
| **G-A**（`PathGuard`/`code_run` → **运行时** Rust AST 意图拦截） | 不立项 | **维持不立项** | 既有触发条件**三条均未满足**（无可复现绕过样本 · 无证据表明绕过的是内核层而非仅正则 · 解析方案未裁定）。**新增**：即使立项，缺的也不仅"解析器"——见 §1-3（bash 侧连 tokenizer 都覆盖不到复杂命令）。**更新**：若将来立项，**FFI 通道已通**（§1-1）⇒ 边际成本低于 2026-10-07 的估计 |
| **G-C**（压缩/分片的 **AST 作用域闭环**） | 不立项（B8） | **维持不立项** | ① **R18 已证伪其前提**（本仓压缩粒度 = **消息/轮次**，**不做代码字符切片**）；② B8 的"**收益不可测**"（无 chunk 级度量）+ "**无内核**"结论未变。**新增**：原生层**已有压缩 FFI**（`py_compress_messages`，`compaction/utils.ts` 已 require）⇒ 若要动压缩，**先评估既有原生压缩**而非新写 swc |
| **G-B**（静态门禁 → **AST 依赖图**） | 既有评估只把它归入"静态门禁域"（`arch-gate-watchdog-assessment`），**未单独立项** | **新增可执行分片（P1）** | 这是**唯一**前提已完全具备、且**零运行时成本**的一项（§1-5）；收益边界如实：只能闭合**静态** import 的判读精度，**动态导入盲区本质不可闭合**（已由 R00-003 显式上报） |

> **共同结论**：AST 家族**从"条件不具备"变为"条件分层"** —— **dev/CI 侧可做（P1）**，**运行时侧仍需新依赖 + 满足既有触发条件（P2）**。

---

## 3. 分阶段方案

### P0 —— 清理陈旧原生绑定 ✅ **已实施（2026-10-09）**

**删除前六步核查（`code-deletion.md` CD01–CD06，全部留痕）**：

| 步 | 结论 |
|---|---|
| **CD01** 静态引用 / 动态导入 / 配置注册 | `NativeBindings` / `getNativeModule` / `compress_messages_safe` / `estimate_tokens_safe` / `pyapp_native` 全仓 grep：**除文件自身外零命中**；**动态导入**（`ffi/NativeBindings` · `'./ffi` · `context/ffi`）**0 命中** |
| **CD02** 构建入口 / 插件 / 运行时发现 | `context/ffi/` 目录**仅此一文件**（无 `index.ts` barrel、无 `.d.ts`）；bundle 入口 `src/pyapp.ts` 未引用；无目录扫描/约定式加载 |
| **CD03** DI / 反射 / 协议入口 | 非 DI 注册项、非装饰器/约定式方法、非 HTTP/IPC/webhook 入口 |
| **CD04** 测试 / 构建变体 / 运行模式 | `app/tests/**` 零引用；`build-variant` 仅按 feature flag、不列文件；`CLI/REPL/MCP/DAEMON/TEST` 均不可达 |
| **CD05** 先摘入口 | **如实：入口本就不存在**（零引用、无 barrel、无动态路径）⇒ 本步**空**；故不存在"入口与实现同批删"的风险 |
| **CD06** 独立提交 + 回滚路径 | 独立提交；**回滚点**：`HEAD=b1f89eb6d`、blob **`fcaad43b502d3099365a1e3e6ad6d999cead3997`**、末次改动 `39a53f0ed`(2026-08-26) ⇒ `git checkout b1f89eb6d -- app/src/context/ffi/NativeBindings.ts` 可复原 |
| **CD07** 关键模块白名单 | 属 `context/ffi`（app 层）**不在**沙箱/安全/权限/会话恢复/通道白名单内；且其功能由**现役** `app/native/index.js`（`py_compress_messages`/`py_estimate_tokens`）承载，**无能力损失**（CS01：消除第二套实现） |

**验收（实测）**：文件已删 · `NativeBindings` 在 `app/` **零命中** · `typecheck` **0**（含两个 scripts tsconfig）。

**动作**（已完成）：删除 `app/src/context/ffi/NativeBindings.ts`（目录随之空置）。

### P1 —— 静态门禁升级为**真解析** —— 🔴 **暂缓：与既有终局裁定冲突，待裁判定**

> **冲突取证（本轮补齐）**：`.trae/specs/arch-gate-watchdog-assessment.md`（2026-10-07）已对**同一治理对象**（= Gemini 建议二 / 本方案 G-B）作出 **B10 终局裁定 = 不立项**：
> - 理由 ①（决定性）：**R00-001 架构例外已彻底归零**（`layer-exceptions.json` `bulkExceptions: []` · `perModuleExceptions: []` —— **本轮复核仍为 0**）⇒ 看门狗**无治理对象**；
> - 理由 ②：需 AST 而本仓**无内核** ⇒ 新依赖；
> - 理由 ③：**反面先例**（`tool-name-compile-time-enum.md` 明确弃用 AST 规则，理由"误报率高"）+ 本仓**实测高误报**（注释假阳性 6 处 / 3 次返工）⇒ 属 CS03 过度工程。
> - **B10 触发条件（须按序）**：① 例外**回潮** **或** 正则注释/require **误报再现**；② 已选定 AST 方案（新依赖需裁定）；③ 先**量化**可接受误报率 + 给出收益证据。
> - **本轮状态**：① **未满足**（例外=0 未回潮；`lint:arch` 仍 0 错/4 警基线，无新误报）· ② **未裁定** · ③ **未量化**。
>
> **P1-b 对照取证（✅ 已执行，2026-10-09）** —— 新增非门禁脚本 [`app/scripts/ast-vs-regex-import-diff.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/scripts/ast-vs-regex-import-diff.ts)（正则侧**逐字复制**门禁 `stripComments` 与两条静态正则；AST 侧用 `typescript`（devDep）；**收窄到门禁追踪口径** = `@modules/*` + 相对路径）。实测（`app/src` **3937** 文件）：
>
> | 项 | 数量 | 说明 |
> |---|---:|---|
> | 提取条数 | 正则 **14455** / AST **14430**（收窄口径；AST 另有 2407 条裸包/内建，门禁**有意**不追踪） | — |
> | **正则【漏判】** | **6**（**0.04%**） | **全部同类：无 `from` 的副作用导入** —— `import '../global.d.ts'`×2 · `import './storage/{Memory,FileSystem}UnifiedStorage.js'`×2 · **`import '@modules/core'`×2（均在测试**，且注释说明"复刻生产入口 main.ts 顺序"= **有意副作用**） |
> | **正则【多出/误报】** | **29**（**0.20%**） | **全部位于"文本载体"文件**：`docs/ApiDocs.ts`(9) · `docs/PluginDevGuide.ts`(6) · `plugin-sdk/scaffold.ts` · `scripts/plugify.ts`(6) · `tools/FewShotRegistry.ts`(2) · `tools/ModuleMigrationTool.ts`(2) · `config/schema/ConfigDocGenerator.ts` ⇒ 文档字符串 / 模板 / few-shot 示例 / 迁移生成器，**不产生运行时依赖边** |
>
> **结论（数据驱动）**：差异**总量极小**（漏判 0.04% / 误报 0.20%），且**当前零活跃影响** —— `lint:arch` 仍 **0 违规 / 4 警（基线）**，说明上述 29 处误报**未产生**违规（同层或已按既有口径处置）。⇒ **P1「精度版」维持不立项**（与 §8.4 的"精度提升无对象"一致，且现**有实测支撑**）。
> **同时沉淀基线**：这 29 处可作为 B10 触发条件① 之"**误报再现**"的**对照基线** —— 若未来出现"文本载体导致**跨层**假阳性"的实测样本，AST 的收益即刻**可量化**，届时复评（脚本可重跑）。
>
> **两条路径的最终归属**：
> - **P1-a（维持不立项）**：✅ **采纳**（数据支撑）。
> - **P1-b（仅取证）**：✅ **已执行**（本节上表），脚本保留为非门禁工具备用。

**（若将来获裁启动）范围**：`scripts/lint-architecture.ts` 的**静态 import 扫描**（现为 regex + `readFileSync`；`parseModuleImports:2654-2680` / `parseDynamicImports:2742/2770`）。
**目标**：闭合"正则漏判"的**静态**部分；**动态导入**维持 R00-003 的 **warning 上报**口径（不改判定）。

**决策点 D2（解析器选型）**：

| 选项 | 优点 | 代价 | 建议 |
|---|---|---|---|
| **`@typescript-eslint/parser`**（已在 devDeps） | 真 TS AST；对 `.ts`/`.tsx` 准确 | CI 变慢；需与 eslint 版本同步 | ⚠️ 次选 |
| **`typescript` compiler API**（devDep） | 最准（含 type-only 判定，正对 R00-001 的 type-only 口径） | 最慢 | ✅ **首选**（门禁对速度不敏感） |
| `espree`（eslint 传递） | 快 | 仅 JS，TS 需预处理 | ❌ 不适配 `.ts` |

**验收**：① 门禁仍 **0 违规**（现有 3916 文件）+ **警告 4（基线）不变**；② **成对自证**（对齐 R5 门禁自证）：构造"故意越权 import"夹具 ⇒ **必须报 R00-001**；构造合法夹具 ⇒ **必须 0 违规**；③ **type-only 引用**计入既有"仅上报"口径（不得由 warning 变 error，避免误伤 14 处 type-only）。

### P2 —— 运行时"真 AST"（**需裁定依赖 + 满足既有触发条件**）

**前置（**同时**满足，沿用 `runtime-ast-guardrail-assessment.md` §2 触发条件）**：
- ① 有**可复现**的绕过样本（非理论向量）；
- ② 评估证明绕过的是**沙箱/内核层**而非仅正则（否则 Landlock 已兜底）；
- ③ **用户裁定**新增依赖（`swc_ecma_parser`（Rust crate）或 `oxc-parser`（JS））。

**若立项，建议两步（先 bash、后 TS/JS）**：
- **P2-a（bash）**：把 `bash_ast.rs` 从 tokenizer 升级为**真 AST**（Rust `brush-parser` 或 `tree-sitter-bash`）⇒ 覆盖目前一律 `too_complex` 的 `&&`/`|`/`;`/控制结构。**不引入 TS 侧依赖**，复用现役 FFI 通道（§1-1）。
- **P2-b（TS/JS）**：`code_run` 侧在**已有** `Bun.Transpiler().scan()` 之上（§1-2）追加语义级检查（如"混淆拼接后仍解析出危险调用"）—— **需先有 §2 的实证样本**。
> **本方案建议：P2 暂不启动**（维持既有裁定），仅登记"条件已分层"的事实与成本更新。

### 不在本方案范围（防越界）

| 项 | 归宿 |
|---|---|
| **R19** 工具出参契约（覆盖 1/81、非阻断） | 计划 §2 批次 R7 · 需产品决策（`zod` 已在 runtime deps） |
| **R20** `PathGuard` Unicode 归一化 | 计划 §2 批次 R7（触发条件：正式支持 macOS 且出现绕过样本） |
| **R24** Sidecar / AI-VFS context / gVisor 兜底 / Code-as-Tool | 计划 §2 批次 R7（不立项，各有触发条件） |
| **R25** 沙箱默认姿态（`bashEnabled`/`failClosed`） | 计划 §2 批次 R7（安全姿态决策）· 台账 **L-19** |

---

## 4. 影响文件（按阶段）

| 阶段 | 文件 |
|---|---|
| **P0** | `app/src/context/ffi/NativeBindings.ts`（删）· 可能其 `index.d.ts` |
| **P1** | `scripts/lint-architecture.ts`（解析替换）· 可能新增 `scripts/` 下解析助手 · `.github/workflows/ci.yml`（若需 node_modules 缓存范围调整） |
| **P2** | `app/native/Cargo.toml`（新 crate）· `app/native/src/*`（新符号）· `app/native/index.js`（新符号注册）· `tools/CodeRunner/staticValidation.ts` 或 `security/bash/BashAST.ts`（接线） |

---

## 5. 决策点（需拍板）

| # | 决策 | 建议 |
|---|---|---|
| **D1** | **P0（清陈旧绑定）是否执行** | ✅ 建议执行（零风险；依 CD07 顺序，独立提交） |
| **D2** | **P1 是否做** | ✅ **已定：不做**（P1-a）。依据 = 既有 B10 终局裁定 **∩** §3 P1-b **实测**（漏判 6 / 误报 29，且**零活跃影响**）⇒ 精度版收益≈0。**不做**门禁替换；**仅保留**取证脚本作基线 |
| **D3** | **P2 是否新引依赖（swc/oxc）** | ❌ 建议**暂不**（沿用既有不立项裁定；先看 §2 触发条件） |

---

## 6. 合规检查清单（GR01–GR15 相关项）

| 规则 | 结论 |
|---|---|
| **GR15** | ✅ 本文件为**方案/复评**（P0 可执行；P1/P2 待拍板），**不推翻**既有 B7/B8 裁定 |
| **CS01 归一化** | ✅ **不新建**解析/护栏实现：P1 复用 devDeps 既有解析器；P2 复用**现役 FFI 通道**（`native/index.js`），不另起第二套桥 |
| **CS03 回退最小化** | ✅ P2 明确拒绝"为未验证向量引依赖"；P1 不引入运行时依赖 |
| **CS05 根因优先** | ✅ G-C 指出更前置根因（压缩粒度非字符切片 · 原生压缩 FFI 未评估） |
| **CS06 证据驱动** | ✅ §1 六条全带 `file:line`；**并纠正**本轮一次 grep 截断导致的"原生未接线"误判 |
| **CD07 关键模块** | ✅ P0 涉原生绑定（安全相邻）⇒ 严格 **先摘入口 → 观察 → 再删**，独立提交 |
| **R06-008 分层** | ✅ P1 只改 `scripts/`（构建期工具）；P0/P2 不新增跨层依赖 |
| **doc↔code** | ✅ 未改 `project_rules §1.4`（若将来动安全开关，须同批更新断言表） |

---

## 7. 风险与边界（如实）

1. **既有裁定的时效性**：B7 的"不立项"以"**无可复现样本 + 解析方案未定**"为前提；本方案**不改变**该前提，仅更新**成本面**（FFI 已通）与**能力面**（`Bun.Transpiler` 真解析已在）。
2. **P1 收益有上限**：只能闭合**静态**盲区；**动态导入**（43 处 / 38 组合）**本质不可由静态分析闭合**，维持上报口径。
3. **P2 的"AST"之名**：即便立项，也须明确目标是"**受控子集 + 语义特征匹配**"还是"**完整 AST + 数据流**"——两者成本差一个数量级；本方案未预设。
4. **未做**：本文件不含任何代码改动；P0/P1 落地需经 D1/D2 拍板后另起实施。

---

## 8. 立项 / 不立项 **决策矩阵**（架构维度，2026-10-09 追加）

### 8.1 判别轴：`enforced`（强制边界） vs `advisory`（启发式判断）

| | `enforced` | `advisory` |
|---|---|---|
| 例 | Landlock（**内核拒绝系统调用**）· 分层门禁（**CI 阻断**） | 正则/AST **判断后放行或告警** |
| 失效模式 | 失效即**拒绝**（fail-closed 可配） | 失效即**漏判**（静默放行） |
| 绕过成本 | 须**攻破内核机制** | 须构造判断器未覆盖的**形态** |

> **判据**：立项收益 =（覆盖增量 ∩ 真实可达）× **保证强度** − 成本。**保证强度是乘数** —— `advisory` 的覆盖增量**乘不出** `enforced` 的保证。
> **AST 三项全部是 `advisory`** ⇒ 立项不改变保证类型，只增加"多命中哪些实例"。

### 8.2 逐项差异（立项 ↔ 不立项）

| 项 | 立项新增覆盖 | 保证类型 | 真实可达性 | 不可闭合项 | 成本 | 净差 |
|---|---|---|---|---|---|---|
| **G-A** 运行时 AST 意图拦截 | 混淆拼接 / Base64 / 零宽等**意图**形态 | **advisory**（判对拦、判错放） | **低**（需"恶意注入 + 主动混淆 + 沙箱未开"三者同时） | 混淆手段**无限**，判据永远不完备 | 新 crate（`swc_ecma_parser`）/`oxc` + FFI 符号 + **3 平台构建** + FP 评估 | ➖ **弱正 / 偏负**（现状已有 `Bun.Transpiler` **真解析** + `pathShield` fail-closed + Landlock 内核兜底） |
| **G-B** 门禁 → AST（**精度版**） | 注释 / `require` / type-only 的**判读精度** | enforced（**不变量已守住**） | 现状：`lint:arch` **0 违规 / 3916 文件**、例外 **0**；注释**已由 `stripComments` 治本**；静态 `require` 是**明示口径** | **动态导入 43 处** —— **AST 也看不到**（运行时解析） | CI 变慢 + 历史**误报 3 次返工** | ➖ **≈0**（不变量已守 ⇒ 精度提升**无对象**） |
| **G-B** 门禁 → AST（**新不变量版**） | **全新**不变量类（如"ui 桶不得再导出 infra"）——**当前 0 覆盖** | **enforced + 新增保证** | 需**需求样本** | 同 | 同上 + 需先定义不变量 | ⭐ **唯一正收益形态**（条件式） |
| **G-C** 压缩 AST 作用域闭环 | **对象不存在**（本仓压缩 = 消息/轮次，**非**字符切片；R18 已证伪） | advisory | **0** | — | 中 | ❌ **=0** |

### 8.3 结论（按目标分岔）

1. **目标 = 防穿透 / 代码执行安全** ⇒ **不立项收益最大**。AST 全是 `advisory`，而兜底已在**内核层**（Landlock）与**真解析**（`Bun.Transpiler.scan`）；同样的投入放在**启用已存在但默认关闭的 `enforced` 边界**（见 R25）收益更大。
2. **目标 = 新增架构保证** ⇒ **立项收益最大，但只能做 G-B 的"新不变量"形态**（唯一 `enforced` + 当前 0 覆盖）；**G-A / G-C 均不该做**。
3. **就当前证据**（无正式用户 · 单机单用户 · 例外为 0 · 无绕过样本）⇒ **不立项的净收益 > 立项**。

### 8.4 决策规则与开关条件

> **只有当"要守的不变量"是 AST 能机械判定、且 `enforced` 侧尚无覆盖时，立项才划算**；否则不立项。

- **G-B 新不变量版**：**开关条件** = 出现"某类倒挂/越界**反复人工 review 发现**，且**静态可机械判定**"的样本 **≥2 次** ⇒ 立项；否则维持不立项（与 B10 一致）。**（可计数入口：§8.5 样本登记表 —— 按「目标项 + 不变量类」分组计数，当前 **0** 行）**
- **G-B 精度版**：**开关条件** = 由 §3 P1-b 的**对照取证**证明差异**非零且有跨层影响**（当前**已执行取证**，结果见 §3 P1 与台账 L-20）。
- **G-A / G-C**：维持不立项（触发条件见 `runtime-ast-guardrail-assessment.md` §2 / `ast-semantic-chunking-assessment.md` §2）。

### 8.5 「不变量缺失」样本登记表（供 §8.4 计数，2026-10-09 建立）

**用途**：把 §8.4 的文字判据变成**可计数**记录 —— 每次出现"**门禁 / 内核没拦住**、由评审或复盘发现"的越界，在此登记**一行**；**按「目标项 + 不变量类」分组计数**，同组 **≥2** 即触发立项评估（G-B 新不变量版），或满足 G-A / G-C 的对应条件。

**登记表（当前 **0** 行 ⇒ 无满足条件的样本）**：

| ID | 日期 | 目标项 | 不变量类 | 现象（实测） | 发现方式 | 现有 enforced 为何漏 | 静态可机械判定 | 证据（file:line / 命令） |
|---|---|---|---|---|---|---|---|---|
| _（空）_ | — | — | — | — | — | — | — | — |

**填写规则**：
1. **ID**：`IG-<序号>`（Invariant Gap）。
2. **目标项**：`G-B 新不变量` ／ `G-B 精度` ／ `G-A` ／ `G-C`。
3. **不变量类**：只有**同一条规则**才算同类（**跨类不累加**）。例：`ui 桶再导出 infra` 与 `core 直连 app 子路径` 是**两类**。
4. **发现方式**：须写明"**当时未被门禁拦下**"（评审 / 复盘 / 用户报告 / 事故）—— 这是"`enforced` 侧存在缺口"的证据。
5. **现有 enforced 为何漏**：正则能力边界？**规则缺失**？还是**内核层也无法拦**（G-A 的关键区分）？
6. **静态可机械判定**：`是` ／ `否`（填 `否` ⇒ 该样本**不构成** G-B 的立项依据）。
7. **证据**：`file:line` 或可复现命令；**禁止编造**（CS06）。
8. **计数与触发**：
   - `G-B 新不变量`：同「不变量类」**≥2** ⇒ 触发立项评估，且**第一步优先用现有门禁形态**（正则 / 集合校验），**仅当不可表达**才考虑 AST；
   - `G-A`：出现**可复现绕过样本**且证明绕过的是**内核层** ⇒ 才满足既有条件②；
   - `G-C`：出现"**可测**检索损失"样本 ⇒ 才满足既有条件①。

**复评流程**：① 登记一行 → ② 同组计数 ≥2 → ③ （若涉 G-B）**重跑** [`app/scripts/ast-vs-regex-import-diff.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/scripts/ast-vs-regex-import-diff.ts) 取最新基线 → ④ 按 §8.4 决定"**用现有门禁形态加规则**"还是"立 AST" → ⑤ 台账登记结论。

> ⚠️ **本表不得预填示例数据**（CS04 / CS06）：**空表即"当前无满足条件的样本"**；上面的空行仅作**列示意**，不是登记项。
