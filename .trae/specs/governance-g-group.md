# Spec：治理项 G 组（《Liri 优化方案》§4 G1–G3）

> **状态**：G1 ✅ **可执行部分 + 选项 C（探测+告警）+ 选项 A（bash 真接入 Landlock，默认关闭）+ G1-A2（`code_run` 接入 `sandbox.landlock` 配置）全部完成**；**§3-1 Linux 真机验证 ✅ 已完成（2026-10-04，WSL2 Ubuntu，内核 6.18.33.2）**；G2 ✅ 已办（方案自述）；G3 ✅ 已办 + **守卫化已完成（2026-10-05，§3-7）**；**§3 剩余 5 项（§3-2 策略可配置 / §3-5 打包大小写校验 / §3-6 同名目录守卫 / §3-7 G3 守卫化 / §3-8 死调用点处置）✅ 全部收口（2026-10-05，见 §4.1）**
> **来源方案**：[`Liri优化方案-20260925.md`](../../dev_docs/Liri优化方案-20260925.md) §4「G 组：治理项」
> **最后更新**：2026-10-05（§3 剩余 5 项治理轮收口）

---

## 1. G1 同名双目录 `tools/BashTool/` 与 `tools/bash/`

### 1.1 复核实证（含对方案的一处补强）

| 事实 | 实测 |
|---|---|
| 两个目录**在本机并存**（非同一目录） | `Glob` 分别列出：`tools/BashTool/{BashTool.ts,schemas.ts,prompt.ts,UI.tsx}` 与 `tools/bash/{BashTool.ts,UI.tsx,types.ts,index.ts,BashSemantics.ts,semantics/*}` |
| 活跃入口是小写 | `tools/index.ts:339`、`ToolFactory.ts:8` 均指向 `./bash/BashTool` |
| 大写目录**唯一活引用** | `components/ui/ToolUIRegistry.ts:144` `require('../../tools/BashTool/UI')` —— **只用到 UI** |
| ⚠️ **补强（方案未提）** | 两份 `UI.tsx` **不对称**：大写那份导出 **5 个**（含 `renderToolUseProgressMessage` / `renderToolUseErrorMessage` / `getToolUseSummary`，三者均在 `ToolUIRenderer` 契约内），小写那份只剩 **2 个** ⇒ **契约更全的 UI 反而住在"死"目录里**，正是 G1 所述风险的实物化 |

### 1.2 已执行（本轮的"可执行部分"，按方案"先迁移引用、再删副本"）

1. **合并**：把大写 `UI.tsx` 的内容并入活跃目录 [`tools/bash/UI.tsx`](../app/src/tools/bash/UI.tsx)（补齐 3 个缺失导出；补上 `import React from 'react'`，原副本靠全局命名空间）；
2. **改引用**：[ToolUIRegistry.ts:144](../app/src/components/ui/ToolUIRegistry.ts#L143-L150) 改指 `../../tools/bash/UI`；
3. **删副本**：`tools/BashTool/{BashTool.ts,schemas.ts,prompt.ts,UI.tsx}` 4 个文件已删除；
4. **验证**：`typecheck` **0** · `lint` **0**；残留 `tools/BashTool` 命中**仅注释**（对 CC 上游 `cc_code/backend/tools/BashTool/...` 的出处标注）与新写的 G1 说明，**无任何代码引用**。

### 1.3 Landlock 归属（方案 §1 #13 的收窄结论，本轮复核成立）

- `code_run` 路径 ✅ **已生效**：`tools/CodeRunner/LinuxSandboxRunner.ts`（`LandlockDetector` 探测 → `buildLandlockArgv` → `runCodeRunnerSafely`）；
- `bash` 路径 ❌ **未生效**：活跃 [`tools/bash/BashTool.ts`](../app/src/tools/bash/BashTool.ts) 的 `landlock` **0 命中**；其"沙箱"仅是 **`SandboxSecurityChecker.checkDangerousCommands()`** 的**事前静态检查**（`:624-638`），不是内核级强制；执行方式是 `child_process.exec(command, { maxBuffer: 16MB })`（`:30,:45-47`）；
- 随本次删除，**旧副本里那份 bash+Landlock 集成代码（原 `:549-591`）一并移除** ⇒ "bash 无内核级约束"从此**显式化**，不再有"看起来有"的误导。

### 1.4 bash 是否应接入 Landlock —— **评估结论（安全决策，待用户裁定；本轮不实施）**

| 维度 | 结论 |
|---|---|
| 可行性 | 中。需把 `exec(shellString)` 换成经 `runWithLandlock` 包装的 `bash -c …`，并用 `LandlockPolicyBuilder` 声明路径策略（可读系统路径 + 可写工作区） |
| 平台 | **仅 Linux**（Landlock 需内核 5.13+，且有 ABI 分档 `clampAccessByAbi`）⇒ Windows/macOS 不生效 ⇒ **三平台行为分叉** |
| 主要风险 | **误伤**：策略若漏声明用户需要的路径，会**拦掉正常 bash 操作**；仓内**无 Linux CI 证据**；`sandbox/landlock/native/` 的 C11 helper 需先构建 |
| 缺口性质（如实） | 属**实际安全缺口**（Linux 上 bash 无内核级约束），但**不属"名义契约谎报"** —— bash 从未声称有 Landlock，`SandboxSecurityChecker` 是明确的黑名单检查 |
| 选项 A | **接入**：Linux 上让 bash 经 `runWithLandlock`；建议**默认关闭**（配置显式开启）以控误伤，需 Linux 验证 |
| 选项 B | **显式记录缺口**（文档 + 台账 + 帮助文档），保持现状 |
| 选项 C | **中间态**：只做"能力探测 + 告警"（Linux 上 Landlock 可用但 bash 未接入时提示），不改执行路径 |

> **裁定与落地**：2026-09-26 用户选定 **选项 C**（探测 + 告警，不改执行路径）⇒ 实施见 §1.5；**选项 A（接入）仍未做**，保留为后续可选项（需 Linux 验证）。

### 1.5 选项 C 已实施：能力探测 + 告警（**不改执行路径**）

交付物：新增 [`tools/bash/bashLandlockGap.ts`](../app/src/tools/bash/bashLandlockGap.ts) + 在活跃 [`tools/bash/BashTool.ts`](../app/src/tools/bash/BashTool.ts#L658-L661) 的 `execute` 内、**即将真正执行**处调用一次。

| 维度 | 落地 |
|---|---|
| 触发条件 | **Linux 且** `/sys/kernel/security/lsm` 含 `landlock` ⇒ 才提示（非 Linux / 未启用 ⇒ 无提示） |
| 频次 | **全进程一次**（模块级标记）；已提示后**短路、零 IO** |
| 行为影响 | **零** —— 返回值不参与控制流；该函数**吞掉自身全部失败**（`@ignore-catch`）⇒ 顾问性提示不得让 bash 执行失败 |
| 可测试性 | 纯判据 `judgeBashLandlockGap()`（零 IO）+ 可注入 `platform` / `readLsm` / `warn` ⇒ 10 例**全离线**（不需要 Linux） |

**⚠️ 关键设计取舍：刻意不复用 `LandlockDetector.detect()`（有实证理由，不是偏好）**

`LandlockDetector` 的探测结果**全局缓存**，而真实安全路径 `LinuxSandboxRunner` 用**它自己的 `helperPath`** 调用 `detect({ helperPath })`。若告警路径用**默认 helper** 探测并写入缓存（如 `helper-missing`），真实 `code_run` 会读到该缓存 ⇒ **误判 Landlock 不可用**、进而**改变安全行为**（这才是真回归）。故本模块**只读 LSM 列表**（不 spawn、不写缓存）。

**代价（如实）**：LSM 列表有盲区 —— `LandlockDetector` 自己的注释就指出"LSM 列表有盲区，需 probe 才能确证 enforce 能力"⇒ 本提示**只是线索**，**不得**当作"Landlock 已生效/未生效"的判据（代码注释同此声明）。

**验收（离线）**：10 例覆盖 ① 平台门控 ② 读不到 LSM（**不臆断为可用**）③ LSM 无 `landlock` ④ LSM 含 `landlock` ⇒ 提示 ⑤ 已提示不再提示 ⑥ Windows 不读 LSM 不告警 ⑦ 告警**恰一次** + 二次调用短路零 IO ⑧ 未启用不告警 ⑨ 告警出口抛错 ⇒ 照常返回（原因如实 `probe-failed`，**不**混淆成"未启用"）⑩ 读 LSM 抛错 ⇒ 不抛给调用方。

**A/B**：同时变异"去掉一次性标记 + 去掉兜底" ⇒ **恰 3 红**且可分归（一次性 1 例 / 兜底 2 例）。

**仍未做（如实）**：~~**Linux 真机验证未做**（本机 Windows ⇒ 实际走 `not-linux` 分支，告警分支只在**注入依赖**下被覆盖）~~ ✅ **已完成（2026-10-04，WSL2，含"告警恰一次 + 二次短路"）见 §3-1**；**未接入执行路径**（这正是选项 C 的定义：只提示、不改行为）—— 注：选项 A 已另批实施（§1.6）。

### 1.6 选项 A 已实施：bash 接入 Landlock（**默认关闭**，2026-09-26 用户指令）

> §1.5 的选项 C 只"提示"；本节按用户指令**真正接入**（A 与 C 并存：**未开启接入时**仍会提示）。

**交付物**：新增 [`tools/bash/bashLandlockExec.ts`](../app/src/tools/bash/bashLandlockExec.ts)
（`buildBashLandlockPolicy()` / `decideBashLandlockGate()` / `execBashCommand()` + 可注入的 `LandlockHelperRunner`）；
[`BashTool.execute`](../app/src/tools/bash/BashTool.ts) 的执行步收敛到 `execBashCommand()`；
配置面**复用**既有 [`sandbox/landlock/config.ts`](../app/src/sandbox/landlock/config.ts)（**新增** `sandbox.landlock.bashEnabled`，默认 **false**）；
另把 `appendWithinLimit` / `readLandlockConfig` 等经 `@modules/sandbox` 桶导出（**不深路径 import、不另造**）。

| 维度 | 落地 |
|---|---|
| 开关 | `sandbox.landlock.enabled`（总）× `sandbox.landlock.bashEnabled`（分项，默认 **false**） |
| 真正受限 | `landlock-run <--ro/--rw…> -- /bin/sh -c <command>`（复用 `buildLandlockArgv`；命令是**单个 argv 元素**，不拼壳） |
| **开启却无法受限** | **拒绝执行**（非 Linux / 能力不可用），错误信息给出两条可操作出路 ⇒ **不静默降级** |
| helper 初始化失败（exit 125） | 由既有 `failClosed` 决定：`true` ⇒ 拒绝；`false` ⇒ 回退普通执行 + WARN（既有契约字面语义） |
| 命令非 0 退出 | 抛**与 `exec` 同形**的错误（带 `stderr` / `code`），调用方归因方式不变 |
| 输出上限 | 复用 B1 的 `appendWithinLimit` 逐块切片（16MB 硬上限防 OOM；口径同 PTY：**按字符**） |
| 写权限（最小化） | 可写：cwd、`~/.pyapp/{output,downloads,temp}`、`/tmp`、`/var/tmp`、`~/.bun`、`~/.npm`、`~/.cache`、`/dev`（供 `2>/dev/null`）；只读：`/usr` `/bin` `/lib` `/etc` `/proc` … 以及 **`~/.pyapp` 整体**（bash 改不动配置与凭据） |
| 网络 | **显式放行** `connect_tcp/udp` —— Landlock 缺省=全禁 TCP/UDP，照抄 `code_run` 的"无 net 规则"会让 curl/git/npm 全废（误伤） |

**为什么"无法受限 ⇒ 拒绝"而不是回退**：B2 已确立"不假装已受限"。用户显式打开 enforcement 开关后再静默走不受限路径，等于把开关做成装饰；故拒绝执行，并把**出路写进错误信息**（关开关 / 装 helper）。

**验收（离线，21 例）**：默认关闭 / 门控六分支 / 策略形状（cwd 可写、`~/.pyapp` 只读、`/dev` 可写、网络放行）/ argv 形状（`--ro`+`--rw` 声明、命令单元素）/ 开关关闭时不探测 / **两条拒绝且不调用普通执行器** / exit 0、exit 125（两种走向）、exit 7（带 `stderr`+`code`）、未取到退出码、helper 启动失败。

**A/B（各自单变量）**：① 把"拒绝"改成静默回退 ⇒ **恰 2 红**（两条拒绝用例）；② 把命令二次拼壳（`"${command}"`）⇒ **恰 1 红**（argv 形状用例）。合计 3 红，可按用例名归属。

**未做/未验（如实）**：① ~~**真实 Linux 上的 enforce 行为未验证**（本机 Windows）~~ ✅ **已验证（2026-10-04，WSL2）**：见 §3-1（域内放行 / 白名单外读写拒绝 / `~/.pyapp` 只读生效）；② `defaultLandlockHelperRunner` 的截断未单测（复用 B1 助手，其自身有单测）；③ 策略是"够用优先"的**固定清单、不可配置** —— 若用户需要额外可写路径会被**拦到正常命令**（这正是默认关闭的理由；**真机上以 `/opt`、`/root` 为例实测被拒**，见 §3-1）；④ **未提供 UI 开关** —— 开启需手改 `~/.pyapp/config.json` 的 `sandbox.landlock.bashEnabled`；⑤ `enabled` / `failClosed` 原本无消费者的问题**已另批修复**（见 §1.7 的 G1-A2）。

### 1.7 已修（G1-A2，2026-09-26 用户指令）：`code_run` **接入** `sandbox.landlock` 配置（原为"名义契约"）

**实测的缺口（本轮先在 §1.7 记录、随后按用户指令修）**：`readLandlockConfig` / `resolveLandlockConfig` / `DEFAULT_LANDLOCK_CONFIG` 在 `sandbox/landlock/` 与其桶导出之外**零命中**；
`tools/CodeRunner/LinuxSandboxRunner.ts` 原本是**直接** `LandlockDetector.detect()` + 不可用即降级，**不读配置** ⇒
`sandbox.landlock.enabled=false` **拦不住** `code_run` 走 Landlock、`failClosed=true` **也不生效**（与 B1 同类的名义契约）。

**改法（接入同一配置面，不新增键）**：

| 情形 | 改后行为 |
|---|---|
| `enabled === false` | 直接走跨平台执行器（配置语义"关闭则完全走本地执行路径"）；**连探测都不做** |
| 能力不可用 + `failClosed === false` | 降级跨平台（**既有行为不变**，仅补 debug 日志） |
| 能力不可用 + `failClosed === true` | **拒绝**：返回 `status: 'security-rejected'` + 可操作信息（装 helper / 关开关），**不**降级到无约束执行 |
| helper 初始化失败（**exit 125**）+ `failClosed === true` | **拒绝**（同上，换成 `security-rejected`，保留原日志便于排障） |
| helper 初始化失败（exit 125）+ `failClosed === false` | **降级**跨平台 + WARN（配置的字面语义"初始化失败时拒绝而非回退"默认关闭） |
| 非 Linux | 走跨平台（**设计内正常分支**，见下） |

**两处关键判据（都可离线证伪）**：
1. **exit 125 的判据是"真实退出码"，不是文案** ⇒ 为此给 `CodeRunResult` 增 `exitCode?: number`（`CrossPlatformRunner` 的 `exit` 事件带出）。若从 `error` 里找 `"125"`，就是**字符串匹配做状态判断**（CS02），且会**双向误判**（A/B 已实证，见下）。
2. **非 Linux 判"跨平台"而非"拒绝"**：`failClosed` 的字面语义只管"初始化失败"，而跨平台执行器是**合法执行器**（文件头 P1-4：平台差异仅在隔离手段）。若因 `failClosed=true` 在非 Linux 上拒绝，会把 Windows/macOS 的 `code_run` 直接打死 —— 而该开关此前无消费者、从未有过这层语义。

**验收（离线 13 例）**：门控六分支（含"非 Linux + failClosed=true ⇒ 仍 plain"）/ 默认配置不变 / 125 分流三态（keep / fallback / refuse）/ 拒绝结果形状（`security-rejected`、零耗时、空集合）/ **真实子进程**验证 `exitCode` 带出（`bun -e process.exit(125)` 与 `process.exit(0)`）。

**A/B（各自单变量；实测 4 红，**比预估多 1**，如实记录）**：
- ① 把 125 判定改成**文案匹配** ⇒ **恰 2 红**，且是**双向**误判：`exitCode=0/1/7` 因文案含 "125" 被**误判为初始化失败**；`exitCode=125` 但文案不含 "125" 时被**漏判**。
- ② 去掉 `CrossPlatformRunner` 的退出码带出 ⇒ **恰 2 红**（两个真实子进程用例）。
- 预估 3 红、实得 4 红：原因是①的共用夹具 `error` 文案本身含 "125"，使"非 125 ⇒ keep"用例也被翻转 ⇒ **该差异已核明，非未定性**。

**未做/未验（如实）**：① `runCodeRunnerWithLandlock` 的**真实 spawn 路径未单测**（依赖真实 landlock-run + Linux）⇒ 判据与形状已用纯函数 + 真实子进程分片覆盖；② 真实 Linux 上"125 ⇒ 拒绝/降级"未端到端验证。

---

## 2. G2 / G3（状态）

- **G2**（把报告失真记入预存台账）：方案自述**已办**（2026-09-25，N-73 等条目）；本轮在台账新增/更正的条目继续沿用该做法。
- **G3**（隔离提示词工具名漂移）：已在**排查计划 P3-2** 处置 —— `AgentTool.ts:2162` 的 `read_file/write_file/edit_file` 改为真实注册名 `file_read/file_write/file_edit`。
  ⚠️ 方案另建议"**加守卫**（从工具注册表取名的单一来源，而非在提示词里写字面量）"—— **未做**：该提示词是静态模板串，接注册表会引入运行时依赖；作为后续可选改进记录（§3-7）。

---

## 3. 未做 / 未验（如实）

1. ~~**Linux 真机验证未做（选项 A 与 C 的共同缺口）**~~ ✅ **已于 2026-10-04 在 WSL2 Ubuntu 完成（内核 `6.18.33.2-microsoft-standard-WSL2`）**：

   **前置（两处环境事实）**：① WSL2 默认**未挂 securityfs** ⇒ `/sys/kernel/security/lsm` 读不到（`LandlockDetector` 会判 `not-in-lsm`、选项 C 判"未启用"）⇒ 需 `mount -t securityfs none /sys/kernel/security`（uid=0 可挂）后 LSM 才可读（实测 `capability,landlock,yama,safesetid,selinux,ima`，**含 `landlock`**）；② WSL 内 `bun` 是 **Windows 互操作**（非 Linux 原生）⇒ 需 Linux 版 bun（本次离线放入 `bun-linux-x64`，WSL 无外网）。

   **helper/内核层 enforce 矩阵（`landlock-run` 直接调用，`--probe` = `partially enforced (older ABI)`）**：

   | 例 | 策略/命令 | 实测 |
   |---|---|---|
   | 读域内 | `--rw <work>` `cat <work>/inside.txt` | ✅ `INSIDE`，exit 0 |
   | 读域外（未声明路径） | 同上 `cat /tmp/ll-verify/outside/secret.txt` | ✅ **Permission denied**，exit 1 |
   | 写域内 | `echo hi > <work>/new.txt` | ✅ exit 0 |
   | 写域外 | `echo hi > <work>/../outside/new.txt` | ✅ **Permission denied**，exit 2 |
   | `~/.pyapp` 只读 | `--ro <home>/.pyapp` 后写 `config.json` | ✅ **Permission denied**（只读生效） |

   **项目代码路径端到端（Linux bun + `execBashCommand`，`enabled=true` + `bashEnabled=true` + `failClosed=true`，注入 `helperPath`）**：

   | 例 | 实测 |
   |---|---|
   | 选项 C：`reportBashLandlockGapOnce()`**不注入** | ✅ `{report:true, reason:'landlock-available-but-unused'}`，告警**恰 1 次**；二次调用 `already-reported`、warnCount 仍 1 |
   | A1 读 cwd 内 / A3 写 cwd 内 / A5 `pwd` | ✅ exit 0（域内放行） |
   | **A6 写 `~/.pyapp/config.json`** | ✅ **拒绝**（exit 2 / Permission denied）—— spec §1.6"`~/.pyapp` 整体只读"**端到端成立** |
   | **A7 写 `/opt/l1-out`**（策略白名单外） | ✅ **拒绝**（mkdir: Permission denied） |
   | **A8 读 `/root/.bashrc`**（白名单外） | ✅ **拒绝**（Permission denied） |
   | 反例说明 | A2/A4 落在 `/tmp` 下**被放行** —— 因策略显式声明 `/tmp`/`/var/tmp` 可写（§1.6 清单），**非缺陷**；取样点须在白名单之外 |

   ⇒ **选项 A 的"开启即真受限"与选项 C 的"能力可用却未接入 ⇒ 提示一次"两个分支均在真实 Linux 上成立**。
   **仍未验（如实）**：① **网络放行/阻断**因 WSL 无外网（`curl` 两种策略均返回 `000`）**无法区分**（此前 T-③06 已用 `curl exit=7` 单独验证过 `--net-deny`）；② 真机上 `exit 125`（helper 初始化失败）分流**未端到端**（离线用例覆盖）。
2. ~~**bash 的 Landlock 策略是"够用优先"的固定清单、不可配置**~~ ✅ **已修（2026-10-05，§3-2）**：新增配置项 `sandbox.landlock.bashExtraWritablePaths`（字符串数组，默认 `[]`）—— 逐条声明**额外可写路径**，在 `buildBashLandlockPolicy` 末尾追加 `FS_READ_WRITE` 规则；仅 `bashEnabled === true`（且 `enabled === true`）时生效。**默认 `[]` ⇒ 策略与治理前逐条等价（零行为漂移）**；缺失路径由 `buildLandlockArgv` 的存在性过滤统一丢弃（同一机制）。⚠️ **不改变**「`~/.pyapp` 整树不放行」（P0-3-a）。
3. ~~**`sandbox.landlock.enabled` / `failClosed` 原先无消费者的问题未修**（§1.7）~~ ✅ **已修（G1-A2）**：`code_run` 现按 `enabled` / `failClosed` 分流（§1.7）。
4. **选项 C 的告警信号强度有限（已知，非缺陷）**：只读 LSM 列表、不做功能 probe（理由见 §1.5），故可能有"LSM 列出但内核拒绝 enforce"的假阳性 ⇒ 提示只作线索。
5. ~~**G1 的"Windows 大小写不敏感"打包风险未验**~~ ✅ **已验证（2026-10-05，§3-5）**：app 侧 `forceConsistentCasingInFileNames: true`（显式，`app/tsconfig.json:19`）；**实证**：故意用错大小写 `import './targetname'` 引用 `TargetName.ts` ⇒ `tsc --noEmit` 报 **TS1261**（"...differs from file name ... only in casing"）**并 exit 2**（fixture 已删）。client 侧原**依赖 TS≥5 隐式默认 true**，已**显式化**（`client/tsconfig.json`）⇒ 不再依赖编译器版本默认；`client` `tsc --noEmit` 保持 **exit 0**。⚠️ **仍未验（如实）**：git 检出 / 打包（`bun build --compile`）在**大小写不敏感 CI 与目标机**上的行为差异——本机文件系统为**大小写不敏感**（实测 `Foo`/`foo` 无法同目录并存），**无法**在本地复现"Linux 可提交、Windows 检出丢失"的形态。
6. ~~未做"同名目录"防回归守卫~~ ✅ **已做（2026-10-05，§3-6）**：新增脚本 `scripts/lint-case-collision.ts`（`bun run lint:case`，已纳入 `app/package.json` 的 `ci` 链）递归扫描项目树，按 `toLowerCase()` 对**同一父目录**下的直接子项分组，组内出现 >1 个互异名即判违规（exit 1）；忽略 `node_modules`/`.git`/`dist`/`target` 等。**含自检控制组**（合成 `['Foo','foo']` 必须命中、`['Foo','bar']` 必须不命中）防"空集假绿"。**当前实测通过**（无仅大小写不同的同级条目）。
7. ~~G3 的"守卫化"（提示词工具名取自注册表）未做~~ ✅ **已做（2026-10-05，§3-7）**：`tools/AgentTool/agentTeammateIsolation.ts` 的 worktree 隔离提示词改为引用常量 `WORKTREE_FILE_TOOL_NAMES`，其类型为 `as const satisfies readonly ToolName[]`（`ToolName` 来自**注册表生成物** `constants/toolNames.generated.ts`，由 `getAllBuiltinToolLoaders()` 生成）⇒ 拼错 / 上游改名未同步将直接触发 **`typecheck` 报错**，杜绝 2026-09-26 那类漂移。
8. ~~**`BashTool.safeExecute` / `BashTool.executeCommand` 无活调用点**~~ ✅ **已处置（2026-10-05，§3-8）**：两静态方法连同其专属 import（`promisify`/`execAsync`/`AppError`/`ErrorCategory`/`ErrorSeverity`）一并删除，`child_process` import 收窄为 `import type { ExecOptions }`；删除前全仓 grep 确认**无活引用**（仅 spec / 台账文档命中）。
   - ✅ **同批新发现并已处置（2026-10-05）**：静态 `BashTool.isDangerousCommand()`（原 `BashTool.ts:760`）经全仓 grep 确认为**同类死代码**（**0 引用**、**无动态访问**；实例路径用的是 `@modules/security/bash/BashAST` 的**同名函数**，见 `BashTool.ts:27`/`:564`），且与 `execute()` 内联的安全拦截段（`:502-554`）**重复**。**用户裁定「删除」** ⇒ 已删除（零级联：三常量/函数仍被实例路径 `:508`/`:523`/`:542` 使用；文件 **973 → 943 行**）。验证：`typecheck` 0 · 定向 `eslint` 0 · bash 相关测试 **44 pass / 0 fail**。

---

## 4. 门禁（G1-A2 实施后）

`typecheck` **0** · `eslint`（本轮改动 4 文件）**0** · `lint:arch` **0 错 0 警** · 新增用例 **13 pass**（`tests/tools/codeRunnerLandlockConfig.test.ts`；G1-A 的 21 例与 G1-C 的 10 例仍全绿）· 全量 **3936 pass / 19 skip / 0 fail / 3955 tests / 402 files**（套件自报 74.07s）。

> 时点对照：G1-C = 3902 pass·3921 tests·400 files（72.87s）；G1-A = 3923 pass·3942 tests·401 files（74.51s）；G1-A2 = 3936 pass·3955 tests·402 files（74.07s）。
> 过程说明（如实）：`eslint` 在**本轮改动**的文件上报 6 处 prettier 格式问题（非预存），已 `--fix` 后归零并**重跑**门禁。
> 口径提醒：全量门禁**不要**经 PowerShell 管道（`| Select-Object -Last`）—— 该形态曾 ≥5 分钟未结束；改用**重定向到文件**后稳定在 72–75s（详见台账 2026-09-26 补充数据点）。

### 4.1 §3 剩余 5 项治理轮（2026-10-05）

**改动文件**（9）：`app/src/tools/bash/BashTool.ts` · `app/src/tools/bash/bashLandlockExec.ts` · `app/src/sandbox/landlock/config.ts` · `app/src/tools/AgentTool/agentTeammateIsolation.ts` · `app/tests/tools/bashLandlockExec.test.ts` · `client/tsconfig.json` · `app/scripts/gen-tool-names.ts`（顺带修 `lint:exit`）· 新增 `scripts/lint-case-collision.ts` · `app/package.json`（注册 `lint:case` 并纳入 `ci`）。

**门槛（逐项我亲自独立重跑，不采信子代理自述）**：

| 项 | 结果 |
|---|---|
| `bun run typecheck`（app，含 `tsconfig.scripts` / `tsconfig.root-scripts`） | ✅ exit 0 |
| `client` `tsc --noEmit` | ✅ exit 0 |
| `eslint`（本轮改动文件） | ✅ 0 错（先 `--fix` 归零后重跑） |
| `lint:scripts`（`../scripts/**`） | ✅ 0 错（28 warning 为预存，非本轮） |
| `lint:arch` | ✅ exit 0（warning 为预存） |
| `lint:size` | ✅ exit 0（461 warning / 16 豁免为预存） |
| `lint:case`（新增） | ✅ 通过（自检控制组同步通过） |
| `lint:legacy-env` / `lint:unref` / `lint:refs` / `check:paths` / `i18n:check` | ✅ 全部 exit 0 |
| **`lint:exit`** | ✅ **已修复（2026-10-05，随本轮）**：原报 `app/package.json#gen:toolnames → scripts/gen-tool-names.ts` 缺显式退出（**预存**，与本轮无关：该文件最后改动 2026-10-01）⇒ 已在其末尾补 `process.exit(0)`；现 `✅ 入口脚本显式退出检查通过（已检查 30 个入口脚本）` |
| 全量 `bun test` | ✅ **4445 pass / 21 skip / 0 fail / 4466 tests / 469 files**（84.65s） |

**新增/更新用例**：`tests/tools/bashLandlockExec.test.ts` 新增 3 例（§3-2 额外可写路径：缺省等价 / 声明生效 / `resolveLandlockConfig` 归一化），该文件 **30 pass**（原 27 → 30）。

