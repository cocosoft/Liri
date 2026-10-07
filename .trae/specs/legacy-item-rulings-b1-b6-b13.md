# 裁定：存量遗留项 B1 / B2 / B5 / B6 / B13 —— 终局裁定（含两处**旧结论订正**）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **裁定完成（零代码）**
> 来源：`dev_docs/20261007/任务计划.md` §5.2 **B1/B2/B5/B6** + **B13**
> 规则：GR15 / CS01 / CS03 / CS06 / R06-008

---

## 1. 逐项取证与裁定

### B1 · 台账 **D-36-③**：4 个"类里声明 `name`、却不在注册面"的 PascalCase 类

**原始记录**（`liri-upgrade-plan-20260928.md:215` → 台账 `预存错误与待处理问题.md:6320-6323`）：
`EnterPlanMode` · `ExitPlanMode` · `TeamCreate` · `TeamDelete`；**为何门禁没抓到** = "T3-① 门禁判据是**清单里的名字 ∈ 注册面**，而这 4 个名字**不在任何清单** ⇒ 属**判据外**"。

**本次实测**：

| 类 | 现状 | 证据 |
|---|---|---|
| `EnterPlanMode` / `ExitPlanMode` | ✅ **类已不存在**（全仓 `app/src` **仅剩 1 处沿革注释**）⇒ **该条记录已过时** | 全仓 grep `EnterPlanMode\|ExitPlanMode` → **唯一命中** `tools/AgentTool/strategies/VerificationStrategy.ts:153`（注释里的沿革说明） |
| `TeamCreate` / `TeamDelete` | ⚠️ **类仍在，但** **不是死类** —— 有 loader 引用 **且带开关门控** | 类 `TeamCreateTool.ts:76` / `TeamDeleteTool.ts:50`；工厂 `ToolFactory.ts:605-608`（`isToolEnabled('ENABLE_TEAM_CREATE')`，关则 `return null`）/ `:622-625`（同 `ENABLE_TEAM_DELETE`）；loader `ToolManagerUtils.ts:161-162` |
| 是否在生成物（71 名）内 | **均不在** | `constants/toolNames.generated.ts` 对 `TeamCreate`/`EnterPlanMode`/`ExitPlanMode` **零命中**（仅有一个无关的 `'plan'`） |

**裁定**：
1. **半数自动闭环**：`EnterPlanMode`/`ExitPlanMode` 两个**类已删**（应系 D-33/D-34 死类清理批次带走）⇒ D-36-③ 该半条**作废**；
2. `TeamCreate`/`TeamDelete` **维持现状**：其"不在生成物"是**设计使然**（flag-gated 工具默认不注册），**不是漏注册**⇒ 无动作；
3. **门禁盲区如实登记（判据边界，非缺陷）**：T3-① 判据覆盖"**清单里的名字**"，故**任何不在清单的类名**天然在判据外；若将来要把 flag-gated 工具纳入门禁，须**先裁定口径**（生成物 = **生效面 60** 还是 **全量面 71**）——**本项不触发**。

---

### B2 · **X1 白名单口径**：`@modules/core/<subpath>` 直连

**实测**：**110 处 / 100 文件**（计划记 106/100 ⇒ 自然增长）；`lint:arch` 判 **违规 0**（这些路径落在 `canonicalEntryKeys` 白名单内）。样例：`@modules/core/paths`（最多）、`@modules/core/external/sqlite3`、`@modules/core/spi`、`@modules/core/events/EventBus`、`@modules/core/patterns/index.js`。

**裁定：维持**（不收紧白名单）。
**理由**：① 现门禁 **0 违规**，白名单是 **D-190 既定口径**（2026-10-01 用户裁定）；② 收紧只会产生**大量无收益改动**（这些子入口正是"层内合规出口"的设计）；③ CS03：不为"看起来更严"而改判定面。

---

### B5 · **R02-002**（同名/重复定义检测）—— ⚠️ **含一处口径纠偏**

**实测**：
1. 具体重复项 **`ToolSearchOutput` 已收敛**：`tools/index.ts:333-334` 明载「**2026-10-02 R02-002 收敛：ToolSearchOutput 数据契约唯一落点（zod 推导）**」，唯一事实源 = `tools/ToolSearchTool/schemas.ts:37`（`ToolSearchTool.ts:14-17` 同载）⇒ 原"三处重复定义"**已闭环**；
2. 门禁规则本身**已实施且带标定阈值**：`locations.length < 3 ⇒ continue`（`scripts/lint-architecture.ts:937-939`）。

**⚠️ 口径纠偏**：计划 B5 的表述「此前裁定'维持不做'**因 ≥553 噪声**」**不准确** —— `lint-architecture.ts:937` 的 **553 是阈值标定数据**（583 个候选里 **553 个仅出现在 2 个模块子树**，属**领域局部变体/巧合** ⇒ 故阈值定为 ≥3），**不是"假阳性/噪声计数"**。
> 这与 `arch-gate-watchdog-assessment.md` §1-8 纠正的是**同一处误读**（两处引用同一数字）。**"553 是噪声"是本计划的一处内部误述**，此处订正。

**裁定：维持**（门禁阈值不改）。**理由**：降阈值即刻引入 553 条 2-子树同名（标定已证），无收益证据；且具体重复项已收敛 ⇒ **无"立项"待办**。

---

### B6 · doc2 的 **A1 结构化挂起清单** —— ⚠️ **旧结论订正：已实施**

**实测**：`.trae/specs/a1-fail-closed-pending-queue.md:3` 开篇即载「**状态**：✅ **已实施（T1–T6，2026-10-05）** —— 全部任务交付并按 §8 验收通过」。

**⚠️ 订正**：计划 B6 记「建议**维持不做**（需产品入口）」—— 其依据是 doc2 `:28` 的 **2026-10-02** 复核结论（"仍在位仅 3 项：A1/F5/F1"），而 **A1 已于 2026-10-05 实施** ⇒ **该依据已过时**。

**裁定：已闭合**（不需裁定）。**附带**：doc2 的"仍在位 3 项"中，**F5 / F1** 已列"明确不做"（§6），**A1 已实施** ⇒ 该"仍在位"清单**三项全部有终局**。

---

### B13 · 报告 §六「A4、M2–M5 未复验」—— **一次性关闭**

**报告原文**（`Liri架构对标AgenticDesignPatterns复核-20261007.md:251`）：「本次复验聚焦 …；**A4、M2–M5 未复验**，矩阵中相应章节标 🔁/⬜」。
**M2/M4/M5 的定义**（同报告 `:233`）：M2 检查点恢复**扫描入口** · M4 RAG 分块 **overlap** · M5 压缩**保留度探针**。

**本次逐项实测**：

| 项 | 实测结论 | 证据 |
|---|---|---|
| **M2** 检查点恢复扫描入口 | ✅ **已存在且已接线**：`ResumeManager.scanPending()`（扫描 `getPendingSessions()` → 产出恢复候选 + 进度事件） | [`ResumeManager.ts:63-64`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ResumeManager.ts#L63-L64)（`storage.getPendingSessions()` `:67`、进度 `:66/:69`） |
| **M4** RAG 分块 overlap | ✅ **已存在**：`ChunkOptions.overlap` **默认 12 行**（滑窗 `stride = windowLines - overlap`） | [`chunker.ts:76-77`](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/semantic/chunker.ts#L76-L77) · 应用点 `:162/191/452` |
| **M5** 压缩保留度探针 | ✅ **已存在且有消费与用例**：`measureRetention()` + 编排器调用 + 专属用例 | [`retentionProbe.ts:107`](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/compaction/retentionProbe.ts#L107) · `CompactionOrchestrator.ts:51/889` · `tests/context/retentionProbe.test.ts:65-101` |

**裁定：一次性关闭**。**理由**：三项**均已实现且可指认**（本仓台账 §14 亦早有"不成立/已过时/已实施"的处置）⇒ 报告的"未复验"标记**作废**，此后**不再重列**（CS06：不留过期结论）。

> **未并入**：报告的 **A4**（未复验）仍归 **A 类 A4**（长任务压缩观察点，需真实长任务 + 额度）—— **不在本次关闭范围**。

---

## 2. 净效果

| 项 | 变化 |
|---|---|
| **B1** | 半数（2 类）**自动闭环**（类已删）；另 2 类**维持**（非死类）；门禁盲区登记为**判据边界** |
| **B2** | **维持**（110 处/100 文件，0 违规） |
| **B5** | **维持** + **订正一处内部口径误述**（"553 噪声" → 阈值标定数据） |
| **B6** | **已实施（2026-10-05）** ⇒ 从"待裁定"移出（**旧结论订正**） |
| **B13** | **一次性关闭**（M2/M4/M5 三项实测存在） |
| **计划真待执行** | B 类由 **6 项 → 1 项**（仅 **B14**，待拍板） |

---

## 3. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 纯裁定（零代码） |
| CS01 | ✅ 均**不新增**机制；B1 复用既有 loader/开关语义 |
| CS03 | ✅ B2/B5 拒绝无收益的判定面收紧 |
| CS06 | ✅ §1 每条带 `file:line`；**两处旧结论（B6、B5 口径）经取证订正**；"未找到/已不存在"如实标注 |
| R06-008 | ✅ B1 的"门禁判据边界"如实登记，不改判定 |

## 4. 风险与边界（如实）

1. **B1 的"类已删"是现状推定**：`EnterPlanMode*` 文件已不存在，但**未核对 Git 历史**确认删除批次（不排除从未落盘）⇒ 结论是"**当前不存在**"（已足够支撑裁定）。
2. **B5 的订正只针对"553 的语义"**，不改门禁阈值（保持 ≥3）。
3. **B13 只关闭 M2/M4/M5**；**M3** 早已不成立（§2.5）、**A4** 仍在 A 类。
4. 未做：任何代码/门禁/清单改动。
