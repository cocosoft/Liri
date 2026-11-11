/**
 * 自动模式分类器
 * 用于自动判断工具使用是否安全
 */

import { handleError } from '@openliri/infra/error';
// 2026-11-10：注入类检测只对"入参会被执行"的工具生效（角色判据单一来源）
import { isExecutionToolName } from '@openliri/infra/utils/toolContract/toolRoles';
// 2026-11-10（方案①）：危险令牌按**命令位**匹配（解释器名作为参数时不误报）
import {
  containsCommandToken,
  extractNestedShellBodies,
  // 2026-11-12（P0）：`powershell -EncodedCommand` 载荷解码
  extractEncodedBodies,
} from './command-token-match';
// 2026-11-12（P0）：未知命令档位的灰度开关（与 `PERMISSION_MODE` 同源读取方式）
import { configManager } from '@openliri/infra/config';
// 2026-11-11：嵌套 shell 的内层若是**结构只读命令**，不能按词表硬拒
// （`powershell -Command "git diff --stat"` 会命中 `git ` 令牌）。
// 与 PermissionManager 的只读短路共用同一事实源（readonly-command-allowlist）。
import { checkReadonlyCommand } from './readonly-command-allowlist';
import { DANGEROUS_TOOL_KEYWORDS } from './dangerous-tool-keywords';
// 2026-11-11（P5）：命令令牌表已迁入安全规则域，经安全模块桶（index.ts）导入
import {
  AUTO_MODE_HARD_DENY_TOKENS,
  AUTO_MODE_APPROVAL_TOKENS,
  expandTokenAliases,
} from '@openliri/infra/security';
import { SENSITIVE_PATH_PATTERNS } from './sensitive-path-patterns';
import { ENV_POLLUTION_PATTERNS } from './env-pollution-patterns';
import { ZERO_WIDTH_PATTERNS } from './zero-width-patterns';
import {
  detectZeroWidthCharacters,
  detectNullByteInjection,
  detectZshEqualsExpansion,
  detectEncodingAttack,
  detectSqlInjection,
  detectXssAttack,
  detectCommandInjection,
  detectDeserializationAttack,
  detectLDAPInjection,
  detectXXEAttack,
} from './injection-rules';
import {
  detectTemplateInjection,
  detectPathTraversal,
  detectEncodedPathTraversal,
  detectPipeAndRedirect,
  detectReDoSAttack,
  detectSSRFAttack,
  detectFileInclusion,
  detectRequestSmuggling,
  detectWebSocketAttack,
  detectDNSTunnel,
} from './vector-rules';

// 2026-09-26：`ClassifierDecision` 已抽到**叶子** `./classifierDecision` —— 打断
// `AutoModeClassifier ↔ injection-rules` 与 `↔ vector-rules` 两条环
// （`madge --circular` 把 `import type` 也计环，故类型位置也会成环）。
// 本地使用需 `import`（re-export 不引入本地绑定）；对外路径由下方 `export type` 保持不变。
import type { ClassifierDecision } from './classifierDecision';
export type { ClassifierDecision } from './classifierDecision';

/**
 * 未知命令档位（2026-11-12，P0 · 未知命令策略 B）。
 *
 * 默认 `ask`（fail-closed）；`PERMISSION_UNKNOWN_COMMAND_TIER=allow` 灰度回退改造前行为。
 * 只接受显式 `allow`：拼写错误 / 空值一律按 `ask`，避免"配置写错 ⇒ 静默放宽"。
 */
function resolveUnknownCommandTier(): 'allow' | 'ask' {
  const raw = configManager
    .env('PERMISSION_UNKNOWN_COMMAND_TIER', 'ask')
    ?.trim()
    .toLowerCase();
  return raw === 'allow' ? 'allow' : 'ask';
}

/**
 * 令牌**或同组等价写法**是否命中（2026-11-11，等价命令组归一表）。
 *
 * 先判原令牌（原始命令名的既有判定不变），再按 `COMMAND_EQUIVALENCE_GROUPS`
 * 展开的同组写法判（`set-content` ⇒ `sc` / `add-content` / `ac` …；
 * `ren ` ⇒ `rename-item` / `rni` / `mv` …；`remove-item` ⇒ `del` / `rd` / `rmdir` …）。
 * 这样新增写法只需改表，不必同时改两张令牌表。
 */
function matchesCommandToken(surface: string, token: string): boolean {
  if (containsCommandToken(surface, token)) return true;
  return expandTokenAliases(token).some((alias) =>
    containsCommandToken(surface, alias)
  );
}

/**
 * 分类器接口
 */
export interface IAutoModeClassifier {
  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision>;

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean;
}

/**
 * 安全工具白名单
 * 这些工具被认为是安全的，不需要分类器检查
 */
const SAFE_TOOLS = new Set([
  'read',
  'list',
  'search',
  'view',
  'cat',
  'pwd',
  'echo',
  'help',
  'info',
  'status',
  'version',
  'whoami',
]);

/**
 * 文件写入类工具里承载**正文**的字段（2026-11-10）。
 *
 * 分类器原先把 `JSON.stringify(input)` 整体喂给命令注入 / 危险令牌 / 编码 / XSS 检测 ⇒
 * 写文件时正文里的正常文本也会被判攻击（真机 `session_mwafufgo83f3a75abb`：`file_write`
 * 因正文含 ` at ` 与 `</script>` 连续 2 轮被拒 ⇒ `environment_blocked`，任务直接失败；
 * 前一轮同类误报是正文含 `C:\Users\…` 被判 Unicode 编码攻击）。
 *
 * 口径：这些字段是**数据**，不在本次调用里执行；真正的执行面（bash `command` / code_run
 * `code`）不含这些键 ⇒ 仍走全部检测。若正文日后被拿去执行，那次执行的入参会再次被检查。
 */
const FILE_CONTENT_FIELD_KEYS = new Set([
  'content',
  'text',
  'body',
  'markdown',
  'html',
  'old_string',
  'new_string',
  'diff',
  'patch',
  'snippet',
]);

/** 文件载荷的路径字段（与正文键同时出现才认定"这是文件载荷"） */
const FILE_PATH_FIELD_KEYS = new Set([
  'file_path',
  'filepath',
  'path',
  'target_path',
]);

/**
 * 去掉文件载荷里的正文键（其他工具输入原样返回，保持 fail-closed 的扫描面）。
 */
function stripFileContentFields(
  input: Record<string, unknown>
): Record<string, unknown> {
  const keys = Object.keys(input).map((key) => key.toLowerCase());
  const looksLikeFilePayload =
    keys.some((key) => FILE_PATH_FIELD_KEYS.has(key)) &&
    keys.some((key) => FILE_CONTENT_FIELD_KEYS.has(key));
  if (!looksLikeFilePayload) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FILE_CONTENT_FIELD_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/**
 * 收集输入里的**原始字符串值**（不转义）。
 *
 * 2026-11-10：敏感路径必须比对原始值 —— `JSON.stringify` 会把 `\` 变成 `\\`，而
 * `C:\Windows\System32\`、`C:\Users\Administrator\` 这类**多段**模式在转义文本里根本
 * 匹配不到（此前只有裸盘符根能命中，所以才"全拦"）。解码后的值面既保留真敏感项的拦截，
 * 又不会把工作区路径判敏感。
 */
function collectStringValues(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out);
  }
}

/**
 * 取执行面原文（`command` / `cmd` / `code`），用于注入类检测。
 *
 * 缺失这些字段 ⇒ `undefined`（该工具没有可执行入参，注入类检测不适用）。
 *
 * 2026-11-12（P0）：**保留原始大小写** —— base64 载荷区分大小写，
 * 此前在取面时统一 `toLowerCase()` 会把 `-EncodedCommand` 解成乱码，
 * 导致解码后判定全部落空。大小写归一改由调用点按需处理。
 */
function executionSurfaceOf(
  input: Record<string, unknown>
): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue;
    const lowered = key.toLowerCase();
    if (lowered === 'command' || lowered === 'cmd' || lowered === 'code') {
      parts.push(value);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * 模拟自动模式分类器实现
 * 这是一个基础实现，实际项目中可以替换为真实的AI分类器
 */
export class AutoModeClassifier implements IAutoModeClassifier {
  /**
   * 分类器名称
   */
  readonly name = 'auto-mode';

  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  async classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision> {
    const startTime = Date.now();

    try {
      // 检查是否是安全工具
      if (this.isAllowlistedTool(toolName)) {
        return {
          shouldBlock: false,
          reason: 'Tool is in safe allowlist',
          durationMs: Date.now() - startTime,
        };
      }

      // 简单的启发式规则
      const decision = this.heuristicClassify(toolName, input);

      return {
        ...decision,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      await handleError(error, {
        module: 'permission:classifier',
        action: 'classify',
      });
      return {
        shouldBlock: true,
        unavailable: true,
        reason: 'Classifier unavailable',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean {
    const lowerName = toolName.toLowerCase();
    return SAFE_TOOLS.has(lowerName) || this.isPartialMatch(lowerName);
  }

  /**
   * 启发式分类
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 分类决策
   */
  private heuristicClassify(
    toolName: string,
    input: Record<string, unknown>
  ): ClassifierDecision {
    const lowerToolName = toolName.toLowerCase();

    // 检查危险工具关键词（使用完整单词匹配，避免子字符串误匹配）
    for (const dangerous of DANGEROUS_TOOL_KEYWORDS) {
      // 只匹配完整单词：工具名等于关键词，或以关键词开头后跟下划线/连字符，或包含关键词作为完整部分
      const pattern = new RegExp(
        `(^${dangerous}$)|(^${dangerous}[_-])|([_-]${dangerous}$)|([_-]${dangerous}[_-])`
      );
      if (pattern.test(lowerToolName)) {
        return {
          shouldBlock: true,
          reason: `Tool "${toolName}" contains dangerous keyword: "${dangerous}"`,
        };
      }
    }

    // 检查输入中的危险命令模式（文件载荷只扫"路径+其余参数"，正文属数据不执行）
    const scanInput = stripFileContentFields(input);
    const inputString = JSON.stringify(scanInput).toLowerCase();
    /**
     * 2026-11-10：注入类检测只对**会被执行的入参**生效（`command` / `cmd` / `code`）。
     * 其余工具的入参是数据（待办正文 / 正则 / 路径 / 文件正文），逐条硬匹配只会误杀：
     * 真机 `todo_write` 因 `"id "`、`grep` 因正则被判危险命令 ⇒ deny 累积后连带把正常
     * 读取升级成 ask。取**原文**而非 JSON 文本 —— 危险令牌按命令位锚定，JSON 的
     * `{"command":"` 前缀会让任何"句首"锚点失效（见 `containsDangerToken`）。
     */
    // 2026-11-12（P0）：原文供 base64 解码（大小写敏感）；下游判定用小写面
    const rawExecutionSurface = isExecutionToolName(lowerToolName)
      ? executionSurfaceOf(scanInput)
      : undefined;
    const executionSurface = rawExecutionSurface?.toLowerCase();

    // 检查Unicode零宽字符注入
    const zeroWidthResult = detectZeroWidthCharacters(
      inputString,
      ZERO_WIDTH_PATTERNS
    );
    if (zeroWidthResult) {
      return zeroWidthResult;
    }

    // 检查空字节注入
    const nullByteResult = detectNullByteInjection(inputString);
    if (nullByteResult) {
      return nullByteResult;
    }

    /**
     * 2026-11-12（P0 · L1/L6）：实际参与令牌判定的**命令面**集合。
     * 原命令之外，还要带上 `powershell -EncodedCommand <base64>` 的**解码结果** ——
     * 否则 base64 只是一串普通文本，等于给任意代码执行留后门（实测曾整体放行）。
     * 嵌套 shell 的脚本体由 `containsCommandToken` 递归处理，不在此重复。
     */
    const commandSurfaces: string[] = executionSurface ? [executionSurface] : [];

    if (executionSurface) {
      // 检查Zsh equals expansion攻击
      const zshResult = detectZshEqualsExpansion(executionSurface);
      if (zshResult) {
        return zshResult;
      }

      // 检查编码攻击（Base64、URL编码等）
      const encodingResult = detectEncodingAttack(executionSurface);
      if (encodingResult) {
        return encodingResult;
      }

      // 2026-11-12（P0）：编码载荷解码 —— 解不开就是"不知道它要干什么"⇒ fail-closed
      const encoded = extractEncodedBodies(
        rawExecutionSurface ?? executionSurface
      );
      if (encoded.undecodable) {
        return {
          shouldBlock: true,
          reason: 'Input contains undecodable encoded command payload',
        };
      }
      commandSurfaces.push(...encoded.bodies);

      // 嵌套 shell 的脚本体若整体是**结构只读命令**（`git diff` / `Get-Content` …），
      // 直接放行：PermissionManager 的只读短路只覆盖"单一命令"，包一层
      // `powershell -Command` / `bash -c` 就失效，随后被词表里的 `git `/`dir ` 等令牌误杀。
      // 复合命令（含管道 / 分号）仍会被 `checkReadonlyCommand` 判 false ⇒ 继续走词表。
      //
      // 2026-11-12（P3 复查）：**仅当整条命令就是这层 shell 包装时**才适用。
      // 原实现只看"串里有没有 `sh -c`"，于是 `git config --global core.sshCommand "sh -c id"`
      // 被当成"内层只读"整条放行（外层 `git config` 从未参与判定）。
      const firstWord = executionSurface.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      const isShellWrapper =
        /^(?:bash|sh|zsh|ksh|powershell|pwsh|cmd|cmd\.exe)$/.test(firstWord);
      // 2026-11-12（P0）：脚本体必须取自**原文** —— 小写面里的 base64 是乱码，
      // 会让只读短路误判（`-EncodedCommand <ls 的 base64>` 被判"非只读"）。
      // 同时剔除"看起来就是 base64 载荷"的脚本体：那串不是脚本，真正的脚本在 `encoded.bodies`。
      const nestedBodies = extractNestedShellBodies(
        rawExecutionSurface ?? executionSurface
      ).filter((body) => !/^[A-Za-z0-9+/=]{8,}$/.test(body.trim()));
      const shellBodies = [...nestedBodies, ...encoded.bodies];
      if (
        isShellWrapper &&
        shellBodies.length > 0 &&
        shellBodies.every((body) => checkReadonlyCommand(body).allowed)
      ) {
        return {
          shouldBlock: false,
          reason: 'Nested shell body is a read-only command',
        };
      }

      // 检查危险命令模式（按**命令位**匹配，见 `containsCommandToken`）
      for (const pattern of AUTO_MODE_HARD_DENY_TOKENS) {
        if (
          commandSurfaces.some((surface) =>
            matchesCommandToken(surface, pattern)
          )
        ) {
          return {
            shouldBlock: true,
            reason: `Input contains dangerous command pattern: "${pattern}"`,
          };
        }
      }
    }

    // 检查敏感路径访问（比对**原始值**，见 `collectStringValues`）
    const rawValues: string[] = [];
    collectStringValues(scanInput, rawValues);
    const pathSurface = rawValues.join('\n').toLowerCase();
    for (const pathPattern of SENSITIVE_PATH_PATTERNS) {
      if (pathSurface.includes(pathPattern.toLowerCase())) {
        return {
          shouldBlock: true,
          reason: `Input attempts to access sensitive path: "${pathPattern}"`,
        };
      }
    }

    // 检查环境变量污染
    for (const envPattern of ENV_POLLUTION_PATTERNS) {
      if (inputString.includes(envPattern)) {
        return {
          shouldBlock: true,
          reason: `Input attempts to modify critical environment variable: "${envPattern}"`,
        };
      }
    }

    // 检查路径遍历。
    // 2026-11-11（P5 路径单一来源续）：区分**数据面**与**执行面** ——
    //  - 数据面（`file_read` / `file_write` 的路径入参）：明文 `../` 仍按遍历拦截；
    //  - 执行面（`command` / `code`）：`../` 是普通相对路径语法（`cp ../a b`、`cd ..`），
    //    一律判遍历会让 `cp` / `mv` 的审批档被抢先拒绝；只拦**编码/混淆**形态
    //    （`%2e%2e/`、`%u002e%u002e/`、`%252e%252e/` …），那才是刻意绕过路径检查。
    const pathTraversalResult = executionSurface
      ? detectEncodedPathTraversal(executionSurface.toLowerCase())
      : detectPathTraversal(inputString);
    if (pathTraversalResult) {
      return pathTraversalResult;
    }

    // 非执行工具（todo_write / grep / 文件读写…）到此为止：下面全是"解释器注入"类检测，
    // 只对会被执行的入参有意义（见 `executionSurface` 注释）。
    if (!executionSurface) {
      return {
        shouldBlock: false,
        reason: 'Action appears safe',
      };
    }

    // 检查管道和重定向
    const pipeResult = detectPipeAndRedirect(inputString);
    if (pipeResult) {
      return pipeResult;
    }

    // 检查SQL注入（`delete` / `update` 按命令位判定，见 `COMMAND_POSITION_SQL_PATTERNS`）
    const sqlResult = detectSqlInjection(inputString, executionSurface);
    if (sqlResult) {
      return sqlResult;
    }

    // 检查XSS攻击
    const xssResult = detectXssAttack(inputString);
    if (xssResult) {
      return xssResult;
    }

    // 检查命令注入
    const cmdInjectionResult = detectCommandInjection(inputString);
    if (cmdInjectionResult) {
      return cmdInjectionResult;
    }

    // 检查反序列化攻击
    const deserializationResult = detectDeserializationAttack(inputString);
    if (deserializationResult) {
      return deserializationResult;
    }

    // 检查正则表达式DoS攻击（ReDoS）
    const redosResult = detectReDoSAttack(inputString);
    if (redosResult) {
      return redosResult;
    }

    // 检查服务器端请求伪造（SSRF）
    const ssrfResult = detectSSRFAttack(inputString);
    if (ssrfResult) {
      return ssrfResult;
    }

    // 检查文件包含攻击
    const fileInclusionResult = detectFileInclusion(inputString);
    if (fileInclusionResult) {
      return fileInclusionResult;
    }

    // 检查LDAP注入攻击
    const ldapResult = detectLDAPInjection(inputString);
    if (ldapResult) {
      return ldapResult;
    }

    // 检查XML外部实体攻击（XXE）
    const xxeResult = detectXXEAttack(inputString);
    if (xxeResult) {
      return xxeResult;
    }

    // 检查模板注入攻击
    const templateResult = detectTemplateInjection(inputString);
    if (templateResult) {
      return templateResult;
    }

    // 检查请求走私攻击
    const smugglingResult = detectRequestSmuggling(inputString);
    if (smugglingResult) {
      return smugglingResult;
    }

    // 检查WebSocket劫持攻击
    const websocketResult = detectWebSocketAttack(inputString);
    if (websocketResult) {
      return websocketResult;
    }

    // 检查DNS隧道攻击
    const dnsTunnelResult = detectDNSTunnel(inputString);
    if (dnsTunnelResult) {
      return dnsTunnelResult;
    }

    // 2026-11-11（P5-approval）：可能覆盖 / 搬走既有文件的命令**不硬拒**，转人工审批。
    // 放在所有 deny 判定之后 ⇒ 同时命中硬拦（`sudo cp …`）或注入类规则时仍是 deny。
    for (const pattern of AUTO_MODE_APPROVAL_TOKENS) {
      if (
        commandSurfaces.some((surface) => matchesCommandToken(surface, pattern))
      ) {
        return {
          shouldBlock: false,
          requiresApproval: true,
          reason: `Command requires approval: "${pattern}"`,
        };
      }
    }

    /**
     * 2026-11-12（P0 · 未知命令策略 B，用户裁定 2026-11-12）：
     * 走到这里说明**没有任何档位认领这条命令**。此前一律放行 ⇒ 每个未收录的 CLI 都是洞
     * （实测 `runas` / `regsvr32` / `msiexec` / `cargo publish` 全部 ALLOW）。
     * 现改为：**结构只读才放行，其余转人工审批**。
     *
     * 灰度回退：`PERMISSION_UNKNOWN_COMMAND_TIER=allow`（回到改造前行为）。
     */
    if (
      resolveUnknownCommandTier() === 'ask' &&
      !checkReadonlyCommand(executionSurface).allowed
    ) {
      return {
        shouldBlock: false,
        requiresApproval: true,
        reason: 'Unknown command requires approval (not covered by any rule)',
      };
    }

    // 默认允许
    return {
      shouldBlock: false,
      reason: 'Action appears safe',
    };
  }

  /**
   * 检查是否部分匹配
   * @param toolName 工具名称
   * @returns 是否匹配
   */
  private isPartialMatch(toolName: string): boolean {
    const safeKeywords = [
      'read',
      'list',
      'search',
      'view',
      'show',
      'get',
      'find',
      'ls',
      'dir',
      'cat',
    ];

    for (const keyword of safeKeywords) {
      if (toolName.includes(keyword)) {
        return true;
      }
    }

    return false;
  }
}
