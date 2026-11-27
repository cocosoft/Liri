# Windows 兜底沙箱（Low IL + Job Object）实施方案

> 版本 1.3 ｜ 日期 2026-10-26（2026-11-21 补执行记录；2026-11-21 晚复查：拦截归因 SAC + CI 硬证据闭合）｜ 状态：**已实施**（§4 五步全部落地；本机自证受 Smart App Control 阻断，覆盖由 CI `windows-latest` 闭合，见 §8.3）
> 关联：[`macos-sandbox-exec.md`](./macos-sandbox-exec.md)（同一档"OS 级兜底"，先例与口径复用）
> 上游依赖（2026-11-21 登记）：[`real-machine-governance-remediation.md`](./real-machine-governance-remediation.md)
> —— 该方案的 P2-3 只做「不参与判定」的只读披露对齐；**审批过期状态收敛（P1-2）不依赖本沙箱**，已先行落地。

---

## 1. 目标与非目标

**目标**：为 Windows 提供**可验证的 OS 级写隔离**，口径与 macOS/Linux 一致——「开启即真受限，否则拒绝执行，绝不静默降级」。

**非目标（v1 明确不做）**
- ❌ 不沙箱化 `bash`（Windows 上 `bashEnabled=true` 仍 `refuse/platform-unsupported`，**维持现状**）
  —— 原因见 §3.3（需改动用户仓库 ACL，副作用不可接受）
- ❌ 不做网络隔离（与 macOS 首版一致：只做写隔离）
- ❌ 不引入 Docker / Windows Sandbox（前者已 opt-in 存在；后者要求 Pro/EE 且是 VM）
- ❌ 不改 Linux / macOS 任何行为与默认值

---

## 2. 现状取证（均已回仓核）

| 事实 | 证据 |
|---|---|
| 本机 shell 完整性级别 = **Medium**（`S-1-16-8192`） | `whoami /groups` 实测 |
| Low IL SID = `S-1-16-4096`；MIC 默认策略 = **NO_WRITE_UP** ⇒ Low 进程可读 Medium、**不可写** | Windows 文档口径（本机可实证，见 §5） |
| `icacls.exe` 可用（设置/恢复目录强制标签用） | `C:\Windows\system32\icacls.exe` |
| 本机有 MSVC 14.44（`...\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`），但**未在 PATH** | `vswhere` + 目录探测 |
| CI Test Suite 矩阵 = `ubuntu-latest, windows-latest, macos-latest` | `.github/workflows/ci.yml:39` |
| `code_run` 的运行目录由我们创建（`prepareRunDir`），可自由改标签 | `tools/CodeRunner/CrossPlatformRunner.ts` |
| 现有 `code_run` 在非 Linux 直接走跨平台执行器（无 OS 约束） | `LinuxSandboxRunner.ts:290-305`（`runCodeRunnerSafely`） |

---

## 3. 设计

### 3.1 隔离机制：Low 完整性级别（MIC）+ Job Object

| 机制 | 解决什么 | 不能解决什么 |
|---|---|---|
| **Low IL 令牌**（`CreateRestrictedToken` → `SetTokenInformation(TokenIntegrityLevel)` → `CreateProcessAsUser`） | 子进程**无法写入** Medium/High 完整性对象（用户文档、仓库、`%APPDATA%` 等）—— 即"写不出边界" | 读、网络不受限（与 macOS 首版同口径） |
| **Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + 可选内存/进程数上限） | 父进程退出/被杀 ⇒ 子进程树**一并回收**（防孤儿） | 不是隔离，只是生命周期约束 |

**关键可行性依据**：`CreateProcessAsUser` 在「令牌是调用方自身令牌的**受限版本**」时**不要求 `SeAssignPrimaryTokenPrivilege`**
⇒ 普通用户权限即可，无需提权。降自己的完整性级别也无需特权（只能降不能升）。

### 3.2 新增原生 helper `win-sandbox-run.exe`

- 语言：**C11**（与 `sandbox/landlock/native/main.c` 同路线；CI `windows-latest` 用 MSVC 编译，见 §3.5）
- 源码：`packages/sandbox/src/sandbox/win/native/win_sandbox_run.c`（**编译产物不入库**；路径已按搬包后实测订正）
- CLI：

```
win-sandbox-run.exe [--mem-mb N] [--max-procs N] [--timeout-ms N] -- <program> [args...]
win-sandbox-run.exe --version
win-sandbox-run.exe --probe
```

`--probe`（2026-11-19 补）：**只验证能力、不执行任何外部程序** —— 建一次受限令牌 + Job Object
后即退出，输出单行 JSON `{"ok":true,"lowIl":true,"jobObject":true,"version":"0.2.0"}`；
失败输出 `{"ok":false,"reason":"low-il-failed|job-object-failed|job-limit-failed",...}` + 退出码 126。
TS 侧 `sandbox-probe` 据此给出 `helper.runnable`（此前固定 `null` + `probe-unsupported`）。

约定：
- 只做「降 IL + 建 Job + 起进程 + 转发退出码/信号」，**不做路径授权**（授权由 TypeScript 侧对**自有目录**做，见 §3.4）；
- stdout/stderr 直接继承（Node 侧已用 pipe 接），helper 不缓冲、不改写；
- 退出码：子进程退出码原样返回；helper 自身失败 ⇒ **`126`**（**不复用 125** —— 125 是 landlock 的"初始化失败"
  语义，复用会与「用户命令恰好退出 125」混淆，macOS 侧已踩过该坑）；超时 ⇒ `124`；参数错误 ⇒ `2`。

### 3.3 为什么 v1 不做 bash（决策与代价，如实）

Low IL 进程**默认不能写** Medium 目录。要让 bash 能写工作区，只有两条路：

| 方案 | 做法 | 代价（不可接受点） |
|---|---|---|
| 给目录加 Low IL 的显式 ACE | `icacls "<cwd>" /grant *S-1-16-4096:(OI)(CI)(M)` | **修改用户仓库 ACL**；helper 崩溃/被杀会残留；并发/多仓切换时互相污染 |
| 把目录强制标签降为 Low | `icacls "<cwd>" /setintegritylevel (OI)(CI)Low` | 同上，且所有 Medium 进程对该目录的写策略都会变 |

⇒ v1 只覆盖 `code_run`：其运行目录是**我们自己的临时目录**，降标签/授权不触碰用户资产。
`bash` 在 Windows 上继续 `refuse/platform-unsupported`（**与今天行为一致**，不是回退）。

> **2026-11-07 复核（P2 追加决策）**：用户曾要求「bash 接入 win-sandbox-run，默认启用」；
> 复核本文件 §3.3 后确认**阻塞仍在**（helper 无路径授权，Low IL 需给仓库改 ACL），
> 用户拍板 **「保持不沙箱 + 补齐可观测」**。落地内容：
> - `describeSandboxPosture` 增 `bashSandboxReason: 'enforced' | 'switch-off' | 'platform-unsupported'`，
>   Windows 报 `bash-sandbox-unsupported`（不再含糊地说"开关没开"）；
> - bash 首次 plain 执行落一次 `bash: sandbox_degraded`（含 `why` / `ref`，指向本节）；
> - `code_run` 的沙箱拒绝补归因码 `sandbox_denied: init | write`；
> - 设置页「当前安全姿态」如实显示上句，避免误以为"打开开关就受保护"（在 Windows 打开只会全部拒绝）。

### 3.4 接线（与 macOS 完全同形）

| 层 | 文件 | 改动 |
|---|---|---|
| 探测 | `sandbox/win/WindowsSandboxDetector.ts` | 找 helper（`WIN_SANDBOX_HELPER` → `<PROJECT_DIR>/bin/win-sandbox-run.exe` → PATH）；返回 `{ available, reason? }` |
| 执行器 | `sandbox/win/runWithWinSandbox.ts` | `spawn(helper, ['--timeout-ms', …, '--', exe, ...args])`；超时/输出上限/abort 强杀（复用 `killProcessTree` 与 `appendWithinLimit`） |
| 目录授权 | `tools/CodeRunner/WindowsSandboxRunner.ts` | 对 `runDir` 打 Low 强制标签：`icacls "<runDir>" /setintegritylevel (OI)(CI)Low`（失败 ⇒ 按 `failClosed` 拒绝，不降级）；退出时恢复为 Medium（`/setintegritylevel (OI)(CI)Medium`） |
| 调度 | `LinuxSandboxRunner.runCodeRunnerSafely` | 在 darwin 分支之后加 `win32` 分支（顺序：darwin → win32 → landlock → 跨平台） |
| 开关 | 复用 `sandbox.landlock.{enabled,failClosed}` | **不新增配置键**（与 macOS 同一决策：键名是历史包袱，语义是"OS 级沙箱"） |
| 文档 | `sandbox/landlock/config.ts` 头注 | 补 Windows 口径 |

### 3.5 失败模式

| 场景 | 行为 |
|---|---|
| `enabled=false` | 跨平台执行器（与今天一致） |
| helper 缺失 | `failClosed=true` ⇒ `security-rejected`；`false` ⇒ 降级 + warn |
| helper 自身失败（exit 126） | 按 `failClosed` 拒绝（`security-rejected`）或降级 + warn |
| `icacls` 打标失败 | **拒绝**（无法证明写隔离成立时不得声称受限） |
| 子进程超时/取消 | `killProcessTree` + Job 的 kill-on-close 双保险 |
| 子进程 `exit 125` | **不得**被误判为"helper 初始化失败"（126/125 分离后天然成立） |

---

## 4. 交付拆分（每步独立提交、可回滚）

| # | 提交 | 内容 | 验证 |
|---|---|---|---|
| 1 | `feat(sandbox): add win-sandbox-run helper (low IL + job object)` | C 源码 + `build:win-sandbox` 构建脚本 + 本机编译通过 | 本机 `cl` 编译；手工跑 `-- echo ok` 与"写 Desktop 失败" |
| 2 | `feat(sandbox): detector + runner for windows sandbox` | 探测器 / 执行器 / 单测（注入式，不依赖真 helper） | tsc / eslint / 单测 |
| 3 | `feat(sandbox): code_run windows runner` | `WindowsSandboxRunner` + 调度分流 + `icacls` 打标/恢复 | 本机实跑：runDir 内可写、Desktop 不可写 |
| 4 | `feat(ci): build + verify win-sandbox helper on windows-latest` | CI windows job 编译 helper 并跑负向用例 | CI 绿 |
| 5 | `docs(evidence): 登记 windows 兜底沙箱` | 台账 + spec/配置头注 | 台账三门禁 |

---

## 5. 验证计划（本机可闭合，不像 macOS 只能等真机）

| 层 | 用例 | 位置 |
|---|---|---|
| 单测 | 探测器三态；argv 形状；超时/输出上限/abort 调用 | `app/tests/sandbox/winSandbox*.test.ts` ✅ CI 全平台 |
| 本机实跑 | ① runDir 内写成功；② `%USERPROFILE%\Desktop` 写失败（Access Denied）；③ 子进程 `exit 125` 原样透传；④ 父进程被杀 ⇒ 子进程消失 | `app/scripts/verify-win-sandbox.ts`（与 macOS 同款自证脚本） |
| CI | windows-latest 编译 helper + 跑 ①–④ | `.github/workflows/ci.yml` 新增步骤（仅 `matrix.os == 'windows-latest'`） |

---

## 6. 风险与待确认

| 风险 | 说明 | 处置 |
|---|---|---|
| 令牌/权限差异（域账户、受限用户、UAC 提升态） | `CreateProcessAsUser` 对自身受限令牌免特权是文档口径，但**非域环境未实测** | 本机（本地账户、Medium IL）先验；CI windows runner 也是本地账户 ⇒ 两种环境覆盖 |
| `icacls` 打标残留 | 若进程被强杀，runDir 仍是 Low 标签 | runDir 位于受管临时目录、且启动时清理；恢复失败仅记 warn（目录本身是一次性的） |
| bun 可执行文件位置 | 若 bun 装在**不可读**位置，Low IL 起不来（MIC 允许读 Medium，故正常）；`Program Files` 亦可读 | 探测阶段跑一次 `-- echo ok` 自检，失败按"不可用"处理 |
| Windows 10 老版本 | MIC 自 Vista 起可用；Job Object 自 XP | 无需版本门控，仅按"能否跑通自检"判定 |

---

## 7. 与现有规则的关系

- **CD07（关键模块）**：本方案**只新增** Windows 路径；不删 `landlock/**`、`docker/**`、`IsolationManager` 等。
- **CS01**：复用 `killProcessTree` / `appendWithinLimit` / `ProcessRegistry` 的 `PROCESS_STATUS` 常量；
  探测/执行器形态与 `sandbox/darwin/*` 对称，不另造第二套。
- **CS03**：只有"探测/打标失败 ⇒ 拒绝"这一条真回退；不写"跑一半降级 plain"。
- **CD06**：5 个独立提交，第 1 步纯增量（未接线），每步可单独 revert。

---

## 8. 执行结果与偏差（2026-10-26 落地；2026-11-21 复查补齐）

### 8.1 §4 五步交付全部落地

| # | 交付 | 落点 |
|---|---|---|
| 1 | helper 源码 + 构建脚本 | `packages/sandbox/src/sandbox/win/native/win_sandbox_run.c`、`app/scripts/build-win-sandbox.ts`（`bun run build:win-sandbox`） |
| 2 | 探测器 + 执行器 | `packages/sandbox/src/sandbox/win/{WindowsSandboxDetector,runWithWinSandbox,helperPaths,index}.ts` |
| 3 | `code_run` Windows 执行器 + 调度分流 | `app/src/tools/CodeRunner/WindowsSandboxRunner.ts`、`LinuxSandboxRunner.runCodeRunnerSafely` 的 `win32` 分支 |
| 4 | CI 编译 + 实测 | `.github/workflows/ci.yml`：`windows-latest` 的 `build:win-sandbox` / `verify:win-sandbox`，以及独立 `win-helper-probe` 作业（`cl` 编译 + `--version` / `--probe` 契约） |
| 5 | 台账登记 | `.trae/architecture/fix-evidence-registry.json`（C 源码 / 探测器 / 执行器 / 两个脚本均在 `code` 列表） |

`--probe` / `--version`（2026-11-19 补）已实现，探测器据此给出 `runnable`（不再用 `available` 冒充）。

### 8.2 2026-11-21 复查发现并修复的三处缺口

真机复查（本机 Windows，`bun run build:win-sandbox` → `verify:win-sandbox`）暴露：

1. **spawn 同步抛出未归一**：helper 被系统策略拦下时，Bun 的 `spawn` **同步抛出** `EUNKNOWN: uv_spawn`（不像 Node 发 `error` 事件），导致 `verify` / `code_run` 直接崩异常栈。
   修复：`runWithWinSandbox` 与 `WindowsSandboxRunner` 均用 try/catch 归一为 **`helperFailed`**，交由 `failClosed` 决策（拒绝或降级），不抛给调用方。
2. **探测结果未被消费**：`WindowsSandboxRunner` 只看 `available`（文件存在），忽略 `runnable === false`（`--probe` 实测失败）。
   修复：`!available || runnable === false` 同等视为不可用；`verify-win-sandbox.ts` 也只在 `runnable === true` 时继续（否则退出 2 并打印 `reasonCode`）。
3. **C 格式串宽窄混用**：`wprintf(L"...%s", const char*)` 触发 MSVC `C4477`。
   修复：5 处改为 `%hs`（构建已零 warning）。

### 8.3 本机验证边界（如实记录）

| 步骤 | 结果 |
|---|---|
| `bun run build:win-sandbox` | ✅ 编译通过（MSVC 14.44，产物 `bin/win-sandbox-run.exe`，不入库） |
| 直接运行 helper | ❌ 宿主报「应用程序控制策略已阻止此文件」 |
| 策略诊断（2026-11-21，只读） | `Smart App Control = 开启`（`VerifiedAndReputablePolicyState=1`）+ `C:\Windows\System32\CodeIntegrity\CiPolicies\Active` 下有 **8 条 WDAC 策略** |
| **拦截归因（2026-11-21 晚，只读）** | CodeIntegrity 事件 **3077 / 3033**（`Microsoft-Windows-CodeIntegrity/Operational`）指名 Policy ID **`{0283AC0F-FFF1-49AE-ADA1-8A933130CAD6}`**；该 `.cip` 内部字符串含 `VerifiedAndReputableDesktop` / `VerifiedAndReputableTrustMode` / `ISGSmartscreenTrustSuppressed` ⇒ **Smart App Control 策略**，非自定义企业 WDAC；`Start-Process` 直接报「应用程序控制策略已阻止此文件」；当前会话 `elevated=False` |
| `bun run verify:win-sandbox` | ⚠️ 退出 **2**（`probe-failed`）—— 现在会打印上述两条诊断，不再只给一句"未通过" |
| `bun test tests/sandbox` | ✅ 247 pass / 0 fail（含新增「helper 起不来 ⇒ helperFailed」用例） |
| `lint:sandbox` / `typecheck` | ✅（0 error） |
| **CI 硬证据（`49b96b5a7`，`windows-latest`）** | ✅ `Build win-sandbox helper (low IL + job object)` 与 `Verify Windows sandbox (low IL write isolation)` **均 success**（job `Test Suite (windows-latest)`），即 §5 的 ①–④ 实跑断言在不含 SAC 的 runner 上已闭合 |

⇒ **本机自证结案方式（2026-11-21 用户裁定）**：本机拦截发生在 `CreateProcess` 阶段（SAC 无按应用白名单），**不关闭 SAC、不改宿主安全姿态**；§5 ①–④ 的实跑覆盖由 CI `windows-latest` 承担，作为可审计的硬证据。`verify-win-sandbox.ts` 的失败分支保留只读诊断，用于在其他机器上快速归因。

若未来某台机器必须本机自证，仍只有三条**受支持**的路径（均需管理员，脚本不代做、也不绕过安全策略；本仓**不采用**）：
1. 关闭 Smart App Control（**注意**：关闭后重新开启需重装系统）——个人开发机才可考虑；
2. 用受信任证书给 `win-sandbox-run.exe` 签名（企业环境首选；SAC 下仍受 ISG 声誉约束）；
3. 由管理员在 WDAC 策略中把该 helper 加入允许清单并重启策略（SAC 开启时可能仍被其自身策略拦截）。

### 8.4 2026-11-27：REPL 接入时发现的三个真问题（已修）

SG-1 把 REPL / notebook 执行面接进 Low IL 后，真机冒烟暴露并修复：

1. **`(IO)` 标签被误当成目录自身的级别**：本机 `C:\` 带
   `Mandatory Label\High Mandatory Level:(OI)(NP)(IO)(NW)` —— `(IO)` 是**继承专用**，对 `C:\` 自己不生效，
   但 `parseIntegrityLevel` 只看关键词 ⇒ 把"父目录无显式标签"的 `~/.pyapp/attachments` 推算成 `High`。
   修复：解析时**跳过含 `(IO)` 的行**（`bashWindowsSandbox.parseIntegrityLevel`）。
2. **降级了恢复不了的级别**：把标签**提升**到 High/System 需要 `SeRelabelPrivilege`（普通用户没有）
   ⇒ 一旦把 `High` 目录降为 Low 就永久留在 Low（真机已发生一次，已人工恢复为 Medium）。
   修复：`grantOne` 在 `restoreLevel ∈ {High, System}` 时**跳过该目录**（不进 `failures`，会话仍可用，
   该目录在域内不可写 = 安全方向），并在 `WindowsBashGrantSession.skipped` 如实返回；
   `cleanupStaleWindowsBashGrants` 对旧台账里的 High/System 条目改恢复为 **Medium** 并留 WARN。
3. **`.cmd/.bat` 无法被 helper 直接 `CreateProcess`**（`npx` 即此形态）：REPL 的 `typescript` 语言此前只能降级。
   修复：`replSandboxSpawn` 用 `where.exe` 解析出 `.cmd/.bat` 后，经 `cmd.exe /d /s /c` +
   **环境变量转交**命令文本（复用 `buildWindowsBashInvocation`，变量名 `LIRI_REPL_CMD`）。
   **参数一律按 MSVCRT（`CommandLineToArgvW`）规则加引号**（`quoteWindowsCommandLineArg`）：
   含空格/引号的值可保真（`x"y` ⇒ `"x\"y"`，结尾反斜杠 `C:\dir\` ⇒ `"C:\dir\\"`），
   且 `& | < > ^` 因落在引号内成为字面量。仅 `%`（cmd 会在引号内也做变量展开）与 **换行**
   （会截断命令文本）仍如实降级（`windows-cmd-unsafe-args`）。
   真机实测（cmd → 批处理 `%*` → node）：`"x\"y"` 与 `"x""y"` 都能让 node 拿到 `x"y`，`^"` 会丢引号
   ⇒ 取 CRT 规则（与 `spawn(..., windowsVerbatimArguments:false)` 同语义）。

真机冒烟（本机）：`mode=windows-low-il`，`args=… -- C:\Windows\system32\cmd.exe /d /s /c %LIRI_REPL_CMD%`，
`LIRI_REPL_CMD="…\probe.cmd"`，`exit=0 stdout=SMOKE_OK`，授权/恢复全部成功、台账归零。
**含引号参数冒烟（2026-11-27 补）**：`args=[a b, x"y, C:\dir\]` ⇒
`LIRI_REPL_CMD="…\probe.cmd" "a b" "x\"y" "C:\dir\\"` ⇒ 批处理 `%*` 转交 node，
`node-argv=["a b","x\"y","C:\\dir\\"]`、`exit=0`（逐字保真）。

`verify-win-sandbox.ts` 的失败分支现已内置**只读诊断**（读上述注册表键与策略目录），把"为什么不可用"直接打在输出里。
