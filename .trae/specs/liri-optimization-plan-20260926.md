# Liri 优化方案（2026-09-26）

> 来源材料：`E:\PY\Desktop\google ai  建议.txt`（Google AI 对话串：工作台截图分析 + 多 Agent 协作拆解 +
> CodeMidas `arXiv:2609.22068v1` / DSec `arXiv:2609.22978v1` 的联想）。
>
> **本文的写法**：外部建议**逐条在本仓核验**（grep / 读码），只保留"缺口在本仓成立"的项；
> 与代码不符的说法**如实纠正**（依据 `.trae/rules/PY_APP.md §5 基于证据的分析`、`coding-standards.md CS04/CS06`）。
> 每条给出**证据坐标**与**验收标准**，不写"看起来对但无从验证"的内容。

---

## 0. 任务状态总览（2026-09-29 复核）

| 任务 | 状态 | 说明 |
|---|---|---|
| P0-1 Mermaid 生成自纠错 | ✅ **已完成** | ① 前端降级 + ② 服务端零依赖预检/本轮内回喂均已落地；仅"真机端到端"未验（需模型额度） |
| P0-2 Agent 台账写入合并 | ❌ **不实施**（前提取证证伪） | 原验收判据已固化为回归守卫（`agentRunStore.test.ts` 2 例） |
| P0-3 Landlock 拒绝集补强 | ✅ **已完成** | a/b/c 三项均落地；仅"Linux 真机端到端"未验（本机 Windows） |
| P1-1 对抗 Agent（作弊审查） | ✅ **形态 B 已落地** | 机械攻击集 `evals/antiCheatAudit.ts` + 8 例；形态 A（LLM 攻击者）另立 spec |
| P1-2 Token burst 悲观预扣 | ❌ **不实施**（前提证伪 + 处方有反作用） | —— |
| P1-3 热窗口阈值口径统一 | ✅ **已完成** | a/b/c/d 全部落地；另立项 `compaction-duplicate-subsystems.md`（已核查：两套为分工，非双轨） |
| P2-1 沙箱层复用（`pack_diff` 类） | ⛔ **阻塞（前提证伪）** | 2026-09-29 取证：依赖的 `SandboxPruner` **零消费者**，且项目**无活的实例级沙箱生命周期**（`ToolSandboxRouter`/`SandboxManagerImpl` 亦未接线 ⇒ 台账 **D-16**）⇒ 无可挂目标；spec 已标阻塞 |
| P2-2 MCP 动态工具映射 | ✅ **已实施（2026-09-29）** | spec：[`pathguard-registry-driven-args.md`](./pathguard-registry-driven-args.md)。`PathGuard` 改为**注册表驱动**（`resolveToolParamNames` + `PATH_ARG_KEYS` 求交），两个调用方已注入；8 例守卫 + 回归 119 例全绿。⚠️ 取证**纠正**：`pathShield` 本就与工具名无关（**无需改**），真缺口在 `PathGuard` 静态名单（方向是 **fail-OPEN**，非"误拦"） |

**结论**：P0 三项与 P1 三项**已全部收口**（其中 P0-2 / P1-2 为"取证后裁定不做"）；**P2-2 已于 2026-09-29 实施**；**剩余 = P2-1（⛔ 阻塞：前提证伪，见 D-16）**。

---

## 1. 核验结论总表（先证真伪，再谈优化）

| # | 外部建议 | 本仓实况（证据坐标） | 判定 |
|---|---|---|---|
| 1 | 强制 SQLite WAL 防锁 | **已开**：`app/src/core/external/sqlite3.ts:158-160`（`journal_mode=WAL` + `busy_timeout=10000` + `temp_store=MEMORY`）；`workspace/ProjectItemStore.ts:238` 亦单独开 | ✅ **已做**（只需核验覆盖面） |
| 2 | 台账写入合并（Write-Buffer + 节流批量提交） | `tools/AgentTool/**` 内**无** `flushBatch` / `writeBuffer` / `throttle` / `debounce` 命中 | ⚠️ **缺口成立** |
| 3 | Mermaid 语法自纠错（Lint 拦截 + 回喂重试） | 前端 `client/src/components/ChatArea/MarkdownRenderer.tsx` 以 `securityLevel:'strict'` + DOMPurify 渲染；**服务端无任何语法校验**（报错只在前端暴露） | ⚠️ **缺口成立** |
| 4 | Fail-Closed 访问控制（禁读 `/proc`、切断全盘 `grep` 偷答案） | 沙箱实现是 **Landlock**：`app/src/sandbox/landlock/*`（`buildLandlockArgv` / `runWithLandlock` / `readLandlockConfig`），且 2026-09-26 `G1-A` 刚把 **bash 接入 Landlock**（`sandbox/index.ts:112,139-149`）。**未发现 `apparmor` / `ebpf` / `seccomp` 任何命中** | ⚠️ **方向成立、手段需纠正**（应扩展 Landlock 规则，不是引入 eBPF/AppArmor） |
| 5 | 四级描述符解析链 / fail-closed 拒绝 | v0.4.50 已落地（见 `dev_docs/error_repairs/预存错误与待处理问题.md` 的 v0.4.50 条目：DB 角色 → 运行时注册表 → 内置类型 → **fail-closed 拒绝**） | ✅ **已做** |
| 6 | 工具命名规范（禁冒号，改下划线） | v0.4.50 `N-42` 已修：`media:<域>:<动作>` → `media_<域>_<动作>`（同条目） | ✅ **已做** |
| 7 | 对抗 Rollout / Leakage Filtering（作弊 Agent） | 已有 A7 题源屏蔽族：`app/src/tools/pathShield.ts` + `tools/shieldGuard.ts` + `evals/shieldPlan.ts`，评测侧 `evals/sourceTask.ts` 的"桩必败 / 原件必胜"自检 | 🟡 **部分已做** ⇒ 缺"对抗 Agent 作为独立角色" |
| 8 | Token burst 控制（悲观预扣 + 真实回滚） | 2026-09-26 已改为**真实 `usage.prompt_tokens` 记账 + 对称退款**（`chat/ReActToolLoop._chargeStreamBudget`、`query/TAORLoop._observeRound`）⇒ 仍存"usage 回传前的窗口期" | 🟡 **部分已做** ⇒ 预扣为可选增强 |
| 9 | 长任务摘要/上卷腾热窗口 | `app/src/context/compaction/*`（0.92 触发、分层折 earliest batches）已在做；名为 compaction，非"上卷" | 🟡 **部分已做** ⇒ 只需统一阈值口径 |
| 10 | 沙箱 `pack_diff` / EROFS 秒级复用 | 仓内**无 `pack_diff`**；评测侧快照是 `git archive` + 依赖拷贝/junction（`app/src/evals/repoSnapshot.ts`） | 🔶 **方向成立（重）** ⇒ 需先出 spec |

**需要纠正的外来说法（避免照着想象开工）**：
- 「五层安全防护 / eBPF 细粒度网络白名单 / AppArmor 策略」—— 仓内**不存在**这些实现；现有 LSM 能力是 **Landlock**（路径级）。
- 「`CONTEXT_LAYERING` 开关」「kswapd 式 L0/L1/L2 内存回收」—— 仓内**无此开关/命名**；实际对应物是 `context/compaction` 的分层压缩与 `monitoring/memoryPressure`。**不要凭外部命名新建"影子配置面"**（会与既有配置面分裂）。
- 「EROFS / 分布式存储按需拉取」—— 属外部基础设施经验，Liri 当前不涉及该层，**不建议照搬**。

---

## 2. 排期（按"缺口证据充分度 × 成本"）

### P0 — 小、缺口明确、可当次落地

**P0-1 Mermaid 生成自纠错（对照 §1-#3）—— ✅ ① ② 均已落地（2026-09-28）；仅"真机端到端"未验**
- 现状：坏语法只在浏览器端 `Syntax error in text mermaid version 11.15.0` 暴露，后端无拦截。
- 做法（两步，先做 ①）：① **前端降级**：`MarkdownRenderer` 捕获 mermaid `parseError`，失败时**降级为代码块**并显示"图表语法错误（已保留源码）"，杜绝红字刷屏；② **服务端校验 + 回喂**：对**助手终稿**做结构预检，失败则注入修正指令让模型**同一轮内**重发（≤1 次/运行），并落一条事件（对齐 §1.6「模型可见 ⇔ 已落盘」）。
  ⚠️ 原写"在**图表类工具输出落盘前**做语法校验"——**实施期取证后修正**（`doc_generate` 无 mermaid 通道，该挂点已删除），详见下方 ② 的④条修正记录。
- 验收：注入坏语法 ⇒ UI 无红色报错（降级为代码块）；后端日志出现自纠错重试记录；正常图表零回归。
- 风险：服务端校验需一个 mermaid 解析器（node/wasm），**先做前端降级即可止血**。
  → **已解除（2026-09-28）**：改用**零依赖结构预检**（不引入 mermaid 解析器），见下方 ② 的 ②条。
- **① 已完成（2026-09-28）**：`MarkdownRenderer.tsx` 的实施与原方案有一处**关键修正** ——
  原方案写的是"捕获 `parseError`"，但实测真凶是 **`mermaid.render()` 失败时 mermaid 自行往 DOM 注入它的错误图**
  （"Syntax error in text mermaid version …"，即用户截图右下角红字），原 catch 只替换目标元素、**拦不住注入**；
  且旧降级把源码渲染成红字（第二个红字来源）。现改为：
  ① **`await mermaid.parse(code)` 预校验**（实测 `graph TD; A-->;` 即抛 `Parse error on line 1`）⇒ 非法语法**不进 render**，
  从根上杜绝错误图进入 DOM；② 失败时兜底 `remove()` 残留的 `#<id>`/`#d<id>` 节点；
  ③ 降级 UI ＝ 通俗提示（i18n `chat.mermaidRenderFailed`：中文"图表未能渲染（语法有误），已保留源码"）＋ 源码原样保留（可复制），不再红字；
  ④ 回归守卫 `client/src/tests/mermaidFallback.test.tsx`（2 例：非法 ⇒ **render 从未被调用** + 无 "Syntax error" 文本 + 提示与源码在位；合法 ⇒ 正常渲染阳性对照）。
  门禁：client **52 文件 / 488 用例全通过**、`tsc --noEmit` 干净、改动文件 eslint 0 error（仅 1 条既有 `react-refresh` warning）。
- **② 已完成（2026-09-28）**：服务端校验 + **本轮内**回喂重试。落地过程中有 **4 处前提修正**（均先取证再改，非照原方案硬做）：
  1. **挂点收窄为「助手聊天正文」** —— 原方案写"图表类工具输出落盘前"，取证三条后**证伪该前提**：
     `doc_generate` 的 `markdownToHtmlBody()` **不识别任何代码围栏**（mermaid 块以裸文本落 `<p>`）、全文无 pandoc、`officecli` batch 不渲染图、
     工具描述亦未声明图表；而全仓唯一被 mermaid 渲染的只有**助手聊天正文**（前端 `MarkdownRenderer` ← `BlockContent` ← `markdownParser`，单一路径，① 已覆盖）。
     ⇒ **用户裁定：删除 `doc_generate` 挂点**（对"它根本不渲染的东西"做语法校验无意义），只做助手正文。**该上游缺陷已另行登记**（见 `dev_docs/error_repairs/预存错误与待处理问题.md` 2026-09-28 D-2）。
  2. **校验收敛为「零依赖结构预检」** —— 新增 [`utils/mermaidLint.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/utils/mermaidLint.ts)：图类型白名单 / 空块与纯注释 / 括号引号配平，**三条启发式，不引入 mermaid 解析器**（避免 d3/dompurify 体积与启动分层代价）；
     文件头**如实标注启发式边界**（与真解析器判定不保证一致 ⇒ 决定了下面的"保守回喂"）。
  3. **回喂位置由「收尾后」改为「本轮内」** —— 新增骨架钩子 [`ReActLoop.onFinalOutputValidation`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L616-L632)（**在 `onIncompleteTurn` 之后、`finalize` 之前**调用；返回 `true` ⇒ 骨架 `continue` 再给一轮），
     由 [`ReActToolLoop`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L2489-L2534) 覆写 ⇒ 模型**同一轮内**拿到修正指令并重发，用户最终看到的是**已修正**的回复。
     （若挂在收尾后的 `StreamPipeline.postProcess`，`injectSteering` 只能**下一次请求前**生效 ⇒ 跨轮，且用户已先看到坏图。）
     与 `onIncompleteTurn` 的分工：前者判**完整性**（空回复/只思考/只计划/被截断），本钩子判**合法性**（内容在但不合规）。
  4. **保守回喂：每 run 至多 1 次**（`_outputValidationRetried`，随 `resetRunState` 归零）—— 预检是启发式 ⇒ 模型若已按指令改而启发式仍判不合格，再回喂即**纯空转**（每轮多一次 LLM 请求）；用尽后**如实放行**（用户仍看到 ① 的降级卡片，不静默）。
- **② 的实现要点**：
  - **§1.6 落事件**：新增事件类型 **`validation/injected`**（载荷 `kind: 'mermaid'` / `issues` / `channel: 'steering'` / `text` ＝**注入正文**），**三处同步**——`chat/types/events.ts` 联合 + `eventPayloads.ts` 载荷 + `knownEventTypes.ts` 登记（编译期穷尽断言保证不漏）；
    先落盘再注入；`text` **不含** `[STEERING] ` 前缀（前缀由 `onSteering` 的片段类型拼装，与 `goal/injected` 同口径）；事件为 **log-only**（不入消息 surface）。
  - **文案单一来源**：指令模板进 `CONTINUATION_TEMPLATES.mermaid_repair`（`goalTemplates.ts`，键与重试类别一一对应）；`{{issues}}` 由 `mermaidLint.ts` 的 `formatMermaidIssues()` 渲染（问题措辞唯一来源在校验器，不重写两处）。
  - **修正轮取代坏正文**：复用既有 `_supersedeNextRoundText`（O2-4 语义）⇒ 避免"坏图与修正图并存"；指令因此明确要求"**重发完整回复**"。
  - **前端镜像同步**（`client/src/types/events.ts` 文件头明文要求双端一致）：联合 + 载荷各补一项。
- **② 的验收（已跑）**：`app` 侧 `tsc --noEmit` **0**；新增/扩展用例 **30 pass / 0 fail**（`mermaidLint` 13 例 + 骨架钩子契约 4 例 + `mermaid_repair` 模板渲染 1 例）；`lint:arch` **0 错 1 警**（唯一告警是**预存** R07-004 `REF/`，与本次改动无关）；改动文件 `eslint` **0**；`client` 侧 `tsc --noEmit` **0**。
- **② 未验收（如实）**：**真机端到端未做** —— 需"真实模型产出坏 mermaid ⇒ 观察同一轮内自纠并落 `validation/injected`"的一次会话级观察（需真实模型额度）；`lint:arch` 的 1 条 warning 是预存项，非本次引入。

**P0-2 Agent 台账写入合并（对照 §1-#2）—— ❌ 前提经取证**证伪**，不实施；验收判据已固化为回归守卫（2026-09-28）**

- **原设**：多子代理并发写 `AgentRunStore`（SQLite，WAL 已开）仍可能 `SQLITE_BUSY` / 写放大 ⇒ 加内存 Write-Buffer + 定时/阈值 flush。
- **取证结论（四条，均可复核）—— 该前提不成立**：
  1. **进程内不存在多连接争锁**：[`getAgentRunStore()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/AgentTool/AgentRunStore.ts#L641-L643) 是**模块级单例**，全部写入点都经它（`AgentTool.ts` 11 处）⇒ 单例持**一个** `bun:sqlite` 连接；而 `bun:sqlite` 的 `run()` 是**同步**的 ⇒ 进程内写入天然串行。
  2. **跨连接也不是"报错"而是"等待"**：[`core/external/sqlite3.ts:159`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/external/sqlite3.ts#L156-L160) 统一 `PRAGMA busy_timeout=10000`（10 秒），且这是**全仓统一封装**（非本 store 特设）⇒ `SQLITE_BUSY` 仅在"等待超 10s"才可能浮出。
  3. **无写放大**：`prune()` 只在 `doInit()` 调用一次（[`AgentRunStore.ts:207`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/AgentTool/AgentRunStore.ts#L207)），**不在写入路径**；单个 run 生命周期写入固定 2–3 次小 upsert（`startRun` / `setDescriptorSource` / `settleRun`）。
  4. **全仓无 `SQLITE_BUSY` 实测证据**（`grep SQLITE_BUSY` **零命中**）⇒ 原设属**推测**，无观测支撑。
- **且"不应做"（除前提不成立外）**：Write-Buffer 会**主动破坏**该 store 头注释⑥声明的语义 —— "批次内**逐任务**落盘…完成即写回 ⇒ **崩溃只丢"未完成的那几个"**，而不是整批状态未知"；中间态延迟落盘会让"这条委派跑到哪了"在崩溃后**失真**，与 §1.6 Write-Ahead 方向相反。按 CS03（不为理论可能性加缓冲/回退）与 §2（不做投机性扩展）⇒ **不引入**。
- **已落地（把原验收判据变成长期守卫，零生产代码改动）**：`tests/tools/AgentTool/agentRunStore.test.ts` 新增 `describe('AgentRunStore：并发写入（P0-2 验收判据）')` **2 例**：
  ① 单连接 **50 路并发** `startRun`/`settleRun` ⇒ 起跑阶段 50 行全在盘、终态齐全（实测 287ms）；
  ② **两个连接**同库并发写 ⇒ 不报 BUSY、50 行齐全（实测 315ms）。
  ⇒ 若将来有人改成多连接 / 去掉 `busy_timeout` / 把 `prune` 挪进写入路径，这两条会**先红**。
- **验收（原方案所写）＋ 实测**：`bun test tests/tools/AgentTool/agentRunStore.test.ts` ⇒ **25 pass / 0 fail**（原 23 例 + 新增 2 例）。

**P0-3 Landlock 拒绝集补强（对照 §1-#4）—— ⚠️ 原"做法"三条均与现状不符；方案已重写，**三项（a/b/c）全部落地**（2026-09-28）**

- **原设（留档）**：把 `/proc`、`/sys`、自身数据目录（`~/.pyapp/data`，含 `app.db`）显式列入**拒绝/只读**，并让 bash 与 CodeRunner 共用同一份配置（"现已共用 `readLandlockConfig`，扩展即可"）。
- **取证结论（四条，均核到行）**：

| # | 原设 | 实测现状 | 差异性质 |
|---|---|---|---|
| 1 | 把 `/proc`、`/sys` **列入拒绝** | **Landlock 无"拒绝规则"这个概念**：[`LandlockPolicyBuilder.build()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/landlock/LandlockPolicyBuilder.ts#L88-L109) 产出 `{ path, allow: [...] }`，是**纯白名单**；未列出的路径**本就 `EACCES`** | **语义错误**（"显式列入拒绝"不是 Landlock 的可用操作，疑从 AppArmor 语义照搬 —— 而本 spec 自己又说"不引入 AppArmor"） |
| 2 | 同上（针对 bash） | bash 策略**已显式"允许只读"`/proc`、`/sys`**（[`bashLandlockExec.ts:100-113`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/bashLandlockExec.ts#L93-L113) 的 `SYSTEM_READ_EXECUTE_PATHS`，含 `/usr /bin /sbin /lib /lib32 /lib64 /etc /opt /proc /sys /run /var`），理由是该文件自己的注释："**漏一个就会让 shell 自身起不来**" | **方向相反**：照原设"拒绝"会**直接打断 bash 正常执行**（正是 `governance-g-group.md` §1.4 担心的"误伤"） |
| 3 | `~/.pyapp/data`（含 `app.db`）列入**拒绝/只读** | bash 策略已有 `{ path: pyappHome, allow: FS_READ_EXECUTE }`（[`:136`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/bashLandlockExec.ts#L130-L151)）⇒ **"只读"已达成**（防的是"改"）；`code_run` 侧 `SandboxConfigBuilder` 白名单**不含** `~/.pyapp` ⇒ **天然全拒** | **"只读"已达成**；但**"可读"未收窄** —— 见下方真缺口 |
| 4 | bash 与 CodeRunner **共用同一份配置** | **不共用**：`CodeRunner` 用 [`SandboxConfigBuilder`](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/SandboxConfigBuilder.ts#L75-L148)（白名单 A：`/usr /lib /lib64 /bin` + cwd），bash 用 `buildBashLandlockPolicy`（白名单 B，**独立一份**，12 条系统路径 + `~/.pyapp` + `/dev` + 受管目录 + 工具缓存）；两者只共用 `readLandlockConfig()` 的**开关** | **前提错误**（"扩展即可"不成立：两份白名单的粒度与风险面不同） |

- **🔴 取证发现的真缺口（这才是 P0-3 应有之义）**：bash 域内 `~/.pyapp` **只读**，而该目录下有 **`config.json`（可能含供应商 API Key 等凭据）** 与 **`data/app.db`（全部会话 / 记忆 / 台账）** ⇒ **在 bash 域内这两者"可读"**。
  · **严重性定位（不夸大）**：`sandbox.landlock.bashEnabled` **默认 `false`**（[`config.ts:60`](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/landlock/config.ts#L56-L61)）⇒ **默认不暴露**，仅在用户显式开启 bash Landlock 后才成为边界问题；
  · **同一项目内的口径不一致（有先例可援）**：`~/.pyapp/config.json` **已被项目认定为敏感文件** —— QQ 通道的出站文件过滤明确 block 它（见 `project_rules.md` / 项目记忆）；而 bash 的 Landlock 白名单**把它连同 `data/` 一起放行只读** ⇒ **同族缺口在另一条路径上遗漏**。
  · **技术约束（决定改法）**：Landlock **无法表达"父允许、子排除"**（规则是路径粒度的 allow）⇒ 要排除 `data/`，只能**不再写 `pyappHome` 整条规则**，改为**逐项枚举**（或整条移除）。
- **重写后的做法（三件；**均已落地**）**：
  - **✅ P0-3-a 已落地（2026-09-28）：整条移除 `{ path: pyappHome, allow: FS_READ_EXECUTE }`** —— 并**否决了"逐项枚举"**这一备选：
    · **取证 1（决定形态）**：实测 `~/.pyapp` 顶层有 **25 个目录 + 6 个文件**，而**敏感的远不止 `config.json` 与 `data/`** —— 还有 `credentials.json`、`credentials/`、`permissions/`、`settings/`、`sessions/`、`memory/`、`knowledge/`、`logs/`、`mcp/`、`snapshots/`、`backups/`… ⇒ **非敏感项几乎为空** ⇒ 逐项枚举**净收益为负**且要长期维护两套清单 ⇒ 整条移除是唯一合理形态。
    · **取证 2（证"无功能损失"）**：`tools/` 下其它 `resolvePyappHome()` 引用（`CuratorScheduler` / `ResumeAgent` / `SkillLifecycleManager` / `ToolCacheManager` / `CanvasTool`）都是**宿主进程直接读写、不经 Landlock**；而 `execBashCommand` 的**唯一调用点**是 [`BashTool.ts:686`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/BashTool.ts#L686)（命令来自用户/模型）⇒ 项目内**无内建 bash 命令**需要读 `~/.pyapp`。
    · **取证 3（排除"漏场景"）**：① 受管产物目录 `output`/`downloads`/`temp` 是 `~/.pyapp` 下的**具体子路径**、**已单独以读写列出** ⇒ 不受影响；② 技能按 `project_rules.md §1.15` **仅提示词注入、禁止 shell 执行** ⇒ 无"读 `skills/` 跑脚本"场景；③ 工具链缓存（`~/.bun`/`~/.npm`/`~/.cache`）与 cwd 已单独放行。
    · **改动面**：[`buildBashLandlockPolicy`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/bashLandlockExec.ts#L115-L149) 删规则 1 行 **+ 删 `pyappHome?: string` 参数**（连同其计算与 `resolvePyappHome` import，避免留死代码）⇒ "不再放行 `~/.pyapp`"成为**结构事实**（无法靠误改一行加回）；同步改写既有断言 [`bashLandlockExec.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tools/bashLandlockExec.test.ts#L128-L133)（原"`~/.pyapp` 只读"⇒"整棵树不放行"），并在守卫测试**新增 1 条加固**（"不得出现 `~/.pyapp` 本身的规则"）。
    · **验收**：`typecheck` **0** · `eslint` **0** · `prettier` ✓ · `lint:arch` **0 错 1 警**（预存 R07-004）· landlock 相关 4 文件 **52 pass / 0 fail**（较上轮 +1）。
    · **未做（如实）**：**Linux 真机端到端未验**（本机 Windows ⇒ 只能离线断言策略形状；"bash 开启后**实际**读不到 `config.json`"这一行为**未实测**）；未重复做变异 A/B（上轮已证"守卫 + 判定链路"可证伪；新增断言的失效路径等价 —— 只要 `policy.fs` 出现该路径即红）。
  - **✅ P0-3-b 已落地（2026-09-28）**：新增 [`tests/sandbox/landlockSensitivePathGuard.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/sandbox/landlockSensitivePathGuard.test.ts) **8 例**（P0-3-a 落地后追加 1 条加固）。断言刻意写成**方向性不变量**（"不得覆盖 / 不得可写"），而非"当前快照" ⇒ **P0-3-a 落地时本文件无需改写**（实测：落地后仍全绿，只在"边界被放宽"时才红）。
    · 覆盖 6 条守卫：code_run 的 6 种策略**经 `LandlockPolicyBuilder.build()` 映射后**不得覆盖 `~/.pyapp/config.json` 与 `data/`；code_run 与 bash **均不得**出现"家目录整体"；bash 侧 `config.json`/`data/` **不得可写**；`~/.pyapp` 下的可写规则**仅限** output/downloads/temp；**控制组**（证明 `~/.pyapp` 过滤确实命中，防空集假绿）；**判定函数自检**（证明守卫非恒真）。
    · **A/B（可证伪，已跑）**：临时把 bash 的 `~/.pyapp` 规则变异为可写 **且** 追加 `~/.pyapp/data` 可写 ⇒ **恰 2 红**，失败信息精确可归属（`可写规则 C:\…\.pyapp 覆盖了敏感路径 …/config.json`、`…\.pyapp\data 不在受管产物目录白名单内`），其余 5 例（含自检与控制组）保持绿；**已还原 + `grep 'A/B 变异'` 确认零残留**。
    · **未做（如实）**：code_run 侧**未做**变异 A/B（其可证伪性由"判定函数自检"间接支撑）。
    · **实施中自查出的、我自己的两处缺陷（均已修，如实记录）**：① 首版 `covers` 用 `/` 拼路径 ⇒ 在 Windows（`resolvePyappHome()` 返回 `C:\…`）下**全部失配 ⇒ 守卫静默失效、空集假绿**（已改为分隔符归一化，并补控制组断言防回归）；② 首版断言的是 `SandboxConfigBuilder` 的**中间权限模型**（`{path, permissions}`）而非**最终下发策略**（`{path, allow}`）⇒ 被 `typecheck` 当场拦下（**6 处 TS2322**），已改为经 `LandlockPolicyBuilder.build()` 取真实产物（顺带覆盖权限映射与 ABI 裁剪）。
  - **✅ P0-3-c 已落地（2026-09-28）**：注释漂移实际只有 **1 处** —— **更正我先前"两处"的说法**：
    ① [`sandbox/landlock/config.ts:37-42`](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/landlock/config.ts#L37-L45) 原以**现在时**称"`enabled` / `failClosed` **没有任何执行路径读取它们**" ⇒ **确属过时**（G1-A2 已让 `LinuxSandboxRunner` 读它）⇒ 已改写为"**历史陈述 + 现状**"两段式，保留可追溯性；
    ② ~~`tools/CodeRunner/LinuxSandboxRunner.ts:19`~~ ⇒ **复核后撤回**：该句原文为"**G1-A2（2026-09-26）修复的"名义契约"**：`enabled` / `failClosed` **此前**无任何消费者（实测…零命中）" —— 陈述的是**修复前的历史事实**，与同文件 `:34`/`:185` 的修复后行为**不矛盾** ⇒ **不是漂移，不改**（我先前的判断有误，如实更正）。
- **明确不做（附理由）**：① **不**把 `/proc`、`/sys` 列入"拒绝" —— 会打断 bash（见上表 #2），且 Landlock 无此操作（#1）；② **不**引入 AppArmor/eBPF（与 §1 纠正段一致，仓内无实现基础）；③ **不**为"统一两份白名单"做重构（两者的风险面不同：bash 要能起 shell，code_run 不需要 ⇒ 强行合并会放宽 code_run 或打断 bash）。
- **验收（重写）**：① **离线用例**：守卫测试锁定"敏感路径不在允许集"（P0-3-b，8 例）；策略形状断言沿用既有 [`bashLandlockExec.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tools/bashLandlockExec.test.ts#L122-L133) 的 3 条（系统路径只读 / `~/.pyapp` **整棵树不放行** / 工作区与受管目录可写）—— 其中第 2 条**已随 P0-3-a 同步改写**（原"只读"⇒"不放行"）；② 常规工作目录操作零回归（离线可证策略形状，**Linux 真机不可证 —— 本机为 Windows**）。
- **未做/未验（如实）**：① **Linux 真机验证仍缺**（`governance-g-group.md` §3 已记同一缺口：本机 Windows ⇒ 全部用例靠注入依赖离线覆盖）—— 故"bash 开启后**实际**读不到 `config.json`/`data/`"这一**行为**未实测，只离线断言了策略形状；② P0-3-a 的取证为**静态**（实测目录结构 + 全仓引用面），**非 Linux 运行时观测**；③ 本轮改动面 = `bashLandlockExec.ts`（删 1 条规则 + 删 1 个参数/import）＋ 注释 1 处（`config.ts`）＋ 2 个测试文件（新建 1 / 改写 1），**无新增能力、无行为开关变更**。

### P1 — 中

**P1-1 对抗 Agent（作弊审查角色）**（对照 §1-#7）—— ✅ 已裁定「形态 C」并落地 **B**（2026-09-28）；**A（LLM 攻击者）另立 spec**

- **原设（留档）**：在评测流水线补第 4 角色 —— 拿到"隐藏验证器 + 用例"后，专职尝试**不改目标代码而让测试通过**（读缓存/编译产物/绕过 allowlist/读自身台账）；产出 `cheatReport`；命中即该题**作废（fail-closed）**。复用既有 `evals/shieldPlan.ts`、`tools/shieldGuard.ts`、`sourceTask` 的桩自检。
- **取证结论（三条，均核到行）**：

  1. **"第 4 角色"在评测流水线里没有对应层**：`evals/` 的数据模型只有 **task → attempt → findings**（[`types.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/types.ts#L176-L262)：`EvalTask` / `EvalAttempt` / `ProcessFinding` / `ToolCallDetail`），**不存在"角色 / Agent"实体**。⇒ 照原设做，真正要落的是"**一个相位 + 一个产物**（`cheatReport`）"。
     · 仓内确有 `roles: ['generator','adversarial-reviewer','aggregator']`（[`core/patterns/PatternRegistry.ts:43`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternRegistry.ts#L38-L46)），但那是**产品内的描述层**（该文件头注释明写"消费方仅记录/展示，执行仍由既有模块承担"）⇒ 与评测流水线**不同域，不可直接移植**。

  2. **现有机械判据已覆盖大部分"作弊面"（被动检测）** ⇒ P1-1 的增量**不是"挡作弊"（已有）**，而是"**自测判据是否真挡得住**"（红队 / 对抗性验证）：
     | 已有机制 | 挡什么 |
     |---|---|
     | [`pathShield`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/pathShield.ts) + [`shieldGuard`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/shieldGuard.ts#L57-L79) | 工具参数引用屏蔽路径 ⇒ **fail-closed 拒绝、工具不执行**；**两处执行收口各调一次**（Agent 路径 + HTTP/CoreAPI 路径）；含**四种写法比较针** |
     | [`processAssertions`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/processAssertions.ts#L31-L36) **P-c** | 从落盘 trace **离线判定**"是否**尝试**访问被屏蔽路径" ⇒ **作弊企图的正面证据**（此前只知道"工具层会拒"） |
     | [`repoPatchSnapshot`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/repoSnapshot.ts) / [`repoTestJudge`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/repoTestJudge.ts) | **判据不可篡改**（跑测试前**重放**该提交的测试文件）+ 三态判据（`green` / `red` / `unrunnable`） |
     | [`fixTaskScreening`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/fixTaskScreening.ts) | 起始态必须**真红**、修复态必须**绿**，否则拒收（fail-closed） |
     | 既有用例 | `toolRegistryPathShield.test.ts` 断言"工具**未被执行**"（`calls===0`）；`fixTaskMaterialize` 的离线反作弊（测试改恒通过 + 源码不改 ⇒ 仍判失败） |

  3. **顺带发现一个具体、可验证的攻击向量（预存缺口，已另登记 D-5）**：评测沙箱的 `LIRI_HOME` / `LIRI_DATA_DIR` 建在 [`mkdtempSync(join(tmpdir(), 'liri-eval-'))`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/sandbox.ts#L199-L201) ⇒ **Linux 上即 `/tmp/liri-eval-*/`**，而 `home/` 下有**从真实配置复制的 `config.json` 与 `credentials.json`**（[`:212`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/sandbox.ts#L212) / [`:227-231`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/sandbox.ts#L227-L231)）；而 bash 的 Landlock 白名单**放行 `/tmp` 可写**（[`bashLandlockExec.ts:157`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/bashLandlockExec.ts#L143-L160)）⇒ **沙箱内 bash 可读（乃至跨 attempt 读）其它沙箱的凭据副本**。严重性定位同 P0-3：`bashEnabled` **默认 `false`** ⇒ **默认不暴露**。
     · 说明：这不是 P0-3 的遗漏（P0-3 修的是真实 `~/.pyapp`），而是**评测隔离**面的另一个路径 ⇒ 正好属 P1-1 题域（原设明列"读自身台账"）。

- **三个候选形态（待裁定）**：

  | 形态 | 内容 | 成本 | 覆盖 | 可当门禁 |
  |---|---|---|---|---|
  | **A 按原设（LLM 攻击者）** | 新增 LLM 驱动的"作弊者"角色：生成"不改源码而让判据通过"的方案并实测 | **需模型额度**（每次评测 +N 次调用）× 结果不确定 | 能发现**未知**漏洞 | ❌ 非确定 |
  | **B 机械攻击集（推荐）** | 把已知作弊手法做成**固定向量集**（读题源 / 读报告 / 改判据 / 换执行入口 / 父目录批量读 / 读沙箱凭据…），逐条实测"是否被挡"，产出 `cheatReport`；**任一未挡 ⇒ 该题作废（fail-closed）** | **零模型**、可离线、确定 | 只覆盖**已知**手法 | ✅ |
  | **C = B 先落地 + A 另立 spec** | 当次交付 B；A 作为可选增量（需额度与新 spec） | 小 | 先已知、后未知 | ✅（B 部分） |

- **我的建议：C** —— 先落 **B**（确定性、可门禁、零额度），并把上面第 3 条的向量纳入攻击集；**A** 待额度有明确安排时另立 spec（避免"为了像论文而引入不确定的 LLM 角色"）。
- **✅ 形态已裁定（2026-09-28，用户选 C）**：先落**机械攻击集**；**LLM 攻击者（形态 A）另立 spec**。
- **✅ 形态 B 已落地（2026-09-28）**：新增 [`evals/antiCheatAudit.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/antiCheatAudit.ts)（**5 条向量**）+ [`tests/evals/antiCheatAudit.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/evals/antiCheatAudit.test.ts)（**8 例**）+ [`cli.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/cli.ts) 接线（运行期**只打印一次** + 可选 `--cheat-gate`）。
  - **❗落地前置的事实（决定它的定位，必须如实读）**：实施取证的结论是 —— **未找到"未覆盖且可机械判定"的 must-block 缺口**：主要作弊面**已被既有机械防线覆盖**（见上方第 2 条的表），`cli.ts` 也已把**报告目录**并入屏蔽（`shieldTargets = [...declaredShieldedPaths, outDir]`），剩余全部是**已登记**的已知边界。
    ⇒ 故该模块**不是"发现新漏洞的扫描器"**，而是三件事：① **配置一致性**（C-1 报告目录是否在屏蔽清单内、C-2 声明＝生效 —— 后者**复用 `verifyShieldApplied`**，不另写一份比较逻辑）；② **已知边界显性化**（C-3 沙箱根落 `/tmp` / C-4 bash 无内核约束 / C-5 祖先目录批量读 —— **每次运行打印**，防"以为已经安全了"）；③ **挂载点**（`CheatFinding` 契约，未来新增防线可登记为一条 must-block 向量）。
  - **三态语义（不是二态"挡/没挡"）**：`blocked` / `exposed`（**必挡未挡** ⇒ `--cheat-gate` 下**拒绝运行**，fail-closed）/ `knownGap`（**已登记的已知缺口，刻意不参与 fail-closed** —— 否则 D-5 会让**所有题立即全废**）。
  - **默认仅观测**（与 A2 / A5 / S2 同取向：先取干净基线，再议门禁化；`--cheat-gate` 已就位）。
  - **验收**：`typecheck` **0** · `eslint` **0** · `prettier` ✓ · `tests/evals` **132 pass / 0 fail**（含新增 8 例）。
- **未做（如实）**：① **形态 A（LLM 攻击者）未做** —— 需模型额度 + 新 spec（用户已裁定另立）；② **未在真实评测里跑过 `--cheat-gate`**（需额度）；③ `EvalAttempt` / 报告**未加** `cheatReport` 字段（本轮为**最小接线**：仅运行期打印；数据模型变更与门禁化同批再议）；④ 向量集**只覆盖已知手法**（这是形态 B 的定义，**不是**缺陷）。

**P1-2 Token burst 悲观预扣**（对照 §1-#8，可选）—— ❌ **取证后：前提证伪 + 处方有反作用 ⇒ 不实施**（2026-09-28）

- **原设（留档）**：在真实 `usage` 回传前的窗口期内，按**上一轮真实值**预扣；回传后多退少补（与现有对称记账对齐，勿引入第三套口径）。验收：单测覆盖"预扣 → 回传更小 → 退款"；不得让"无 usage"场景退回到估算。
- **取证结论（四条，均核到行）**：

  1. **现有账务语义 = "账上恒为上一轮的完整真实占用"**：[`createStreamBudget.chargeContextEstimate`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L97-L112) 是**对称记账**（增长 `consumeTokens`、回落 `releaseTokens`），使 `spent` **恒等于当前上下文占用**（而非历史累计）；[`TAORLoop._observeRound`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L1392-L1404) 同口径。
  2. **判定时机 ⇒ "窗口期"不构成漏记**：预算判定（`budget.canExecute()`）在骨架**每轮 reason 前**（[`ReActLoop.run`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/ReActLoop.ts#L733-L750)），而记账在**同一轮响应回来后** ⇒ 时序恒为「**记账(轮 N-1) → 判定 → 请求 → 响应 → 记账(轮 N)**」⇒ 判定时账上**总是**上一轮的**完整**真实值，**不存在"在飞未记账"被漏掉的判定点**。
  3. **预算不跨 loop 共享 ⇒ 并发面亦不存在**：[`createStreamBudget`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L72-L114) 每次调用 **new 一个** `TokenBudgetController`（[`:79-87`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L79-L87)），且只注入到该 loop 的 `config.budget`（[`:142-145`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/createAgentLoop.ts#L142-L145)）⇒ 并发子代理**各持独立预算**。
  4. **❗处方本身有反作用（关键）**：
     · "按**上一轮真实值**预扣" —— 该值**已经记在账上**（`_lastBudgetedTokens` / `lastEstimate` 已置为它）⇒ 照做即**重复记账、`spent` 翻倍** ⇒ **必然误杀长任务**（正是 2026-09-26 刚修掉的那个病）。
     · 若要"预扣**未来**增量" ⇒ 只能**估算**，而 2026-09-26 的根因修复已明确决定「**不引入任何估算**，无真实值则**不记账**（fail-open）」，依据是实测估算偏 **6.4×**（真实 `prompt_tokens` 29,143 vs 记账 185,195）—— 见 [`_chargeStreamBudget` 注释](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L3369-L3403) 与 [`_observeRound` 注释](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L1378-L1392) ⇒ 预扣会**原样复现误杀**。

- **结论：不实施** —— CS03（不为理论可能性加机制）+ CS05（该处的根因**已由 2026-09-26 的修复覆盖**）。该 spec 自己标"**可选**"是准确的。
- **若将来确实担心"单轮增量"顶穿窗口**：唯一**安全**方向**不是"预扣"**（那必然要估算），而是**给单轮增量留余量**（把硬停阈值与 compaction 触发线一并下调）。
  ⚠️ 但**前提是先有"单轮增量分布"的实测数据** —— 当前**无**该数据 ⇒ **不得臆造阈值**（CS04 / CS06）。

**P1-3 热窗口阈值口径统一**（对照 §1-#9）—— **a / b / c / d 全部落地**（2026-09-28）

- **原设（留档）**：把"事件数 / token 数"两类阈值写成显式配置并登记台账，消除 compaction 与 unified 的隐性分歧。
- **取证结论 ①：已做（比原设预期更多）**

  | 项 | 现状 | 证据 |
  |---|---|---|
  | 比例阈值**单一源** | `UNIFIED_THRESHOLDS`（0.5 / 0.7 / 0.75 / 0.85 / 0.92）**一处定义**，多处**引用而非复制** | [`TokenBudgetController.ts:51-57`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/tokenBudget/TokenBudgetController.ts#L50-L57)、[`UnifiedTokenTracker.ts:81-88`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/tokenBudget/UnifiedTokenTracker.ts#L75-L88)、[`BudgetPolicy.ts:230-232`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/tokenBudget/BudgetPolicy.ts#L218-L243)（注释明写"阈值**引用** `UNIFIED_THRESHOLDS`，不复制数值"） |
  | **策略层登记** | **已实施**（`budget-policy-layer.md` §6.5，2026-09-25）：`context.compression-levels` / `goal.limit` / `subagent.summary-chars` 已登记为策略 | 该 spec §6.5 |
  | **窗口来源同源** | 两条路径**都读 `ModelRegistry`（DB `model_registry.context_window`）** | [`resolveContextWindow:96-101`](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/window/ContextWindowResolver.ts#L87-L110)（注释"代码**不**维护硬编码模型名表"）、[`ModelManager.getModelContextWindow:155-158`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/models/ModelManager.ts#L155-L163) |

- **取证结论 ②：真实剩余分歧（3 处，均核到行）**

  | # | 分歧 | 证据 | 影响面 | 风险 |
  |---|---|---|---|---|
  | **a** | **死代码 + 违规模式残留**：`CONTEXT_WINDOW_MAP: Record<string, number> = {}` **恒空**（"按模型名建表"模式，与 `model-usage.md` 明令冲突） | [`services/compact/utils.ts:36,42`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L36-L46) | **零**（`\|\|` 短路到下一级，从不生效） | **零** |
  | **b** | **兜底窗口值不一致**：同一"未注册模型"在 `services/compact` 得 **100000**，而 `resolveContextWindow` 得 **200_000**（`ModelManager` 亦 200000） | [`utils.ts:44`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L40-L46) vs [`ContextWindowResolver.ts:20,109`](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/window/ContextWindowResolver.ts#L19-L23) | 仅"未注册模型"的兜底路径；消费方 `AutoCompactService`（**活的**） | 低 |
  | **c** | **阈值口径两套**：`services/compact/` 用**绝对 buffer**（`AUTO_COMPACT=13000` / `WARNING=20000` / `MANUAL=3000`）；`context/compaction/` + `UNIFIED_THRESHOLDS` 用**比例** | [`utils.ts:29-33,60-82`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L29-L82) vs `UNIFIED_THRESHOLDS` | `AutoCompactService`（[`:51-53`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/AutoCompactService.ts#L51-L53) 消费 `calculateTokenWarningState` / `getAutoCompactThreshold`） | **中-高**（改口径＝**改压缩触发时机**） |

- **⚠️ 另一处待核（**不在** P1-3 原范围，如实标注）**：`services/compact/`（**23 个文件**）与 `context/compaction/` **两套压缩并存**，且命名几乎一一对应（`CompactOrchestrator` vs `CompactionOrchestrator`、`microCompact` vs `MicroCompactionEngine`、`SnipCompactStrategy` vs `SnipEngine`），**两者都有活消费者**（前者：`ChatManager:327`、`ContextCompactor:33`、`ContextCollapse:9`、`ReactiveCompact:12`、`session/compaction/ServiceAdapters:1`；后者：`@modules/context` 的 `compactionOrchestrator`）。**是否构成双轨（应下线一套）未定** ⇒ 需更大范围调用链取证，且与 `architecture.md` 的"实现唯一性"相关 ⇒ **建议单独立项**，不并入 P1-3。

- **取证结论 ③：分层方案（按风险排序）**

  | 项 | 内容 | 风险 | 建议 |
  |---|---|---|---|
  | **P1-3-a** | 删 `CONTEXT_WINDOW_MAP` 空表（死代码 + 违规模式残留） | **零** | 可立即做 |
  | **P1-3-b** | `services/compact/utils.ts` 的窗口解析**改用 `resolveContextWindow`**（消除 100000/200000 兜底分歧；顺带免去 `ModelManager` 的静态表回退） | 低（仅影响未注册模型的兜底；`AutoCompactService` 的触发线会随之变化） | 可做，但须在 spec 写明行为变化 |
  | **P1-3-c** | 把**绝对 buffer 口径统一为比例**（引用 `UNIFIED_THRESHOLDS`） | **中-高**（**改变压缩触发时机**） | **需裁定** |
  | **P1-3-d** | 把 ② 的 3 处分歧**登记台账**（原设明写"登记台账"） | 零 | 可立即做 |

- **✅ 实施记录（2026-09-28，用户裁定 a+b+c+d）**

  | 项 | 状态 | 说明 |
  |---|---|---|
  | **a** 删 `CONTEXT_WINDOW_MAP` 空表 | ✅ 已删 | 死表 + "按模型名建表"违规模式残留，一并消除 |
  | **b** 窗口解析改用 `resolveContextWindow` | ✅ 已改 | [`utils.ts:40-55`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L40-L55)：**消除 100000 兜底分歧**（统一为 DB → 1M 启发式 → `200_000`），并**去掉了 `ModelManager` 的静态表回退**（该回退与 `model-usage.md`"DB 唯一事实源"相悖）。**行为变化（已写进代码注释）**：未注册模型兜底 100000 → 200000 ⇒ 该类模型自动压缩**触发更晚** |
  | **c** 把绝对 buffer 口径**统一为比例** | ✅ 已改 | [`utils.ts:33-115`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L33-L115)：删 `AUTO_COMPACT`/`WARNING`/`ERROR` 三个**绝对 buffer** 常量，阈值改为**以有效窗口为基准的比例** —— 自动压缩 `COMPACT_DEEP`(0.85) / 警告 `WARNING`(0.75) / 错误 `CRITICAL`(0.92)；`getWarningThreshold` / `getErrorThreshold` **签名改为接收有效窗口**，顺带**修掉 D-6-d 的反向算式**；`getBlockingLimit` **有意不比例化**（它是"手动压缩硬上限"、语义为预留**绝对**空间，不属压缩档范畴，理由已写入注释）。同步删除 `index.ts` 的三项桶导出 |
  | **c 的行为变化（如实）** | —— | 以 200k 窗口 / 输出预留 20k（有效窗口 180k）为例：自动压缩 167000 → **153000**（**早 14000**）、警告 160000 → **135000**（早 25000）、错误 160000 → **165600**（晚 5600，且**不再与警告同级**） |
  | **d** 3 处分歧登记台账 | ✅ 已登记 | `预存错误与待处理问题.md` **D-6** |

- **c 的取舍记录（如实）**：我曾在实施前**提出异议** ——"绝对 buffer → 比例"会改变语义，且在小窗口上更危险（`1M` 窗口下比例会**早压 117000**；`128k` 窗口下会**晚压 13800**），并建议改用"把绝对 buffer 登记为 `BudgetPolicy` 策略"（保数值与语义）。**用户复核后明确裁定仍按原意统一比例** ⇒ 已照办，行为变化已在上表逐项列明。
  · **配套观察点（未做，如实）**：`AutoCompactService` 的触发线整体前移（200k 窗口下早 14000）⇒ 建议**下次真实长任务里观察是否出现过早压缩**；若确认过早，可下调映射档（如自动压缩改用 `WARNING`(0.75) 而非 `COMPACT_DEEP`(0.85)）。
  · 原异议中"与两套压缩核查**强耦合**"的判断**仍然成立**：若核查结论为"下线 `services/compact/`"，本次改动会随之作废 —— **该风险已由用户知悉并接受**。

- **✅ 立项（2026-09-28，用户裁定）**：新建 [`compaction-duplicate-subsystems.md`](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/compaction-duplicate-subsystems.md) —— 核查 `services/compact/`（23 文件）与 `context/compaction/` 的调用链、职责边界、是否下线一套（与 `architecture.md` 实现唯一性相关）。

- **✅ 顺带修掉（原为死代码里的算式错误）**：[`getWarningThreshold`](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/compact/utils.ts#L98-L112) 原算式为 `autoCompactThreshold - (13000 - 20000)` = `autoCompact + 7000` ⇒ **warning 反而晚于 autoCompact**（方向反了）。**已随 c 一并修正** —— 该函数签名改为接收**有效窗口**，算式改为**比例乘法**（`effective × WARNING`）；同文件 `calculateTokenWarningState` 也改为**复用**这两个比例函数（原为内联的绝对 buffer 减法）。

- **验收（本轮）**：`typecheck` **0** · `eslint`（改动文件）**0** · `prettier` ✓ · `lint:arch` **0 错 1 警**（预存 R07-004）· 受影响 4 个 compact 测试文件 **21 pass / 0 fail**。
  依赖方向如实说明：**b** 引入 `@modules/context`（`service → app`，与改动前的 `@modules/ai` **同层** ⇒ 不新增依赖方向；`lint:arch` 豁免数 395 → 396 即此一处被既有 `R00-001` 例外覆盖）；**c** 引入 `@modules/core/tokenBudget`（`service → core`，**允许方向**）。⇒ **未新增违规**。

### P2 — 重，需先出 spec

**P2-1 沙箱层复用（`pack_diff` 类能力）**（对照 §1-#10）—— ⛔ **阻塞（前提经取证证伪，2026-09-29）**。跨 `sandbox` / `evals` / 工具面 ⇒ 按规范**先 spec 后编码**；spec 已立项：[`sandbox-freeze-reuse.md`](./sandbox-freeze-reuse.md)。**但其前提不成立**：依赖的 `SandboxPruner` 全仓**零消费者**，且项目**没有活的实例级沙箱生命周期**（`SandboxPruner` / `ToolSandboxRouter` / `SandboxManagerImpl` 三者均未接线）⇒ "冻结/复用"**既无触发点也无可复用载体**。完整取证见台账 **D-16**。⇒ 与"明确不做"同理，**当前不具备实施条件**。
**P2-2 MCP 动态工具映射**（对照 §1-#4 的引申）—— ✅ **已实施（2026-09-29，用户批准）**：[`pathguard-registry-driven-args.md`](./pathguard-registry-driven-args.md)。取证结论（两条，均附行号）：① **`pathShield` 无需改动** —— 它的 `findShieldedHit()` 把整个入参 `JSON.stringify` 后做子串匹配、**完全不看工具名** ⇒ 天然覆盖 MCP 动态工具；② **真缺口在 `PathGuard`** —— 它按 `READ_FILE_TOOL_NAMES`/`SEARCH_TOOL_NAMES`/`WRITE_TOOL_NAMES` **三份静态名单**判"哪个入参是路径"，名单外工具（含 `mcp__<server>__<tool>`）`_extractPath()` 返回 `null` ⇒ `checkToolCall()` **直接放行（fail-OPEN）**。⚠️ 故原方案"避免误拦合法外部工具"的表述**与实测方向相反**（现状是**漏拦**；"误拦"是**改法自身**要防的风险，已在 spec §3.2 设反例守卫）。
**落地形态**：`PathGuard` 加**可选注入** `resolvePathArgKeys`（端口注入，避免 `query→tools` 新依赖）＋ 新增注册表派生解析器 `ToolRegistry.resolveToolParamNames()` ＋ `PATH_ARG_KEYS` 求交收窄；两个调用方 [`ReActToolLoop`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L319-L321) / [`TAORLoop`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TAORLoop.ts#L500-L502) 已注入。**验收**：新增 8 例守卫全过 · `tests/query` 回归 **119 pass / 0 fail** · `typecheck` 0 · `lint:arch` 0 错 1 警（预存 R07-004）· eslint/prettier 干净。

---

## 3. 明确不做

| 外部建议 | 不做的理由 |
|---|---|
| 引入 eBPF / AppArmor 网络白名单 | 本仓无实现基础（grep 无命中）；现有 Landlock 已覆盖路径级隔离，新增 LSM 栈属**架构级**决策，须另立 spec 并给收益证据 |
| EROFS / 分布式存储按需拉取 | 与本仓部署形态（本地/桌面为主）不匹配，收益未证 |
| 新建 `CONTEXT_LAYERING` 开关 / "kswapd L0-L2" 命名 | 与既有 `context/compaction`、`monitoring/memoryPressure` **重复造概念**（违反归一化原则），会造出第二配置面 |
| 按外部说法"五层安全防护已具备 eBPF" | 与代码不符，**不得**据此对外声称能力 |

---

## 4. 与当前发版的关系

- v0.4.51 的 tag 流程**不受本方案影响**（门禁：CI 全绿后再打 tag；当前 `Lint & Test` / `Static Checks` 的修复已提交，等 CI 判定）。
- P0 三项互不依赖，可各自小步提交；建议 **tag 之后**再开工，避免把新改动混进本次发版窗口。

---

## 5. 附：本方案的自我约束（供评审）

1. 每条结论都给了**文件/行**坐标；无坐标的条目一律放入"需纠正/不做"。
2. 区分了「**已做**」「**部分已做**」「**缺口成立**」三种状态，未把"已做"包装成"待优化"。
3. 未给出时间估算（按仓库约定，只给顺序与验收标准）。
