# 待执行任务清单（合并去重版）

- **目的**：把「一次历史会话的产出」（Agentic Design Patterns 架构分析）与三份 spec 中的**待执行任务**合并去重，形成单一清单，避免同一事项在多份材料中状态不一、口径漂移。
- **生成时间**：2026-10-01
- **输入材料**（均为只读，未修改）：
  1. `E:\PY\Downloads\chat-export-1790838377052.md`（标题「Agentic Design Patterns 架构分析」，144 条消息 / 28 轮，2026-09-27 起）
  2. `E:\PY\Documents\CODES\PY_APP\.trae\specs\liri-optimization-plan-20260926.md`
  3. `E:\PY\Documents\CODES\PY_APP\.trae\specs\liri-upgrade-plan-20260928.md`
  4. `E:\PY\Documents\CODES\PY_APP\.trae\specs\architecture-benchmark-20260928.md`

## 口径说明

1. **状态取最新**：同一任务在多份材料中状态不同时，取**更晚**的说明，差异写入 §5「去重说明」。
2. **证据驱动（CS06）**：每条「来源」给出可核对出处（`文件:行` 或 `§章节`）。读不到/不确定者标注「未能取证」，不猜。
3. **范围**：只整理**任务级**条目；不复述分析正文，单条尽量 ≤2 行。
4. **编号约定**：本清单任务号 `T-①xx`，其中 ①②③④⑤ 为分组。会话导出以「导出 Lxxx」标注行号（该文件共 4921 行）。
5. **素材固有局限**：会话导出中的 app/src 代码证据系**会话自述**（本任务未回仓复核代码），故标注为「会话自称」；会话产出的项目文件位于 `C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\`（本机不可访问，仅从导出文本取证）。

---

## 1. 任务总表

### ① 架构 / 分层治理

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-①01 | **A8** 模式层「描述非可执行」：`PatternSelection` 仅 `{name}`、`PatternDescriptor.composedOf: string` → 改为**可执行装配描述** | 导出 L4732-4733 / L4890；`architecture-benchmark` §四①（L357） | **已完成（2026-10-01）** | 无 | ✅ **已回仓复核并实施**：`pattern-executable-assembly.md`，提交 `3980a80cc`。`composedOf: string` 已删除，改为 `PatternAssembly`（assembler 闭集 + 角色→承担方绑定）；`PatternSelection` 携带 `descriptor`；新增 `validatePatterns()` 契约自检 |
| T-①02 | **A1** 编排模式层空壳：`tasks/PlanDrivenLoop.ts:333` 的 `selectPattern({complexity:'complex'})` 返回值只流向 `logger.info`，`return` 在 `if` 之外 | 导出 L4785 / L4883（会话自称） | **已完成（2026-10-01）** | ~~依赖 T-①01（A8）~~ 已解除 | ✅ 提交 `fa452fe10`。**根因更正**：不是"少写装配代码"，而是**决策被放在无法行动的层**（PDL 无手段承接 `competitive_strategy`，返回值必然退化为日志）；修复＝删除 PDL 空转块 + 决策权归位到 `ChatManager`。双轨已消（`ChatManager.ts:4654` 现消费 `selectPattern`）。**遗留**：`iterative_refine`/`parallel_distributed`/`self_verify` 三位仍"有装配描述、无装配运行时" ⇒ 归 T-①04 |
| T-①03 | **A7** Routing 分散：`new CompetitiveStrategyOrchestrator` 实点 1 处 → **2 处**（新增 `CoreAPIImpl.ts:2520`），入口未统一 | 导出 L4791 / L4895-4800（会话自称） | 未开始（**加重**） | 与 T-①02 同源 | 会话建议次序第 3 步：入口统一后自然收敛；建议尽早冻结该装配点 |
| T-①04 | **A4** 编排家族失控：`^export class \w*(Orchestrator\|Loop\|Scheduler)` = **28 类/28 文件**，含 3 组同名概念（工具/任务/多智能体各三套） | 导出 L4788 / L4595 / L4734 | 未开始 | ~~依赖 T-①01 的统一抽象~~（A8 已提供装配描述落点） | **已回仓复核（2026-10-01）：实测 32 类 / 32 文件**（会话数字偏低，非加重以外的口径差）。会话：属大工程，各自立项；本项亦承接 A8 遗留的三位"有装配描述、无装配运行时" |
| T-①05 | **A3** 安全/权限双轨：`permission/PermissionManager.ts` 与 `security/PermissionManager.ts` **同名类并存** | 导出 L4787 / L4521（会话自称） | 未开始 | 无 | D-157 收的是 `permission→sandbox`（另一条边），未触及本项 |
| T-①06 | **A2** 多智能体协作层缺失：`CollaborationOrchestrator` 全仓 **0 命中**（建议的统一抽象未落地） | 导出 L4786 / L4597 / L4736 | 未开始 | 无 | 会话：大工程，各自立项 |
| T-①07 | **A5** 记忆分层碎片化：`MemoryPort` **0 命中**；三套记忆实现并存（`AdvancedMemorySystem` / `MemoryManager` / `EnhancedMemoryManager`） | 导出 L4789；导出 §一 #8（L1217）、§4 M3（L1364） | 未开始 | 无 | 导出 §4 M3 建议「收敛为单一接口 + 适配器，明确 deprecation」 |
| T-①08 | **A6** 评估可观测性割裂：`EvalBus` **0 命中**；`BehaviorMetrics` 明注「仅观测，不参与判定」 | 导出 L4790；A2 第 3 点（L1270）、§一 #19（L1228） | 未开始 | 无 | 会话：属大工程 |
| T-①09 | **X1** 绕过统一出口直连子路径：`import ... from '@modules/core/` 实测 **191 处 / 182 文件** | 导出 L4807 / L4904（会话自称） | 未开始 | 复用已有 R03-002 门禁探针 | **已回仓复核（2026-10-01）：实测 215 处 / 201 文件**（较会话数字**加重**）。会话建议：**自动化收口，别人工逐处改**（建议次序第 5 步） |
| T-①10 | **D-3-B B/C 类分层倒挂收口**：`service→app`≈102 · `infra→app`≈36→**≈21** · `infra→service`≈6；按模块分批（SPI/DI/物理归位） | `architecture-benchmark` §5.7（L531-557，D-145~D-157） | **进行中** | 门禁不支持文件级层映射 → 只能物理移动或 DI 反转 | 每批 `lint:arch` 0 错 / 全量 `bun test` 4250 pass；剩余大头 `config`2 · `permission`2 · `chronos`2 · `system`2 · `memory`2 · `state`1 · `monitoring`1 |
| T-①11 | **A9** 未提交改动堆积：257 文件改 / 25 删 / ~41 新增，**全部未提交**，变更不可追溯、无法按主题回退 | 导出 L4527 / L4813 | **已不成立（2026-10-01 实测）** | ~~需在仓跑 git~~ 已跑 | ❌ **已回仓复核：`git status --porcelain` = 0 行**（工作树干净）；HEAD 当时为 `facb2edd4`（即本清单自身的提交）。会话所述 257/25/41 系 2026-09-30 一版快照，**已被提交消化**。⇒ 本项无需处置 |
| T-①12 | **X2** SPI 只解决「依赖谁」未解决「谁是谁」：`TaskOrchestrator` / `TaskScheduler` / `LongRunningTaskOrchestrator` 三套编排**照样并存** | 导出 L4808 / L4905 | 未开始 | 与 T-①04 同源（并入 A4 立项） | 会话结论：这是「47 文件架构动作对 A1–A8 改善为零」的根因说明 |

### ② 契约与单一事实源

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-②01 | **#11 Goal 预算「两步记账」竞态**：`addUsage` 与 `markStatusChanged` 各为独立 SQL、无事务；已有 `addUsageAndPromote` 原子晋升 | `architecture-benchmark` §四③（L359）、§6.1（L575）、§6.4 #11（L608） | **待裁定**（spec 已记，未动） | 属「原子晋升」改造 | 竞态窗口存在但已有原子晋升单条 UPDATE 兜底 |
| T-②02 | **#11 目标监控闭环未接线**：`GoalMetricsService.queryStageMetrics/queryReviewSamples` 只有定义无调用方；无 `alert`/`deviation` 上报 | `architecture-benchmark` §6.4 #11（L608） | 未开始 | 无 | 进度上报 / 偏差告警缺失 |
| T-②03 | **#13 审批/提问裁决不可审计**：`events.jsonl` 查不到「谁批/谁拒/何时」；仅在内存 TTL + NegotiationState JSON | `architecture-benchmark` §6.4 #13（L610）、「未查明」#4（L625） | 未开始 | 无 | `assistant/question` 只落**问题文本**，答案不落盘 |
| T-②04 | **#2 路由决策可观测性缺口**：路由命中/回退仅 `debug` 日志（默认 INFO 不落盘）；`context/model-input` 载荷**不含** model/route 字段 | `architecture-benchmark` §6.4 #2（L615）、「未查明」#2（L623） | 未开始 | 无 | 既无事件承载、也默认不落盘 |
| T-②05 | **#6 分流判据硬编码**：阈值 `SIMPLE_TASK_MAX_LENGTH=60` 与「危险清单」（实为 7 条意图正则，非工具名）均**硬编码且不读配置** | `architecture-benchmark` §6.4 #6（L616） | 未开始 | 无 | 头注释明写「冻结期固定」 |
| T-②06 | **#9 adaptation 无反馈写回**：`SkillCurator` 存在（pin/patch/consolidate），但无「策略/提示演化」写回路径 | `architecture-benchmark` §6.4 #9（L607）、「未查明」#3（L624） | 未开始 | 无 | `selfImprove`/`promptEvolution`/`rewritePrompt` 全仓零命中；Curator **无 HTTP/前端消费者** |
| T-②07 | **#17 无显式 CoT / ToT / 可调推理预算**：`reasoningEffort`/`chainOfThought`/`treeOfThought`/`thinkingBudget` 全仓零命中 | `architecture-benchmark` §6.4 #17（L612） | 未开始 | 无 | `capabilities.thinking` 仅作 SmartRouter 布尔开关，不能调预算 |
| T-②08 | **#20 无统一优先级调度入口**：`PriorityQueue` 仅命中 `TTSPriorityQueue`（语音局部）；各模块仅局部排序 | `architecture-benchmark` §6.4 #20（L613） | 未开始 | 无 | `tasks/` 与 `chronos/` 无跨模块统一调度 |
| T-②09 | **#21 无主动探索 / 假设生成**：`hypothesis` 全仓零命中；验证侧已有等价能力（`query/verifyProject.ts` + evals 断言族） | `architecture-benchmark` §6.4 #21（L614） | 未开始 | 需先确认与现有能力重叠 | 若新机制只补「验证」⇒ 属重复建设（CS01） |

### ③ 工程质量 / 门禁

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-③01 | **X1 门禁执行**：R03-002 已存在但「没人执行到位」；建议自动化收口 `@modules/core/` 直连子路径 | 导出 L4807 / L4904 | 未开始 | 复用现有探针机制 | 与 T-①09 同一事项的门禁侧 |
| T-③02 | **门禁 `exemptedCount` 计数口径核查**：连续 3 批「已豁免」与「实际消除边数」不符（D-153/154/155） | `architecture-benchmark` §5.7（L557） | 未开始 | 单独立项 | 结论不受影响（边消除已用 grep+全量测试独立证实） |
| T-③03 | **未归因残差 2 处**：D-153 / D-154 各 1 处豁免数与预期不符，落在 `app→ui` / `service→app` / `infra→ui` / `core→service` 桶 | `architecture-benchmark` §5.7（L552） | 未开始 | 与 T-③02 一并复核 | 建议下批复核 |
| T-③04 | **#12 删除两处 `@deprecated` 旧重试器**：`bridge/error/BridgeErrorHandler.ts:147-150`、`bridge/utils/debugUtils.ts:378-380`，残留调用面 = **0** | `architecture-benchmark` §6.4 #12（L609） | **已不成立（2026-10-01 实测）** | 无 | ❌ **已回仓复核：`app/src/bridge/**` 全目录 `@deprecated` 0 命中** ⇒ 两处旧重试器**已不存在**（疑由后续提交删除）。⇒ 本项无需处置 |
| T-③05 | **daemon `TaskQueue` 装配链在 TS 侧断开**：`new TaskQueue(` / `new CronBridge(` 全 app **0 命中**，仅 `import type` | `architecture-benchmark` §六「未查明」#1（L622） | 未开始 | 疑留给驱动层 | 存量未接线，已登记台账 D-139 |
| T-③06 | **Landlock `--net-connect` 语义与注释相反**：未请求 net 时完全不受限 | `liri-upgrade-plan` §5 尾（L202）；§5 #6（L197） | **待验证**（⚠️ 需 Linux 实测） | 需 Linux 环境 | 已收敛为两态（`--net-deny`=全禁 / 不 handle=不受限），见 `landlock-net-policy-two-state.md` |
| T-③07 | **P0-1 Mermaid 真机端到端未验**：需真实模型产出坏 mermaid ⇒ 观察同一轮内自纠并落 `validation/injected` | `liri-optimization-plan` P0-1（L90） | **未验证**（需模型额度） | 需真实模型额度 | ①② 已落地，仅端到端未验 |
| T-③08 | **P0-3 Linux 真机端到端未验**：「bash 开启后实际读不到 `config.json`/`data/`」未实测 | `liri-optimization-plan` P0-3（L130/L141） | **未验证**（本机 Windows） | 需 Linux 环境 | 策略形状已离线断言 |

### ④ 文档与流程

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-④01 | **P3-3 工作区卫生物理搬迁**：`REF/`（82,168 文件 / 2,659 MB）物理搬迁 | `liri-upgrade-plan` §0（L23）、§3 P3-3（L156-157） | **待办**（用户裁定暂缓） | 目录被进程占用（IDE 索引/watcher），rename 被拒 | 逻辑排除已完成（`.gitignore:233` + R07-004）；择机用同卷 `Directory.Move` |
| T-④02 | **会话产出的 21 模式建议文件（01–21）未落盘**：`write_project_file` 静默失败 | 导出 L3499-3505 / L3703-3708 / L3822 | **未完成** | 需改用绝对路径 `file_write` / 修 `write_project_file` | 仅 `00_Agentic设计模式清单.md` 与 `00` 回读验证存在 |
| T-④03 | **会话工作副本已落盘（可核对）**：`dev_docs/Liri架构对标AgenticDesignPatterns分析-20260927.md`（13,558 字符） | 导出 L797 / L1000；文件已确认存在 | **已落盘** | 无 | 会话产出；建议作为 A1–A9 的原始报告留档 |

### ⑤ 其他

| 编号 | 任务 | 来源 | 现状 | 阻塞/前置 | 备注 |
|---|---|---|---|---|---|
| T-⑤01 | **对抗 Agent 形态 A（LLM 攻击者）另立 spec**：需模型额度 + 新 spec | `liri-optimization-plan` P1-1（L181）、§0（L19） | 未开始（待立 spec） | 需模型额度 | 形态 B（机械攻击集）已落地 |
| T-⑤02 | **通道进程隔离转「观察项」**：前置量化 = 0 条运行历史；「守护自愈」已具备 | `liri-upgrade-plan` P2-2（L148）、E1（L101） | **不实施**（转观察） | 待真实通道数据 | spec `channel-process-isolation.md`；本机未启用任何通道 |

---

## 2. 已闭环项（避免与待办混淆）

> 含「已完成」「取证后裁定不做」「不适用」三类。

| 项 | 结论 | 来源 |
|---|---|---|
| optimization **P0-1** Mermaid 生成自纠错 | ✅ 已完成（①②；仅真机端到端未验 → T-③07） | `liri-optimization-plan` §0（L16） |
| optimization **P0-2** Agent 台账写入合并 | ❌ 不实施（前提取证证伪；判据已固化为回归守卫 2 例） | 同 §0（L17） |
| optimization **P0-3** Landlock 拒绝集补强 | ✅ 已完成（a/b/c；Linux 真机未验 → T-③08） | 同 §0（L18） |
| optimization **P1-1** 对抗 Agent | ✅ 形态 B 已落地（5 向量 + 8 例） | 同 §0（L19） |
| optimization **P1-2** Token burst 悲观预扣 | ❌ 不实施（前提证伪 + 处方有反作用） | 同 §0（L20） |
| optimization **P1-3** 热窗口阈值口径统一 | ✅ 已完成（a/b/c/d） | 同 §0（L21） |
| optimization **P2-1** 沙箱层复用（`pack_diff`） | ❌ 不适用（前置沙箱实例层已物理删除） | 同 §0（L22/L25） |
| optimization **P2-2** MCP 动态工具映射（PathGuard 注册表驱动） | ✅ 已实施 | 同 §0（L23） |
| upgrade **P1-1** Mermaid 自纠回路 | ✅ 已完成（= optimization P0-1） | `liri-upgrade-plan` §0（L15） |
| upgrade **P1-3** 工具出参 schema 校验 | ✅ **A + B + C 档全部完成（2026-10-01）** | `architecture-benchmark` §6.3（L595）、§2.2.3（L325） |
| upgrade **P2-1** Token 悲观预扣 + 回滚 | ❌ 不实施（= optimization P1-2） | `liri-upgrade-plan` §0（L18） |
| upgrade **P2-2** 通道进程隔离 | ⛔ 不实施（前置=0 条）→ 转观察（→ T-⑤02） | 同 §0（L19） |
| upgrade **P2-3** 工具名 codegen | ✅ 已完成（T0–T3 + 去重） | 同 §0（L20） |
| upgrade **P3-1** A2A 对外暴露 | ✅ 已完成（T0–T6） | 同 §0（L21） |
| upgrade **P3-2** 工具链级 checkpoint + 原子回滚 | ⛔ 不实施（能力已具备）；衍生 `snapshot-storage-governance` ✅ 已实施 | 同 §0（L22） |
| upgrade **§5 未核实项 2–10** | ✅ 已全部核实回填 | 同 §0（L24） |
| benchmark **§2 DocWorkflow 阶段序列双份** | ✅ 已完成（收口形态＝删除 `runDocWorkflow`） | `architecture-benchmark` §2（L56） |
| benchmark **§三 收尾门禁**（R15-001 / R15-002） | ✅ 已完成（存量 44→0；接线 21 / 删除 24） | 同 §三（L337） |
| benchmark **§5.1 门禁「假绿」**（19 目录未检查，329 文件盲区） | ✅ D-3-A 已落地（映射 65→84；新增 R00-002） | 同 §5.6（L454-460） |
| benchmark **§5.3 跨端契约单一事实源** | ✅ 已完成（事件名下沉 `shared/events/eventNames.ts` + 三端门禁） | 同 §5.3（L418-424） |
| benchmark **D-3-B** B1 / B2 / A 类 | ✅ B1（续期 2027-04-18 + 删 4 冗余 + `types` 归 core）· B2（D-143）· A 类 12 处（D-144） | 同 §6.3（L596） |
| benchmark **§6.4 待细核项**（#7/#9/#11/#12/#13/#16/#17/#20/#21 等） | ✅ 已全部取证（#7 判「不成立」） | 同 §6.4（L600-616） |
| benchmark **§4 ⑤ 工作区卫生（逻辑）** | ✅ R07-004 已落地（warning 级） | 同 §4（L361） |
| benchmark **工具数口径 60 vs 81** | ✅ 已核（生效 60 / 全量 71；「81」无本仓口径支撑） | 同 §6.1（L569） |
| benchmark **§5.4 新增 `server/` 文件夹** | ❌ 不建议（与实现唯一性冲突；契约应落 `shared/`） | 同 §5.4（L440-446） |
| optimization/upgrade **明确不做**（eBPF/AppArmor、EROFS、`CONTEXT_LAYERING` 影子开关、RocksDB/Sled、Rust 线程池、ACP 分布式传输、F 动态思考预算） | ❌ 已裁定不做（附理由） | `liri-optimization-plan` §3（L258-265）；`liri-upgrade-plan` §3 表（L170-176） |

---

## 3. 待裁定项（需用户拍板）

| 编号 | 事项 | 来源 | 待定内容 |
|---|---|---|---|
| D-01 | **治理起点 C / D**：C＝拆文件规模债（156 个 `>1000` 行文件）；D＝分层依赖收口（210 处跨层依赖走 SPI） | `architecture-benchmark` §5.5（L450） | A/B 已完成，C/D 未选；建议顺序 A→B→C/D |
| D-02 | **D-3-B B2/B3 深度收口 vs 续期**：B/C 类 ≈204 处是否逐点重构，或维持「例外+续期」 | 同 §5.2（L410）、§5.7（L496-505） | B3（全面收口 376 处）会与 `decayRules` 冲突 |
| D-03 | **156 文件大小例外 + 20 条分层例外** 的处置 | 同 §5.2（L414） | 收口 or 续期 |
| D-04 | **4 个「类里声明但不在注册面」的 PascalCase 类** 处置 | `liri-upgrade-plan` §5 尾（L202）；台账 D-36-③ | 属独立议题 |
| D-05 | **`app/tests/**` 是否纳入 lint 范围**（现 `eslint src` 不含 tests；与 D-137/D-138 同类门禁盲区） | `architecture-benchmark` §2.2.3 顺带发现（L277） | 待裁定是否纳入 |
| D-06 | **#11 Goal 预算是否改造为单条 UPDATE 原子晋升** | 同 §四③（L359）、§6.4 #11（L608） | 已有 `addUsageAndPromote`，是否彻底改造 |
| D-07 | **会话 A2/A4/A5/A6 是否各自立项**（大工程） | 导出 L4820（建议次序第 4 步） | 会话建议：4 项各自立项 |
| D-08 | **会话 A9 未提交改动是否按主题拆提交** | 导出 L4527 / L4813 | 需先跑 git 复核（→ T-①11） |
| D-09 | **通道进程隔离是否维持「观察项」**（或待真实通道数据后重启） | `liri-upgrade-plan` P2-2（L148）、§0（L19） | 依赖真实通道运行数据 |
| D-10 | **会话遗留调试垃圾是否清理**：项目 `output/` 下 `_diag1.md`/`_probe*.md`/`_t3.md`/`_writetest.txt`/`_liri_probe_cwd.txt` 等 | 导出 L4381 / L4169 / L4325 | 非交付物（在 C: 盘项目内） |

---

## 4. 去重说明

### 4.1 同一任务在多份材料中重复（以哪份为准）

| 事项 | 出现处（重复） | 取值 |
|---|---|---|
| **Mermaid 自纠错** | optimization **P0-1** ≡ upgrade **P1-1**；benchmark #4「产物出口无校验」同源 | 以 optimization P0-1 为主（明细最全） |
| **沙箱快照/层复用** | optimization **P2-1** ≡ upgrade **P1-2**；benchmark #10 / B3 / D2「`pack_diff`」 | 三处同物，结论「❌ 不适用」（前置已删） |
| **Token 悲观预扣** | optimization **P1-2** ≡ upgrade **P2-1**；benchmark C1 / #16 同源 | 结论「❌ 不实施」 |
| **对抗 Agent（作弊审查）** | optimization **P1-1** ≈ upgrade A2「对抗性 Rollout / Leakage Filtering」 | 以 optimization P1-1 为主 |
| **PathGuard 动态工具映射** | optimization **P2-2** ≡ upgrade **C2** ≡ benchmark #10 | **三处重复**，以 optimization P2-2（✅ 已实施）为准 |
| **工具出参 schema** | upgrade **P1-3** ≡ benchmark **§2 P1-3**；benchmark **§2.1/§2.2** 是同一号不同物（见 4.3） | 均已闭环 ✅ |
| **ACP/A2A 协议双轨 + 端点** | benchmark **#15** ≡ upgrade **F2 / P3-1 / G2** | 结论「✅ 已完成（T0–T6）」 |
| **工具名 codegen** | upgrade **P2-3** ≡ benchmark E5 | 结论「✅ 已完成」 |
| **失败语义/依赖图** | 会话 **A3**（前驱失败不阻断后继）与 benchmark #6/#12 方向相关但非同一任务 | 分别单列 |
| **agent 台账写入合并** | optimization **P0-2** ≡ upgrade **D4 后半** | 结论「❌ 不实施」 |
| **热窗口阈值口径** | optimization **P1-3** ≡ upgrade **C3 / #9** | 结论「✅ 已完成」 |

### 4.2 关键差异（同一任务**状态不一致**，已取更晚）

1. **工具出参 schema 校验（P1-3）B/C 档** —— `liri-upgrade-plan` §0（2026-09-29）写「**B/C 档未做（另一议题）**」；`architecture-benchmark` §6.3（**2026-10-01**）写「**B1/B2/B3/C 全部完成**」。⇒ **取更晚**：已完成（本清单列入「已闭环」）。
2. **D-3-B 例外到期日** —— `architecture-benchmark` **§5.2（L410-416）仍写**「`expiresAt: 2026-10-18`，过期是 error」，但 **§5.6/§5.7（L456/L462/L596）已写**「续期至 **2027-04-18**」且 B1/B2/A 类已完成。⇒ **§5.2 为陈旧段落**，取 §5.6/§5.7。
3. **沙箱复用（P2-1）** —— `liri-optimization-plan` §0 该行**内部先后不一**：行首写「⛔ 阻塞」，同段末尾写「**已改判为 ❌ 不适用**」。⇒ 取「不适用」。
4. **会话 A1 行号** —— 会话自称 `PlanDrivenLoop.ts` 调用点由上轮 **334** 行变为本轮 **333** 行（迁移导致的整体行号 −1，非代码改写）。
5. **会话 A7 方向反转** —— 上一轮记录「双轨并行」1 处装配点，本轮实测扩散为 **2 处**（判定为「仍成立**且加重**」）。

### 4.3 同名不同物（易混编号，须区分）

- **`P1-3`**：在 `liri-optimization-plan` = **热窗口阈值口径统一**（✅ 已完成）；在 `liri-upgrade-plan` / `architecture-benchmark` = **工具出参 schema 校验**（✅ 已完成）。**两者编号相同、所指不同**（benchmark §2 已显式提醒）。
- **`P2-1`**：optimization = 沙箱层复用；upgrade = Token 预扣。
- **`P2-2`**：optimization = MCP 动态工具映射；upgrade = 通道进程隔离。
- **`P1-2`**：optimization = Token 预扣；upgrade = 沙箱快照复用。

---

## 5. 未取证 / 存疑项（如实列出，不作结论）

| 项 | 说明 |
|---|---|
| 会话产出文件本体 | 位于 `C:\Users\csdnc\Documents\LiriProjects\proj_1790493202403_7cecrq\output\`（`01_Liri架构层面对照分析报告.md` / `02_复查…` / `03_二次复核…` / `04_三次复核…`），**本机不可访问**，仅据导出文本取证 |
| 会话的 app/src 代码结论 | `PlanDrivenLoop.ts:333`、`PatternSelection`、`CollaborationOrchestrator`/`EvalBus`/`MemoryPort` 0 命中、28 类编排等，均为**会话自称**。**2026-10-01 已部分回仓复核**（实测值）：`PlanDrivenLoop.ts:333` ✅ 成立（同址）；`PatternSelection` 仅 `{name}` ✅ 成立；`PatternDescriptor.composedOf: string` ✅ 成立；`CollaborationOrchestrator` / `EvalBus` / `MemoryPort` **0 命中** ✅ 成立；编排家族 **28→实测 32 类/32 文件** ❌ 数字偏低；`@modules/core/` 直连 **191/182→实测 215/201** ❌ 数字偏低；A9 未提交改动 ❌ **已不成立**。未复核项：`PermissionManager` 双轨已确认并存；其余 §1 条目仍待回仓 |
| 会话 A9 未提交改动数字 | 257 文件改 / 25 删 / ~41 新增 为 **2026-09-30 一版**，会话自述**本轮未复核**（无 git 工具） |
| 会话期间新增 commit | 会话末尾提「本轮提交链 `4c2ac9f54` → `2223b20e6`」（属 benchmark 记录），会话侧未复核 |
| optimization/upgrade 的「真机 / Linux 端到端」 | 见 T-③07、T-③08，均因环境（Windows / 无模型额度）未验 |

---

## 6. 排除的评测噪音（会话导出中与本仓无关的自动生成内容）

> 会话导出混有**基线评测自动生成**的通用内容（与 Liri / PY_APP 架构治理无关），已**全部排除**，未进入任务总表：

1. **「TaskFlow 智能任务编排与执行平台 PRD」** —— 示例产品的完整虚构 PRD（V1.0 / 版本修订记录 / 里程碑）。
2. **「通用电商 Web/App 平台 V1.0」需求梳理** —— 假设对象（游客/注册用户/运营…的模块与 FR-01…）。
3. **「智能工单分派与 SLA 预警（v1.0）」PRD** —— 虚构的 B 端客服 SaaS 产品（含变更记录、评审人、目标发布日）。
4. **多份「PRD 评审与定稿执行结果」** —— 虚构的评审人/反馈闭环（F-01 / F-001 等）、批准状态与未决项。
5. **「无法完成提取/探索」的阻塞模板** —— 多段「缺少输入材料」的通用骨架（角色/场景/目标「待确认」表），与本次任务无关。
6. **项目 `proj_1790493202403_7cecrq` 的工具故障诊断噪声** —— `write_project_file` 静默失败探测、「路径赌博」（C: 盘 vs E: 盘）、`_probe*`/`_diag*`/`_t3` 等探针过程与垃圾文件。

> 甄别口径：与**本仓（Liri / PY_APP）架构治理、对标分析、工程改进**相关的**真实任务项**才收录；上述 6 类属通用评测模板 / 虚构案例 / 工具诊断过程，予以排除（其中第 6 类的**衍生产物**——21 模式清单与报告——已在 T-④02 / T-④03 中如实记录）。
