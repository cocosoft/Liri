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
import {
  createToolResult,
  ErrorLevel,
  ToolExecutionStatus,
} from '../types/ToolResult';
import { getLogger } from '@openliri/infra/monitoring';
import { feature } from '@openliri/kernel';
import { SandboxSecurityChecker } from '@modules/sandbox';
import {
  evaluateCommandRules,
  readCommandRulesConfig,
  isReadViaShellCorrectionEnabled,
  buildReadViaShellCorrection,
  type ApprovalScope,
  type ApprovalSnapshot,
  type CommandRulesSettings,
} from '@openliri/infra/permission';
import { parseForSecurity, isDangerousCommand } from '@openliri/infra/security';
import {
  DANGEROUS_COMMANDS,
  DANGEROUS_PATTERNS,
  hasInlineCodeFlag,
  isBaseCommandAllowed,
  isHighCapabilityInterpreter,
  maskQuotedSegments,
} from './bashCommandPolicy';
import { isSinglePowerShellWrapperCommand } from './powerShellWrapper';
import {
  isUnixSensitivePath,
  type StandardizedCommand,
} from './commandNormalization';

const logger = getLogger('tools:bash:securityGate');

/**
 * 硬拦截结果（BUG-8，2026-10-19）。
 *
 * **必须带 `error` / `success:false`**：消费方（`ReActToolLoop`）用
 * `toolResult.error ? 'failed' : 'success'` 判定工具状态 —— 若只把错误写进
 * `newMessages`，安全拦截会被日志/UI/统计误记为「成功」。
 *
 * @param message 人类可读摘要（同时作为 `error`）
 * @param metadata 附加元数据（会与 `securityIntercepted: true` 合并）
 * @param modelMessage 回给模型的消息（默认 `Error: <message>`；个别门保持原文）
 */
function blockedResult(
  message: string,
  metadata: Record<string, unknown>,
  modelMessage: string = `Error: ${message}`
): ToolResult<unknown> {
  return createToolResult(message, {
    success: false,
    error: message,
    // FIX-5（2026-10-27）：安全门拦截属**环境阻塞**，不是"模型无效输出"。
    // 不带分类时会被计入 `consecutiveInvalidTurns`（3 轮）；带上 `safety_blocked`
    // 后走 `environment_blocked` 预算（2 轮），且失败原因在恢复期可读（P2-3 落盘）。
    failureKind: 'safety_blocked',
    newMessages: [{ role: 'system', content: modelMessage }],
    metadata: { securityIntercepted: true, ...metadata },
  });
}

/** 安全分析器的最小结构（`BashSecurityAnalyzer.analyze`，由 `BashTool` 实例传入） */
export interface CommandAnalyzer {
  analyze: (
    command: string,
    trustLevel?: string,
    /** FIX-15：单条 PowerShell 包裹已由 PowerShell 安全链判定 ⇒ 授权分析器跳过 bash 只读族复判 */
    options?: { delegatedSinglePowerShell?: boolean }
  ) => {
    behavior: 'allow' | 'deny' | 'ask';
    message?: string;
    matchedPatterns?: string[];
    /** B3（issue #37）：只读族放行标记（AST 不确定分支据此免 ask） */
    readOnly?: boolean;
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
  return blockedResult('路径安全检查失败: 禁止访问系统敏感目录', {
    reason: 'path_safety',
    unsafePath,
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
  // 2026-10-23（预存台账批次 A #1）：危险词改 **token 边界匹配**，与
  // `SandboxSecurityChecker.checkDangerousCommands` 同口径；旧 `includes()` 会把
  // `result`（含 `su`）、`git add`（含 `dd`）、`format-test`（含 `format`）、
  // `skill`（含 `kill`）等正常命令误判为危险。带空格的组合（如 `rm -rf`）仍按
  // 整串匹配 —— 组合本身足够具体，token 化反而会漏掉跨参数写法。
  const tokens = lowerCommand.split(/[\s;|&<>]+/).filter(Boolean);
  const matchedDangerousCommand = DANGEROUS_COMMANDS.find(
    (dangerousCommand) => {
      const d = dangerousCommand.toLowerCase().trim();
      if (!d) return false;
      return d.includes(' ') ? lowerCommand.includes(d) : tokens.includes(d);
    }
  );
  if (matchedDangerousCommand) {
    // P9-5（2026-11-12）：命中的命令必须进**文案**，否则模型/用户只看到
    // 「检测到危险命令」却无法调整（真机会话 session_mwcyhmmpd44e93b602 seq 52）。
    return blockedResult(
      `安全检查: 检测到危险命令「${matchedDangerousCommand}」`,
      {
        reason: 'dangerous_command',
        matchedCommand: matchedDangerousCommand,
      }
    );
  }

  // B2-3（2026-10-30，issue #36）：单条 `powershell|pwsh -Command "…"` 的内层脚本
  // 由 PowerShell 安全链判定（本方法之后的 G-07 门）⇒ 文本模式只扫**引号外**的部分，
  // 避免脚本里的 `$(…)` / `exec ` / `source ` 字面量被当成 bash 危险模式。
  // 多段形态不做掩码（兄弟段未经验证，必须保持原文 fail-closed）。
  const patternTarget = isSinglePowerShellWrapperCommand(command)
    ? maskQuotedSegments(command)
    : command;
  const matchedPattern = DANGEROUS_PATTERNS.find((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(patternTarget);
  });
  if (matchedPattern) {
    // P9-5：同样把命中的模式源串带进文案（此前只有布尔结论）。
    return blockedResult(
      `安全检查: 检测到危险命令模式「${matchedPattern.source}」`,
      {
        reason: 'dangerous_pattern',
        matchedPattern: matchedPattern.source,
      }
    );
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
   * B1（2026-11-18）：命令执行目录（作为「工作区内」判定的边界根；缺省 ⇒ 不做纠正）。
   */
  cwd?: string;
  /** B1：会话权限档（仅 `default` 档纠正；缺省按 default） */
  permissionMode?: string;
  /**
   * 工作区信任级别（`securityIntegrationService.getTrustLevelForPath(cwd)`）。
   *
   * ⚠️ 分析器的 `analyze(command, trustLevel)` 一直支持该参数，但本门此前只传 `command`
   * ⇒ 工具路径上信任级别恒为 `undefined` ⇒ `applyAllowlistThenTrust` 对"不在已知安全
   * 列表"的命令一律 `deny`（"信任工作区可降级"分支成为死代码）。此处显式透传。
   */
  trustLevel?: string;
  /**
   * 命令级黑白名单（B 体系）。缺省 ⇒ 运行时读配置（`readCommandRulesConfig`）；
   * 显式传 `null` 表示"本次无规则"（供单测与复用点确定性注入，避免依赖全局配置）。
   */
  commandRules?: CommandRulesSettings | null;
  /**
   * FIX-15（2026-10-27）：整条命令**仅**为一条 `powershell|pwsh -Command "…"`，且内层脚本
   * 已由 PowerShell 安全链判定通过（`checkPowerShellWrapper` 先行放行）⇒ 透传给分析器，
   * 避免 bash 只读族把 `powershell` 判"非只读"而二次否掉同一判定。
   */
  delegatedSinglePowerShell?: boolean;
}): ToolResult<unknown> | null {
  const {
    command,
    bypassAsk,
    approvalScope,
    approvalSnapshot,
    analyzer,
    trustLevel,
    commandRules,
    delegatedSinglePowerShell,
    cwd,
    permissionMode,
  } = params;

  const securityResult = analyzer.analyze(command, trustLevel, {
    delegatedSinglePowerShell,
  });

  const astResult = parseForSecurity(command);
  if (astResult.kind === 'simple') {
    if (astResult.commands.some((c) => isDangerousCommand(c.argv))) {
      return blockedResult(
        'AST安全分析: 检测到危险命令',
        { reason: 'ast_analysis' },
        'Error: AST安全分析阻止了危险命令执行'
      );
    }
  } else if (!bypassAsk && securityResult.readOnly !== true) {
    // 第九轮审查 §十-4（2026-10-09，缺陷 #4）：**AST 不确定 ⇒ 失败关闭（fail-closed）**。
    // 原实现仅在 `kind === 'simple'` 时判危险；`too-complex` / `parse-unavailable`
    // **既不阻断也不要求审批** ⇒ 解析器能力边界与实际安全决策不一致（盲区即放行）。
    // 现：两种"无法可靠解析"⇒ **转人工审批**（不静默放行；也不直接 deny，保留可用性）。
    // S1-2（2026-10-11）：已批准（bypassAsk）⇒ 不再重复弹卡，但**继续**走其后的
    // deny/白名单/沙箱等硬拦截（不因"免问"而放行）。
    // B3（2026-10-30，issue #37）：分析器已按**只读族**（argv 级）放行
    // （`readOnly === true`）⇒ 不再转人工 —— 只读命令无副作用，弹卡只会让调用悬空
    // （真机 6 次 `security_analyzer_ask` 无人应答）。危险命令/deny/白名单/沙箱随后照旧执行。
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
    // F1（2026-10-27）：deny 必须带**可归因**的原因。
    // 原实现 `|| '命令被阻止执行'` 会在分析器未给 message 时把信息吃光 —— 实测会话
    // `session_mvoqs1ho875ea6b95e` 有 179 次同值报文，模型无法据此改正，只能反复盲试
    // （Liri 报告 R1）。现：保留分析器文案 + 带上命中的规则/模式，写入 metadata 供审计。
    const matchedRule = securityResult.matchedPatterns?.[0];
    const reason =
      securityResult.message ||
      (matchedRule
        ? `命中安全规则：${matchedRule}`
        : '命令被安全检查拒绝（分析器未返回具体规则，请查看 app.log 的 bash: security_gate_blocked）');
    return blockedResult(`安全检查失败: ${reason}`, {
      reason: 'security_analyzer_deny',
      code: 'SECURITY_ANALYZER_DENY',
      ...(matchedRule ? { matchedRule } : {}),
      ...(securityResult.matchedPatterns?.length
        ? { matchedPatterns: securityResult.matchedPatterns.slice(0, 5) }
        : {}),
    });
  }

  // P0-2（2026-10-27，权限归一化）：用户「命令级黑白名单」（B 体系）此前**零消费者**
  // （`permission.customRules.commandRules` 只有配置与匹配器，没有读取点）⇒ 配置不生效。
  // 位置刻意放在 `deny` 之后、`ask` 之前：黑名单可否决，白名单命中只免掉"未知命令 ⇒ ask"，
  // 后续硬拦截（基命令白名单 / 沙箱二次校验）**照旧执行**。
  const commandRuleVerdict = evaluateCommandRules(
    command,
    commandRules === null
      ? undefined
      : (commandRules ?? readCommandRulesConfig())
  );
  if (commandRuleVerdict?.behavior === 'deny') {
    const reason =
      commandRuleVerdict.reasonCode === 'custom_blacklist'
        ? `命中命令黑名单「${
            commandRuleVerdict.rule.label ?? commandRuleVerdict.rule.pattern
          }」`
        : '命令未命中白名单（当前为白名单模式）';
    return blockedResult(`安全检查失败: ${reason}`, {
      reason: commandRuleVerdict.reasonCode,
      code: 'CUSTOM_COMMAND_RULE_DENY',
      ...(commandRuleVerdict.reasonCode === 'custom_blacklist'
        ? { matchedRule: commandRuleVerdict.rule.pattern }
        : {}),
    });
  }
  if (commandRuleVerdict?.behavior === 'allow') {
    // 白名单命中 ⇒ 免审批（返回 null 让调用方继续后续硬拦截）
    return null;
  }

  // S1-2：批准只免"审批交互"——`bypassAsk` 时不再重复弹 ask 卡；
  // 硬拦截（deny/危险命令/白名单/沙箱）无论批准与否都照旧生效。
  if (securityResult.behavior === 'ask' && !bypassAsk) {
    // B1（2026-11-18）：default 档下「单读类动词 + 单路径」的 shell 调用 ⇒ **直接回纠正提示**，
    // 不建审批卡（用户裁定：仅 default 档 / 严格最小集 / 仅工作区内 / 默认关灰度）。
    // 工作区边界取本工具的生效 cwd（保守口径：不把界外路径纠正成死路）。
    if (
      cwd &&
      isReadViaShellCorrectionEnabled() &&
      (permissionMode ?? 'default') === 'default'
    ) {
      const correction = buildReadViaShellCorrection({
        enabled: true,
        toolName: 'bash',
        input: { command, cwd },
        permissionMode: permissionMode ?? 'default',
        workspacePath: cwd,
      });
      if (correction) {
        logger.info('bash: read_via_shell_corrected', {
          commandPreview: command.slice(0, 200),
          verb: correction.verb,
          targetTool: correction.tool,
          cwd,
        });
        return createToolResult(correction.message, {
          status: ToolExecutionStatus.FAILURE,
          executionTime: 0,
          error: correction.message,
          errorLevel: ErrorLevel.RECOVERABLE,
          failureKind: 'tool_error',
          newMessages: [
            { role: 'system', content: `Error: ${correction.message}` },
          ],
          metadata: {
            reason: correction.reasonCode,
            targetTool: correction.tool,
            verb: correction.verb,
          },
        });
      }
    }
    // P0-1（2026-10-27，权限归一化）：**必须**带 `requireApproval: true`。
    // 此前只返回文本 ⇒ `ToolExecutionService` 不认它是"待审批"，工具结果落成
    // `status:'success'` 且 `pendingApproval:false`（实测 2026-10-27 07:09:31Z
    // `bun _scan.js`：命令未执行、未入 Inbox，模型只能反复换命令）。
    // 现：走既有 `requireApproval` 契约 ⇒ 上层提交 Inbox 卡并返回 awaiting_approval。
    const askMessage = securityResult.message || '此命令需要确认后执行';
    return createToolResult(`需要用户确认: ${askMessage}`, {
      requireApproval: true,
      approvalReason: askMessage,
      // FIX-5：待审批同样属于"环境阻塞"而非模型无效输出
      failureKind: 'permission_denied',
      newMessages: [
        {
          role: 'system',
          content: `Error: 需要用户确认: ${askMessage}`,
        },
      ],
      metadata: {
        securityIntercepted: true,
        reason: 'security_analyzer_ask',
        approvalScope,
        approvalSnapshot,
      },
    });
  }

  return null;
}

/**
 * 硬拦截④：**命令白名单 + 沙箱二次校验**。
 *
 * - 白名单（F3）：仅允许安全的基命令；基命令取 S1-5 统一归一化结果 `std.baseCommand`
 *   （**剥壳后**，P1 2026-11-22：`bash -lc "git log"` 的基命令是 `git`）；
 * - 沙箱二次校验（F2）：独立于工具层安全检查器的 `SandboxSecurityChecker`，
 *   扫描对象是 `std.effectiveCommand`（**实际执行的命令**，而非外层壳）。
 *
 * @returns 命中 ⇒ 拦截/待确认结果；通过 ⇒ `null`
 */
export function checkWhitelistAndSandbox(
  command: string,
  std: StandardizedCommand,
  /** N-19：沙箱"升级确认"所需的审批上下文（缺省 ⇒ 按硬拒处理，fail-closed） */
  ask?: {
    bypassAsk: boolean;
    approvalScope: ApprovalScope;
    approvalSnapshot: ApprovalSnapshot;
  }
): ToolResult<unknown> | null {
  const wrapperNote =
    std.shellWrappers.length > 0
      ? `（经 ${std.shellWrappers.join(' → ')} 包裹）`
      : '';
  if (!isBaseCommandAllowed(std.baseCommand)) {
    return blockedResult(
      `安全检查: 命令 "${std.baseCommand || command.split(/\s+/)[0]}" 不在允许列表中${wrapperNote}`,
      { reason: 'command_whitelist' }
    );
  }

  // P1（2026-11-22）：**壳包裹 PowerShell 一律拒绝**。
  //
  // `checkPowerShellWrapper` 只识别「语句位置」的 `powershell|pwsh`（`^` / `;` / `&&` / `|`），
  // 因此 `cmd /c powershell -Command "…"`、`bash -c "powershell -Command …"` 的内层脚本
  // **不会**经过 PowerShell 安全链（实测：`cmd /c powershell -Command
  // "Remove-Item -Recurse -Force C:\Windows"` 落 ask，点一下就能执行）。
  // 这里在内层脚本尚未被判定时 fail-closed，并给出可直接照抄的写法。
  if (
    std.shellWrappers.length > 0 &&
    (std.baseCommand === 'powershell' || std.baseCommand === 'pwsh')
  ) {
    return blockedResult(
      `安全检查: 禁止用壳包裹 PowerShell${wrapperNote}。请直接执行 powershell -Command "…"（或改用 powershell 工具），以便内层脚本经过 PowerShell 安全链判定。`,
      { reason: 'shell_wrapped_powershell' }
    );
  }

  const sandboxCheckResult = sandboxSecurityChecker.checkDangerousCommands(
    std.effectiveCommand || command
  );
  if (!sandboxCheckResult.allowed) {
    // N-18（2026-11-07 真机）：把检查器的**可执行替代**带给模型。
    // 旧文案只有「请检查命令是否必要，避免执行破坏性操作」，对 `node -e` 这类被拒毫无指导，
    // 真机里模型只会换写法反复重试（`node -e` → `node --eval` → `_probe.js`），
    // 白烧 2–3 轮并撞 `turn_blocked (consecutive environment-blocked turn)`。
    const hint = sandboxCheckResult.suggestion
      ? `（${sandboxCheckResult.suggestion}）`
      : '';
    // N-19（2026-11-07）：解释器内联执行 ⇒ 升级人工确认（与 A4 守卫同口径）。
    // 已批准（`bypassAsk`，命中放行缓存）⇒ 放行；否则转审批卡，而不是硬拒。
    if (sandboxCheckResult.requiresConfirmation && ask) {
      if (ask.bypassAsk) return null;
      const askMessage = `沙箱安全检查: ${sandboxCheckResult.reason}${hint}`;
      return createToolResult(`需要用户确认: ${askMessage}`, {
        requireApproval: true,
        approvalReason: askMessage,
        failureKind: 'permission_denied',
        newMessages: [
          { role: 'system', content: `Error: 需要用户确认: ${askMessage}` },
        ],
        metadata: {
          securityIntercepted: true,
          reason: 'sandbox_confirmation',
          approvalScope: ask.approvalScope,
          approvalSnapshot: ask.approvalSnapshot,
        },
      });
    }
    return blockedResult(`沙箱安全检查: ${sandboxCheckResult.reason}${hint}`, {
      reason: 'sandbox_checker',
    });
  }

  return null;
}

/**
 * 2026-11-24（真机 `session_mwrf18pu00456e0f2b`）：**审批终局预检** —— 审批卡只在"批准后真能执行"时出现。
 *
 * 事故：`for %f in (...) do @echo ...` 被安全分析器判 `ask` ⇒ 提交审批卡（文案承诺
 * 「用户批准后可继续执行」）；用户批准后重放，却被**硬拦截④**（基命令白名单：`for` 不在
 * 允许列表）否决 ⇒ 审批白点、模型收到的却是"命令不在允许列表中"的失败。
 *
 * 两个判断层对"可审批性"口径不一致（ask 层认为"确认即可执行"，硬拦截层认为"永不可执行"）
 * ⇒ 用户被要求为一件不可能发生的事做决定。口径收敛为：**在返回"需要审批"结果之前**，
 * 以"已批准"视角（`bypassAsk=true`）预跑审批之后的硬拦截；若仍会拦截 ⇒ 直接返回该拦截
 * 结果（带纠正提示），**不提交审批卡**。
 *
 * 纯函数 / 无副作用（与真实执行时的门禁调用同一实现）⇒ 预检结论与批准后重放结论一致。
 */
export function checkApprovalWouldBeBlocked(params: {
  command: string;
  std: StandardizedCommand;
  approvalScope: ApprovalScope;
  approvalSnapshot: ApprovalSnapshot;
}): ToolResult<unknown> | null {
  return checkWhitelistAndSandbox(params.command, params.std, {
    bypassAsk: true,
    approvalScope: params.approvalScope,
    approvalSnapshot: params.approvalSnapshot,
  });
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
    isHighCapabilityInterpreter(std.baseCommand) &&
    // B3（2026-10-30，issue #37）：只对"内联代码"形态（-c/-e/-Command…）升级确认 ——
    // 脚本/模块调用（`node x.js`、`python -m pytest`）不再一律弹卡。
    // P1（2026-11-22）：内联标记取自**剥壳后**的命令 —— 否则 `bash -c "node script.js"`
    // 会被外层壳的 `-c` 误判为内联代码；`bash -c "node -e …"` 仍能正确命中 `-e`。
    hasInlineCodeFlag(std.effectiveCommand)
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
