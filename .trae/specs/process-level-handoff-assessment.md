# 评估：进程级「自动交接」（`autoHandoff`，B9）—— 终局裁定

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **评估完成（零代码）**
> 来源：`dev_docs/20261007/任务计划.md` §5.2 **B9**（外部报告「Ralph 短板 3」L789-797）· `google ai 建议.md` §4.5-#17
> 关联（同族裁定，**必须一并引用以防反复重评**）：`.trae/specs/contract-layer-6-proposals.md` **CL-4** · `.trae/specs/long-task-routing.md:48` · `.trae/specs/compaction-duplicate-subsystems.md` · `.trae/specs/adaptation-writeback-evolution.md`
> 规则：GR15 / CS01 / CS03 / CS05 / CS06

---

## 1. 现状取证（本次实测，`file:line`）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | "上下文过压"现由**三级压缩**处理（Tier1 微压缩 / Tier2 轮次裁剪 / Tier3 LLM 全量摘要），**三级均有损** | Tier1 `context/compaction/MicroCompactionEngine.ts:2-6/39`（tool_result → 占位符）；Tier2 `SnipEngine.ts:39-52`（丢弃中间轮次 + 超长截断）；Tier3 `CompactionOrchestrator.ts:776`（摘要） |
| 2 | 触发阈值：`warning 0.75` / `trigger 0.92`（另有消息数兜底 50） | [`tokenBudget/TokenBudgetController.ts:55-60`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tokenBudget/TokenBudgetController.ts#L55-L60) · `UnifiedTokenTracker.ts:109/332-338` |
| 3 | **不存在**"会话级 / 进程级重建 + 交接"机制 —— `autoHandoff`／`handoff`（仅终端 TUI 重绘）／`交接`（仅名额/工单）／`fresh instance`（仅终端字符池）／`respawn`（未找到）**逐项无业务实现** | 已搜 `autoHandoff\|handoff\|交接\|fresh instance\|新实例\|process restart\|respawn`；`TaskRegistry.ts:268` 的 `'Task lost: process restarted…'` **只是标记中断，不重建** |
| 4 | 本仓的"续跑"是**断点续跑**，**非干净实例**：`resumeFromCheckpoint`（同进程状态恢复）/ `ResumeManager`（启动扫描检查点）/ `resumeStream`（恢复被中断的流式回合） | `query/TAORLoop.ts:1475/1494-1518` · `query/ResumeManager.ts:41/74/228-263` · `chat/ChatManager.ts:4169` |
| 5 | `session-lineage-restart-rebuild.md` 讲的是**启动期从盘重建血缘链**（一次性内存索引），**不是**"重启出干净实例 + 交接" | 该 spec `:1-7/29/52/86/167`（"运行期不实时同步…仅启动期重建"） |
| 6 | **同族先例已被否决**：**CL-4**（每轮重启模式 `ReActState.freshEachTurn`）裁定 **不做**，理由 =「**高风险行为变更**；本环境**无模型额度**做 A/B ⇒ **收益不可验证**（CS04：不得以未验证数据入库）」 | [`contract-layer-6-proposals.md:30`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/contract-layer-6-proposals.md#L30)（整族 6/6 不立项，`:34`） |
| 7 | "异 loop 中途移交"亦**已被显式声明不做**（需 handoff 语义/状态迁移，属后续独立 spec） | `long-task-routing.md:48` |
| 8 | 报告设想的"桥记忆"载体**已有等价实现**（开发规约实时回灌 ⇒ 提示覆盖层/技能侧车，**机制等价、非同名文件**） | `adaptation-writeback-evolution.md`；本计划 §4.5-#13（"近似已实现"） |

---

## 2. 裁定：**不立项**（维持）

**理由（三条）**：

1. **承载物不存在**：报告设想的"检测到水位逼近极限 ⇒ **原子落盘** ⇒ **主动销毁当前会话引擎** ⇒ **瞬间重构无污染的新会话** ⇒ 靠最新 Git 差异 + `progress.txt` 续跑"—— 其中"**进程级会话重建**"本仓**没有**（§1-3）；现有 `resume*` 是**同一会话的断点续跑**（§1-4），语义不同（报告要的是"**换一个干净实例**"）。
2. **收益不可验证（同族口径逐字适用）**：CL-4 因"**无 A/B 条件 ⇒ 收益不可验证**"被否（§1-6），而 B9 与 CL-4 属**同一族**（都是"用进程/轮次级重建换取上下文洁净度"）⇒ 本仓**当前同样没有**可对比指标与额度来证明"有损压缩不够用"（CS06/CS04）。
3. **"干净实例"未必更优，且代价明确**：三级压缩（§1-1）保证**保留**会话内的结构化摘要；而"拉新实例"会**丢弃全部会话上下文**，仅靠磁盘桥记忆（而本仓的桥记忆等价物只覆盖"开发规约回灌"，不覆盖任意任务状态，§1-8）⇒ 在无证据前，按 CS03/CS05 不应以"物理洗底"替换当前**有效且更轻**的机制。

**触发条件（须按序满足，与 CL-4 同门槛）**：① 具备 **A/B 评测条件**（模型额度 + 可对比指标），且实证"**有损压缩导致可测的细节丢失 / 语法断裂**"（不是理论担忧）；② 且已裁定产品语义：抢占/交接后**自动恢复 vs 手动恢复**（§1-7 同款未决）；③ 且明确"桥记忆"载体（需扩展现有等价物以覆盖**任务状态**，而非仅开发规约）。

---

## 3. 与相邻裁定的关系（防重复重评）

| 相邻项 | 关系 |
|---|---|
| **CL-4**（每轮重启） | **同族**（轮次级 vs 进程级）；CL-4 已否 ⇒ 本 spec 的裁定**延续同一口径**，不构成新结论 |
| **B11/B12**（资源治理） | 无关（那是调度维度）；**不并入** |
| **C 类**（已清零） | 无关 |
| `adaptation-writeback-evolution` | 是**桥记忆的一半**（开发规约回灌）**已实现**；本 spec 不重复评估 |

---

## 4. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 纯评估（零代码） |
| CS01 | ✅ 不新建"交接"机制；复用既有 resume/压缩结论 |
| CS03 | ✅ 拒绝用"物理洗底"替换有效机制 |
| CS05 | ✅ 以"承载物不存在 + 收益不可验证"为根因论据 |
| CS06 | ✅ §1 八条全带 `file:line`；逐项"未找到"已标注所用检索词 |

## 5. 风险与边界（如实）

1. **本裁定不否定 Ralph 模式本身**：在"无限上下文代码生成"流派中它自洽有效；否定的是"**在本仓当前机制与验证条件下**引入进程级交接"。
2. **与报告的口径差**：报告假设本仓有 `progress.txt` / `AGENTS.md` 式桥记忆（§1-8 仅**部分**等价）⇒ 评估基于**本仓实际结构**。
3. 未做：任何压缩/续跑/进程生命周期侧代码改动。
