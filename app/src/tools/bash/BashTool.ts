import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
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
import { createToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { createBashProgress } from '../types/ToolProgress';
// LRO-10（2026-10-26）：空输出判定/文案落在 `tools/utils/ToolUtils`（与 PowerShellTool 同一口径）
import {
  ToolUtils,
  isEmptyOutput,
  EMPTY_OUTPUT_HINT,
} from '../utils/ToolUtils';
import type { InterruptBehavior } from '../types/Tool';
import { ToolTag } from '../types/Tool';
import {
  BashSecurityAnalyzer,
  securityIntegrationService,
} from '@modules/security';
import type { ExecOptions } from 'child_process';
import { analyzeBashCommandType, isSilentBashCommand } from './BashSemantics';
// S1-5（2026-10-11）：命令规范化"单一事实源" —— 审批哈希 / 安全拦截层 / 最终 spawn /
// 审批卡展示四处共用 `standardizeCommand()` 的一次性产出（消除 G10/G22 口径漂移）
import {
  standardizeCommand,
  type StandardizedCommand,
} from './commandNormalization';
// G18（2026-10-11）：5 个安全门（硬拦截 ①~④ + 解释器守卫）外移为**纯函数**模块
//（`checkPathSafety`/`checkBashDangerousCommand`/`checkAstAndAnalyzer`/`checkWhitelistAndSandbox`/
// `checkInterpreterGuard`）+ `isPathSafe` 迁入；本文件只负责按序短路调用）
import {
  checkPathSafety,
  checkBashDangerousCommand,
  checkAstAndAnalyzer,
  checkWhitelistAndSandbox,
  checkInterpreterGuard,
} from './bashSecurityGate';
// G-07（2026-10-19）：`powershell/pwsh -Command "…"` 包裹的内层脚本不得绕过安全链 ——
// 复用 PowerShellTool 的同一判定入口（不新增第二套危险词表）。
import {
  checkPowerShellWrapper,
  isSinglePowerShellWrapperCommand,
} from './powerShellWrapper';
// G18：大输出软截断抽至 `./bashOutputTruncate`
import {
  applyBashOutputSoftTruncate,
  BASH_EXEC_MAX_BUFFER_BYTES,
} from './bashOutputTruncate';
// G1-A（2026-09-26）：bash 执行的唯一收敛入口 —— 配置显式开启时在 Landlock 域内执行
// （G1-C 的顾问性提示已随之收敛到该入口的"普通路径"分支内）
import { execBashCommand } from './bashLandlockExec';
import {
  completeSecuritySystem,
  stripSensitiveEnv,
  sanitizeCallerEnv,
} from '@modules/security';
import { feature } from '@openliri/kernel';

// G18（2026-10-11）：K-5 输出截断常量/函数已抽至 `./bashOutputTruncate`（**纯搬迁**，语义不变）。
// 工具执行审批链路（P0-4 / S1-1）：已批准命令放行缓存
import {
  ApprovedCommandRegistry,
  getApprovedCommandRegistry,
  hashCommandForExecution,
  hashEnvForApproval,
  type ApprovalScope,
  type ApprovalSnapshot,
} from '@modules/permission';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:bash:BashTool');

/**
 * 第九轮审查 §七 建议 5（2026-10-09）：**不让安全开关在缺少告警的情况下长期停留默认关闭**。
 *
 * 进程内**首次构造** BashTool 时打印一次"仍有 Bash 安全开关处于灰度（默认关）"的告警，
 * 使当前安全姿态可见。A2 已翻转为安全基线（默认开）；A4/A5 仍为灰度。
 * 启用条件 / 回退条件 / 迁移期限：`.trae/specs/default-off-switches-review-gates.md §2.2`。
 */
let graySwitchWarningEmitted = false;

/** 灰度开关清单（单一事实源；A2 已翻转为安全基线，不在其中） */
const GRAY_SECURITY_SWITCHES = [
  'BASH_INTERPRETER_GUARD',
  'BASH_APPROVAL_STRICT',
] as const;

/**
 * 打印一次"灰度开关"告警（**模块私有**；外部只暴露 `resetGraySwitchWarningForTest`）。
 *
 * 可观测性由**日志**承担（`logger.warn`，module=`tools\bash\BashTool`）—— 单测经
 * 「构造 BashTool + 日志断言」验证，**不扩大导出面**。
 */
function warnGraySecuritySwitchesOnce(): void {
  if (graySwitchWarningEmitted) return;
  graySwitchWarningEmitted = true;
  const gray = GRAY_SECURITY_SWITCHES.filter((f) => !feature(f));
  if (gray.length > 0) {
    logger.warn('[Bash 安全姿态] 以下安全开关仍处**灰度（默认关）**', {
      switches: gray,
      note: '启用条件 / 回退 / 迁移期限见 .trae/specs/default-off-switches-review-gates.md §2.2',
    });
  }
}

/** 仅测试用：重置"一次性告警"标记 */
export function resetGraySwitchWarningForTest(): void {
  graySwitchWarningEmitted = false;
}

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

// G18（2026-10-11）：`DANGEROUS_COMMANDS` / `DANGEROUS_PATTERNS` / `ALLOWED_COMMANDS` /
// `isBaseCommandAllowed` / `HIGH_CAPABILITY_INTERPRETERS` / `isHighCapabilityInterpreter`
// 已抽至 `./bashCommandPolicy`（**纯搬迁**，语义不变）并在顶部导入。

// G18（2026-10-11）：沙箱安全检查器实例 + `isPathSafe()` 已抽至 `./bashSecurityGate`
// （**纯搬迁**，语义不变）—— 见该模块的 `checkWhitelistAndSandbox` / `checkPathSafety`。

// G18（2026-10-11）：`applyBashOutputSoftTruncate` / `formatBytes` / K-5 阈值常量
// 已抽至 `./bashOutputTruncate`（**纯搬迁**，含日志文案与阈值逐字保持）并在顶部导入。

/**
 * P1-5（2026-10-10）：bash 子进程**最终环境**的**唯一构造点**（纯函数，便于跨层一致性测试断言
 * `env 清洗 → 最终 spawn` 全链，避免测试复制生产逻辑）。
 *
 * 语义（第九轮审查 §五 缺陷 #5）：
 * - 先剥离**父进程**继承的敏感键（`stripSensitiveEnv`，单一事实源 `@modules/security`）；
 * - 对**调用方 env**（模型可控）施加**同一套**敏感键策略 + 额外剥离**执行控制键**
 *   （`PATH`/`NODE_OPTIONS`/`LD_PRELOAD` 等）⇒ 调用方**不能覆盖**已剥离项，也不能改写执行语义；
 * - Windows 追加 `GIT_SSL_BACKEND=schannel`。
 *
 * @returns `env` 最终环境；`stripped` 被剥离的调用方键（供调用方留痕，不静默丢弃 —— CS03-002）
 */
export function buildBashSpawnEnv(
  callerEnv: NodeJS.ProcessEnv | undefined,
  opts: { isWindows: boolean; parentEnv?: NodeJS.ProcessEnv }
): { env: NodeJS.ProcessEnv; stripped: string[] } {
  const sanitized = sanitizeCallerEnv(callerEnv || {});
  const env: NodeJS.ProcessEnv = {
    ...stripSensitiveEnv(opts.parentEnv ?? process.env),
    ...sanitized.env,
  };
  if (opts.isWindows) {
    env['GIT_SSL_BACKEND'] = 'schannel';
  }
  return { env, stripped: sanitized.stripped };
}

export class BashTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.bash;

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

  /**
   * 描述：**平台无关**（2026-10-19 CI 修复）。
   *
   * `prompts/zh-CN/tool-descriptions.json` 是跨平台冻结物，且 `resolveToolDescription()`
   * 中**包内资源优先于源码描述** ⇒ 若此处按平台二选一，Linux 会解析到 Windows 文案
   * （模型被告知用 cmd.exe），反之亦然；CI 的 `descriptions:check`（ubuntu 生成）
   * 也永远对不上 Windows 生成物。
   * 现改为**同时说明两平台**：信息不丢，资源在任一平台生成都一致。
   */
  override get description(): string {
    return [
      '在安全检查下执行 shell 命令。',
      '执行环境随平台而定：Windows 为 cmd.exe（不是 bash；路径用 \\，用 dir/type/findstr/del/copy/move 代替 ls/cat/grep/rm/cp/mv，临时目录用 %TEMP%，复杂脚本可前缀 powershell -Command "…"）；Unix 为 /bin/sh。',
    ].join('\n');
  }

  override tags = [ToolTag.CODE];

  /** A-4（2026-10-18）：能力声明位 —— 执行任意 shell 命令（调用方不再按工具名分支） */
  override sandboxLevel = 'execution' as const;

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
    // 第九轮审查 §七 建议 5：一次性的"灰度开关"告警（进程内只打一次）
    warnGraySecuritySwitchesOnce();

    // 动态参数描述（2026-10-19：改为**平台无关**文本 —— 资源 `prompts/zh-CN/tool-params.json`
    // 是跨平台冻结物，原 Windows 专用文案会让 Linux 运行时解析到错误说明，且 CI 的
    // `params:check`（在 ubuntu 生成）与 Windows 生成物必然漂移 ⇒ 改为同时覆盖两平台的说明。
    const commandParamDesc =
      '要执行的命令（按当前平台默认 shell 执行：Windows 使用 cmd.exe —— 路径用 \\、环境变量用 %VAR%；Unix 使用 /bin/sh）';
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
    // B 类可观测性缺口 ②（2026-10-25）：catch 作用域访问不到 try 块内的 `command`，
    // 故在执行前预存命令摘要，供异常分支落 app.log（含命令预览 + sessionId）。
    let executedCommandPreview: string | undefined;

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

      // S1-5（2026-10-11）：**一次性**规范化 —— 审批哈希 / 安全拦截层 / 最终 spawn /
      // 审批卡展示四处共用同一 `StandardizedCommand`（消除 G10/G22 口径漂移）。
      // - `preprocessed` = 最终 spawn 字符串（保留多行/引号原语义）；
      // - `normalized`   = 审批哈希与展示口径（`normalizeCommand` 会折叠换行 ⇒ **不可 spawn**）；
      // - Windows 改写（/tmp→%TEMP%、/dev/null→NUL、全角冒号加引号）**只在 `standardizeCommand` 内发生一次**。
      const std: StandardizedCommand = standardizeCommand(command, {
        isWindows: this.isWindows,
      });
      if (std.warnings.some((w) => w.includes('禁止'))) {
        const warningMsg = `BashTool 命令预处理警告:\n${std.warnings.join('\n')}`;
        // LRO-09 步骤 4（2026-10-26）：预处理"禁止"分支**不再返回 success** ——
        // 该分支的命令从未执行，返回成功会让模型误以为已生效、也让熔断器把它当"有推进"。
        // 分类走结构化字段（`safety_blocked`），不解析文案（CS02）。
        return createToolResult(warningMsg, {
          status: ToolExecutionStatus.FAILURE,
          error: warningMsg,
          failureKind: 'safety_blocked',
          newMessages: [
            {
              role: 'system',
              content: `Error: ${warningMsg}`,
            },
          ],
        });
      }
      command = std.preprocessed;
      // B 类可观测性缺口 ②：预存最终 spawn 字符串摘要（见 `executedCommandPreview` 声明处）
      executedCommandPreview = command.slice(0, 200);
      // 自动修正 cwd 中的 Unix 路径
      if (this.isWindows && cwd) {
        cwd = this.translateWindowsPath(cwd);
      }

      // W1（2026-10-19）：把工作区信任级别透传给分析器。
      // `analyze(command, trustLevel)` 的信任分级（development/work 下非危险命令不硬拒）
      // 此前在工具路径上恒为 `undefined`（本门只传 command）⇒ 该分支是死代码，
      // 导致受信任工作区里的 `node --version` 等只读命令仍被 allowlist 硬拒。
      const trustLevel = securityIntegrationService.getTrustLevelForPath(
        cwd ?? context?.options?.cwd ?? process.cwd()
      );

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', '', undefined, true, false),
      });

      // S1-1（2026-10-11）：审批绑定执行作用域 + 审批快照（S1-5：快照取自同一 `std`）。
      // - scope：同一命令在不同 cwd / 调用方 env / 平台下**不得**复用同一次批准
      //   （env 仅取**已清洗**调用方 env 的摘要，不落明文）；
      // - snapshot：记录"原始命令 / 规范化命令 / 改写项"，使审批卡与实际执行字符串可对账
      //   （Windows 改写见 `commandNormalization.preprocessWindowsCommand`）。
      const approvalScope: ApprovalScope = {
        platform: process.platform,
        cwd: cwd ?? context?.options?.cwd,
        envDigest: hashEnvForApproval(sanitizeCallerEnv(env || {}).env),
      };
      const approvalSnapshot: ApprovalSnapshot = {
        originalCommand: std.raw,
        normalizedCommand: std.normalized,
        rewrites: std.rewrites,
      };

      // P0-4: 已批准命令放行通道 —— 用户审批批准的命令放行
      // （保留 Zod 输入校验 L333 + Windows 预处理 L351 + 审计日志，见下）
      // P0-2: 统一用 hashCommandForExecution（与提交审批端一致，幂等于已预处理命令）
      const approvedHash = hashCommandForExecution(command);
      const isApproved = this.approvedRegistry.isApproved(
        context.sessionId || '',
        approvedHash,
        approvalScope
      );
      // S1-2（2026-10-11，G11）：**硬拦截层无条件执行**（下方花括号块恒定进入）。
      // 原实现 `if (!isApproved || revalidateApproved)` 允许"已批准 + 灰度关"整体跳过本层
      // ⇒ 只要把 `FEATURE_BASH_APPROVED_REVALIDATE` 置 false，DENY/危险命令即可被绕过
      //（安全基线可被灰度开关回退）。现语义收敛为：
      // - 硬拦截（路径 / 危险命令 / 危险模式 / AST-危险 / deny / 白名单 / 沙箱）：**恒执行，开关关不掉**；
      // - `bypassAsk` 仅豁免"重复弹 ask 卡"（已批准命令不再重复确认）；
      // - 灰度开关 `BASH_APPROVED_REVALIDATE`：关 ⇒ 已批准命令免重复 ask；开 ⇒ 已批准命令仍按 ask 复检。
      const bypassAsk = isApproved && !feature('BASH_APPROVED_REVALIDATE');
      // P0-4: 放行即需审计记录（session + hash + 命令）确保可追溯
      if (isApproved) {
        logger.info('已批准命令放行', {
          sessionId: context.sessionId,
          hash: approvedHash,
          command: command.slice(0, 500),
          bypassAsk,
          hardBlocksEnforced: true,
        });
      }

      // ── 硬拦截层（S1-2：**恒定执行**，无门禁；已批准仅豁免 ask 分支，不豁免任何硬拦截）──
      // G18（2026-10-11）：原为一个 ~185 行的花括号块，现按"单职责"下沉为 4 个**纯函数**
      //（`./bashSecurityGate`，逐字搬迁、语义不变）：
      //   ① `checkPathSafety`（S1-5 统一口径 `std.paths` + G22 Windows fail-closed）
      //   ② `checkBashDangerousCommand`（危险命令列表 + 危险模式）
      //   ③ `checkAstAndAnalyzer`（安全分析器 + AST + deny/ask；AST 不确定 ⇒ fail-closed 转人工）
      //   ④ `checkWhitelistAndSandbox`（白名单 F3 + 沙箱二次校验 F2）
      const pathBlock = checkPathSafety(std);
      if (pathBlock) {
        // 2026-10-25（预存台账 B 类可观测性缺口）：拦截事件此前**零日志** —— 只落会话消息、
        // 不进 app.log（用户会话 `session_mvl0d0a3d6e2e9a764` 实证），排查"命令被安全策略拦截"
        // 只能翻 messages.jsonl。现按 `powershell_wrapper_blocked`（本方法 :403）先例补 warn，
        // 字段同构：sessionId + commandPreview + reason。
        logger.warn('bash: security_gate_blocked', {
          sessionId: context.sessionId,
          commandPreview: command.slice(0, 200),
          reason: pathBlock.metadata?.['reason'],
        });
        return pathBlock;
      }

      const dangerBlock = checkBashDangerousCommand(command);
      if (dangerBlock) {
        logger.warn('bash: security_gate_blocked', {
          sessionId: context.sessionId,
          commandPreview: command.slice(0, 200),
          reason: dangerBlock.metadata?.['reason'],
        });
        return dangerBlock;
      }

      // G-07（2026-10-19）：`powershell/pwsh -Command "…"` 的内层脚本复用 PowerShellTool
      // 的安全链（分析器 → 白名单 → 沙箱）；`-EncodedCommand` 等不可检查形态 fail-closed。
      const psWrapperBlock = checkPowerShellWrapper(
        command,
        cwd ?? context?.options?.cwd
      );
      if (psWrapperBlock) {
        logger.warn('bash: powershell_wrapper_blocked', {
          sessionId: context.sessionId,
          commandPreview: command.slice(0, 200),
        });
        return psWrapperBlock;
      }

      const analysisBlock = checkAstAndAnalyzer({
        command,
        bypassAsk,
        approvalScope,
        approvalSnapshot,
        analyzer: this.securityAnalyzer,
        trustLevel,
        // FIX-15：单条 PowerShell 包裹已由上一道闸（G-07）用 PowerShell 安全链判定过
        delegatedSinglePowerShell: isSinglePowerShellWrapperCommand(command),
      });
      if (analysisBlock) {
        // 2026-10-25（与 path/danger 分支同源补日志）：分析器 deny / AST 拦截事件落 app.log，
        // 字段同构（reason 区分 deny 与 ask/inconclusive 等来源）。
        logger.warn('bash: security_gate_blocked', {
          sessionId: context.sessionId,
          commandPreview: command.slice(0, 200),
          reason: analysisBlock.metadata?.['reason'],
        });
        return analysisBlock;
      }

      const whitelistBlock = checkWhitelistAndSandbox(command, std);
      if (whitelistBlock) {
        // 2026-10-25（B 类可观测性缺口 ①）：白名单 F3 / 沙箱二次校验 F2 拦截事件此前**零日志**
        // —— 只落会话消息、不进 app.log（用户会话 `session_mvl0d0a3d6e2e9a764` 实证"bash 命令
        // 被安全策略拦截"无迹可查）。与 path/danger/ast 三分支（本方法 :392/:402/:435）同构补齐。
        logger.warn('bash: security_gate_blocked', {
          sessionId: context.sessionId,
          commandPreview: command.slice(0, 200),
          reason: whitelistBlock.metadata?.['reason'],
        });
        return whitelistBlock;
      }

      // A4（2026-10-09）：高能力解释器命令不得仅凭"白名单内"自动放行
      // G18 下沉（2026-10-11）：抽为 `checkInterpreterGuard(...)`（含 O1-B2 观测日志），语义不变。
      const interpreterBlock = checkInterpreterGuard({
        std,
        isApproved,
        approvalScope,
        approvalSnapshot,
        sessionId: context.sessionId,
      });
      if (interpreterBlock) {
        return interpreterBlock;
      }

      // G18 下沉（2026-10-11）：审计 + env 构建 + 执行 + 截断 + 成功结果构造，抽为
      // `this.runCommandAndBuildResult(...)`（逐字搬迁）；其内**不吞异常** ⇒ 仍由本方法
      // 外层 `catch` 统一处理（错误路径语义不变）。
      return await this.runCommandAndBuildResult({
        command,
        cwd,
        env,
        timeout,
        context,
        startTime,
        onProgress,
      });
    } catch (error) {
      const executionTime = ToolUtils.calculateExecutionTime(startTime);
      const msg = error instanceof Error ? error.message : String(error);
      const stderr = (error as { stderr?: string }).stderr;

      // B 类可观测性缺口 ②（2026-10-25）：执行异常此前**零 app.log** —— 只返回 failureResult
      // 给模型，排查"命令为什么失败"只能翻会话消息。现补 error 级日志（含命令摘要 + stderr 截断）。
      logger.error('bash: execute_error', {
        sessionId: context.sessionId,
        commandPreview: executedCommandPreview ?? '',
        error: msg.slice(0, 500),
        ...(stderr ? { stderr: stderr.slice(0, 300) } : {}),
      });

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
   * 审计 + 环境构建 + **执行** + 输出截断 + 成功结果构造（G18 下沉，2026-10-11）。
   *
   * ⚠️ 本方法**不捕获异常** —— 由 `execute` 的外层 `catch` 统一处理（错误路径语义不变）。
   * 逐字搬迁自原 `execute` 尾部，含：F5/A1 审计、G3 cwd 回退、A3/§五 env 清洗（单一事实源
   * `buildBashSpawnEnv`）、K-5 maxBuffer 硬防线、R21 取消信号、K-5 二次软截断。
   */
  private async runCommandAndBuildResult(params: {
    command: string;
    cwd: string | undefined;
    env: Record<string, string> | undefined;
    timeout: number;
    context: ToolUseContext;
    startTime: number;
    onProgress?: ToolCallProgress<any>;
  }): Promise<ToolResult<unknown>> {
    const { command, cwd, env, timeout, context, startTime, onProgress } =
      params;

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
    // SSH_AUTH_SOCK / 云凭据等），避免密钥泄露进子进程。
    // 剥离清单**单一事实源**：`@modules/security` 的 stripSensitiveEnv（与 hooks 侧同源，避免第二份）。
    //
    // 第九轮审查 §五（2026-10-09，缺陷 #5 修复）：**调用方显式传入的 env 不再直接合并**
    // —— 原 `{ ...stripSensitiveEnv(process.env), ...(env || {}) }` 允许调用方（模型可控输入）
    // **覆盖**已剥离项。现对调用方 env 施加**同一套策略**（敏感键）+ 额外剥离**执行控制键**
    // （PATH / NODE_OPTIONS / PYTHONPATH / BASH_ENV / LD_PRELOAD … ⇒ 命令文本不变但实际
    // 执行语义改变）。被剥离项**留痕**（debug），不静默丢弃（CS03-002）。
    const { env: mergedEnv, stripped: strippedCallerEnv } = buildBashSpawnEnv(
      env,
      { isWindows: this.isWindows }
    );
    if (strippedCallerEnv.length > 0) {
      logger.warn('bash: caller env 含受保护键，已剥离', {
        sessionId: context.sessionId,
        stripped: strippedCallerEnv,
      });
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

    // LRO-10（2026-10-26）：成功但完全无输出 ⇒ 结构化标记 + 提示（状态仍是成功）
    const emptyResult = isEmptyOutput(stdout, stderr);
    if (emptyResult) {
      logger.info('bash: empty_result', {
        sessionId: context?.sessionId,
        commandPreview: command.slice(0, 200),
      });
    }

    // 报告执行完成
    onProgress?.({
      toolUseID: context.toolUseId || 'bash-tool',
      data: createBashProgress(stdout, stderr, 0, false, true),
    });

    // 对标CC：返回元数据丰富的结果
    return ToolUtils.createSuccessResult(
      emptyResult ? EMPTY_OUTPUT_HINT : output,
      {
        output: emptyResult ? EMPTY_OUTPUT_HINT : output,
        errorOutput: stderr,
        executionTime,
        toolName: 'bash',
        executionId: ToolUtils.generateExecutionId('bash'),
        timestamp: Date.now(),
        // LRO-10：空输出是**事实标记**，不是失败（前端/审计可据此区分"跑了但没信息"）
        ...(emptyResult ? { metadata: { emptyResult: true } } : {}),
        newMessages: [
          {
            role: 'system',
            content: emptyResult
              ? `Command executed successfully in ${executionTime}ms (no output)`
              : `Command executed successfully in ${executionTime}ms`,
          },
        ],
      }
    );
  }

  // G18（2026-10-11）：5 个安全门（`checkPathSafety` / `checkDangerousCommand` / `checkAstAndAnalyzer` /
  // `checkWhitelistAndSandbox` / `checkInterpreterGuard`）已整体外移为 `./bashSecurityGate` 的**纯函数**
  //（**逐字搬迁**，语义不变；`checkAstAndAnalyzer` 的分析器由 `execute` 以参数传入）。

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
