/**
 * Bash 工具
 *
 * 提供安全的 Shell 命令执行功能
 * 对标CC源码 src/tools/BashTool/BashTool.ts 实现
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  PermissionResult,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { createBashProgress } from '../types/ToolProgress';
import { ToolUtils } from '../utils/ToolUtils';
import type { InterruptBehavior } from '../types/Tool';
import { ToolTag } from '../types/Tool';
import { BashSecurityAnalyzer } from '@modules/security';
// eslint-disable-next-line no-restricted-imports
import {
  parseForSecurity,
  isDangerousCommand,
  type ParseForSecurityResult,
} from '@modules/security/bash/BashAST';
import type { ExecOptions } from 'child_process';
import { analyzeBashCommandType, isSilentBashCommand } from './BashSemantics';
// G1-A（2026-09-26）：bash 执行的唯一收敛入口 —— 配置显式开启时在 Landlock 域内执行
// （G1-C 的顾问性提示已随之收敛到该入口的"普通路径"分支内）
import { execBashCommand } from './bashLandlockExec';
import { SandboxSecurityChecker } from '@modules/sandbox';
import { completeSecuritySystem, stripSensitiveEnv } from '@modules/security';
import { feature } from '@modules/core';

// ── K-5 内存阈值治理：BashTool 大输出源头截断常量 ──────────────
/**
 * K-5 P1 软截断阈值（默认 2MB）。超过此阈值后返回前缀 + 标注，避免超大输出打爆上下文/内存。
 * 注意：这是工具层的"用户可见返回"截断，不等于 exec 内部的 maxBuffer；
 *       两者同时生效，双层防护（硬防线 16MB > 软截断 2MB）。
 */
const BASH_OUTPUT_SOFT_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MB
/**
 * K-5 P1 硬截断阈值（默认 16MB）。传给 child_process.exec 的 maxBuffer。
 * 超过此阈值底层 execAsync 会直接抛错（ERR_CHILD_PROCESS_STDIO_MAXBUFFER），
 * 防止 10GB 级 cat /dev/zero 把 Node 进程拉爆。对齐 sandbox 策略。
 */
const BASH_EXEC_MAX_BUFFER_BYTES = 16 * 1024 * 1024; // 16 MB
/** 工具返回中标注截断信息的最大样本（保留多少原始尾部上下文） */
const BASH_TRUNCATED_TAIL_BYTES = 20 * 1024; // 20 KB 尾部，便于定位最后报错
// 工具执行审批链路（P0-4）：已批准命令放行缓存
import {
  ApprovedCommandRegistry,
  getApprovedCommandRegistry,
  hashCommandForExecution,
} from '@modules/permission';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\bash\BashTool');

/**
 * BashTool 输入模式 - 对标CC Zod校验
 * 安全审计修复：移除 skipSecurityCheck 参数，安全检查强制运行，不可绕过
 */
const BashInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的Bash命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(60000)
    .describe('执行超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  env: z.record(z.string()).optional().describe('环境变量'),
});

/**
 * BashTool 输出模式 - 对标CC
 */
const BashOutputSchema = z.object({
  stdout: z.string().describe('标准输出'),
  stderr: z.string().describe('错误输出'),
  exitCode: z.number().int().describe('退出码'),
});

/**
 * 危险命令列表 - 对标CC源码安全策略
 */
const DANGEROUS_COMMANDS = [
  'rm -rf',
  'sudo',
  'su',
  'chmod',
  'chown',
  'dd',
  'mkfs',
  'fdisk',
  'format',
  'shutdown',
  'reboot',
  'poweroff',
  'kill',
  'killall',
  'pkill',
  'openssl',
  'ssh-keygen',
  'passwd',
  'useradd',
  'userdel',
  'groupadd',
  'groupdel',
  'usermod',
  'groupmod',
  'chroot',
  'mount',
  'umount',
  'systemctl',
  'service',
  'init',
];

/**
 * 危险模式列表（正则表达式）- 对标CC源码
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/,
  />\s*\/dev\/null/,
  /\|\s*sh$/,
  /\$\([^)]*\)/,
  /`[^`]+`/,
  /;\s*rm\s+/,
  /&&\s*rm\s+/,
  /\|\|\s*rm\s+/,
  /eval\s*\(/,
  /exec\s+/,
  /source\s+/,
];

/**
 * 安全命令白名单（F3 修复）
 * 仅允许以这些基命令开头的命令执行，防止任意命令注入
 * 注意：路径类命令（如 ./node_modules/.bin/xxx）也需处理
 */
const ALLOWED_COMMANDS = new Set([
  // 开发工具
  'npm',
  'npx',
  'node',
  'bun',
  'yarn',
  'pnpm',
  // 版本控制
  'git',
  // 文件查看（只读）
  'dir',
  'ls',
  'type',
  'cat',
  'echo',
  'findstr',
  'grep',
  'find',
  // 目录操作
  'cd',
  'mkdir',
  'md',
  // 文件操作
  'copy',
  'move',
  'ren',
  'rename',
  // 网络诊断
  'ping',
  'nslookup',
  'tracert',
  'ipconfig',
  // 系统信息
  'ver',
  'set',
  'whoami',
  'hostname',
  'where',
  // 构建工具
  'make',
  'cargo',
  'rustc',
  'tsc',
  'npx',
  // PowerShell（安全参数）
  'pwsh',
  'powershell',
  // 环境变量查看
  'printenv',
  'env',
  // Python
  'python',
  'python3',
  'pip',
]);

/**
 * 检查命令的基命令是否在白名单中
 * @param command 完整命令字符串
 * @returns 是否允许
 */
function isBaseCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // 提取第一个词（基命令）
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  // 去除路径前缀（如 ./node_modules/.bin/xxx → xxx）
  const baseName = firstWord.replace(/^.*[/\\]/, '');

  // 去除 .cmd / .exe / .ps1 等扩展名
  const cleanName = baseName.replace(/\.(exe|cmd|bat|ps1|com)$/i, '');

  return ALLOWED_COMMANDS.has(cleanName);
}

/**
 * A4（2026-10-09）：高能力解释器命令名集合。
 *
 * 这些命令**能执行任意代码**（`node -e` / `bun -e` / `python -c` / `npm exec` …），
 * 仅凭"在白名单内"不足以视为安全。灰度开关 `BASH_INTERPRETER_GUARD` 开启时，
 * 未批准的此类命令不自动放行，转人工确认（见 execute 内实现）。
 */
const HIGH_CAPABILITY_INTERPRETERS = new Set([
  'node',
  'bun',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'deno',
  'pwsh',
  'powershell',
  'python',
  'python3',
  'pip',
  'pip3',
]);

/** 命令的基命令是否为高能力解释器（复用白名单的路径/扩展名归一化逻辑） */
function isHighCapabilityInterpreter(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  const baseName = firstWord.replace(/^.*[/\\]/, '');
  const cleanName = baseName.replace(/\.(exe|cmd|bat|ps1|com)$/i, '');
  return HIGH_CAPABILITY_INTERPRETERS.has(cleanName);
}

/** 沙箱安全检查器实例（F2 修复：二次校验） */
const sandboxSecurityChecker = new SandboxSecurityChecker();

/**
 * 检查路径是否安全 - 对标CC源码，适配 Windows
 */
function isPathSafe(path: string): boolean {
  const isWin = process.platform === 'win32';

  // 路径遍历模式：Unix 用 ..//，Windows 额外支持 ..\
  const pathTraversalPatterns = isWin
    ? [/\.\.\//, /^\.\//, /\/\.\.\//, /\.\.\\/, /^\.\\/, /\\\.\.\\/]
    : [/\.\.\//, /^\.\//, /\/\.\.\//, /^\//];

  // 危险系统目录：按平台区分
  const dangerousPaths = isWin
    ? [
        /^[A-Za-z]:\\windows\\/i,
        /^[A-Za-z]:\\system32\\/i,
        /^[A-Za-z]:\\boot\\/i,
        /^[A-Za-z]:\\program files\\/i,
      ]
    : [
        /^\/etc\//,
        /^\/sys\//,
        /^\/proc\//,
        /^\/boot\//,
        /^\/dev\//,
        /^\/root\//,
      ];

  return (
    !pathTraversalPatterns.some((pattern) => pattern.test(path)) &&
    !dangerousPaths.some((pattern) => pattern.test(path))
  );
}

/**
 * K-5 P1 内存治理：Bash stdout/stderr 源头软截断（2MB 前缀 + 20KB 尾部 + 标注）。
 * 避免 cat 10GB 日志 → 10GB 字符串 → 内存爆 + 上下文爆。
 *
 * 算法（避免 Buffer.byteLength 对超大字符串二次复制的负担）：
 *   当 s.length*3 < 软阈值 → 快速路径（ASCII 常见）直接返回，不 new Buffer
 *   否则 → Buffer.byteLength + Buffer.slice（UTF-8 安全切分，不会把一个多字节字符切两半）
 */
function applyBashOutputSoftTruncate(
  s: string | undefined | null,
  streamName: 'stdout' | 'stderr'
): string {
  if (s == null) return '';
  // 快速路径：ASCII 估算不足阈值直接返回（多数命令输出短）
  if (s.length * 3 < BASH_OUTPUT_SOFT_LIMIT_BYTES) return s;

  let byteLen: number;
  try {
    byteLen = Buffer.byteLength(s, 'utf-8');
  } catch {
    // byteLength 理论上永不对字符串抛错（极端超大字符串 V8 OOM 另论），保守兜底 slice 按字符
    logger.warn(
      'applyBashOutputSoftTruncate: Buffer.byteLength 失败，回退字符截断',
      {
        stream: streamName,
        len: s.length,
      }
    );
    const safeChars = Math.floor(BASH_OUTPUT_SOFT_LIMIT_BYTES / 3);
    if (s.length <= safeChars) return s;
    return (
      s.slice(0, safeChars) +
      `\n\n[K-5 truncated ${streamName}: ${s.length} chars > limit, kept ~${safeChars}]`
    );
  }

  if (byteLen <= BASH_OUTPUT_SOFT_LIMIT_BYTES) return s;

  // 超限：head（软阈值 - 尾部余量）+ 尾部保留 + 标注
  const headReserveBytes = Math.max(
    0,
    BASH_OUTPUT_SOFT_LIMIT_BYTES - BASH_TRUNCATED_TAIL_BYTES
  );
  const buf = Buffer.from(s, 'utf-8');
  const head = buf.slice(0, headReserveBytes).toString('utf-8');
  const tail =
    BASH_TRUNCATED_TAIL_BYTES > 0
      ? buf
          .slice(Math.max(0, buf.length - BASH_TRUNCATED_TAIL_BYTES))
          .toString('utf-8')
      : '';

  logger.warn('K-5 BashTool 大输出源头截断', {
    stream: streamName,
    originalBytes: byteLen,
    keptBytes: BASH_OUTPUT_SOFT_LIMIT_BYTES,
    limitBytes: BASH_OUTPUT_SOFT_LIMIT_BYTES,
  });

  const notice =
    `\n\n[K-5 output truncated on ${streamName}]\n` +
    `original=${formatBytes(byteLen)}  kept_head=${formatBytes(headReserveBytes)}  tail=${formatBytes(BASH_TRUNCATED_TAIL_BYTES)}  soft_limit=${formatBytes(BASH_OUTPUT_SOFT_LIMIT_BYTES)}\n` +
    `[Tip: rerun with filters (grep/findstr/Select-String) or pipe to a file, then read the file.]\n\n--- tail ---\n`;
  return head + notice + tail;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

export class BashTool extends BaseTool {
  name = 'bash';

  /**
   * 出参契约（P1-3 A 档，2026-09-28）。
   *
   * ⚠️ **刻意不复用**本文件内 `{ stdout, stderr, exitCode }` 的 zod schema —— 实测它描述的是
   * **内层** `execBashCommand()` 的返回，而工具出口的 `data` 是**字符串** `output`
   * （见 `createSuccessResult(output, …)`；各错误分支同样传字符串）⇒ 与 `glob` **完全同型**的
   * 契约漂移，强行接线会每次校验失败。故此处按**真实出口**声明：`data` 为**字符串**。
   */
  outputSchema = z.string();

  /** 是否为 Windows 平台 */
  private isWindows = process.platform === 'win32';

  /** 动态描述：根据平台告知 LLM 实际的执行环境（getter 避免抽象属性构造函数赋值限制） */
  override get description(): string {
    if (this.isWindows) {
      return [
        '通过 Windows 命令提示符（cmd.exe）执行命令。',
        '重要：这里运行的是 cmd.exe，不是 bash。只能使用 Windows 命令。',
        '- 路径分隔符使用 \\（例如 C:\\Users\\...），而非 /',
        '- 临时/用户目录使用 %TEMP% 或 %USERPROFILE%，而非 /tmp',
        '- 用 dir 代替 ls，用 type 代替 cat，用 findstr 代替 grep',
        '- 用 del 代替 rm，用 copy 代替 cp，用 move 代替 mv',
        '- git、npm、node、python 等可直接使用（Windows 上可用）',
        '- 复杂脚本请加前缀 powershell -Command "..."',
      ].join('\n');
    }
    return '在安全检查下执行 shell 命令';
  }

  override tags = [ToolTag.CODE];

  params: ToolParam[];

  override aliases = ['sh', 'shell'];
  override searchHint = 'Execute shell commands with security checks';
  override maxResultSizeChars = 100000;
  searchTips = ['execute', 'command', 'shell', 'bash'];

  private securityAnalyzer: BashSecurityAnalyzer;

  /** 已批准命令放行缓存（P0-4）：危险命令经审批批准后跳过安全拦截 */
  private approvedRegistry: ApprovedCommandRegistry;

  constructor(
    approvedRegistry: ApprovedCommandRegistry = getApprovedCommandRegistry()
  ) {
    super();
    this.approvedRegistry = approvedRegistry;

    // 动态参数描述
    const commandParamDesc = this.isWindows
      ? '要执行的命令。必须是 Windows cmd.exe 命令（而非 Unix/bash）。路径使用 \\，环境变量使用 %VAR%。'
      : '要执行的命令';
    const commandParamExample = this.isWindows ? 'dir C:\\Users' : 'ls -la';

    this.params = [
      {
        name: 'command',
        type: 'string',
        description: commandParamDesc,
        required: true,
        default: '',
        example: commandParamExample,
      },
      {
        name: 'timeout',
        type: 'number',
        description: '超时时间（毫秒，最大 300000）',
        required: false,
        default: 60000,
      },
      {
        name: 'cwd',
        type: 'string',
        description: '工作目录',
        required: false,
        default: undefined,
      },
      {
        name: 'env',
        type: 'object',
        description: '环境变量',
        required: false,
        default: undefined,
      },
    ];

    this.securityAnalyzer = new BashSecurityAnalyzer();
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      // 对标CC：Zod输入验证
      const parsedInput = BashInputSchema.safeParse(input);
      if (!parsedInput.success) {
        const errors = parsedInput.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        return createToolResult(`Bash输入验证失败: ${errors}`, {
          newMessages: [
            {
              role: 'system',
              content: `Error: ${errors}`,
            },
          ],
        });
      }

      let { command, timeout, cwd, env } = parsedInput.data;

      // Windows 平台：预处理命令，翻译常见 Unix 路径
      if (this.isWindows) {
        const preprocessed = this.preprocessWindowsCommand(command);
        if (preprocessed.warnings.length > 0) {
          const warningMsg = `BashTool 命令预处理警告:\n${preprocessed.warnings.join('\n')}`;
          if (preprocessed.warnings.some((w) => w.includes('禁止'))) {
            return createToolResult(warningMsg, {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: ${warningMsg}`,
                },
              ],
            });
          }
        }
        command = preprocessed.command;
        // 自动修正 cwd 中的 Unix 路径
        if (cwd && this.isWindows) {
          cwd = this.translateWindowsPath(cwd);
        }
      }

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', '', undefined, true, false),
      });

      // P0-4: 已批准命令放行通道 —— 用户审批批准的命令放行
      // （保留 Zod 输入校验 L333 + Windows 预处理 L351 + 审计日志，见下）
      // P0-2: 统一用 hashCommandForExecution（与提交审批端一致，幂等于已预处理命令）
      const approvedHash = hashCommandForExecution(command);
      const isApproved = this.approvedRegistry.isApproved(
        context.sessionId || '',
        approvedHash
      );
      // A2（2026-10-09）：批准豁免语义重定义（灰度开关 BASH_APPROVED_REVALIDATE，默认关）。
      // - 关（默认）⇒ 保留 P0-4：已批准命令跳过全部安全拦截层；
      // - 开 ⇒ 批准只免"审批交互"（ask 不再重复弹卡），危险命令/危险正则/AST/沙箱/
      //        白名单等**硬拦截仍须过**（CS03：不静默降级；见任务计划 §3-A2）。
      const revalidateApproved =
        isApproved && feature('BASH_APPROVED_REVALIDATE');
      // P0-4: 放行即绕过安全拦截层，必须审计记录（session + hash + 命令）确保可追溯
      if (isApproved) {
        logger.info('已批准命令放行', {
          sessionId: context.sessionId,
          hash: approvedHash,
          command: command.slice(0, 500),
          revalidated: revalidateApproved,
        });
      }

      if (!isApproved || revalidateApproved) {
        // 安全审计修复：安全检查强制运行，不可绕过
        // BUG08 修复：增强路径提取，支持 UNC、空格、--path= 形式
        const pathMatch = command.match(
          /(?:--?\w+=)?['"]?((?:\/[^\s'"]*|[A-Za-z]:[\\/][^\s'"]*|\\\\[^\s'"]+))['"]?/
        );
        if (pathMatch && !isPathSafe(pathMatch[1])) {
          return createToolResult('路径安全检查失败: 禁止访问系统敏感目录', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 路径安全检查失败: 禁止访问系统敏感目录',
              },
            ],
            metadata: { securityIntercepted: true, reason: 'path_safety' },
          });
        }

        // 对标CC：危险命令列表检查
        const lowerCommand = command.toLowerCase();
        if (
          DANGEROUS_COMMANDS.some((dangerousCommand) =>
            lowerCommand.includes(dangerousCommand.toLowerCase())
          )
        ) {
          return createToolResult('安全检查: 检测到危险命令', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 安全检查: 检测到危险命令',
              },
            ],
            metadata: {
              securityIntercepted: true,
              reason: 'dangerous_command',
            },
          });
        }

        // 对标CC：危险模式检查
        if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
          return createToolResult('安全检查: 检测到危险命令模式', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 安全检查: 检测到危险命令模式',
              },
            ],
            metadata: {
              securityIntercepted: true,
              reason: 'dangerous_pattern',
            },
          });
        }

        // 安全检查器分析
        const securityResult = this.securityAnalyzer.analyze(command);

        // AST级安全分析
        const astResult = parseForSecurity(command);
        if (
          astResult.kind === 'simple' &&
          astResult.commands.some((c) => isDangerousCommand(c.argv))
        ) {
          return createToolResult('AST安全分析: 检测到危险命令', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: AST安全分析阻止了危险命令执行',
              },
            ],
            metadata: { securityIntercepted: true, reason: 'ast_analysis' },
          });
        }

        if (securityResult.behavior === 'deny') {
          return createToolResult(
            `安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
                },
              ],
              metadata: {
                securityIntercepted: true,
                reason: 'security_analyzer_deny',
              },
            }
          );
        }

        // A2：批准只免"审批交互"——已批准时不再重复弹 ask 卡；硬拦截（deny/危险命令/
        // 白名单/沙箱）仍在其上/下继续生效。
        if (securityResult.behavior === 'ask' && !isApproved) {
          return createToolResult(
            `需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
                },
              ],
              metadata: {
                securityIntercepted: true,
                reason: 'security_analyzer_ask',
              },
            }
          );
        }

        // F3 修复：命令白名单检查 — 仅允许安全的基命令
        if (!isBaseCommandAllowed(command)) {
          return createToolResult(
            `安全检查: 命令 "${command.split(/\s+/)[0]}" 不在允许列表中`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 安全检查: 命令 "${command.split(/\s+/)[0]}" 不在允许列表中`,
                },
              ],
              metadata: {
                securityIntercepted: true,
                reason: 'command_whitelist',
              },
            }
          );
        }

        // F2 修复：沙箱安全检查器二次校验（独立于工具层安全检查）
        const sandboxCheckResult =
          sandboxSecurityChecker.checkDangerousCommands(command);
        if (!sandboxCheckResult.allowed) {
          return createToolResult(
            `沙箱安全检查: ${sandboxCheckResult.reason}`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 沙箱安全检查: ${sandboxCheckResult.reason}`,
                },
              ],
              metadata: {
                securityIntercepted: true,
                reason: 'sandbox_checker',
              },
            }
          );
        }
      } // 结束安全拦截层（默认：!isApproved；A2 开启时：已批准也复检）

      // A4（2026-10-09）：高能力解释器命令不得仅凭"白名单内"自动放行（灰度开关
      // BASH_INTERPRETER_GUARD，默认关）。此处位于硬拦截之后 ⇒ 只在命令**本会执行**
      // （危险命令/deny/白名单/沙箱均已通过）时，把未批准的解释器命令升级为人工确认；
      // 已批准（isApproved）不再重复弹卡。危险命令不会被降级为"可批准"。
      if (
        !isApproved &&
        feature('BASH_INTERPRETER_GUARD') &&
        isHighCapabilityInterpreter(command)
      ) {
        return createToolResult('需要用户确认: 解释器命令', {
          requireApproval: true,
          approvalReason:
            '解释器命令（可执行任意代码）需人工确认（BASH_INTERPRETER_GUARD）',
          newMessages: [
            {
              role: 'system',
              content:
                '需要用户确认: 解释器命令（node/bun/npm/python/pwsh 等）具备执行任意代码能力',
            },
          ],
          metadata: { reason: 'interpreter_guard' },
        });
      }

      // F5 修复：操作审计日志
      // A1（2026-10-09）：sessionId 必须取 context.sessionId（此前误用 toolUseId，
      // 导致 CompleteSecuritySystem 按会话归集/检索失效）。
      completeSecuritySystem.auditAction({
        sessionId: context.sessionId || 'unknown',
        action: 'bash_execute',
        actor: 'system',
        target: command.substring(0, 200),
        result: 'allowed',
        level: 1,
        details: `BashTool execute: ${command.substring(0, 100)}`,
      });

      // 对标CC：支持 cwd 参数（env / timeout 由 execBashCommand 直接接收，不再经 execOptions）
      const execOptions: ExecOptions = {};

      if (cwd) {
        execOptions.cwd = cwd;
      } else if (context?.options?.cwd) {
        // G3：cwd 隔离——工具参数未指定 cwd 时，回退上下文 options.cwd
        //（worktree 隔离 / 会话工作目录），使 bash 在隔离目录内执行。
        execOptions.cwd = context.options.cwd;
      }

      // 构建环境变量：Windows 上设置 git SSL 后端为 schannel
      // A3（2026-10-09）：剥离父进程继承的敏感 env（*_API_KEY / *SECRET* / *TOKEN* /
      // SSH_AUTH_SOCK / 云凭据等），避免密钥泄露进子进程；工具参数显式传入的 env 保持不变。
      // 剥离清单**单一事实源**：`@modules/security` 的 stripSensitiveEnv（与 hooks 侧同源，避免第二份）。
      const mergedEnv = {
        ...stripSensitiveEnv(process.env),
        ...(env || {}),
      };
      if (this.isWindows) {
        mergedEnv['GIT_SSL_BACKEND'] = 'schannel';
      }

      // K-5 P1 内存治理：硬 maxBuffer 防线（防止 child_process 内部无限制 buffer 暴涨）
      // 调用方显式传的 maxBuffer 优先（测试/特殊场景可调），否则默认 16MB
      const maxBuffer = Number.isFinite(
        (execOptions as { maxBuffer?: number }).maxBuffer
      )
        ? (execOptions as { maxBuffer: number }).maxBuffer
        : BASH_EXEC_MAX_BUFFER_BYTES;

      // 执行命令（G1-A：**唯一收敛入口**）——`sandbox.landlock.bashEnabled=true` 时在 Landlock
      // 域内执行；默认关闭 ⇒ 行为与改造前的 `execAsync` 等价，且保留 G1-C 的顾问性提示。
      const { stdout: rawStdout, stderr: rawStderr } = await execBashCommand({
        command,
        cwd: typeof execOptions.cwd === 'string' ? execOptions.cwd : undefined,
        env: mergedEnv,
        timeoutMs: timeout,
        maxBufferChars: maxBuffer,
        // R21（2026-10-09）：把会话取消信号接入执行链 ⇒ 取消/中断时强杀**进程树**
        //（否则 shell 与孙进程会继续运行成为孤儿；信号来源见 `ToolUseContext.abortController`）
        ...(context?.abortController?.signal
          ? { signal: context.abortController.signal }
          : {}),
      });
      // K-5 P1 二次软截断：即使 exec maxBuffer 没触发（Unicode 多字节/流式拆分），
      // 也在此按字节 slice 到 2MB + 末尾 20KB，避免 LLM 上下文和 ToolResultBudget 爆掉
      const stdout = applyBashOutputSoftTruncate(rawStdout as string, 'stdout');
      const stderr = applyBashOutputSoftTruncate(rawStderr as string, 'stderr');

      const output = stdout + (stderr ? '\n' + stderr : '');
      const executionTime = ToolUtils.calculateExecutionTime(startTime);

      // 报告执行完成
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress(stdout, stderr, 0, false, true),
      });

      // 对标CC：返回元数据丰富的结果
      return ToolUtils.createSuccessResult(output, {
        output,
        errorOutput: stderr,
        executionTime,
        toolName: 'bash',
        executionId: ToolUtils.generateExecutionId('bash'),
        timestamp: Date.now(),
        newMessages: [
          {
            role: 'system',
            content: `Command executed successfully in ${executionTime}ms`,
          },
        ],
      });
    } catch (error) {
      const executionTime = ToolUtils.calculateExecutionTime(startTime);
      const msg = error instanceof Error ? error.message : String(error);
      const stderr = (error as { stderr?: string }).stderr;

      // 报告执行错误
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', msg, 1, false, true),
      });

      return ToolUtils.createFailureResult(msg, {
        executionTime,
        errorOutput: stderr || msg,
        toolName: 'bash',
        executionId: ToolUtils.generateExecutionId('bash'),
        timestamp: Date.now(),
        newMessages: [
          {
            role: 'system',
            content: `Error: ${msg}`,
          },
        ],
      });
    }
  }

  /**
   * 检查命令是否安全
   */
  checkSecurity(command: string) {
    return this.securityAnalyzer.analyze(command);
  }

  /**
   * 检查是否为只读命令
   */
  override isReadOnly(input?: Record<string, unknown>): boolean {
    const command = input?.command as string;
    return this.securityAnalyzer.isReadOnlyCommand(command);
  }

  /**
   * 检查是否并发安全
   */
  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查是否是搜索或读取命令
   */
  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    const command = input?.command as string;
    if (!command) {
      return { isSearch: false, isRead: false };
    }

    const classification = analyzeBashCommandType(command);
    return {
      isSearch: classification.isSearch,
      isRead: classification.isRead,
      isList: classification.isList,
    };
  }

  /**
   * 准备权限匹配器
   */
  override async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const command = (input?.command as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(command);
    };
  }

  /**
   * 获取用户可见的工具名称
   */
  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const command = (input?.command as string) || '';
    if (command) {
      return `Bash: ${command}`;
    }
    return this.name;
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.command as string) || '';
  }

  /**
   * 获取工具完整信息 - 对标CC源码 getInfo 实现
   */
  override getInfo(): {
    name: string;
    description: string;
    params: ToolParam[];
    aliases?: string[];
    searchTips?: string[];
    enabled: boolean;
    readOnly: boolean;
    destructive: boolean;
    concurrencySafe: boolean;
    deferred: boolean;
    alwaysLoad: boolean;
    interruptBehavior: InterruptBehavior;
    maxResultSizeChars?: number;
  } {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive ? this.isDestructive() : false,
      concurrencySafe: this.isConcurrencySafe(),
      deferred: this.shouldDefer || false,
      alwaysLoad: this.alwaysLoad || false,
      interruptBehavior: 'block' as const,
      maxResultSizeChars: this.maxResultSizeChars,
    };
  }

  /**
   * Windows 命令预处理：翻译常见 Unix 路径和命令
   * @param command 原始命令
   * @returns 预处理后的命令和警告列表
   */
  private preprocessWindowsCommand(command: string): {
    command: string;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let processed = command;

    // 检测 Unix 专用命令（Windows cmd.exe 中不存在）
    const unixOnlyCommands = ['head', 'tail', 'sed', 'awk', 'xargs', 'tee'];
    const cmdWords = processed.split(/\s+/);
    for (const cmd of unixOnlyCommands) {
      if (cmdWords.some((w) => w === cmd || w === `${cmd}.exe`)) {
        warnings.push(
          `${cmd} 是 Unix/Linux 命令，Windows cmd.exe 中不可用。请使用 PowerShell: pwsh -Command "..." 或改用 Windows 等价命令。`
        );
      }
    }

    // 自动翻译常见 Unix 路径为 Windows 路径
    if (processed.includes('/tmp')) {
      processed = processed.replace(/\/tmp\b/g, '%TEMP%');
      warnings.push('已自动将 /tmp 替换为 %TEMP%');
    }
    if (processed.includes('/dev/null')) {
      processed = processed.replace(/\/dev\/null\b/g, 'NUL');
      warnings.push('已自动将 /dev/null 替换为 NUL');
    }

    // 检测 2>&1 重定向（Windows cmd.exe 也支持，但确保格式正确）
    // 无需修改，cmd.exe 支持 2>&1

    // 检测 && 链式命令（cmd.exe 支持）
    // 无需修改，cmd.exe 支持 &&

    // 检测仅包含 Unix 路径的命令（禁止执行）
    if (/\bcd\s+\/[a-z]/.test(processed)) {
      warnings.push(
        '禁止: cd 到 Unix 根路径（如 /tmp、/usr）。请使用 Windows 路径或 %TEMP%。'
      );
    }

    // 方案六 P1-5：对含全角冒号（：）等特殊字符且未加引号的路径 token 自动加引号，
    // 避免 cmd.exe 解析含全角字符的文件路径失败（如 `标的1-标包10：云景....docx`）
    processed = processed.replace(
      /(^|[\s"'|;&,()<>])(?!["'])([^\s"'|;&,()<>]*：[^\s"'|;&,()<>]*)/g,
      (match, prefix: string, token: string) => {
        // 前缀为引号说明 token 已在引号上下文内，跳过避免双重包裹
        if (prefix === '"' || prefix === "'") return match;
        return `${prefix}"${token}"`;
      }
    );

    return { command: processed, warnings };
  }

  /**
   * 翻译 Unix 绝对路径为 Windows 路径
   */
  private translateWindowsPath(unixPath: string): string {
    let result = unixPath;
    if (result.startsWith('/tmp')) {
      result = result.replace(
        /^\/tmp/,
        process.env['TEMP'] || 'C:\\Windows\\Temp'
      );
    } else if (result.startsWith('/home/') || result.startsWith('/Users/')) {
      result = result.replace(
        /^\/(home|Users)\/[^/]+/,
        process.env['USERPROFILE'] || 'C:\\Users\\Default'
      );
    }
    return result;
  }
}
