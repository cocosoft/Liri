import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * GrepTool - 代码/文件内容搜索工具
 *
 * 使用正则表达式在文件中搜索文本内容，基于低层 grep() 函数实现。
 * 本工具专注于文件内容搜索，返回含匹配行内容的结果。
 * （2026-09-29 台账 D-32：原句"对标 FileSearchTool（基于 Glob 的文件名搜索）"已删 ——
 *  `FileSearchTool` 从未被任何 loader 注册，已随死类集群清理移除。）
 *
 * MIT License
 * Copyright (c) 2026 Liri
 */
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam, ToolTag } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ToolValidationResult } from '../types/Tool';
import {
  createSuccessResult,
  createFailureResult,
  checkPathAccessibility,
  getToolBaseDir,
  resolveFilePath,
} from '../utils/ToolUtils';
import { grep, grepAsync } from './grep';
import type { GrepInputType, GrepOutputType } from './schemas';
import {
  validateGrepInput,
  GrepOutputSchema,
  GrepOutputJsonSchema,
} from './schemas';
import { getDescription } from './prompt';
import { resolveToolPrompt } from '@modules/services/prompt/PromptVersionManager';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:GrepTool:GrepTool');

/**
 * BUG-05 深化：grep 专属"重复 pattern 短路"。
 * 同一搜索键（路径+pattern+include+输出模式）在短窗口内重复调用时，跳过真实搜索并提示，
 * 从源头拦截 agent 空转反复搜同一批内容的模式（LoopDetector 的 steering 在循环层兜底，本层更前置）。
 * 用模块级缓存，不依赖工具实例生命周期，保证跨调用/多实例共享。
 *
 * **2026-10-08（真机暴露）**：原缓存**只存时间戳**，命中短路时返回
 * `matches: [] / matchCount: 0` —— 明明**没有真的搜**，却对下游（模型 / 审查）呈现为"**零命中**"。
 * 长程任务实测（`pdca_muz6lxv4` step_2）：两次 `grep liri` 全被短路（首次距上一同键搜索仅 21s，
 * 受**其它任务**的历史搜索影响）⇒ 审查判 `major: grep 未真正执行、无命中证据` ⇒ 步骤 failed。
 * ⇒ **否定性证据被伪造**。现连同**真实结果**一起缓存，短路时把上次结果原样回给调用方
 * （保留 `skipped: true` 标记"未重新执行"）：反空转初衷不变，不再伪造"零命中"。
 */
const GREP_DUP_WINDOW_MS = 60_000;
/** 重复检测缓存上限（防内存增长；超限直接清空，只丢窗口缓存不丢真实结果） */
const GREP_DUP_CACHE_MAX = 200;
const grepRecentSearches = new Map<
  string,
  { at: number; output: GrepOutputType; summary: string }
>();

/**
 * 写失效（2026-10-31）：`file_write` / `file_edit` 成功后清空短路缓存。
 *
 * 缓存原本只按 60s 窗口过期、**不感知写入** ⇒「写前搜 0 命中 → 写文件 → 写后同 pattern
 * 复查」会拿到写前的**陈旧零命中**（`skipped:true`，正文还提示"请基于上次结果直接交付"），
 * 模型据此误判内容未写入。写入是"结果已改变"的确定信号 ⇒ 直接失效整个窗口缓存。
 */
export function invalidateGrepSearchCache(): void {
  grepRecentSearches.clear();
}

/**
 * 构造搜索去重键：路径 + pattern + include + 输出模式 + 分页/上下文参数。
 * 纳入 offset/headLimit/contextAround：同一 pattern 的翻页续搜（不同 offset/headLimit）或
 * 不同上下文行数的展示请求不是「重复搜索」，计入键内避免被误判短路（结论2）。
 */
function grepSearchKey(input: {
  searchPath: string;
  pattern: string;
  include?: string;
  outputMode?: string;
  offset?: number;
  headLimit?: number;
  contextAround?: number;
}): string {
  return [
    input.searchPath,
    input.pattern,
    input.include ?? '',
    input.outputMode ?? 'files_with_matches',
    input.offset ?? 0,
    input.headLimit ?? 0,
    input.contextAround ?? 0,
  ].join('|');
}

/**
 * O3-3（2026-09-24「会话暴露问题分析与优化方案」§五）：**空结果的可执行诊断**（纯函数，导出便于单测）。
 *
 * 现象：导出记录中出现大量空结果后模型换关键词继续重试（空转轮次，见问题清单 P3）——
 * 原返回体只说"匹配 0 处"，不给"搜了哪里 / 为什么可能搜不到 / 下一步怎么改"。
 */
export function buildEmptyResultDiagnostic(params: {
  pattern: string;
  searchPath: string;
  include?: string;
}): string {
  return [
    '',
    `⚠️ 本次搜索（pattern: ${params.pattern}）无匹配。可执行诊断：`,
    `  - 已搜索路径：${params.searchPath}`,
    `  - include 筛选：${params.include ?? '(未限制)'}`,
    '  - 递归搜索请用双星前缀（如 `**/*.ts`）；单星 `*.ts` 只匹配搜索目录的**根层**',
    '  - 中文/Unicode 范围请用 `[\\u4e00-\\u9fa5]`（勿用 `{...}` 写法）',
    '  - 建议：先用更短的唯一关键词定位文件，再逐步收紧 pattern；重复同一 pattern 会被去重短路',
  ].join('\n');
}

/**
 * 代码/文件内容搜索工具
 */
export class GrepTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.grep;
  /** U-03（2026-10-19）：模型可见出参结构（下发为 `output_schema`） */
  override outputJsonSchema = GrepOutputJsonSchema;
  /**
   * C-3：模型侧工具描述走 T2 解析链（用户 → 项目 → 包内 → 母语回退 → 内置兜底）。
   *
   * 用 getter 而非字段：字段在**实例化时**求值，会把 locale 固定为创建那一刻的值；
   * getter 让 locale 切换与 30s 热更在每次 `getInfo()` 时生效（命中缓存仅一次 Map 查找）。
   * 内置兜底 = `getDescription()`（包内 zh-CN 资源与其 diff=0 ⇒ 行为零变化）。
   */
  get description(): string {
    return resolveToolPrompt('GrepTool', 'getDescription', getDescription());
  }

  override tags = [ToolTag.CODE, ToolTag.READ];

  /**
   * 出参契约（P1-3 A 档，2026-09-28）。
   *
   * **本工具的出参 schema 早已存在** —— `./schemas.ts` 的 `GrepOutputSchema`（zod，与
   * `GrepOutputType` 由 `z.infer` **同源**，即类型与运行期校验本已一致）；此前只是**从未接到
   * `Tool.outputSchema` 字段**上（该字段原类型为 `unknown`，根本无法被消费）⇒ 本次**仅接线**，
   * 不新增任何契约定义（单一事实源）。
   */
  outputSchema = GrepOutputSchema;

  params: ToolParam[] = [
    {
      name: 'pattern',
      type: 'string',
      description: '用于匹配的正则表达式模式',
      required: true,
      example: 'function',
    },
    {
      name: 'searchPath',
      type: 'string',
      description: '搜索的根目录路径（兼容别名 path），默认为当前工作目录',
      required: false,
      default: '.',
      example: './src',
    },
    {
      name: 'include',
      type: 'string',
      description: '文件包含模式（通配符，如 *.ts, *.{ts,tsx}）',
      required: false,
      example: '*.ts',
    },
    {
      name: 'outputMode',
      type: 'string',
      description:
        '输出模式: content（内容）、files_with_matches（仅文件名）、count（计数）',
      required: false,
      default: 'files_with_matches',
      example: 'content',
    },
    {
      name: 'contextAround',
      type: 'number',
      description: '匹配前后各显示的行数',
      required: false,
      default: 0,
      example: 3,
    },
    {
      name: 'caseInsensitive',
      type: 'boolean',
      description: '是否忽略大小写',
      required: false,
      default: false,
      example: true,
    },
    {
      name: 'headLimit',
      type: 'number',
      description: '最大返回结果数，默认 200',
      required: false,
      default: 200,
      example: 100,
    },
    {
      name: 'multiline',
      type: 'boolean',
      description: '是否启用多行匹配模式',
      required: false,
      default: false,
      example: false,
    },
    {
      name: 'type',
      type: 'string',
      description: '文件类型过滤（如 ts, js, rs, py）',
      required: false,
      example: 'ts',
    },
  ];

  override aliases = ['search', 'regex', 'find_text'];
  searchTips = ['grep', 'search', 'regex', 'content'];

  /**
   * 执行文件内容搜索
   *
   * 委托低层 grep() 函数执行搜索，结果含匹配文件路径、行号和内容。
   */
  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      // 验证输入
      const validated: GrepInputType = validateGrepInput(input);
      // 2026-10-31（真机 app.log 取证）：相对 `searchPath` 此前按**进程 cwd** 解析，
      // 而 LRO 步骤的 `context.options.cwd` 是任务工作区 ⇒ 模型的 `searchPath: "output"`
      // 被解析到代码仓根，报 `搜索目录不存在: E:\…\output` 并反复重试。
      // 相对路径必须相对**工具上下文 cwd** 解析（与 `file_read` 的 `resolveFilePath` 同源）。
      const baseDir = getToolBaseDir(context);
      const searchPath = resolveFilePath(
        validated.searchPath || baseDir || process.cwd(),
        baseDir ?? process.cwd()
      );

      // 检查搜索目录可访问性
      const pathCheck = checkPathAccessibility(searchPath, '搜索目录');
      if (!pathCheck.accessible) {
        return createFailureResult(
          `${pathCheck.reason}${pathCheck.suggestions?.length ? `\n建议: ${pathCheck.suggestions.join('; ')}` : ''}`,
          { executionTime: Date.now() - startTime }
        );
      }

      // BUG-05 深化：重复 pattern 短窗口短路。同一搜索键在窗口内已搜过则跳过真实搜索，
      // 阻止 agent 反复 grep 同一批 pattern 而空转（结果通常在上下文/上一轮已可见）。
      const searchKey = grepSearchKey({
        searchPath,
        pattern: validated.pattern,
        include: validated.include,
        outputMode: validated.outputMode,
        offset: validated.offset,
        headLimit: validated.headLimit,
        contextAround: validated.contextAround,
      });
      const dupNow = Date.now();
      const prev = grepRecentSearches.get(searchKey);
      if (prev && dupNow - prev.at < GREP_DUP_WINDOW_MS) {
        const elapsedSinceLastMs = dupNow - prev.at;
        // 仅刷新窗口（持续空转仍被持续抑制），并回 **上次的真实结果** —— 不再伪造空结果
        prev.at = dupNow;
        logger.warn('grep:repeat_shorted', {
          searchPath,
          pattern: validated.pattern,
          include: validated.include,
          elapsedSinceLastMs,
        });
        return createSuccessResult(
          { ...prev.output, skipped: true } satisfies GrepOutputType,
          {
            executionTime: 0,
            output:
              `检测到在 ${(elapsedSinceLastMs / 1000).toFixed(0)}s 内以相同 pattern+include ` +
              `重复搜索 "${validated.pattern}"（路径 ${searchPath}）。重复搜索同一内容常表示空转。` +
              '请基于下方**上次的真实结果**直接交付结论；确需继续搜索时，请改用更精确/不同的 pattern。' +
              `本次未重新执行。\n\n【上次结果】\n${prev.summary}`,
          }
        );
      }

      // 执行搜索（2026-08-31 根因修复：改用协作式异步遍历，扫描大型目录时
      // 定期让出事件循环，SSE 心跳保持，避免前端"流式响应超时"误判）
      const result = await grepAsync({
        pattern: validated.pattern,
        searchPath,
        include: validated.include,
        outputMode: validated.outputMode || 'files_with_matches',
        contextBefore: validated.contextBefore,
        contextAfter: validated.contextAfter,
        contextAround: validated.contextAround,
        showLineNumbers: validated.showLineNumbers !== false,
        caseInsensitive: validated.caseInsensitive,
        type: validated.type,
        headLimit: validated.headLimit ?? 200,
        offset: validated.offset,
        multiline: validated.multiline,
      });

      const output: GrepOutputType = {
        matches: result.matches,
        matchCount: result.matchCount,
        fileCount: result.fileCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
        invalidRegex: result.invalidRegex,
        // #5：遍历规模（只观测；供工具执行统一出口做耗时构成分解）
        ...(result.stats ? { stats: result.stats } : {}),
        skipped: false,
      };

      // BUG-01/02：正则非法时把原因明确反馈给调用方自纠，而非误导性的空结果
      const invalidNotice = result.invalidRegex
        ? `正则无效: ${result.invalidRegex}\n已按字面量降级搜索（通常为空）。请修正 pattern 语法后重试，例如中文范围用 [\\u4e00-\\u9fa5] 而非 [\\x{4e00}-\\x{9fa5}]。\n\n`
        : '';

      // 构造可读的输出摘要
      const skippedLargeFiles = result.stats?.skippedLargeFiles ?? 0;
      const summary = [
        `${invalidNotice}搜索 "${validated.pattern}" 完成:`,
        `  - 匹配 ${result.matchCount} 处，分布在 ${result.fileCount} 个文件`,
        `  - 耗时 ${result.durationMs}ms`,
        // FIX-1（2026-10-27）：大文件被跳过时必须显式告知 —— 否则"没搜"会被读成"没命中"
        skippedLargeFiles > 0
          ? `  - ⚠️ 另有 ${skippedLargeFiles} 个文件超过 16MiB 未扫描：本次结论**不覆盖**这些文件`
          : '',
        result.truncated ? '  - (结果已截断，使用 headLimit 调整)' : '',
        // O3-3：空结果附带可执行诊断（减少"换关键词空转"）
        result.matchCount === 0
          ? buildEmptyResultDiagnostic({
              pattern: validated.pattern,
              searchPath,
              ...(validated.include ? { include: validated.include } : {}),
            })
          : '',
        '',
        ...result.matches.slice(0, 50),
      ]
        .filter(Boolean)
        .join('\n');

      // 缓存**真实结果**（供同键重复调用短路时回给调用方，见文件头 2026-10-08 说明）
      // 防内存增长：条目过多直接清空（只丢窗口缓存，不影响任何真实结果）
      if (grepRecentSearches.size > GREP_DUP_CACHE_MAX) {
        grepRecentSearches.clear();
      }
      grepRecentSearches.set(searchKey, {
        at: Date.now(),
        output,
        summary,
      });

      return createSuccessResult(output, {
        executionTime: result.durationMs,
        output: summary,
      });
    } catch (error: unknown) {
      return createFailureResult(
        error instanceof Error ? error.message : String(error),
        {
          executionTime: Date.now() - startTime,
        }
      );
    }
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override validateInput(input: Record<string, unknown>): ToolValidationResult {
    if (!input.pattern || typeof input.pattern !== 'string') {
      return {
        result: false,
        message: 'pattern 是必填参数且必须是字符串',
      };
    }
    return { result: true };
  }

  override async checkPermissions(
    _input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<PermissionResult> {
    return createAllowResult(_input);
  }

  /**
   * 检查是否为搜索或读取命令
   */
  override isSearchOrReadCommand(_input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: true, isRead: true };
  }
}
