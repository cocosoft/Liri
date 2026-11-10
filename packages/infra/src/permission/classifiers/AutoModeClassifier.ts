/**
 * 自动模式分类器
 * 用于自动判断工具使用是否安全
 */

import { handleError } from '@openliri/infra/error';
// 2026-11-10：注入类检测只对"入参会被执行"的工具生效（角色判据单一来源）
import { isExecutionToolName } from '@openliri/infra/utils/toolContract/toolRoles';
import { DANGEROUS_TOOL_KEYWORDS } from './dangerous-tool-keywords';
import { AUTO_MODE_DANGER_TOKENS } from './dangerous-command-patterns';
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
 * 危险令牌的**标识符边界**匹配（2026-11-10）。
 *
 * 原实现 `surface.includes(token)` 是子串匹配：`node -e` 会命中 PowerShell 的
 * `node -ErrorAction`（真机 `session_mwagfxw09146ea473f` 的只读 `Get-Command node
 * -ErrorAction …` 因此被拒）、`at ` 会命中英文正文的 "at 10"。现要求令牌两侧不紧邻
 * 字母/数字/下划线；令牌自带的空白先裁掉（`' && '` ⇒ `&&`，`'rm -rf /'` 保持原样）。
 */
function containsDangerToken(surface: string, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(surface);
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
     * 2026-11-10：注入类检测只对**会被执行的入参**生效（bash/powershell 的 `command`、
     * `code` 工具的 `code`）。其余工具的入参是数据（待办正文 / 正则 / 路径 / 文件正文），
     * 逐条硬匹配只会误杀：真机 `todo_write` 因 `"id "`、`grep` 因正则被判危险命令 ⇒
     * deny 累积后连带把正常读取升级成 ask。空 ⇒ 跳过该组检测（敏感路径与工作区守卫照旧）。
     */
    const executionSurface = isExecutionToolName(lowerToolName)
      ? inputString
      : undefined;

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

      // 检查危险命令模式（标识符边界匹配，见 `containsDangerToken`）
      for (const pattern of AUTO_MODE_DANGER_TOKENS) {
        if (containsDangerToken(executionSurface, pattern)) {
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

    // 检查路径遍历
    const pathTraversalResult = detectPathTraversal(inputString);
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

    // 检查SQL注入
    const sqlResult = detectSqlInjection(inputString);
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
