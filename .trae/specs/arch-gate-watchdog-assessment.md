# 评估：编译期架构例外看门狗（B10）+ 门禁治本（B4）—— 终局裁定

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **评估完成**（B10 零代码裁定；**B4 剩余半项建议小改，待拍板**）
> 来源：`dev_docs/20261007/任务计划.md` §5.2 **B10**（外部报告「AST 优化三」L837-843）· **B4**（doc3:L686/L694）· `google ai 建议.md` §4.5-#18
> 关联：`.trae/specs/tool-name-compile-time-enum.md`（**反面先例**）· `.trae/specs/architecture-level-proposals-assessment.md`
> 规则：GR15 / CS01 / CS03 / CS05 / CS06

---

## 1. 现状取证（本次实测，`file:line`）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | `lint-architecture.ts` 是**纯正则/字符串**（不 import `typescript`）；import 解析靠正则 | [`scripts/lint-architecture.ts:10-11`](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L10-L11) · `parseModuleImports:2654-2680` · `parseDynamicImports:2742/2770` |
| 2 | **剥离注释只做了一半**：R00-001 路径**已剥离**（`stripComments` 为逐字符状态机，保留字符串/模板串）；**R03-002 路径（`checkModuleExports`）读原始内容、未剥离** | 已剥离：`:2656/:2696/:2746`（调 `stripComments`，定义 `:2580-2652`）；**未剥离**：`:2240`（`readFileSync`）→ `:2245`/`:2283`（直接跑正则） |
| 3 | 该文件自身记录**历史假阳性**："用正则扫**原始文本**而不剥离注释 ⇒ 把旧 import 写进注释会让依赖复活"，**本会话已实证 3 次**（D-162 · D-172） | `:2583-2585` |
| 4 | `require` **仅在动态面识别**；静态面**不识别**（且是**明示口径**，非疏漏） | 识别：`:2770`（`dynRegex` 同时捕 `import(`/`require(`）+ `:2813`（D-190② require 可见化）；**静态面排除**明示于 `:2734-2736` |
| 5 | 架构例外清单：`bulkExceptions` **0** · `perModuleExceptions` **0** · `fileSizeExceptions` **8** · `barrelExceptions` **2** · `tinyFileExceptions` **1**；且 `description` 记载 **R00-001 例外"彻底归零"** | [`scripts/layer-exceptions.json:11-134`](file:///e:/PY/Documents/CODES/PY_APP/scripts/layer-exceptions.json#L11-L134) · `:3` |
| 6 | **反面先例（明确否决 AST 规则）**：原设想"在 `lint-architecture.ts` 加 AST 规则"被**弃用**，理由 =「**误报率高** —— 工具名字面量**合法地**出现在大量比较/分支/提示词中，AST 很难区分"清单"与"普通比较"」，替代方案 = 以生效注册面为判据的**集合校验** | `.trae/specs/tool-name-compile-time-enum.md:175-178` |
| 7 | **误报率有既有量化**（本仓实测）：全仓扫描"注释复写相对导入 35 处 ⇒ **仅 1 处**造成跨层假阳性"；D-190① 剥离注释后"已豁免 **87 → 81** ⇒ 此前 **6 个'豁免'实为注释假阳性**"；**3 次误报致返工** | `dev_docs/20260928/architecture-benchmark-20260928.md:615/681/796-804` |
| 8 | **"553" 不是假阳性计数** —— 它是 R02-002 同名导出**阈值标定**数据（583 条中 553 条仅在 2 个模块定义 ⇒ 阈值设 ≥3） | `scripts/lint-architecture.ts:937-939` |
| 9 | Rust 侧**无 JS/TS AST 内核**（`app/native` 仅 `serde`/`serde_json`/`encoding_rs`；`syn` 是 `serde_derive` 的 proc-macro 传递依赖） | `native/Cargo.toml:13-16` · `native/Cargo.lock:103` |
| 10 | 门禁计数口径：**"4 警告"属 `lint:arch`**（打印于 `:4246-4250`）；**"8 例外"属 `lint:size`**（不同脚本） | `scripts/lint-file-size.ts:203` · `layer-exceptions.json` 的 `fileSizeExceptions`(8) |

---

## 2. B10 裁定：**不立项**

**决定性论据（根因优先）**：报告设想的收益是"**架构例外自动清零**看门狗"，而本仓 **R00-001 的架构例外已彻底归零**（§1-5：`bulkExceptions` / `perModuleExceptions` 均为 **0**，`description` 明载"归零"，且 `lint:arch` 长期 **违规 0**）⇒ **治理对象当前为空，看门狗没有可看的东西**。

其余两条论据：
- **前提需 AST，而本仓无 JS/TS AST 内核**（§1-9）⇒ 新依赖；跨文件依赖图用正则做不到。
- **同类做法已有反面先例且本仓已实证高误报**：`tool-name-compile-time-enum.md:175-178` 明确弃用 AST 规则（理由"误报率高"）；本仓注释假阳性实测 6 处 / 3 次返工（§1-6/§1-7）—— 报告设想的是"**用更重的机制**替换**当前有效**的脚本化门禁"，属 CS03 意义上的过度工程。

**触发条件（须按序）**：① **例外回潮**：`bulkExceptions`/`perModuleExceptions` 被重新引入且长期（>1 个里程碑）不清零；**或** 正则路线的注释/require 误报**再现**（已 3 次 ⇒ 再现即说明正则能力到顶）；② 且已选定 AST 方案（**新依赖需裁定**）；③ 且**先量化**可接受的误报率并给出"看门狗"的收益证据（不能仅以"编译器更"强"为由）。

---

## 3. B4 裁定：**已治本一半 + 剩余半项已实施（2026-10-07）**

| B4 的两个子项 | 实测结论 | 处置 |
|---|---|---|
| 「门禁**不剥离注释**（假阳性）」 | **R00-001 路径已治本**（`:2656/:2696/:2746` 调 `stripComments`，D-190 于 2026-10-01 落地）；**R03-002 路径（`checkModuleExports`）仍未剥离**（`:2240→:2245/:2283`） | ✅ **已实施（2026-10-07）**：该路径同一行改为 `this.stripComments(readFileSync(file, 'utf-8'))`（**沿用既有状态机，未引入 AST**）。**⚠️ 如实：实测效果为"零变化"** —— 改动前后 `lint:arch` 均为 **R03-002 违规 0 / 豁免 883**（`错误: 0 / 警告: 4`），即**该路径当前没有存活的注释假阳性** ⇒ 本次属**消除该类假阳性的复发通道（预防性对齐）**，而非修复一个正在发生的误报 |
| 「不识别 CommonJS `require`」 | **动态面已识别**（`:2770` + D-190②）；**静态面不识别是明示口径**（`:2734-2736` 说明 R00-001/R03-002 只匹配 `from '…'`） | **维持**：本仓 `require` 直连已清零（B3 已结案）；静态面引入 `require` 会**扩大**匹配面并增加误报，**无收益证据** ⇒ 不改 |

**验收（实测）**：`typecheck` **0**（含 scripts 两个 tsconfig）· `lint:arch` **0 错 / 4 警（基线）**· `lint:size` 回基线 · 全量 `bun test` **4898 pass / 21 skip / 0 fail**。

**⚠️ 过程记录（如实）**：首次用 `prettier --write` 同时格式化该 scripts 文件时，**app 侧配置把全文引号风格改写**（1255 行无关 churn）⇒ 已 `git checkout` 回退并**只重放这一行**改动，最终 diff = **+5/−1**（含注释）。**教训**：`scripts/` 与 `app/` 的格式化配置不同，**勿用 app 的 prettier 格式化 scripts 文件**。

---

## 4. 与相邻项的边界

- **B2**（`@modules/core/<subpath>` 白名单）：**维持**（0 违规 + D-190 既定口径）——与本 spec 无重叠；
- **B7/B14**（运行时护栏）：见 `runtime-ast-guardrail-assessment.md`（同族"无 AST 内核"结论，**不重复评估**）；
- **B3**（`bun:sqlite` 直连）：已结案，本节仅引用其结论（§3 第二行）。

---

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 评估（B10 零代码；B4 建议项待拍板） |
| CS01 | ✅ B4 复用既有 `stripComments`，不新增解析器 |
| CS03 | ✅ B10 拒绝"用更重机制替换当前有效机制"；B4 只补唯一有证据的缺口 |
| CS05 根因优先 | ✅ B10 以"例外已归零 ⇒ 无治理对象"为决定性论据，而非比较机制优劣 |
| CS06 | ✅ §1 十条全带 `file:line`；**纠正一处外部口径**（"553"非假阳性计数，§1-8） |

## 6. 风险与边界（如实）

1. **B10 的否定依赖"例外保持归零"**：回潮即触发复评（触发条件 ① 已写）。
2. **B4 的剩余半项很小但不为零风险**：`checkModuleExports` 的判定面会变化（只应更少误报），须以门禁计数守住"只降不升"。
3. 未做：任何门禁脚本改动（待拍板）。
