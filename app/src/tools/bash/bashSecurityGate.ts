// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bashSecurityGate — Bash **安全门**（G18，2026-10-11）
 *
 * 自 `BashTool.ts` **纯搬迁**（只搬不改）抽出的 5 个"硬拦截 / 升级确认"判据 + `isPathSafe`：
 *
 * | 门 | 职责 |
 * |---|---|
 * | `checkPathSafety` | S1-5 统一口径 `std.paths` 逐个过 `isPathSafe`（G22 Windows fail-closed） |
 * | `checkBashDangerousCommand` | 危险命令列表 + 危险模式（对标 CC 安全策略） |
 * | `checkAstAndAnalyzer` | 安全分析器 + AST + `deny`/`ask`；**AST 不确定 ⇒ fail-closed 转人工** |
 * | `checkWhitelistAndSandbox` | 基命令白名单（F3）+ 沙箱二次校验（F2，`SandboxSecurityChecker`） |
 * | `checkInterpreterGuard` | A4 高能力解释器**升级人工确认**（+ O1-B2 观测日志） |
 *
 * ⚠️ 与 `permission/PermissionPolicies.ts` / `sandbox/utils/DangerousCommandChecker.ts` 的
 * "危险命令"判据**并存且刻意分层**（纵深防御，见 CD07；不归并）。
 *
 * 设计：**纯函数 / 无实例状态**（`BashTool` 以参数传入 `analyzer`）⇒ 便于单测与复用；
 * 返回 `ToolResult | null`（`null` = 通过），调用方按序短路。
 *
 * ⚠️ `checkInterpreterGuard` 的 O1-B2 日志 tag 由 `tools\bash\BashTool` 改为
 * `tools:bash:securityGate`（**文案与字段不变**）。
 */
import type { ToolResult } from '../types/ToolResult';
import { createToolResult } from '../types/ToolResult';
import { getLogger } from '@modules/monitoring';
import { feature } from '@modules/core';
import { SandboxSecurityChecker } from '@modules/sandbox';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';
import { parseForSecurity, isDangerousCommand } from '@modules/security';
import {
  DANGEROUS_COMMANDS,
  DANGEROUS_PATTERNS,
  isBaseCommandAllowed,
  isHighCapabilityInterpreter,
} from './bashCommandPolicy';
import {
  isUnixSensitivePath,
  type StandardizedCommand,
} from './commandNormalization';

const logger = getLogger('tools:bash:securityGate');

/** 安全分析器的最小结构（`BashSecurityAnalyzer.analyze`，由 `BashTool` 实例传入） */
export interface CommandAnalyzer {
  analyze: (
    command: string,
    trustLevel?: string
  ) => {
    behavior: 'allow' | 'deny' | 'ask';
    message?: string;
  };
}

/** 沙箱安全检查器实例（F2 修复：二次校验；仅本模块使用） */
const sandboxSecurityChecker = new SandboxSecurityChecker();

/**
 * 检查路径是否安全 - 对标CC源码，适配 Windows
 *
 * G22（2026-10-11，S1-5）：Windows 分支**补** Unix 绝对路径敏感目录探测（fail-closed）。
 * - 非 Windows 侧已有 `/^\//` 覆盖；
 * - Windows 侧**不能**简单加 `/^\//`（会误伤 `dir /b`、`findstr /i` 等合法开关），
 *   故仅当候选**命中真实 Unix 系统目录**（`/etc`、`/usr`…，见 `isUnixSensitivePath`）时拒绝；
 *   反斜杠形态（`\etc\passwd`）先归一为 `/` 再判定。
 */
export function isPathSafe(path: string): boolean {
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

  if (pathTraversalPatterns.some((pattern) => pattern.test(path))) return false;
  if (dangerousPaths.some((pattern) => pattern.test(path))) return false;
  // G22：Windows 分支的 Unix 敏感系统目录 fail-closed
  if (isWin && isUnixSensitivePath(path.replace(/\\/g, '/'))) return false;
  return true;
}

/**
 * 硬拦截①：**路径安全检查**。
 *
 * 判据 = `std.paths`（S1-5 统一口径的**全部候选路径**）逐个过 `isPathSafe()`；
 * Windows 分支叠加 G22（Unix 敏感系统目录 fail-closed）。
 *
 * @returns 命中不安全路径 ⇒ 拦截结果；全部安全 ⇒ `null`
 */
export function checkPathSafety(
  std: StandardizedCommand
): ToolResult<unknown> | null {
  const unsafePath = std.paths.find((candidate) => !isPathSafe(candidate));
  if (!unsafePath) return null;
  return createToolResult('路径安全检查失败: 禁止访问系统敏感目录', {
    newMessages: [
      {
        role: 'system',
        content: 'Error: 路径安全检查失败: 禁止访问系统敏感目录',
      },
    ],
    metadata: {
      securityIntercepted: true,
      reason: 'path_safety',
      unsafePath,
    },
  });
}

/**
 * 硬拦截②：**危险命令列表 + 危险模式**检查（对标 CC 安全策略）。
 *
 * ⚠️ 命名说明：本函数属**工具层**危险命令判据；`permission/PermissionPolicies.ts` 与
 * `sandbox/utils/DangerousCommandChecker.ts` 各自有**独立**的同名/同类判据 —— 三者是**刻意的
 * 纵深防御分层**（CD07 关键域，不归并）；此处以 `Bash` 前缀区分，避免门禁 R02-002 的同名误报。
 *
 * @returns 命中 ⇒ 拦截结果；未命中 ⇒ `null`
 */
export function checkBashDangerousCommand(
  command: string
): ToolResult<unknown> | null {
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

  return null;
}

/**
 * 硬拦截③：**安全检查器 + AST 级分析 + deny/ask 判定**。
 *
 * 语义（逐字保留）：
 * - `kind === 'simple'` ⇒ 仅判是否有危险 argv；
 * - `too-complex` / `parse-unavailable` ⇒ **fail-closed 转人工审批**（第九轮审查 §十-4）；
 * - `deny` ⇒ 恒拦截；`ask` ⇒ `bypassAsk`（已批准且灰度关）时**不再重复弹卡**，但仍返回结果给调用方。
 *
 * @returns 命中 ⇒ 拦截/待批准结果；通过 ⇒ `null`
 */
export function checkAstAndAnalyzer(params: {
  command: string;
  bypassAsk: boolean;
  approvalScope: ApprovalScope;
  approvalSnapshot: ApprovalSnapshot;
  analyzer: CommandAnalyzer;
  /**
   * 工作区信任级别（`securityIntegrationService.getTrustLevelForPath(cwd)`）。
   *
   * ⚠️ 分析器的 `analyze(command, trustLevel)` 一直支持该参数，但本门此前只传 `command`
   * ⇒ 工具路径上信任级别恒为 `undefined` ⇒ `applyAllowlistThenTrust` 对"不在已知安全
   * 列表"的命令一律 `deny`（"信任工作区可降级"分支成为死代码）。此处显式透传。
   */
  trustLevel?: string;
}): ToolResult<unknown> | null {
  const {
    command,
    bypassAsk,
    approvalScope,
    approvalSnapshot,
    analyzer,
    trustLevel,
  } = params;

  const securityResult = analyzer.analyze(command, trustLevel);

  const astResult = parseForSecurity(command);
  if (astResult.kind === 'simple') {
    if (astResult.commands.some((c) => isDangerousCommand(c.argv))) {
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
  } else if (!bypassAsk) {
    // 第九轮审查 §十-4（2026-10-09，缺陷 #4）：**AST 不确定 ⇒ 失败关闭（fail-closed）**。
    // 原实现仅在 `kind === 'simple'` 时判危险；`too-complex` / `parse-unavailable`
    // **既不阻断也不要求审批** ⇒ 解析器能力边界与实际安全决策不一致（盲区即放行）。
    // 现：两种"无法可靠解析"⇒ **转人工审批**（不静默放行；也不直接 deny，保留可用性）。
    // S1-2（2026-10-11）：已批准（bypassAsk）⇒ 不再重复弹卡，但**继续**走其后的
    // deny/白名单/沙箱等硬拦截（不因"免问"而放行）。
    return createToolResult('需要用户确认: 命令无法被可靠解析', {
      requireApproval: true,
      approvalReason: `AST 分析不确定（${astResult.kind}），为避免解析盲区被绕过，需人工确认`,
      newMessages: [
        {
          role: 'system',
          content: `需要用户确认: 该命令无法被 AST 可靠解析（${astResult.kind}），需人工确认后执行`,
        },
      ],
      metadata: {
        reason: 'ast_inconclusive',
        astKind: astResult.kind,
        approvalScope,
        approvalSnapshot,
      },
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

  // S1-2：批准只免"审批交互"——`bypassAsk` 时不再重复弹 ask 卡；
  // 硬拦截（deny/危险命令/白名单/沙箱）无论批准与否都照旧生效。
  if (securityResult.behavior === 'ask' && !bypassAsk) {
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
          approvalScope,
          approvalSnapshot,
        },
      }
    );
  }

  return null;
}

/**
 * 硬拦截④：**命令白名单 + 沙箱二次校验**。
 *
 * - 白名单（F3）：仅允许安全的基命令；基命令取 S1-5 统一归一化结果 `std.baseCommand`；
 * - 沙箱二次校验（F2）：独立于工具层安全检查器的 `SandboxSecurityChecker`。
 *
 * @returns 命中 ⇒ 拦截结果；通过 ⇒ `null`
 */
export function checkWhitelistAndSandbox(
  command: string,
  std: StandardizedCommand
): ToolResult<unknown> | null {
  if (!isBaseCommandAllowed(std.baseCommand)) {
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

  const sandboxCheckResult =
    sandboxSecurityChecker.checkDangerousCommands(command);
  if (!sandboxCheckResult.allowed) {
    return createToolResult(`沙箱安全检查: ${sandboxCheckResult.reason}`, {
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
    });
  }

  return null;
}

/**
 * 解释器守卫（A4）：硬拦截**之后**的"升级人工确认"。
 *
 * - 仅当 命令**本会执行**（危险命令/deny/白名单/沙箱均已通过）且 `BASH_INTERPRETER_GUARD`
 *   开启且**未批准**且基命令为高能力解释器 ⇒ 升级人工确认；
 * - 未升级 ⇒ 记一条 `bash:interpreter_command_allowed` debug（O1-B2：使灰度触发条件可读；
 *   仅日志，零行为变更）。
 *
 * @returns 升级确认结果；无需升级 ⇒ `null`
 */
export function checkInterpreterGuard(params: {
  std: StandardizedCommand;
  isApproved: boolean;
  approvalScope: ApprovalScope;
  approvalSnapshot: ApprovalSnapshot;
  sessionId: string | undefined;
}): ToolResult<unknown> | null {
  const { std, isApproved, approvalScope, approvalSnapshot, sessionId } =
    params;

  if (
    !isApproved &&
    feature('BASH_INTERPRETER_GUARD') &&
    isHighCapabilityInterpreter(std.baseCommand)
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
      metadata: {
        reason: 'interpreter_guard',
        approvalScope,
        approvalSnapshot,
      },
    });
  }

  // O1-B2（2026-10-09，触发条件补全方案 §三-O1）：**解释器命令即将执行**（未被升级确认）
  // ⇒ 观测一条 debug（无论灰度开关；仅日志，零行为变更）。用途：使 `BASH_INTERPRETER_GUARD`
  // 的触发条件「解释器命令仅凭白名单放行」可读（见 `.trae/specs/default-off-switches-review-gates.md`）。
  if (isHighCapabilityInterpreter(std.baseCommand)) {
    logger.debug('bash:interpreter_command_allowed', {
      sessionId,
      approved: isApproved,
      guardEnabled: feature('BASH_INTERPRETER_GUARD'),
    });
  }

  return null;
}
