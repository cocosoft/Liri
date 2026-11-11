// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 只读命令目录（P2-3，2026-11-03）
 *
 * 背景：`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5 P2-3 ——
 * bash / PowerShell 的"只读命令"此前**各写一份**：
 * - `security/BashAllowlistMatcher.ts`（前缀正则，混入 PS 命令）
 * - `security/compoundReadOnly.ts`（基命令集合 + 版本查询 + git 只读正则）
 * - `security/readOnlyValidation.ts`（git 只读子命令集合）
 * - `security/BashSecurityAnalyzer.isReadOnlyCommand()`（方法内再内联一份）
 * - `app/src/tools/PowerShellTool/PowerShellTool.ts`（PS 允许前缀 + 只读动词）
 *
 * 归一化口径（**行为零变化**）：本文件只是这些清单的**唯一存放处**，
 * 各消费方按 shell 引用自己的子集；判定算法（前缀 / 基命令 / 复合串联）仍留在原模块。
 * 新增只读命令只改这里 —— `lint:permission-single-source` 禁止在别处再写一份。
 */

// ─── bash / cmd：基命令（复合只读判定用） ────────────────────────

/**
 * 只读基命令（两平台常用者；不含任何可写/可执行/可交互命令）
 * 消费方：`compoundReadOnly.checkCompoundReadOnly`
 */
export const READ_ONLY_BASE_COMMANDS: ReadonlySet<string> = new Set([
  'dir',
  'ls',
  'findstr',
  'type',
  'cat',
  'head',
  'tail',
  'more',
  'less',
  'grep',
  'rg',
  'where',
  'which',
  'find',
  'tree',
  'echo',
  'whoami',
  'hostname',
  'ver',
  'uname',
  'pwd',
  'cd',
  'chcp',
  'systeminfo',
  'tasklist',
  // P1（2026-11-07 真机）：查看端口/连接是只读操作，此前被白名单门硬拒
  'netstat',
  'ps',
  'df',
  'du',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'stat',
  'file',
  'md5sum',
  'sha256sum',
  'date',
]);

// ─── bash：前缀白名单 ────────────────────────────────────────

/** 已知安全的 bash 只读命令前缀（消费方：`BashAllowlistMatcher.checkBashAllowlist`） */
export const BASH_READ_ONLY_PREFIX_PATTERNS: readonly RegExp[] = [
  /^ls\b/i,
  /^dir\b/i,
  /^pwd\b/i,
  /^cd\b/i,
  /^cat\b/i,
  /^type\b/i,
  /^head\b/i,
  /^tail\b/i,
  /^grep\b/i,
  /^find\b/i,
  /^locate\b/i,
  /^git\s+(status|diff|log|branch|show|rev-parse|remote|config|blame)\b/i,
  /^echo\b/i,
  /^printf\b/i,
  /^wc\b/i,
  /^sort\b/i,
  /^uniq\b/i,
  /^date\b/i,
  /^whoami\b/i,
  /^id\b/i,
  /^uname\b/i,
  /^which\b/i,
  /^where\b/i,
  /^whereis\b/i,
  /^env\b/i,
  /^printenv\b/i,
  /^df\b/i,
  /^du\b/i,
  /^free\b/i,
  /^ps\b/i,
  /^top\b/i,
  /^tree\b/i,
  /^file\b/i,
  /^stat\b/i,
  /^md5sum\b/i,
  // P1（2026-11-07 真机）：只读网络诊断
  /^netstat\b/i,
];

/** 已知安全的 PowerShell 只读命令前缀（消费方同上，按 shell 适配） */
export const POWERSHELL_READ_ONLY_PREFIX_PATTERNS: readonly RegExp[] = [
  /^(Get-ChildItem|Get-Content|Get-Location|Select-String|Get-Process)\b/i,
];

/**
 * 解释器 / 构建器的**只读版本查询**（LRO-D3，2026-10-26）。
 *
 * 只认"命令 + 版本开关"的**完整命令** —— 不把解释器本身加入只读白名单：
 * `node script.js` 仍是"未知命令"，照旧走审批。
 */
export const VERSION_ONLY_QUERY_PATTERN: RegExp =
  /^(node|npm|npx|pnpm|yarn|bun|deno|python|python3|pip|pip3|go|cargo|rustc|java|mvn|gradle|dotnet|git|tsc)\s+(--version|-v|-V)$/i;

// ─── bash：git 只读 ──────────────────────────────────────────

/**
 * git 只读子命令（**完整命令**正则，用于复合只读串联）
 * 消费方：`compoundReadOnly.checkCompoundReadOnly`
 */
export const GIT_READ_ONLY_PATTERN: RegExp =
  /^git(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|[^\s]+)|--no-pager|--no-optional-locks))*\s+(status|log|diff|show|rev-parse|branch\s+--list|--version)(\s|$)/i;

/**
 * git 只读子命令（**token 级**集合，用于 `readOnlyValidation` 的参数扫描）
 * 消费方：`readOnlyValidation`
 */
export const GIT_READ_ONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'tag',
  'ls-tree',
  'rev-list',
  'rev-parse',
  'remote',
  'config',
  'describe',
  'name-rev',
  'shortlog',
  'stash list',
  'blame',
  'grep',
  'bisect',
  'bisect log',
  'bisect visualize',
  'reflog',
  'notes',
  'archive',
  'bundle',
  'cat-file',
  'for-each-ref',
  'var',
]);

// ─── bash：快速只读基命令（BashSecurityAnalyzer） ───────────────

/**
 * `BashSecurityAnalyzer.isReadOnlyCommand()` 的快速判定集合。
 *
 * 注意：这是**宽松版**（含 `node` / `git` 等解释器），与 `READ_ONLY_BASE_COMMANDS`
 * 的严格口径不同 —— 两者用途不同，**不得互换**（合并会把"复合只读"放松成安全事故）。
 */
export const BASH_QUICK_READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'grep',
  'find',
  'which',
  'whereis',
  'type',
  'echo',
  'printf',
  'pwd',
  'whoami',
  'id',
  'date',
  'uname',
  'hostname',
  'df',
  'du',
  'git',
  'npm',
  'yarn',
  'pnpm',
  'bun',
  'node',
  'python',
  'python3',
]);

// ─── PowerShell：允许前缀 + 只读动词 ──────────────────────────

/**
 * PowerShell 安全命令白名单（F3）—— 仅允许以这些动词/命令开头执行。
 * 消费方：`PowerShellTool`
 */
export const POWERSHELL_ALLOWED_COMMAND_PREFIXES: ReadonlySet<string> = new Set([
  // 查询类（只读）
  'get-',
  'test-',
  'resolve-',
  'measure-',
  'compare-',
  'select-',
  'where-',
  'group-',
  'sort-',
  'format-',
  'out-',
  'export-',
  'write-',
  'read-',
  'convertto-',
  'convertfrom-',
  // 诊断类
  'debug-',
  'trace-',
  // 安全辅助
  'checkpoint-',
  'diff-',
  // G4（2026-11-03）：纯只读路径拼接（无 I/O 副作用）
  'join-path',
  // 允许的文件操作
  'new-item',
  'mkdir',
  'md',
  'copy-item',
  'copy',
  'cpi',
  'move-item',
  'move',
  'mi',
  'mv',
  'rename-item',
  'rename',
  'ren',
  'rni',
  // 解压类（zip/tar，低危文件操作）
  'expand-archive',
  'tar',
  // 环境变量
  'get-variable',
  'set-variable',
  // 进程信息（只读）
  'get-process',
  'get-service',
  // 帮助
  'get-help',
  'help',
  'man',
  // 构建工具相关
  'npm',
  'node',
  'bun',
  'yarn',
  'pnpm',
  // 包执行器
  'npx',
  'bunx',
  'pnpx',
  'git',
  'python',
  'python3',
  'pip',
  'cargo',
  'rustc',
  // 目录导航（每次调用都是新进程 ⇒ 无持久副作用）
  'cd',
  'set-location',
  'push-location',
  'pop-location',
  'get-location',
  'pwd',
  // 基本命令
  'echo',
  'write-host',
  'write-output',
  // 方案八 8b：只读文本搜索放行
  'findstr',
]);

/**
 * PowerShell 只读命令判定（`PowerShellTool.isReadOnly` / `isConcurrencySafe`）。
 * 消费方：`PowerShellTool`
 */
export const POWERSHELL_READ_ONLY_COMMAND_PATTERNS: readonly RegExp[] = [
  /^get-/,
  /^test-/,
  /^resolve-/,
  /^get-.*-readonly/i,
  /^out-/i,
];

// ─── auto 模式：单一命令只读白名单（B4 follow-up，2026-11-09） ────

/**
 * auto 模式「只读命令短路」的**严格**白名单（只认**单一**命令，无组合 / 展开）。
 *
 * 与上面清单的分工（**不得互换**）：
 * - `READ_ONLY_BASE_COMMANDS`：复合只读判定的**基命令**（允许 `a && b` 串联）；
 * - `BASH_QUICK_READ_ONLY_COMMANDS`：`BashSecurityAnalyzer` 的宽松版（含解释器）；
 * - 本集合：单条命令直接放行，故**刻意不含**任何可能执行子进程或写文件的命令
 *   （`sed` / `awk` / `xargs` / `less` / `more` 均不在内）。
 *
 * 消费方：`permission/classifiers/readonly-command-allowlist`
 */
export const AUTO_MODE_READONLY_COMMANDS: ReadonlySet<string> = new Set([
  // 文件 / 目录查看
  'ls',
  'dir',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'find',
  'grep',
  'egrep',
  'fgrep',
  'stat',
  'file',
  'tree',
  'du',
  'df',
  'diff',
  'cmp',
  'which',
  'whereis',
  // git 本身按子命令约束（见 AUTO_MODE_GIT_READONLY_SUBCOMMANDS）
  'git',
  // 输出 / 环境查看
  'echo',
  'date',
  'cal',
  'uname',
  'whoami',
  'id',
  'groups',
  'printenv',
  // 校验和 / 文本过滤（不落盘）
  'md5sum',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'sort',
  'uniq',
  'cut',
  // PowerShell 7 只读 cmdlet
  'get-childitem',
  'get-content',
  'get-item',
  'test-path',
  'get-location',
  'select-string',
  // 2026-11-12（P0 · 未知命令策略 B）：集群 / 容器 / 代码托管的**只读子命令**入口。
  // 命令名在此、具体子命令由 `readonly-command-allowlist` 的参数守卫限定；
  // 写子命令（`kubectl delete` / `docker run` / `gh pr merge`）不放行，落审批档。
  'kubectl',
  'docker',
  'gh',
]);

/**
 * `git` 的只读子命令（auto 模式短路用）。
 *
 * 比 `GIT_READ_ONLY_SUBCOMMANDS` **更严**：后者供"参数扫描"用，含 `branch` / `remote` /
 * `config` / `stash` / `archive` 等**可写**子命令；短路直接放行 ⇒ 只保留纯读取者。
 */
export const AUTO_MODE_GIT_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'diff',
  'log',
  'show',
  'blame',
  'rev-parse',
  'describe',
  'shortlog',
  'ls-files',
  'ls-tree',
  'cat-file',
  'grep',
]);

/**
 * 集群 / 容器 / 代码托管 CLI 的**只读子命令**（P1c，2026-11-12 从
 * `readonly-command-allowlist.ts` 迁入；该文件原先各有一份字面集合）。
 *
 * 迁入本文件的原因：只读目录**唯一事实源**在此（门禁 `lint:permission-single-source`
 * 的 `CANONICAL_FILES.readOnly`）。命令语义注册表 `commandSpecs.ts` 只**引用**这些常量，
 * 不再复制字面量。
 */
export const AUTO_MODE_KUBECTL_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'get',
  'describe',
  'logs',
  'top',
  'explain',
  'api-resources',
  'api-versions',
  'version',
  'cluster-info',
  'events',
]);

export const AUTO_MODE_DOCKER_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'ps',
  'images',
  'logs',
  'inspect',
  'version',
  'info',
  'stats',
  'top',
  'port',
  'diff',
  'search',
]);

/** `gh` 用「两段式子命令」（`pr view` / `run list` …） */
export const AUTO_MODE_GH_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'pr view',
  'pr list',
  'pr diff',
  'pr checks',
  'pr status',
  'issue view',
  'issue list',
  'issue status',
  'run list',
  'run view',
  'run download',
  'repo view',
  'release list',
  'release view',
  'status',
  'auth status',
  'config get',
]);
