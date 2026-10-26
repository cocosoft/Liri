# macOS 兜底沙箱（`sandbox-exec`）实施方案

> 版本 1.0 ｜ 日期 2026-10-26 ｜ 状态：**方案待确认（未动代码）**
> 来源：用户裁定「按 CD01–CD07 方案先出 macOS 兜底实现」；背景取证见
> [`dev_docs/20261025/mac-win沙箱取证-20261025.md`](../../dev_docs/20261025/mac-win沙箱取证-20261025.md) 附录 A（macOS 曾有 `sandbox-exec` 实现，2026-09-30 `be299590d` 删除且未恢复；Windows 从未实现）

---

## 1. 目标与非目标

**目标**：在 macOS 上给 `bash` 与 `code_run` 提供**可验证的 OS 级写入隔离**（`sandbox-exec` / Seatbelt），
沿用现有「开启即真受限，否则拒绝执行」的 fail-closed 口径。

**非目标（明确不做）**
- ❌ Windows（AppContainer/JobObject 全历史 0 命中，无既有实现可参考；另立专项）
- ❌ 不改 Linux Landlock 的任何行为与默认值
- ❌ 不复活 `SandboxImpl.ts` 的旧 profile（`(deny default)(allow file-read*)(allow process-exec)(allow network*)`
  —— 只挡写、读/网络全放行，且当年接线为 0 消费者）
- ❌ 不改 `sandbox.landlock.bashEnabled` 的默认值（仍 `false`）

---

## 2. 现状取证（接线点，均已回仓核）

| 环节 | 现状 | 证据 |
|---|---|---|
| 配置 | `sandbox.landlock.{enabled,failClosed,bashEnabled,bashExtraWritablePaths}`；`bashEnabled` 默认 `false` | [config.ts:48-75](../../app/src/sandbox/landlock/config.ts#L48-L75) |
| bash 门禁 | `master-off` → plain；`switch-off` → plain；`platform !== 'linux'` → **refuse**；能力不可用 → **refuse** | [bashLandlockExec.ts:244-288](../../app/src/tools/bash/bashLandlockExec.ts#L244-L288) |
| bash 能力探测 | 仅 `platform === 'linux'` 才调 `LandlockDetector.detect()`，其余 `capability = null` | [bashLandlockExec.ts:508-517](../../app/src/tools/bash/bashLandlockExec.ts#L508-L517) |
| bash 执行分支 | `plain` / `refuse` / 默认（Landlock helper）三分支 | [bashLandlockExec.ts:526-561](../../app/src/tools/bash/bashLandlockExec.ts#L526-L561) |
| code_run | `runCodeRunnerWithLandlock()`，不可用 ⇒ 跨平台执行器（`failClosed=false` 时降级） | [LinuxSandboxRunner.ts:192,293](../../app/src/tools/CodeRunner/LinuxSandboxRunner.ts#L192) |
| 执行信号 | `mode: 'landlock' \| 'none'`，`platform === 'linux' && available ? 'landlock' : 'none'` | [sandboxExecutionSignal.ts:127](../../app/src/sandbox/sandboxExecutionSignal.ts#L127) |
| 进程树回收 / 输出上限 | 已有可复用实现 | `sandbox/utils/killProcessTree.ts` · `sandbox/utils/TimeoutController.ts` |

---

## 3. 设计

### 3.1 新模块 `app/src/sandbox/darwin/`

| 文件 | 职责 |
|---|---|
| `MacOSSandboxDetector.ts` | 探测 `/usr/bin/sandbox-exec` 是否存在且可执行（`existsSync` + `--help` 探测一次即缓存）；返回 `{ available, reason? }`，与 `LandlockCapability` 同形 |
| `MacOSSandboxPolicy.ts` | 纯函数：`buildMacOSSandboxProfile({ cwd, extraWritablePaths, allowNetwork })` → SBPL 字符串（**可单测**，不 spawn） |
| `runWithSandboxExec.ts` | 执行器：`sandbox-exec -p <profile> -- <shell> -c <cmd>`；超时、输出上限、`AbortSignal` → 进程树强杀；退出码与 Landlock 同口径（初始化失败 125 保留） |

**SBPL 基线（deny-by-default）**

```scheme
(version 1)
(deny default)

; 读：系统 + 运行时（bash 自身的动态库、/usr、/bin、/System、/Library、/private/etc 等）
(allow file-read*)
; 写：仅工作区 + 受管产物目录 + 临时目录（逐条 subpath，路径从 config 取，做 realpath 归一）
(allow file-write*
  (subpath "<cwd>")
  (subpath "<~/.pyapp/output>")
  (subpath "<~/.pyapp/downloads>")
  (subpath "<~/.pyapp/temp>")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders"))

(allow process*)
(allow network*)          ; 与现有基线同口径；见 §3.5「后续可选收紧」
```

> 说明：`(allow file-read*)` 与现行 Linux 口径**不完全等价**（Landlock 只放行白名单可写 + 系统只读，
> 但仍能读到工作区）。macOS 侧先做到"**写不出边界**"这一条硬约束，读取面按 §3.5 单列成后续项，
> 避免一次引入因读限制导致的普遍误伤（`bash` 是交互通道）。

### 3.2 配置：复用既有开关，不加新键

**决策**：复用 `sandbox.landlock.{enabled,bashEnabled,bashExtraWritablePaths}`，**不改键名、不改默认值**。

理由：
1. 这两个键在文档里的语义是「OS 级沙箱总开关 / 让 bash 也进 OS 沙箱域」，并非"仅 Landlock"（[config.ts:26-35](../../app/src/sandbox/landlock/config.ts#L26-L35)）；
2. 新增 `sandbox.macos.*` 会让同一语义出现两套开关（双轨），且用户需要翻两个地方；
3. 改键名属破坏性配置变更，收益仅"名字好听"。

**代价（如实）**：macOS 上开启 `bashEnabled` 的行为从「refuse（平台不支持）」变为「受限执行」。
这是**行为变更**，须在 CHANGELOG/台账写明；未开启者（默认）零变更。

### 3.3 门禁：darwin 分支

`decideBashLandlockGate` 返回 `mode` 增加 `'sandbox-exec'`：

| 顺序 | 条件 | 结果 |
|---|---|---|
| 1 | `!config.enabled` | `plain` / `master-off`（不变） |
| 2 | `evalForced` | 不变（评测期仍回退 plain；理由见 P0-4 ②） |
| 3 | `!config.bashEnabled` | `plain` / `switch-off`（不变） |
| 4 | `platform === 'darwin'` 且 `sandbox-exec` 可用 | **`sandbox-exec` / `macos-enabled`（新增）** |
| 5 | `platform === 'darwin'` 且不可用 | `refuse` / `macos-capability-unavailable`（新增文案：如何检查 `/usr/bin/sandbox-exec`、macOS 版本） |
| 6 | `platform === 'linux'` | 现有三分支（完全不变） |
| 7 | 其他平台 | `refuse` / `platform-unsupported`（不变） |

执行器在 `gate.mode === 'sandbox-exec'` 时走 `runWithSandboxExec`；`refuse` 仍抛
`G1A_LANDLOCK_UNENFORCEABLE`（错误码**不改**，避免下游告警口径漂移；文案区分 macOS）。

### 3.4 code_run

新增 `app/src/tools/CodeRunner/MacOSSandboxRunner.ts`，与 `LinuxSandboxRunner` 同形：
`runCodeRunnerWithSandboxExec()` → 成功/失败语义与 `runCodeRunnerWithLandlock()` 对齐；
调度点（`LinuxSandboxRunner.ts:293` 所在函数）按 `process.platform` 分流：`darwin` → macOS runner，
其余 → 现有跨平台执行器。`failClosed` 沿用 `sandbox.landlock.failClosed`。

### 3.5 后续可选收紧（本次不做，登记触发条件）

- 读白名单化（`file-read*` → 逐条 `subpath`）：收益大但误伤面广，需先有 macOS 实机灰度数据；
- 网络收紧（`(allow network*)` → 仅本地回环 / 白名单）：与 Linux 网络策略对齐时一并做。

### 3.6 已知限制（如实，2026-10-26 收口时确认）

| 限制 | 事实与影响 | 为什么不现在修 |
|---|---|---|
| **执行信号不报 `sandbox-exec`** | `SandboxExecutionMode` 只有 `landlock/container/ssh/pty/none`（[Tool.ts:108-112](../../app/src/utils/toolContract/Tool.ts#L108-L112)）；`resolveSandboxExecutionSignal` 的缺省推导只看 Landlock（[sandboxExecutionSignal.ts:122-128](../../app/src/sandbox/sandboxExecutionSignal.ts#L122-L128)）⇒ macOS 真受限时工具结果里仍是 `mode='none'` | 该信号在**权限判定之前**构造（[ToolExecutionService.ts:783](../../app/src/chat/services/ToolExecutionService.ts#L783)），此时尚未执行、拿不到实际门控结果；要做到"本次真走了 sandbox-exec"需两阶段回填，改动面大于收益 |
| 安全影响：**无** | `resolveSandboxExemption` 对 `RiskClass.SHELL` 一律 `shell-unprovable`；文件类还必须 `fileIoIsolated===true`（只来自 container/ssh 工作区）⇒ 信号不报 macOS **不会**放宽任何审批 | — |
| **`/v1/sandbox/status` 不含 macOS 能力字段** | 该端点的读取面是 kernel SPI 端口投影（[spiWiring.ts:509-518](../../app/src/entrypoints/spiWiring.ts#L509-L518)），增加字段要动 kernel 端口契约 + `lint:kernel-api` | 属可观测性增强，不影响运行时行为 |
| 既有的同类不精确（非本次引入） | Landlock 侧同样按**能力**而非**本次调用**推导：`enabled=true` 但 `bashEnabled=false` 时 bash 实际走 plain，信号仍报 `landlock` | 同一根因；修则两侧一起改（两阶段回填） |

**触发条件（何时重开）**：需要"按调用证明隔离"的场景成立时（如把 SHELL 类也纳入沙箱豁免、或审计要求逐次留证），
按"执行入口回填实际 mode → 信号采用回填值"两阶段方案一次性修，并 **同批**扩展 `SandboxExecutionMode`；
仅做展示/排障时优先给 `/v1/sandbox/status` 加只读能力字段。

---

## 4. 安全姿态与失败模式

| 场景 | 行为 |
|---|---|
| macOS + `enabled=false` | plain（与今天一致） |
| macOS + `enabled=true, bashEnabled=false` | plain（与今天一致） |
| macOS + `bashEnabled=true` + helper 可用 | **受限执行**（写入限制在工作区 + 受管目录 + tmp） |
| macOS + `bashEnabled=true` + `sandbox-exec` 缺失/不可执行 | **refuse**（fail-closed，不降级；与 Landlock 同口径） |
| Linux / Windows | **零变更** |
| 执行超时 / 取消 | `killProcessTree` 强杀（复用既有实现） |
| profile 构建失败（路径异常） | 抛错 ⇒ 上层按 `refuse` 处理（不静默 plain） |

---

## 5. 测试计划

| 层 | 用例 | 可在 CI 跑 |
|---|---|---|
| 纯函数 | `buildMacOSSandboxProfile`：含 cwd/受管目录/tmp；`extraWritablePaths` 去重与转义（路径含空格/引号）；`allowNetwork=false` 时不出现 `(allow network*)` | ✅ |
| 纯函数 | `MacOSSandboxDetector`：注入 `existsSync` 桩 ⇒ available / unavailable 两态 | ✅ |
| 门禁 | `decideBashLandlockGate`：darwin+available ⇒ `sandbox-exec`；darwin+unavailable ⇒ `refuse`；linux 三分支**回归不变**；其他平台仍 refuse | ✅ |
| 执行器 | 注入式 runner：断言 argv 形状 `[-p, <profile>, --, <shell>, -c, <cmd>]`、超时/输出上限/abort 调用 | ✅（桩） |
| 真机 | macOS 实机：`bashEnabled=true` 下 `echo x > /tmp/a` 成功、`echo x > ~/Documents/a` 失败（`Operation not permitted`） | ✅ **已接入 CI（2026-10-26）**：`Verify macOS sandbox` step（`macos-latest`）跑 `bun run verify:sandbox-macos` |

**真机自证脚本（2026-10-26 新增）**：`app/scripts/verify-macos-sandbox.ts` —— 复用生产同一套模块
（探测器 / SBPL 生成器 / `sandbox-exec` 执行器），在临时目录里跑 4 条断言：
① 白名单内可写；② 白名单外被拒（非 0 退出 **且** 文件未落盘，不依赖本地化文案）；
③ 系统文件可读（shell 能启动）；④ 用户命令 `exit 125` 原样透传（不得被当成"初始化失败"而回退 plain）。
退出码：0 全通过 / 1 有失败 / 2 环境不支持（非 macOS 或缺 `sandbox-exec`）。

> CI 现状（**2026-10-26 订正**）：`ci.yml` 的 Test Suite 矩阵是 `ubuntu-latest, windows-latest, macos-latest`
> ⇒ CI **有** macOS，且 `bun test` 在三平台都跑（本文件的纯函数用例会真在 macOS 上执行）。
> **真机探针已接入 CI**（2026-10-26，W26-01）：`ci.yml` 新增 `Verify macOS sandbox (seatbelt write isolation)`
> （`if: matrix.os == 'macos-latest'`）⇒ 4 条真机断言每次 CI 自动跑，不再依赖人工在 Mac 上执行。
> `sandbox-exec` 自 10.15 起被 Apple 标为 deprecated，若某版 runner 上不可用，该脚本会以 exit 2 明确报
> 「不可用」而不是静默降级。

---

## 6. 交付拆分（每步独立提交，可单步回滚）

| # | 提交 | 内容 | 验证 |
|---|---|---|---|
| 1 | `feat(sandbox): add macOS seatbelt profile builder + detector` | `sandbox/darwin/` 两个纯函数模块 + 单测 | tsc / 单测 |
| 2 | `feat(sandbox): run bash inside sandbox-exec on macOS` | `runWithSandboxExec` + 门禁 darwin 分支 + 执行器接线 + 测试 | tsc / 门禁回归 / 单测 |
| 3 | `feat(sandbox): code_run macOS runner` | `MacOSSandboxRunner` + 调度分流 | tsc / 单测 |
| 4 | `docs(evidence): 登记 macOS 兜底沙箱` | 台账 + api/文档同步（`docs/沙箱`） | 台账三门禁 |

回滚：任一提交单独 `git revert` 即可；步骤 2/3 未接线时步骤 1 纯增量无风险。

---

## 6.1 真机验证记录

**状态**：✅ **已自动化（2026-10-26，W26-01）** —— `ci.yml` 的 `Test Suite (macos-latest)` 新增
`Verify macOS sandbox (seatbelt write isolation)` step，每次 CI 在真实 macOS runner 上跑 4 条断言；
不再依赖人工在 Mac 上执行。首次 CI 通过后本节回填**真实输出**。

**首次 CI 记录（2026-10-26，`81899911e`）**：❌ `Test Suite (macos-latest)` 在该步骤 **exit 1**
（不是 exit 2 ⇒ `sandbox-exec` 存在、是断言失败）。根因：`os.tmpdir()` 返回 `/var/folders/…`，
而 `/var` 是 `/private/var` 的符号链接，SBPL 的 `(subpath …)` 按**内核解析后**的路径匹配
⇒ 白名单里写 `/var/…` 匹配不到 `/private/var/…`，「白名单内可写」被误拒（**假阴性**）。
修法：`buildMacOSSandboxProfile` 的归一阶段调用 `toKernelPath`（`realpathSync`，路径不存在时原样保留），
并给 CI 步骤加 annotation 提升（job 日志下载接口需 admin，annotations 可匿名读取）。

**第二次 CI 记录（2026-10-26，`c0d6ce1b2`）**：归一化修复生效（「白名单内可写」「白名单外写入被拒」双双 ✅），
剩 **1/4** 失败：`cat /etc/hosts > /dev/null` 报 `/bin/bash: /dev/null: Operation not permitted`。
根因：写白名单未含 `/dev`，而 Linux 侧 `buildBashLandlockPolicy` **早已放行 `/dev`**
（注释：「`2>/dev/null`、`>&2` 等常规重定向；只限制不提权」）⇒ 这是 **macOS 与 Linux 的口径差**，属真缺陷
（几乎所有 shell 脚本都会重定向到 `/dev/null`）。修法：`macWritablePaths()` 与自证脚本的白名单都补 `/dev`，
与 landlock 逐条对齐。

**本地复现（在 Mac 上）**：

```bash
cd app && bun run verify:sandbox-macos
```

**期望输出**（4 条全 ✅，退出码 0）：

```
✅ 白名单内可写 — exit=0 ...
✅ 白名单外写入被拒 — exit≠0 文件存在=false ...
✅ 系统文件可读（shell 能启动） — exit=0 ...
✅ 用户命令 exit 125 原样透传 — exit=125 sandboxInitFailed=false

✅ macOS 兜底沙箱自证通过（4/4）
```

**CI 实际结果（2026-10-26，`97b848c7f`）**：✅ `Test Suite (macos-latest)` 的该步骤 **success**（4/4），
该 run 的 **16 个 job 全绿** ——
https://github.com/cocosoft/Liri/actions/runs/40262589094

> 逐条断言的 `detail` 含 runner 上的本机路径，此处只记录**结论**；原始输出见该 run 的
> `Verify macOS sandbox` 步骤日志（或失败时的 check-run annotations）。

```
✅ 白名单内可写
✅ 白名单外写入被拒（非 0 退出 且 文件未落盘）
✅ 系统文件可读（shell 能启动）
✅ 用户命令 exit 125 原样透传（sandboxInitFailed=false）

✅ macOS 兜底沙箱自证通过（4/4）
```

**若失败**：把失败行的 `detail`（含 `exit` / `stderr` 前 120 字符）贴回，按 §4 失败模式表定位 ——
白名单外仍可写 ⇒ profile 未生效（查 `-p` 实参与 SBPL 语法）；`125` 被判 `sandboxInitFailed` ⇒ 检查
`bashLandlockExec` 里是否为 landlock 专属分支（该守卫不得被移除）；exit 2 ⇒ runner 上 `sandbox-exec`
不可用（Apple 已标 deprecated），此时需评估改用 `App Sandbox`/`sandbox_init` 或降级为"仅 Linux 硬隔离"。

---

## 7. 风险与待确认项

| 项 | 说明 | 需要你拍板 |
|---|---|---|
| 是否复用 `sandbox.landlock.*` 键名 | 见 §3.2（推荐复用） | ✅ 请确认 |
| 读白名单是否本次就做 | 见 §3.5（推荐本次不做） | ✅ 请确认 |
| 默认值是否保持 `bashEnabled=false` | 推荐保持（与 Linux 一致，避免升级即变行为） | ✅ 请确认 |
| 错误码是否新增 `MACOS_SANDBOX_UNENFORCEABLE` | 推荐**不新增**，沿用 `G1A_LANDLOCK_UNENFORCEABLE`（下游告警口径稳定） | ✅ 请确认 |

---

## 8. 与现有规则的关系

- **CS01 归一化**：先查已有 —— `sandbox/utils/{killProcessTree,TimeoutController}` 复用；`LandlockDetector`
  的"平台门控 + 缓存"形态复用为模板；不新增第二套进程管理。
- **CD07（关键模块）**：本方案**只新增**，不删除 `landlock/**` / `docker/**` / `IsolationManager` 等任何关键模块。
- **CD05/CD06**：4 个独立提交，未接线阶段纯增量，回滚点清晰。
- **CS03 回退最小化**：只有"探测失败 ⇒ refuse"这一条真场景回退；不写"跑到一半降级成 plain"的兜底。
