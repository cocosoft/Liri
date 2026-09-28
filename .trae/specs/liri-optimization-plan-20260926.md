# Liri 优化方案（2026-09-26）

> 来源材料：`E:\PY\Desktop\google ai  建议.txt`（Google AI 对话串：工作台截图分析 + 多 Agent 协作拆解 +
> CodeMidas `arXiv:2609.22068v1` / DSec `arXiv:2609.22978v1` 的联想）。
>
> **本文的写法**：外部建议**逐条在本仓核验**（grep / 读码），只保留"缺口在本仓成立"的项；
> 与代码不符的说法**如实纠正**（依据 `.trae/rules/PY_APP.md §5 基于证据的分析`、`coding-standards.md CS04/CS06`）。
> 每条给出**证据坐标**与**验收标准**，不写"看起来对但无从验证"的内容。

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

**P0-1 Mermaid 生成自纠错（对照 §1-#3）**
- 现状：坏语法只在浏览器端 `Syntax error in text mermaid version 11.15.0` 暴露，后端无拦截。
- 做法（两步，先做 ①）：① **前端降级**：`MarkdownRenderer` 捕获 mermaid `parseError`，失败时**降级为代码块**并显示"图表语法错误（已保留源码）"，杜绝红字刷屏；② **服务端校验 + 回喂**：在图表类工具输出落盘前做语法校验，失败则以错误日志为输入回喂同一子代理重试（≤N 次），并落一条事件（对齐 §1.6「模型可见 ⇔ 已落盘」）。
- 验收：注入坏语法 ⇒ UI 无红色报错（降级为代码块）；后端日志出现自纠错重试记录；正常图表零回归。
- 风险：服务端校验需一个 mermaid 解析器（node/wasm），**先做前端降级即可止血**。

**P0-2 Agent 台账写入合并（对照 §1-#2）**
- 现状：多子代理并发写 `AgentRunStore`（SQLite，WAL 已开）仍可能 `SQLITE_BUSY`/写放大。
- 做法：内存 Write-Buffer + 定时/阈值 flush（如 200ms 或 N 条）。
  ⚠️ **红线**：必须遵守 §1.6 Write-Ahead 规范 —— **终态（completed/failed/cancel_requested）即时落盘，不得进缓冲**；只有中间进度可批量化。
- 验收：并发 50 子代理写入无 BUSY 报错；单测断言"终态即时落盘"与"中间态合并落盘"。

**P0-3 Landlock 拒绝集补强（对照 §1-#4）**
- 做法：在 `sandbox/landlock` 的规则集中，把 `/proc`、`/sys`、自身数据目录（`~/.pyapp/data`，含 `app.db`）显式列入**拒绝/只读**，并让 bash 与 CodeRunner 共用同一份配置（现已共用 `readLandlockConfig`，扩展即可）。
- 验收：bash 执行 `grep -r /proc` / 读 `app.db` 被拒且错误可读；常规工作目录操作零回归。
- 说明：**用 Landlock 扩展，不引入 AppArmor/eBPF**（后者无实现基础，见 §1 纠正段）。

### P1 — 中

**P1-1 对抗 Agent（作弊审查角色）**（对照 §1-#7）
- 在评测流水线补第 4 角色：拿到"隐藏验证器 + 用例"后，专职尝试**不改目标代码而让测试通过**（读缓存/编译产物/绕过 allowlist/读自身台账）。产出 `cheatReport`；命中即该题**作废（fail-closed）**。
- 复用既有：`evals/shieldPlan.ts`、`tools/shieldGuard.ts`、`sourceTask` 的桩自检。

**P1-2 Token burst 悲观预扣**（对照 §1-#8，可选）
- 在真实 `usage` 回传前的窗口期内，按**上一轮真实值**预扣；回传后多退少补（与现有对称记账对齐，勿引入第三套口径）。
- 验收：单测覆盖"预扣 → 回传更小 → 退款"路径；不得让"无 usage"场景退回到估算（该路径已明确 fail-open）。

**P1-3 热窗口阈值口径统一**（对照 §1-#9）
- 把"事件数 / token 数"两类阈值写成显式配置并登记台账，消除 compaction 与 unified 的隐性分歧。

### P2 — 重，需先出 spec

**P2-1 沙箱层复用（`pack_diff` 类能力）**（对照 §1-#10）——跨 `sandbox` / `evals` / 工具面 ⇒ 按规范**先 spec 后编码**。
**P2-2 MCP 动态工具映射**（对照 §1-#4 的引申）——让 `pathShield` / `PathGuard` 读**运行时注册表**（含外部 MCP 动态注入工具），而非静态清单，避免误拦合法外部工具。

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
