import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * FileEditTool - 文件编辑工具（SearchReplace模式）
 *
 * 编码说明：使用 Rust 原生模块自动检测文件编码（UTF-8 / GBK / GB18030），
 * 确保对中文编码文件（如 GBK 编码的旧版文本文件）正确处理。
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveFilePath } from '../utils/ToolUtils';
import { resolveIsolatedFileTarget } from '../utils/isolatedFileIo';
import { invalidateGrepSearchCache } from '../GrepTool/GrepTool';
import { runRegisteredOutputGuards } from '@openliri/infra/security/outputGuardRegistry';
import type { FileOperationResult } from '../types/ToolResult';

// 懒初始化 Rust 原生模块，用于自动检测文件编码
let nativeReadFile: ((filePath: string) => string) | null | undefined =
  undefined;

function lazyInitNativeRead(): ((filePath: string) => string) | null {
  if (nativeReadFile === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.readFileWithEncoding === 'function') {
        nativeReadFile = (filePath: string): string => {
          const result = native.readFileWithEncoding(filePath);
          if (result.encoding === 'error') {
            throw new Error(result.error || '编码检测失败');
          }
          return result.content;
        };
      } else {
        nativeReadFile = null;
      }
    } catch (err) {
      handleError(err, {
        module: 'tools:FileEditTool',
        action: 'initNativeReadFile',
      });
      nativeReadFile = null;
    }
  }
  return nativeReadFile;
}

/**
 * 使用 Rust 原生模块读取文件（自动检测编码），失败时回退到 UTF-8。
 */
function readFileWithEncoding(filePath: string): string {
  const nativeRead = lazyInitNativeRead();
  if (nativeRead) {
    try {
      return nativeRead(filePath);
    } catch (err) {
      handleError(err, {
        module: 'tools:FileEditTool',
        action: 'readFileWithEncoding',
      });
    }
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export interface FileEditInput {
  filePath: string;
  oldString: string;
  newString: string;
}

export interface FileEditResult extends FileOperationResult {
  linesChanged: number;
  replaced: boolean;
  oldStringFound: boolean;
}

const FILE_EDIT_MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

/**
 * 单次编辑参数上限（2026-11-05，真机 `app.log` 复盘）：
 * 整节文档塞进 `old_string/new_string`（原始 JSON 5088 字符）⇒ 输出被截断 ⇒
 * 参数 JSON 解析失败 ⇒ 模型原样重试、零进展。超限时提前拒绝并给出替代方案。
 *
 * 2026-11-09（会话 `session_mw8fwx3a48ba9e07f9` 复盘）：原 4 KB 上限**过窄** ——
 * 模型三次正常写入分别被 5650 / 5556 / 4173 字节拒绝，每次都只减几十字节后原样重试，
 * 累计 3 个"无效轮"，直接推高熔断计数。截断的真实约束是**模型输出预算**
 * （`max_output_tokens`，工具轮已按 DB 值放宽至 8192+），8 KB ≈ 2–3 K token，
 * 落在预算内；真发生截断时上游已有半截工具调用检测（N-1），不会再变成"参数为空"。
 */
export const FILE_EDIT_MAX_ARG_BYTES = 8 * 1024;

/** 同一处连续未命中的 no-progress 上限（超过后文案升级为“禁止原样重试”） */
const FILE_EDIT_NO_PROGRESS_CAP = 2;

/** 未命中计数有效期：超过 10 分钟的旧失败不再累计（避免跨任务误升级） */
const FILE_EDIT_NO_PROGRESS_TTL = 10 * 60 * 1000;

/** 同处连续未命中计数（`sessionId:绝对路径:old_string 哈希`） */
const noProgressStreak = new Map<string, { count: number; at: number }>();

/** FNV-1a 32 位哈希（只用于去重键，不做安全用途） */
function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * 单次替换的**纯计算**（宿主直写与"经隔离工作区写"共用 —— 2026-10-23 方案 A）。
 *
 * @returns `null` = 未命中 `old_string`（调用方按"未替换"回执）
 */
function computeSingleEdit(
  content: string,
  oldString: string,
  newString: string,
  filePath: string
): { newContent: string; linesChanged: number } | null {
  const count = countOccurrences(content, oldString);
  if (count === 0) return null;

  if (count > 1) {
    throw new AppError(
      `old_string is not unique in file (found ${count} occurrences). ` +
        `Provide a larger string with more surrounding context to make it unique.`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const guardedNewString = guardEditDelta(newString, filePath);
  const newContent = content.replace(oldString, guardedNewString);
  return {
    newContent,
    linesChanged: Math.abs(
      guardedNewString.split('\n').length - oldString.split('\n').length
    ),
  };
}

export function editFile(input: FileEditInput): FileEditResult {
  const resolved = resolveFilePath(input.filePath);

  if (!fs.existsSync(resolved)) {
    throw new AppError(
      `File not found: ${resolved}. Use the Write tool to create new files.`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const stat = fs.statSync(resolved);
  if (stat.size > FILE_EDIT_MAX_FILE_SIZE) {
    throw new AppError(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  // 使用编码感知的文件读取（自动检测 UTF-8 / GBK / GB18030）
  const content = readFileWithEncoding(resolved);

  const computed = computeSingleEdit(
    content,
    input.oldString,
    input.newString,
    input.filePath
  );
  if (!computed) {
    return {
      filePath: input.filePath,
      canonicalPath: resolved,
      linesChanged: 0,
      replaced: false,
      oldStringFound: false,
    };
  }

  fs.writeFileSync(resolved, computed.newContent, 'utf-8');

  return {
    filePath: input.filePath,
    canonicalPath: resolved,
    linesChanged: computed.linesChanged,
    replaced: true,
    oldStringFound: true,
  };
}

function countOccurrences(str: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * G-8（2026-10-18）：**文件写入（edit 面）**输出护栏接入点（评审门禁 §2-#1①）——
 * 只护栏**模型新增 delta**（`new_string`）；既有文件内容非本轮模型输出，不在护栏面内
 * （避免护栏改写与本次编辑无关的既有内容）。`OUTPUT_GUARD=false` 默认 ⇒ 空注册 ⇒
 * 原样返回（零变更）；redact ⇒ 打码后参与替换；block（`OUTPUT_GUARD_BLOCK`）⇒ 拒写。
 */
function guardEditDelta(newString: string, filePath: string): string {
  const gated = runRegisteredOutputGuards(newString);
  if (!gated || (!gated.blocked && gated.redactedBy.length === 0)) {
    return newString;
  }
  logger.warn('editFile:output_guard_applied', {
    filePath,
    blocked: gated.blocked,
    redactedBy: gated.redactedBy,
    deltaLen: newString.length,
  });
  if (gated.blocked) {
    throw new AppError(
      '编辑内容命中输出护栏（敏感内容），已按策略阻断写入',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'OUTPUT_GUARD_BLOCKED'
    );
  }
  return gated.text ?? newString;
}

import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';

import { getLogger } from '@openliri/infra/monitoring';
import {
  resolveReadFileState,
  type FileStateCache,
} from '@openliri/infra/utils/fileStateCache';
import { getToolBaseDir } from '../utils/ToolUtils';
import { normalizeApprovalPath } from '@openliri/infra/permission';
const logger = getLogger('tools:FileEditTool:FileEditTool');

export class FileEditTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.file_edit;
  description = '通过替换文本编辑文件';

  /**
   * U-03（2026-10-19）：模型可见出参结构。
   * 两条成功分支：（全量替换）`{filePath, replaced}`；（单次替换）额外带
   * `linesChanged / oldStringFound / replaceAll` ⇒ 后者标可选。
   */
  override outputJsonSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '被编辑文件的绝对路径' },
      replaced: { type: 'boolean', description: '是否已写回文件' },
      linesChanged: { type: 'number', description: '变更行数（单次替换分支）' },
      oldStringFound: {
        type: 'boolean',
        description: '是否命中 old_string（单次替换分支）',
      },
      replaceAll: {
        type: 'boolean',
        description: '是否替换全部匹配（单次替换分支恒为 false）',
      },
    },
    required: ['filePath', 'replaced'],
  };

  override tags = [ToolTag.FILE, ToolTag.WRITE];

  /**
   * 方案 A（2026-10-23）：文件 IO 能力声明 —— 与 `file_write` 同口径。
   * 免审批仍需 `fileIoIsolated`（隔离适配器 + 挂载映射），声明本身不构成放行。
   */
  override sandboxLevel = 'file-io' as const;

  /**
   * PR-2（2026-10-23）：授权维度 = 目标文件路径（归一化），与 `file_write` 同口径 ——
   * "总是允许改这个文件"不因替换文本变化而重新弹卡。
   */
  approvalFingerprint(input: Record<string, unknown>): string {
    return `${this.name}:${normalizeApprovalPath(input.file_path)}`;
  }

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: '文件路径',
      required: true,
    },
    {
      name: 'old_string',
      type: 'string',
      description: '要被替换的文本',
      required: true,
    },
    {
      name: 'new_string',
      type: 'string',
      description: '替换后的文本',
      required: true,
    },
    {
      name: 'replace_all',
      type: 'boolean',
      description: '替换 old_string 的所有匹配项（默认 false）',
      required: false,
    },
  ];

  /**
   * B1：写前快照新鲜度校验（read-before-edit）
   *
   * 仅对已存在的文件生效（新文件走 Write 工具，无需先读）。
   * - 无读快照 → 要求先 read_file
   * - 快照 mtime 与磁盘不一致（文件已被外部修改）→ 要求重新 read_file
   * 返回 null 表示校验通过。
   */
  private checkWriteFreshness(
    cache: FileStateCache,
    resolvedPath: string
  ): string | null {
    if (!fs.existsSync(resolvedPath)) return null; // 新文件：不校验
    const snapshot = cache.get(resolvedPath);
    if (!snapshot) {
      return `文件 ${resolvedPath} 尚未被读取。请先使用 read_file 读取该文件，再执行编辑（read-before-edit）。`;
    }
    if (snapshot.mtimeMs !== undefined) {
      try {
        const currentMtime = fs.statSync(resolvedPath).mtimeMs;
        if (currentMtime !== snapshot.mtimeMs) {
          return `文件 ${resolvedPath} 自上次读取后已被修改（mtime 变化）。请重新 read_file 后再编辑，避免基于过期内容修改。`;
        }
      } catch {
        // @ignore-catch — stat 失败按"文件已不存在"处理，不阻断（editFile 会给出文件不存在错误）
      }
    }
    return null;
  }

  /**
   * B1：编辑成功后记录新快照（使后续 edit 能基于最新状态校验）
   */
  private recordSnapshot(cache: FileStateCache, resolvedPath: string): void {
    try {
      const content = readFileWithEncoding(resolvedPath);
      const mtimeMs = fs.statSync(resolvedPath).mtimeMs;
      cache.set(resolvedPath, {
        content,
        timestamp: Date.now(),
        offset: undefined,
        limit: undefined,
        mtimeMs,
      });
    } catch {
      // @ignore-catch — 记录失败不影响编辑结果
    }
  }

  /**
   * 2026-11-05：`old_string` 未命中 ⇒ **硬失败**（此前仍回报 "Successfully edited"，
   * 模型误以为写成功 ⇒ 反复调用同一处、零进展）。同时按「同处连续未命中」升级文案。
   */
  private buildNoMatchFailure(
    context: ToolUseContext,
    resolvedPath: string,
    oldString: string,
    rawPath: string,
    cache?: FileStateCache | null
  ): ToolResult<unknown> {
    const key = `${context.sessionId ?? ''}:${resolvedPath}:${hashText(oldString)}`;
    if (noProgressStreak.size > 500) noProgressStreak.clear();
    const prev = noProgressStreak.get(key);
    // 「读后再试」是允许的：失败之后若发生新的 file_read（快照时间更新），
    // 说明拿到了新信息 ⇒ 计数重置；否则连击累加。
    const snapshot = cache?.get(resolvedPath);
    const stale =
      prev !== undefined && Date.now() - prev.at > FILE_EDIT_NO_PROGRESS_TTL;
    const readAfterFailure =
      prev !== undefined &&
      snapshot?.timestamp !== undefined &&
      snapshot.timestamp > prev.at;
    const streak = (stale || readAfterFailure ? 0 : (prev?.count ?? 0)) + 1;
    noProgressStreak.set(key, { count: streak, at: Date.now() });
    const msg =
      `old_string 未命中，文件未修改（第 ${streak} 次）。` +
      `请先 file_read 读取 ${rawPath} 确认当前内容，再基于最新文本编辑；` +
      `若要整段重写，请改用 file_write。` +
      (streak >= FILE_EDIT_NO_PROGRESS_CAP
        ? ` 同一处已连续 ${streak} 次未命中：禁止原样重试，先读文件或改用 file_write。`
        : '');
    return createToolResult(msg, {
      success: false,
      error: msg,
      newMessages: [{ role: 'system', content: `Error: ${msg}` }],
    });
  }

  /** 成功写入后清掉该处的未命中计数 */
  private clearNoProgress(
    context: ToolUseContext,
    resolvedPath: string,
    oldString: string
  ): void {
    noProgressStreak.delete(
      `${context.sessionId ?? ''}:${resolvedPath}:${hashText(oldString)}`
    );
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      // G3：相对路径优先解析到会话工作目录（cwd），缺省回退 outputDir
      const baseDir = getToolBaseDir(context);
      const resolvedPath = resolveFilePath(input.file_path as string, baseDir);
      // 方案 A（2026-10-23）：隔离工作区可用时，读写都经适配器（宿主 node:fs 不参与）
      const isolated = resolveIsolatedFileTarget(resolvedPath);
      // B1：写前快照新鲜度校验（read-before-edit）——仅当上下文提供文件状态缓存时生效。
      // 隔离环境下宿主快照与实盘（环境内）不是同一份内容 ⇒ 不校验（否则恒报"未读取/已修改"）。
      const cache = resolveReadFileState(context.readFileState);
      if (cache && !isolated) {
        const freshnessError = this.checkWriteFreshness(cache, resolvedPath);
        if (freshnessError) {
          return createToolResult(freshnessError, {
            newMessages: [
              { role: 'system', content: `Error: ${freshnessError}` },
            ],
          });
        }
      }

      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const replaceAll = input.replace_all === true;

      if (!oldString) {
        return createToolResult('old_string is required', {
          newMessages: [
            { role: 'system', content: 'Error: old_string is required' },
          ],
        });
      }

      if (oldString === newString) {
        return createToolResult(
          'No changes to make: old_string and new_string are exactly the same.',
          {
            newMessages: [
              { role: 'system', content: 'Error: No changes to make' },
            ],
          }
        );
      }

      // 2026-11-05：大参数护栏 —— 超限调用会在传输层被截断成“参数为空”，
      // 模型只看到缺参 ⇒ 原样重试。这里提前拒绝并给出替代方案。
      const oldBytes = Buffer.byteLength(oldString, 'utf-8');
      const newBytes = Buffer.byteLength(newString, 'utf-8');
      if (
        oldBytes > FILE_EDIT_MAX_ARG_BYTES ||
        newBytes > FILE_EDIT_MAX_ARG_BYTES
      ) {
        const msg =
          `编辑参数过大（old_string ${oldBytes} 字节 / new_string ${newBytes} 字节，` +
          `单次上限 ${FILE_EDIT_MAX_ARG_BYTES} 字节）。请拆成多次小范围编辑（按行分段，` +
          `每次只改一处），或改用 file_write 整段重写；不要原样重试。`;
        return createToolResult(msg, {
          success: false,
          error: msg,
          newMessages: [{ role: 'system', content: `Error: ${msg}` }],
        });
      }

      if (replaceAll) {
        // 使用编码感知的文件读取（自动检测 UTF-8 / GBK / GB18030）；
        // 隔离环境内统一按 UTF-8 读取（`cat` 原样输出）
        const content = isolated
          ? await isolated.io.readFile(isolated.isolatedPath)
          : readFileWithEncoding(resolvedPath);
        // 2026-11-05：replace_all 先计数 —— 0 命中时 `replaceAll` 会原样写回，
        // 旧实现仍回报 `replaced: true`（假成功）。未命中统一走硬失败。
        if (countOccurrences(content, oldString) === 0) {
          return this.buildNoMatchFailure(
            context,
            resolvedPath,
            oldString,
            input.file_path as string,
            cache
          );
        }
        // G-8：edit 面护栏只作用于模型新增 delta（见 guardEditDelta）
        const newContent = content.replaceAll(
          oldString,
          guardEditDelta(newString, input.file_path as string)
        );
        if (isolated) {
          await isolated.io.writeFile(isolated.isolatedPath, newContent);
        } else {
          fs.writeFileSync(resolvedPath, newContent, 'utf-8');
          // B1：编辑成功后更新快照
          if (cache) this.recordSnapshot(cache, resolvedPath);
        }
        this.clearNoProgress(context, resolvedPath, oldString);
        // 写成功 ⇒ grep 短路缓存失效（否则"写后同 pattern 复查"会回写前的陈旧结果）
        invalidateGrepSearchCache();
        return createToolResult(
          { filePath: resolvedPath, replaced: true },
          {
            newMessages: [
              {
                role: 'system',
                content: 'File edited successfully (all occurrences)',
              },
            ],
          }
        );
      }

      let outcome: {
        linesChanged: number;
        replaced: boolean;
        oldStringFound: boolean;
      };
      if (isolated) {
        const content = await isolated.io.readFile(isolated.isolatedPath);
        const computed = computeSingleEdit(
          content,
          oldString,
          newString,
          input.file_path as string
        );
        if (computed) {
          await isolated.io.writeFile(
            isolated.isolatedPath,
            computed.newContent
          );
        }
        outcome = computed
          ? {
              linesChanged: computed.linesChanged,
              replaced: true,
              oldStringFound: true,
            }
          : { linesChanged: 0, replaced: false, oldStringFound: false };
      } else {
        const result = editFile({
          filePath: resolvedPath,
          oldString,
          newString,
        });
        // B1：编辑成功后更新快照（未命中时文件未变，不刷新快照）
        if (result.replaced && cache) {
          this.recordSnapshot(cache, result.canonicalPath);
        }
        outcome = {
          linesChanged: result.linesChanged,
          replaced: result.replaced,
          oldStringFound: result.oldStringFound,
        };
      }

      // 2026-11-05：未命中 ⇒ 硬失败（旧实现继续回 "Successfully edited"，见 buildNoMatchFailure）
      if (!outcome.replaced) {
        return this.buildNoMatchFailure(
          context,
          resolvedPath,
          oldString,
          input.file_path as string,
          cache
        );
      }
      this.clearNoProgress(context, resolvedPath, oldString);
      if (outcome.replaced) {
        // 写成功 ⇒ grep 短路缓存失效（否则"写后同 pattern 复查"会回写前的陈旧结果）
        invalidateGrepSearchCache();
      }

      return createToolResult(
        {
          filePath: resolvedPath,
          ...outcome,
          replaceAll: false,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `Successfully edited file: ${resolvedPath}`,
            },
          ],
          output: `File edited successfully: ${resolvedPath}`,
        }
      );
    } catch (error) {
      handleError(error, {
        module: 'tools:FileEditTool',
        action: 'execute',
      });
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResult(msg, {
        newMessages: [{ role: 'system', content: `Error: ${msg}` }],
      });
    }
  }
}
