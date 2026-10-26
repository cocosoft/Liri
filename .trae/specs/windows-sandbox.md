# Windows 兜底沙箱（Low IL + Job Object）实施方案

> 版本 1.0 ｜ 日期 2026-10-26 ｜ 状态：**方案定稿，按此执行**
> 关联：[`macos-sandbox-exec.md`](./macos-sandbox-exec.md)（同一档"OS 级兜底"，先例与口径复用）

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

- 语言：**C11**（与 `sandbox/landlock/native/main.c` 同路线；本机与 CI 均有 MSVC）
- 源码：`app/src/sandbox/win/native/win_sandbox_run.c`（**编译产物不入库**）
- CLI：

```
win-sandbox-run.exe [--mem-mb N] [--max-procs N] --timeout-ms N -- <program> [args...]
```

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
