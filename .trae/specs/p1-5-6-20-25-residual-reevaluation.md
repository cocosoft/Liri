# Spec：§2.2 P1 真剩余 4 项复评（P1-5 / P1-6 / P1-20 / P1-25）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：✅ **已复评 —— 2 项收口 · 1 项维持阻塞 · 1 项维持（含 1 子项不立项）；零代码**
> 来源：台账 **§2.2 P1** 的「真剩余 4 项」（§0/§23 汇总口径：「均环境/观察：P1-5/P1-6 真机 · P1-20 Docker/SSH · P1-25 可选」）
> 手法：与 `p2-9-multi-agent-items-assessment.md`（批 F）/ `p2-6-p2-4-residual-closure.md`（批 H）同 —— **回仓取证 + 终局裁定 + 触发条件**，零代码
> 关联规则：GR15 · **CS01** · **CS03** · **CS06** · `.trae/rules/development-workflow.md §2.14 规则 5`（搁置须附触发条件）

---

## 0. 一句话

四项中 **P1-6 与 P1-20 可收口**（前者的"超限分支真机观察"已由 **B-6** 完成 + 本轮复核真实库规模；后者因 **Docker 已可用**，其"真实容器 e2e"已在本会话**实测**，余下 SSH 半 + 一个 by-design 项）；**P1-5 维持阻塞**（无真实 QQ 环境）；**P1-25 维持**（A8/B8 可选未复核；B7 复核成立但**与 M-10 同族、不立项**）。**净新增可执行项 = 0。**

---

## 1. 逐项复评（2026-10-07）

### 1.1 P1-5 `qq-file-transfer` —— ❌ **维持阻塞**

| 项 | 内容 |
|---|---|
| 真剩余（台账） | **⑤ QQ 真机端到端实测**（需真实环境）；步骤 1–4 已实现 |
| 本轮复评 | `~/.pyapp/config.json` **无 `channels` 节点** ⇒ **未启用任何通道**；无 QQ 开放平台凭据/真实 bot 可达 ⇒ 与 §10.4-**B-2**（真实通道数据）**同源同阻塞** |
| 裁定 | **维持阻塞**（不排期） |
| 触发条件 | 具备**真实 QQ bot（AppID/Secret 已获批 intents）+ 至少一条真实收发记录**时，按 spec 步骤 5 做 e2e |

### 1.2 P1-6 `memory-dedup-blocking-rootfix` —— ✅ **可收口**

| 项 | 内容 |
|---|---|
| 真剩余（台账） | **超限分支真机观察** + **DB 规模复核**（观察项，非代码） |
| ① 超限分支 | ✅ **已由 B-6 完成（本会话）**：隔离库 **1001** 条实测触发 `记忆库超限：将归档 1 条（dry-run，未移动文件）`（`{totalMemories:1001, limit:1000}`），并断言 dry-run 不动文件；**新用例** `app/tests/memory/memoryRetentionIntegration.test.ts`（见 `memory-dedup-blocking-rootfix.md` §D5-B） |
| ② DB 规模复核（**本轮实测**） | `~/.pyapp/data/memory` = **724 个 `.md`**（`global/` **723**）+ **2,517.4 KB**（≈2.5 MB）；`.trash` **不存在** ⇒ **真实库（724 < 上限 1000）仍未触发超限**，与 B-6「真实库未被改动」一致。对照 spec 记载（644 条 / 1,871 KB）⇒ **+80 条 / +646 KB** |
| 裁定 | **收口**（两项均已完成/复核）；**维持 `MEMORY_RETENTION_DRY_RUN = true`**（真实库未超限，无需真归档） |
| 触发条件 | 真实库规模 **>1000** 时才需复核"是否翻 `MEMORY_RETENTION_DRY_RUN=false`"（届时须显式裁定） |

### 1.3 P1-20 `sandbox-b-group` —— ✅ **收口（余 SSH 半 + 1 项 by-design）**

| 台账所列"真剩余" | 本轮复评 |
|---|---|
| **B2 威胁模型 e2e** | ✅ **已实测**（本会话，真实容器）：`docker inspect` ⇒ **`CapAdd=[]`** / `NetworkMode=none` / `ReadonlyRootfs=true`；容器内 `iptables -F` ⇒ `not found`(rc=127) ⇒ 无清空手段 |
| **B3-a 真实并发验收** | ✅ **已实测**：真实 `pullImage(alpine)` **47.1 s** 期间 50 ms 定时器 **924 ticks / maxGap 53 ms** ⇒ 事件循环未阻塞 |
| **B4 真实退出码 e2e** | ✅ **已实测**：`exit 7` ⇒ `success=false, exitCode=7`；`exit 0` ⇒ `success=true, exitCode=0, stdout="hello"` |
| **真实容器 e2e** | ✅ 同上（容器 `initialize`/`close` 实测成功） |
| **SSH 边界单测 / 远端 e2e** | ❌ **仍阻塞** —— 本机有客户端（`OpenSSH_for_Windows_9.5p2`）但**无远端目标** |
| **宿主侧执行器**（egress 端口白名单） | ➖ **by-design 不做** —— `sandbox/docker/NetworkPolicyEngine.ts:16/39/66` 明记：本仓**不实现**宿主侧执行器，端口白名单进 `unenforcedInThisRepo`，并把网络模式 **fail-closed 收窄为 `none`**（宁可全禁，不假装已受限） |

**裁定**：**收口**（Docker 侧全数已实测；余 SSH 半为环境阻塞、宿主侧执行器为 by-design）。
**触发条件**：① 有远端 SSH 目标时补 SSH 边界 e2e；② 出现**多租户/公网暴露**需求时，才评估实现宿主侧执行器（届时移除 fail-closed 收窄）。
> 详细记录见 `.trae/specs/sandbox-b-group.md` §4.5（含 2026-10-07 条件复评 + e2e 实测表）。

### 1.4 P1-25 `Liri优化方案-20260925` 剩余 —— ⬜ **维持（A8/B8 可选 · B7 复核成立但不立项）**

| 子项 | 本轮复评 | 裁定 |
|---|---|---|
| **A8** 报告可视化（**可选**） | 未复核（台账原结论保持） | **不排期**（可选；触发条件 = 产品提出报告可视化诉求） |
| **B7** 沙箱**层级化配额与委派** | ✅ **复核成立（本轮实测）**：`app/src/sandbox/ResourceLimitManager.ts` 的键**仅 `pluginId`**（`:31/51/76/86/92/101/122`；`limits`/`activeContexts`/`usageSnapshots` 三张 Map 均以 `pluginId` 为键），**无层级/父子维度** | **不立项** —— 与 **P2-9-A（M-10 容量语义）同族**（层级化配额 = 容量语义 + 委派）；现无多租户/无层级委派诉求，且**会话级**准入/抢占/排队已由 `resourceGovernor` 覆盖（`cross-session-resource-governor.md`）。触发条件 = 出现"**子代理/插件继承父配额**"的真实需求 |
| **B8** 沙箱 QoS 执行侧投影（**可选**） | 未复核（原结论保持） | **不排期**（可选） |

> **注**：B5 S1–S4 已于 2026-09-29 **整篇下线**，非待办（台账已记）。

---

## 2. 净结果

| # | 复评结论 |
|:--:|---|
| P1-5 | ❌ **维持阻塞**（无真实 QQ 环境；与 B-2 同源） |
| P1-6 | ✅ **收口**（超限分支已由 B-6 实测；真实库规模本轮复核 **724 / 2.5 MB**，未超限） |
| P1-20 | ✅ **收口**（Docker 侧 B2/B3-a/B4 + 真实容器 e2e **已实测**；余 SSH 半 + 宿主侧执行器 by-design） |
| P1-25 | ⬜ **维持**（A8/B8 可选不排期；B7 复核成立但**与 M-10 同族、不立项**） |

⇒ **净新增可执行项 = 0**；§2.2 P1 的"真剩余 4 项"**全部处置完毕**（2 收口 / 1 阻塞 / 1 维持），余项**均附触发条件**。

---

## 3. 合规

| 规则 | 落点 |
|---|---|
| **CS01 归一化** | ✅ B7 判"与 M-10/`resourceGovernor` 同族"，不重复立项 |
| **CS03 回退最小化** | ✅ 四项均不加机制；宿主侧执行器明确 by-design 不收窄 |
| **CS06 证据驱动** | ✅ 真实库规模 / `ResourceLimitManager` 键 / `NetworkPolicyEngine` 注释 **均本轮实测或原文取证** |
| R12-1 §2.14 规则 5 | ✅ 每项附**触发条件**（不写"无消费者"了事） |
| GR15 | ➖ 评估类文档（零代码）⇒ 不触发实施面 |

---

## 4. 实施记录（2026-10-07 · 零代码）

| 项 | 结果 |
|---|---|
| 取证 | P1-5：`config.json` 无 `channels`；P1-6：`~/.pyapp/data/memory` 实测 **724 md / 2517.4 KB / 无 `.trash`** + B-6 新用例；P1-20：`sandbox/docker/NetworkPolicyEngine.ts` + `sandbox-b-group.md` §4.5 本会话 e2e；P1-25：`app/src/sandbox/ResourceLimitManager.ts` 键集 |
| 代码改动 | **0** |
| 台账回填 | §2.2 P1-5 / P1-6 / P1-20 / P1-25 四行追加本 spec 链接 + 复评结论 |
| 门禁 | 不涉及代码 ⇒ `typecheck` / `lint:arch` / `lint:size` / `bun test` 无需重跑 |
