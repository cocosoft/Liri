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
  // P6-2（2026-11-12 复查）：内存查询同样只读，此前落「未知 ⇒ ask」
  'free',
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
  // P3-2（2026-11-16）：git 从"前缀白名单"移出，改由 `isGitReadOnlyCommand` 做**参数级**判定
  // （`git config k v` / `git remote add` / `git branch -D` 曾因整族前缀放行而落 allow；
  //  `git -c core.pager=… log` 更可注入 pager 执行任意程序）。见该函数注释。
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
  /^(?:(?:node|npm|npx|pnpm|yarn|bun|deno|python\d*(?:\.\d+)*|py|pip|pip3|go|cargo|rustc|java|mvn|gradle|dotnet|git|tsc)\s+(?:--version|-v|-V|-version)|go\s+version)$/i;

// ─── bash：git 只读 ──────────────────────────────────────────

/**
 * git 只读子命令（**完整命令**正则，用于复合只读串联与单条只读判定）
 * 消费方：`compoundReadOnly.checkCompoundReadOnly`（单条与串联共用同一判据，FIX-16）
 *
 * P3-2/T2a（2026-11-16）：补入 `rev-list` / `shortlog` / `ls-tree` / `cat-file` /
 * `describe` / `name-rev` / `for-each-ref` / `blame` —— 实测（计划 §2.2）显示
 * `git rev-list --count HEAD`、`git shortlog -sne --all` 落在「未知命令 ⇒ 转人工」，
 * 而它们只写 stdout，与已放行的 `log` / `show` 同族。
 *
 * ⚠️ **刻意不含**（虽在同文件的 `GIT_READ_ONLY_SUBCOMMANDS` 中，但那个集合是
 * `readOnlyValidation` 的 token 级视图，含可写子命令）：
 * `tag` / `branch` / `remote` / `config` / `notes` / `bisect` / `stash`（可增删改）、
 * `archive` / `bundle`（`-o` 落文件）、`reflog`（`expire`/`delete` 写）、
 * `grep`（`--open-files-in-pager` 可执行任意程序）。
 * 两份清单**不得合并**（合并等于放开写能力）。
 */
export const GIT_READ_ONLY_PATTERN: RegExp =
  /^git(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|[^\s]+)|--no-pager|--no-optional-locks))*\s+(status|log|diff|show|rev-parse|rev-list|shortlog|ls-tree|cat-file|describe|name-rev|for-each-ref|blame|branch\s+--list|--version)(\s|$)/;

/**
 * P3-2（2026-11-16）：git 只读判定中**禁止出现**的参数（参数级禁区，**单一事实源**）。
 *
 * 三类会把「只读」变成「写盘 / 执行外部程序 / 注入配置」：
 *  - 写文件：`--output=<file>`（`git log/diff` 直接落盘）；
 *  - 执行外部程序：`--ext-diff`（外部 diff 驱动）、`--paginate`（分页器）、
 *    `--open-files-in-pager`、`--exec-path`；
 *    **T2c（2026-11-17）新增 `--textconv` / `--filters`** —— 二者都会调用仓库配置里的
 *    转换器（textconv / clean-smudge 过滤器）= 执行外部程序（探针实测此前为 allow：
 *    `git show --textconv HEAD`、`git cat-file --filters HEAD:x` 均被放行）；
 *  - 注入配置：全局 `-c key=value` —— 可设 `core.pager=sh -c id` / `alias.x=!cmd` /
 *    `core.hooksPath=…`，等价于任意命令执行（**本条即"pager 风险"的根因**；
 *    旧实现里 `GIT_READ_ONLY_PATTERN` 带 `/i`，把 `-c` 当成了合法的 `-C` 切目录开关）。
 *
 * ⚠️ **大小写敏感**：`-C <dir>`（切目录）是合法只读全局参数，不能被 `-c` 的规则误伤；
 * 也刻意**不**收录 `-p`（`git log -p` 是常见的补丁输出开关，与全局 `git -p` 语义不同）。
 * ⚠️ `--no-textconv` / `--no-ext-diff` 等 `--no-*` 反形态**不在**本表（它们是关闭开关，
 * 正则要求标志前是空白，`no-` 前缀天然不命中）。
 */
export const GIT_READ_ONLY_DENIED_FLAGS: readonly string[] = [
  '--output',
  '--ext-diff',
  '--paginate',
  '--open-files-in-pager',
  '--exec-path',
  '--config-env',
  '--textconv',
  '--filters',
  '-c',
];

/**
 * 由 `GIT_READ_ONLY_DENIED_FLAGS` **派生**的禁区正则（不手写第二份列表）。
 *
 * `maxPositional`（T2c 评估结论，**刻意不设上限**）：git 只读子命令的位置参数是
 * pathspec（`git log -- path/to/file`），数量不影响副作用面；真正危险的是"执行外部程序 /
 * 落盘 / 注入配置"，已由本禁区表覆盖 ⇒ 收紧位置参数数量只会造成误报。
 */
export const GIT_READ_ONLY_FORBIDDEN_ARGS: RegExp = new RegExp(
  `(?:^|\\s)(?:${GIT_READ_ONLY_DENIED_FLAGS.map((f) =>
    f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|')})(?:\\s|=|$)`
);

/**
 * P3-2（2026-11-16）：收窄后的「配置 / 远端 / 分支」**查询**形态。
 *
 * 旧前缀 `/^git\s+(…|branch|remote|config|blame)\b/i` 把整族当只读 ⇒
 * `git config --global user.name x`、`git remote add origin …`、`git branch -D main`
 * 全部落 `allow`（可写！）。此处只保留结构上不可能写的查询形态。
 */
export const GIT_READ_ONLY_QUERY_PATTERN: RegExp =
  /^git(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|[^\s]+)))*\s+(?:config\s+(?:--get|--get-all|--get-regexp|--list|-l)\b|remote\s+(?:-v|--verbose|show|get-url)\b|branch(?:\s+(?:--list|-a|--all|-r|--remotes|-v|-vv|--show-current))?\s*$)/;

/**
 * P3-2（2026-11-16）：git 只读判定的**统一入口**（allowlist 前缀链 / 复合只读共用一份判据）。
 *
 * 顺序：先过参数禁区（写盘 / 执行 / 注入配置），再看子命令白名单或收窄后的查询形态。
 * 返回 false **不等于** deny —— 调用方会继续走原分类链（未知命令 ⇒ 转人工审批）。
 */
export function isGitReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (GIT_READ_ONLY_FORBIDDEN_ARGS.test(trimmed)) return false;
  return (
    GIT_READ_ONLY_PATTERN.test(trimmed) ||
    GIT_READ_ONLY_QUERY_PATTERN.test(trimmed)
  );
}

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
  // 2026-11-17（真机会话 session_mwk2fakzf30b34b448）：Windows 的 `type` 是 `cat` 的等价物，
  // 此前遗漏 ⇒ 单条 `type x` 与 `cd /d X && type y` 全部落「未知命令 ⇒ ask」
  //（该会话 19 张审批卡中 10 张由此产生）。
  'type',
  // P9-6（2026-11-12）：单条 `cd` 只改子进程工作目录，本身不写盘
  'cd',
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
  // P9-2（2026-11-12）：`where` 只查找可执行文件路径，纯只读
  'where',
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
  // P6-2（2026-11-12 复查）：进程 / 网络 / 内存查看均为纯只读，此前落「未知 ⇒ ask」
  'ps',
  'netstat',
  'free',
  // P6-3（2026-11-12 绕过面复查）：Windows 只读系统信息 / 进程列表
  'systeminfo',
  'tasklist',
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
  // P9-1（2026-11-12）：管道里最常见的统计 / 解析 cmdlet（均为纯只读）
  'measure-object',
  'convertfrom-json',
  'convertto-json',
  // P11（2026-11-12 真机验证）：属性投影只读；计算属性（`@{…Expression={…}}`）由参数守卫拦
  'select-object',
  // P11（2026-11-12 真机验证）：文本搜索只读，此前落审批
  'findstr',
  // P6-3（2026-11-12 绕过面复查）：进程列表是纯只读 cmdlet
  'get-process',
  'get-wmiobject',
  // 2026-11-17（真机会话 session_mwk2fakzf30b34b448）：保守补齐**纯查询** cmdlet ——
  // 同一 `Get-*` 家族里 `Get-CimInstance` / `Get-PSDrive` 此前未收录 ⇒ 落「未知 ⇒ ask」。
  // 只收录"只读属性/状态查询"（不含 `Set-*` / `New-*` / `Remove-*` / `Invoke-*`）。
  'get-ciminstance',
  'get-psdrive',
  'get-service',
  'get-itemproperty',
  'get-acl',
  'get-member',
  'get-command',
  'get-help',
  'get-date',
  'get-filehash',
  'get-host',
  'resolve-path',
  'split-path',
  'join-path',
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

// ─── 只读命令的「参数级禁区」（P0，2026-11-22）──────────────────
//
// 背景（真机五道门实测，2026-11-22）：只读族此前按**命令名**放行 ⇒
// `find . -exec node evil.js +`、`find . -delete`、`rg --pre sh TODO`、
// `sort -o out.txt`、`uniq in.txt out.txt`、`tree -o out.txt`、`date -s …`
// 全部落 **allow**（零审批），而 `-exec` / `--pre` / `--compress-program` 都能执行外部程序。
//
// 参数级禁区此前**只在 auto 档**（`readonly-command-allowlist.violatesArgumentGuards`）实现
// ⇒ 主链（`BashSecurityAnalyzer` / `compoundReadOnly` / `checkBashAllowlist`）比 auto 档更松。
// 现收敛为本文件的**唯一判据**，三处消费者共用（新增守卫只改这里）。

/** 参数级禁区的命中结果 */
export interface ReadonlyArgViolation {
  /** 归一化命令名（小写、去目录与 `.exe`） */
  command: string;
  /** 命中的开关 / 位置参数（用于报文与审计） */
  flags: string[];
  /** 面向模型的完整报文（含可照抄的等价只读写法） */
  message: string;
}

/** `find` 中会执行子进程或写文件的表达式（`startsWith` 匹配，含 `-execdir` / `-fprintf` 等） */
const FIND_UNSAFE_ARGS: readonly string[] = [
  '-exec',
  '-ok',
  '-delete',
  '-fprint',
  '-fls',
];

/** `sort` 中会写文件或执行外部程序的开关 */
function isUnsafeSortArg(arg: string): boolean {
  return (
    arg === '-o' ||
    /^-o./.test(arg) || // `-oout.txt`
    arg === '--output' ||
    arg.startsWith('--output=') ||
    arg === '--compress-program' ||
    arg.startsWith('--compress-program=') ||
    /^\/o/.test(arg) // Windows `sort /O out.txt`
  );
}

/** `tree` 的输出文件开关（`-o out.txt` / `-oout.txt`） */
function isUnsafeTreeArg(arg: string): boolean {
  return arg === '-o' || /^-o./.test(arg);
}

/** `date` 的设置形态（`-s` / `--set` / 位置参数 —— Windows `date 01/01/2020` 会改系统日期） */
function isUnsafeDateArg(arg: string): boolean {
  if (arg.startsWith('+')) return false; // 只读格式串（`date +%Y-%m-%d`）
  if (arg === '-s' || arg.startsWith('--set')) return true;
  return !arg.startsWith('-');
}

/** `file` 的 magic 缓存编译开关（会写文件） */
function isUnsafeFileArg(arg: string): boolean {
  return arg === '-c' || arg === '--compile' || arg === '--compile-only';
}

/** 取首 token（去引号、去目录、去 `.exe/.cmd/.bat`、小写）与其余参数 */
function splitHeadAndArgs(command: string): { name: string; args: string[] } {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { name: '', args: [] };
  const head = (tokens[0] ?? '').replace(/^["']|["']$/g, '').replace(/[\\/]$/, '');
  const base = head.split(/[\\/]/).pop() ?? head;
  return {
    name: base.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase(),
    args: tokens.slice(1),
  };
}

/**
 * 判定一条（单段）命令是否命中「只读命令的参数级禁区」。
 *
 * 返回 `null` 表示**不适用**（命令不在守卫面内）—— 调用方继续原判定链；
 * 返回结果表示该命令**不是**只读形态，必须 deny（不可经审批放行：`-exec` / `--pre` /
 * `--compress-program` 直接执行外部程序，批准一次会连同审批规则一起长期放开）。
 */
export function findReadonlyArgViolation(
  command: string
): ReadonlyArgViolation | null {
  const { name, args } = splitHeadAndArgs(command);
  if (!name) return null;
  const lower = args.map((a) => a.toLowerCase());

  const violation = (flags: string[], message: string): ReadonlyArgViolation => ({
    command: name,
    flags,
    message,
  });

  if (name === 'find') {
    const flags = lower.filter((a) =>
      FIND_UNSAFE_ARGS.some((token) => a.startsWith(token))
    );
    if (flags.length > 0) {
      return violation(
        flags,
        `只读命令 find 带有执行/写入开关（${flags.join(' ')}），已拒绝执行。` +
          '等价只读写法：只做查找（如「find . -name "*.ts"」）；需要执行命令或删除文件时，请改用对应工具（bash 单条命令 / file_write / file_edit）。'
      );
    }
  }

  if (name === 'rg') {
    const flags = lower.filter((a) => a === '--pre' || a.startsWith('--pre='));
    if (flags.length > 0) {
      return violation(
        flags,
        'rg 的 --pre 会为每个文件执行外部程序，已拒绝执行。等价只读写法：去掉 --pre 直接搜索（如「rg TODO src」）。'
      );
    }
  }

  if (name === 'sort') {
    const flags = lower.filter(isUnsafeSortArg);
    if (flags.length > 0) {
      return violation(
        flags,
        `sort 的输出/压缩开关（${flags.join(' ')}）会写文件或执行外部程序，已拒绝执行。` +
          '等价只读写法：只打印（如「sort in.txt」），落盘改用 file_write。'
      );
    }
  }

  if (name === 'uniq') {
    // `uniq [INPUT [OUTPUT]]`：第 2 个位置参数是**输出文件**
    const positionals = lower.filter((a) => !a.startsWith('-'));
    if (positionals.length >= 2) {
      return violation(
        positionals.slice(1),
        'uniq 的第二个位置参数是输出文件，已拒绝执行。等价只读写法：只传输入（如「uniq in.txt」，需要落盘时改用 file_write）。'
      );
    }
  }

  if (name === 'tree') {
    const flags = lower.filter(isUnsafeTreeArg);
    if (flags.length > 0) {
      return violation(
        flags,
        'tree 的 -o 会写文件，已拒绝执行。等价只读写法：直接「tree .」查看，落盘改用 file_write。'
      );
    }
  }

  if (name === 'date') {
    const flags = lower.filter(isUnsafeDateArg);
    if (flags.length > 0) {
      return violation(
        flags,
        `date 的设置形态（${flags.join(' ')}）会修改系统时间，已拒绝执行。等价只读写法：「date」或「date +%Y-%m-%d」。`
      );
    }
  }

  if (name === 'file') {
    const flags = lower.filter(isUnsafeFileArg);
    if (flags.length > 0) {
      return violation(
        flags,
        'file -C 会生成 magic 缓存文件，已拒绝执行。等价只读写法：直接「file <路径>」。'
      );
    }
  }

  return null;
}

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
