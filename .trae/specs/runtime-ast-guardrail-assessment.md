# 评估：运行时 AST 护栏（B7）+ TAORLoop 拦截粒度（B14）—— 终局裁定

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **评估完成**（B7 零代码裁定；**B14 建议实施，待拍板**）
> 来源：`dev_docs/20261007/任务计划.md` §5.2 **B7**（外部报告「AST 优化一」L819-825）· **B14**（本会话 BUG 修复副产品）
> 关联：`google ai 建议.md` §4.5-#15 · `.trae/specs/pathguard-registry-driven-args.md` · 本会话 `pattern-wiring-closure.md`（同族"粒度"问题）· **复评/增补（2026-10-09）**：[`ast-family-phased-plan.md`](./ast-family-phased-plan.md)（原生 FFI **通道已通** + `Bun.Transpiler` 真解析已在 `code_run` ⇒ 更新**成本面/能力面**，**维持本裁定**）
> 规则：GR15 / CS01 / CS03 / CS06 / R06-008

---

## 1. 现状取证（本次实测，`file:line`）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | 报告称"725 条危险命令 / 138 敏感路径 / 153 环境变量污染"——**属实**（实际 **726 / 138 / 153**） | [`permission/classifiers/dangerous-command-patterns.ts:30-759`](file:///e:/PY/Documents/CODES/PY_APP/app/src/permission/classifiers/dangerous-command-patterns.ts#L30-L759) · `sensitive-path-patterns.ts:30-174` · `env-pollution-patterns.ts:30-196` |
| 2 | 这三张表**全部是字符串 `includes` 匹配**（非正则、非 AST）；且 `dangerous-command-patterns` 内**混入大量敏感路径字面量**，与 `sensitive-path-patterns` 高度重叠 | `BashPermission.ts:110-116`（74 条字面量 `:34-107`）· 重叠见 `dangerous-command-patterns.ts:135-159` |
| 3 | **PathGuard 本体只有 9 条（读）/ 14 条（写）glob** —— 与"725 条"不是一回事 | [`query/PathGuard.ts:46-66`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/PathGuard.ts#L46-L66) |
| 4 | Bash 命令解析**无 AST**：先试 Rust 原生，失败降级 TS；两侧都是**正则 + 手写逐字符 tokenizer** | `security/bash/BashAST.ts:59-125`（降级实现 `:127-223`）· `native/src/bash_ast.rs:78-207`（复杂判定用 `contains("&&")` 等） |
| 5 | **`code_run` 已有 `staticValidation`**：`Bun.Transpiler().scan()` **真解析**（拦全部 import / require / dynamic-import）+ 正则补漏（敏感全局 `Bun`/`fetch`/`process`/`Deno`、`import.meta.require`） | `tools/CodeRunner/staticValidation.ts:72-120`（`:88` scan · `:62-63/:56-59` 正则）· 调用点 `CodeRunnerTool.ts:246` |
| 6 | **`pathShield` 已存在**：入参 `JSON.stringify` → **整串子串匹配**，`fail-closed`（不可序列化 ⇒ 哨兵拦截）；**仅有已声明边界**：挡不住变量/通配拼路径、symlink、祖先目录批量读 | `tools/pathShield.ts:198-216`（`:52/:208/:210` 哨兵）· 边界自陈 `:41-46` · 强制点 `tools/shieldGuard.ts:57` → `ToolRegistry.ts:381` / `ToolManager.ts:344` |
| 7 | **全仓无任何运行时 AST 审查能力** —— 逐项核实：`swc`／`oxc`／`tree-sitter`（明确回避）／`ts-morph`／`@babel/parser`／TS compiler API（`app/src` 内 0 使用）／Rust `syn`·`swc_ecma_parser`·`oxc_ast`（**均无**；`syn` 仅 `serde_derive` 传递依赖） | `app/package.json` 依赖清单 · `utils/bash/ast.ts:6`（"不使用 tree-sitter"）· `native/Cargo.toml:13-16` · `native/Cargo.lock:103`（syn 为 proc-macro 传递依赖） |
| 8 | Rust 原生模块**实际能力** ＝ token 计数 / Bash 字符串解析 / 消息压缩 / 文件编码读取；**Landlock 不在 Rust**（在 C 侧 `sandbox/landlock/native/main.c`） | `native/src/lib.rs:1-6` · `native/index.js:62-109` · `sandbox/landlock/native/main.c` |
| 9 | **TAORLoop 是生产主路径**（`_shouldUseTAORLoop` **函数体直接 `return true`**） | [`ChatManager.ts:583-585`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L583-L585) · 构造点 `createAgentLoop.ts:152` / `ChatManager.ts:1361` |
| 10 | TAORLoop `act()` 的 `blocked` **混装 3 类守卫**（循环检测 critical / PathGuard / 文件 IO），**任一击中即** `stopReason='aborted'` + `stopped=true` + 补发 `tool/canceled` + **整批丢弃** | [`TAORLoop.ts:636-707`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L636-L707)（处置 `:702-707` · 补发 `:995-1055`） |
| 11 | 对照：ReActToolLoop 的 **PathGuard 已细化为"按调用跳过"**（同批其余照常执行、本轮继续），**循环检测仍整轮终止** | `ReActToolLoop.ts:1074-1122` · **本会话修复**（提交 `8961066f7`） |

---

## 2. B7 裁定：**不立项**（运行时 AST 意图防穿透护栏）

报告设想的落地方式（"在底层 Rust 模块用 `syn`/`oxc_ast` 构建运行时突变阻断器"）**前提不成立**：

1. **本仓不存在可用的 JS/TS AST 内核**（§1-7 逐项核空）⇒ 要么**新引入解析器**（新依赖，与本仓 R04/N4 惯例相悖），要么自建 ⇒ **成本远高于报告估计**。
2. **真实发生率未证**：报告举的绕过向量（`Buffer.from('cm0g...','base64')`、字符串拼接）需要"**恶意提示词注入 + 模型主动混淆**"两个前提同时成立；本仓**单机单用户、无正式用户**（`project_rules §1.3`）⇒ **无真实攻击面证据**。按本仓既有口径（`contract-layer-6-proposals.md:30` **CL-4** 以"不可验证"为由**不做**），**不得以未验证的假设立项**（CS06）。
3. **已有防线各司其职，且最后一层是内核而非正则**：`code_run` 的 `staticValidation` 用**真解析**拦住脚本内的 import/require（§1-5）；`pathShield` 以 fail-closed 子串匹配拦"入参里直接出现的受保护路径"（§1-6）；**真正兜底的是 Landlock 内核级沙箱**（§1-8）。⇒ 正则不是唯一屏障，"穿透正则"不等于"穿透防护"。

**触发条件（须**同时**满足）**：① 有**可复现的绕过样本**（不是理论向量）；② 且评估证明**绕过的是沙箱/内核层而非仅正则**；③ 且已选定解析方案（**新依赖需用户裁定**）。

---

## 3. B14 裁定：**已实施**（仅放开 PathGuard 一路）—— 2026-10-07

**问题**：同一类"守卫拦截"，两条主路径**粒度不一致** —— ReActToolLoop 已按调用跳过（§1-11），TAORLoop 仍整批 abort（§1-10）⇒ 属 **CS01 意义的同族漂移**：同一语义两套行为，用哪条路径取决于会话模式。

**已实施改法（最小）**：`TAORLoop.act()` 内把 **PathGuard 从 `blocked` 中分出**（改记入 `pathBlockedById`），**仅执行未命中的调用**，并在**原位回填失败结果**（PAIR-FILL，保住下游 `rawResults[i] ↔ calls[i]` 的**位置契约**——下游 trace / 工具结果消息 / 断路器 / loopDetector **四处**均按位置消费）；**循环检测 critical 与文件 IO 守卫保持原样整批终止**（那两类**属有意终止**）。`tool_execution_errors` 的计数改为**实际执行数**（被跳过者非"执行异常"）。

**⚠️ 过程中触发的门禁（如实）**：首版注释/排版较详尽 ⇒ `TAORLoop.ts` 达 **2020 行**，触发 **R04-001**（文件 2000 行上限）⇒ 按"外科手术式修改"压缩改动后回到限内（门禁复跑 **0 错 / 4 警**，回基线）。**未**在例外表登记。

**验收（实测）**：`typecheck` **0**（含 scripts 两个 tsconfig）· `eslint` 改动文件 **0** · `lint:arch` **0 错 / 4 警（基线）** · `lint:size` 回基线 · **新增专项用例 2 例**（`tests/query/taorLoopPathGuardPerCallSkip.test.ts`：① 命中者不执行 + 原位回填 + 同批其余照常 + **本轮继续**（`results` 与 `calls` 等长，修复前恒为 `[]`）+ 三条 tool 消息配对完整；② 无命中 ⇒ 零行为变更）· 全量 `bun test` **4898 pass / 21 skip / 0 fail**。

**未做（如实）**：① 未加门控 —— 沿用本会话对 ReActToolLoop 的修复口径（用户当时裁定"被拦截可以跳过"）；② 未覆盖"循环检测 / 文件 IO 整批终止"两路（**有意语义**，不在本次范围）。

**建议不做的部分**：不引入 AST、不改命令规则表（与 B7 同结论）。

---

## 4. 与相邻项的边界（防重复评估）

| 项 | 边界 |
|---|---|
| **B2**（`@modules/core/<subpath>` 白名单口径） | **维持**（门禁 0 违规，白名单是 D-190 既定口径）——与"运行时 AST"无关，**不并入本 spec** |
| **B4**（门禁不剥离注释 / 不识别 `require`） | 属**静态门禁**（`scripts/lint-architecture.ts`），与"运行时护栏"不同域 ⇒ 见 `arch-gate-watchdog-assessment.md`（B4 + B10） |

---

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 本文件为评估（B7 零代码裁定；B14 待拍板） |
| CS01 归一化 | ✅ B14 **复用**既有 ReActToolLoop 的粒度语义，不另造机制；B7 不引入平行护栏 |
| CS03 回退最小化 | ✅ B7 拒绝为"理论向量"加新依赖与运行时审查 |
| CS06 证据驱动 | ✅ §1 十一条全带 `file:line`（含 3 组独立取证），未找到项已标注 |
| R06-008 | ✅ B14 改动在既有 app 层模块内 |

## 6. 风险与边界

1. **B7 的"不立项"有前提时效性**：一旦出现真实的可复现绕过样本，触发条件即刻成立。
2. **B14 未动码**：本 spec 只给裁定与落点；实施须用户拍板（因涉生产主路径的终止语义）。
3. **报告与本仓的口径差**：报告把"PathGuard 725 条命令"混为一体；实测 `PathGuard` 仅 **9/14 条 glob**，726 条命令规则在**另一套**（`permission/classifiers/`，用于**权限分类**而非路径护栏）⇒ 评估结论建立在**本仓实际结构**上，不照搬报告前提。
