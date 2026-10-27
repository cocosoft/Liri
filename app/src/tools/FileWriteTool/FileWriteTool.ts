import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * FileWriteTool - 文件写入工具
 *
 * 编码说明：追加内容时使用 Rust 原生模块自动检测文件编码（UTF-8 / GBK / GB18030），
 * 确保对中文编码文件正确处理。写入时统一采用 UTF-8 编码。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveOutputDir,
  resolveInboundDir,
  runRegisteredOutputGuards,
} from '@openliri/kernel';
import { resolveFilePath, getToolBaseDir } from '../utils/ToolUtils';
import { resolveIsolatedFileTarget } from '../utils/isolatedFileIo';
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
        module: 'tools:FileWriteTool',
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
        module: 'tools:FileWriteTool',
        action: 'readFileWithEncoding',
      });
    }
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export interface FileWriteInput {
  filePath: string;
  content: string;
}

export interface FileWriteResult extends FileOperationResult {
  type: 'create' | 'update';
  sizeBytes: number;
  linesWritten: number;
}

const FILE_WRITE_MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

/**
 * G-8（2026-10-18）：**文件写入**输出护栏（评审门禁 §2-#1①）——
 * 敏感内容落盘前过统一护栏（评审口径「工具把 .env 读出并写入文件」路径）。
 * `OUTPUT_GUARD=false` 默认 ⇒ 空注册 ⇒ 零行为变更；redact ⇒ 落盘打码后内容；
 * block（`OUTPUT_GUARD_BLOCK`）⇒ 拒写。
 *
 * 2026-10-23（方案 A）：宿主直写与"经隔离工作区写"**共用本实现**，
 * 避免隔离路径绕过护栏。
 */
function applyWriteGuards(content: string, filePath: string): string {
  const gatedContent = runRegisteredOutputGuards(content);
  if (
    !gatedContent ||
    (!gatedContent.blocked && gatedContent.redactedBy.length === 0)
  ) {
    return content;
  }
  logger.warn('writeFile:output_guard_applied', {
    filePath,
    blocked: gatedContent.blocked,
    redactedBy: gatedContent.redactedBy,
    contentLen: content.length,
  });
  if (gatedContent.blocked) {
    throw new AppError(
      '写入内容命中输出护栏（敏感内容），已按策略阻断写入',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'OUTPUT_GUARD_BLOCKED'
    );
  }
  return gatedContent.text;
}

export function writeFile(input: FileWriteInput): FileWriteResult {
  const resolved = resolveFilePath(input.filePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  if (existed) {
    const stat = fs.statSync(resolved);
    if (stat.size > FILE_WRITE_MAX_FILE_SIZE) {
      throw new AppError(
        `File too large to overwrite: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  // G-8（2026-10-18）：**文件写入**输出护栏接入点（评审门禁 §2-#1①）——
  // 敏感内容落盘前过统一护栏（评审口径「工具把 .env 读出并写入文件」路径）。
  // `OUTPUT_GUARD=false` 默认 ⇒ 空注册 ⇒ null ⇒ 零行为变更；
  // redact ⇒ 落盘打码后内容（回执 size/lines 与实写一致）；block（OUTPUT_GUARD_BLOCK）⇒ 拒写。
  const contentToWrite = applyWriteGuards(input.content, input.filePath);

  fs.writeFileSync(resolved, contentToWrite, 'utf-8');

  const lines = contentToWrite.split('\n').length;

  return {
    type: existed ? 'update' : 'create',
    filePath: input.filePath,
    canonicalPath: resolved,
    sizeBytes: Buffer.byteLength(contentToWrite, 'utf-8'),
    linesWritten: lines,
  };
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
} from '@modules/error';
import {
  checkPathAccessibility,
  resolveWritableProbeDir,
} from '../utils/ToolUtils';

import { getLogger } from '@modules/monitoring';
import { normalizeApprovalPath } from '@modules/permission';
const logger = getLogger('tools:FileWriteTool:FileWriteTool');

export class FileWriteTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.file_write;
  description =
    '把内容写入文件。' +
    '当内容已存在于磁盘上（例如其它工具已产出本地文件）时，' +
    '必须传入 source_file，而不是把完整内容作为字符串复述——' +
    '这样可避免输出 token 爆炸、JSON 截断与内存膨胀。' +
    '路径解析：绝对路径按原样使用；**相对路径/纯文件名解析到会话工作目录**（无工作目录时才回退全局输出目录 `~/.pyapp/output/`）。' +
    '回执会给出**实际写入的绝对路径**——在回复里转述位置时请用它，不要自行改写为 `~/...` 或其它目录。' +
    '若该文件须归入某项目的交付物，请改用 write_project_file 写入该项目 output/。';

  override tags = [ToolTag.FILE, ToolTag.WRITE];

  /**
   * 方案 A（2026-10-23）：文件 IO 能力声明。
   *
   * 声明只说明"本工具**会**写文件"；能否因沙箱而免审批仍取决于
   * `fileIoIsolated`（隔离适配器 + 挂载映射）。两者缺一，`sandboxExemption` 的
   * S1b / S2 都会拒绝豁免 —— 声明本身**不**构成放行。
   */
  override sandboxLevel = 'file-io' as const;

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description:
        '目标文件路径。绝对路径按原样使用；相对路径会解析到**会话工作目录**（无工作目录时才回退 `~/.pyapp/output`）。' +
        '回执返回实际绝对路径，回复中请直接引用它。',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '要写入的内容。仅当未使用 source_file 时必填。',
      required: false,
    },
    {
      name: 'source_file',
      type: 'string',
      description:
        '本地已有文件的路径，其内容将被拷贝到目标文件。' +
        '只要文件已存在于磁盘上，就用它替代 content——' +
        '0 输出 token，无截断风险。',
      required: false,
    },
    {
      name: 'append',
      type: 'boolean',
      description: '追加内容到文件，而非覆盖',
      required: false,
    },
  ];

  override aliases = ['write', 'echo'];
  override searchHint = 'Write content to a file';
  override maxResultSizeChars = 10000;

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      if (
        typeof input.file_path !== 'string' ||
        input.file_path.trim() === ''
      ) {
        const msg = '参数 file_path 必须是非空字符串（目标文件的路径）';
        return createToolResult(msg, {
          success: false,
          error: msg,
          newMessages: [{ role: 'system', content: msg }],
        });
      }

      // G3：相对路径优先解析到会话工作目录（cwd），缺省回退 outputDir
      const baseDir = getToolBaseDir(context);
      // 2026-10-17：**只解析一次**，写盘与回执用同一个绝对路径 ——
      // 此前回执原样回显 `input.file_path`（相对路径）⇒ 模型误以为落在 `~/.pyapp/output`，
      // 在正文里写出该路径（文件实际在工作区根）⇒ 出站文件路由取不到，用户什么也收不到。
      const resolvedPath = resolveFilePath(input.file_path, baseDir);
      // 方案 A（2026-10-23）：隔离工作区可用时，宿主 `node:fs` **不参与**写盘。
      const isolated = resolveIsolatedFileTarget(resolvedPath);

      // 宿主直写时才做宿主侧可访问性检查（隔离环境下宿主目录未必存在，检查会误杀）。
      if (!isolated) {
        // BUG-D（2026-10-27 真机长程任务）：目标目录**不必**已存在 —— `writeFile` 会递归建目录。
        // 此前对 `path.dirname(input.file_path)`（还是**未解析**的相对路径）要求"已存在" ⇒
        // 新建子目录的写入直接被 `写入目录不存在` 拒绝（`mkdir` 又被安全闸 fail-closed 拦住，
        // 模型无路可走）。现在改为检查**最近已存在的祖先目录**。
        const targetDir = path.dirname(resolvedPath);
        const probe = resolveWritableProbeDir(targetDir);
        const filePathCheck = probe.blockedByFile
          ? {
              accessible: false,
              reason: `路径中 "${probe.blockedByFile}" 是文件而非目录，无法在其下创建目录`,
              suggestions: undefined as string[] | undefined,
            }
          : checkPathAccessibility(probe.probeDir, '写入根目录');
        if (!filePathCheck.accessible) {
          const msg = filePathCheck.reason || '';
          const hint = filePathCheck.suggestions?.length
            ? `\n建议: ${filePathCheck.suggestions.join('; ')}`
            : '';
          return createToolResult(msg + hint, {
            success: false,
            error: msg,
            newMessages: [{ role: 'system', content: `路径不可访问: ${msg}` }],
          });
        }
      }

      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            filePath: input.file_path,
            isRunning: true,
            isComplete: false,
          },
        });
      }

      const append = (input.append as boolean) || false;

      // content 与 source_file 至少提供一个：内容在磁盘时必须优先走 source_file（0 输出 token）
      const hasContent =
        typeof input.content === 'string' &&
        (input.content as string).trim().length > 0;
      const hasSourceFile =
        typeof input.source_file === 'string' &&
        (input.source_file as string).trim().length > 0;
      if (!hasContent && !hasSourceFile) {
        const missingMsg =
          '参数 content 或 source_file 必须提供一个（content 为要写入的正文，source_file 为本地已有文件路径，用于避免复述长内容导致 token 爆炸）';
        return createToolResult(missingMsg, {
          success: false,
          error: missingMsg,
          newMessages: [
            { role: 'system', content: '缺少参数 content 或 source_file' },
          ],
        });
      }

      // source_file 优先：从磁盘读取，0 输出 token、不截断、不走模型的嘴
      let effectiveContent: string;
      if (hasSourceFile && !hasContent) {
        const src = path.resolve(input.source_file as string);
        const srcIsolated = resolveIsolatedFileTarget(src);
        if (srcIsolated) {
          // 源文件同样在工作区内 ⇒ 必须经隔离环境读（宿主看不到隔离环境里的文件）
          try {
            effectiveContent = await srcIsolated.io.readFile(
              srcIsolated.isolatedPath
            );
          } catch (e) {
            const readFailedMsg = `source_file 读取失败: ${src}（${e instanceof Error ? e.message : String(e)}）`;
            return createToolResult(readFailedMsg, {
              success: false,
              error: readFailedMsg,
              newMessages: [
                { role: 'system', content: `source_file 读取失败: ${src}` },
              ],
            });
          }
        } else {
          if (!fs.existsSync(src)) {
            const notFoundMsg = `source_file 指定的文件不存在: ${src}`;
            return createToolResult(notFoundMsg, {
              success: false,
              error: notFoundMsg,
              newMessages: [
                { role: 'system', content: `source_file 不存在: ${src}` },
              ],
            });
          }
          try {
            effectiveContent = readFileWithEncoding(src);
            logger.info('FileWriteTool: source_file 读取成功，写入目标', {
              sourcePath: src,
              destPath: input.file_path,
              bytes: Buffer.byteLength(effectiveContent),
              append,
            });
          } catch (e) {
            const readFailedMsg = `source_file 读取失败: ${src}（${e instanceof Error ? e.message : String(e)}）`;
            return createToolResult(readFailedMsg, {
              success: false,
              error: readFailedMsg,
              newMessages: [
                {
                  role: 'system',
                  content: `source_file 读取失败: ${src}`,
                },
              ],
            });
          }
        }
      } else {
        effectiveContent = input.content as string;
      }

      if (isolated) {
        // 方案 A：写盘经隔离工作区；追加时先经环境读取既有内容（读不到 ⇒ 拒绝追加，避免覆盖）
        let existingContent = '';
        if (append) {
          try {
            existingContent = await isolated.io.readFile(isolated.isolatedPath);
          } catch (e) {
            const msg =
              `无法读取隔离工作区内的目标文件，已拒绝追加（避免覆盖既有内容）: ${isolated.isolatedPath}` +
              `（${e instanceof Error ? e.message : String(e)}）`;
            return createToolResult(msg, {
              success: false,
              error: msg,
              newMessages: [{ role: 'system', content: msg }],
            });
          }
        }
        await isolated.io.writeFile(
          isolated.isolatedPath,
          applyWriteGuards(existingContent + effectiveContent, input.file_path)
        );
      } else if (append) {
        // 使用编码感知的文件读取（自动检测 UTF-8 / GBK / GB18030）
        const existingContent = readFileWithEncoding(resolvedPath);
        writeFile({
          filePath: resolvedPath,
          content: existingContent + effectiveContent,
        });
      } else {
        writeFile({
          filePath: resolvedPath,
          content: effectiveContent,
        });
      }

      // 注册到 FileRegistry（异步执行，不阻塞响应返回）
      this.registerWriteToFileRegistry(input);

      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            filePath: resolvedPath,
            isRunning: false,
            isComplete: true,
          },
        });
      }

      const verb = append ? 'appended to' : 'written';
      // 回执必须是**绝对路径**：模型据此在正文里复述位置，出站文件路由也只认绝对路径
      return createToolResult(`File ${verb} successfully: ${resolvedPath}`, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully ${verb} file: ${resolvedPath}`,
          },
        ],
      });
    } catch (error) {
      handleError(error, {
        module: 'tools:FileWriteTool',
        action: 'execute',
      });
      const msg = error instanceof Error ? error.message : String(error);
      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            error: msg,
            isRunning: false,
            isComplete: true,
          },
        });
      }
      return createToolResult(msg, {
        // 契约（对齐 powerShellWrapper 的 BUG-8）：失败必须带 `error`/`success:false`，
        // 否则消费方（长程任务编排器等）会把本次调用误记为「工具执行成功」。
        success: false,
        error: msg,
        newMessages: [{ role: 'system', content: `Error: ${msg}` }],
      });
    }
  }

  override isReadOnly(): boolean {
    return false;
  }

  /**
   * PR-2（2026-10-23）：授权维度 = 目标文件路径（归一化）。
   *
   * 让「始终允许」= "总是允许写这个文件"：内容每次不同也不影响命中，
   * 换文件仍会重新审批（方案 §3.2）。
   */
  approvalFingerprint(input: Record<string, unknown>): string {
    return `${this.name}:${normalizeApprovalPath(input.file_path)}`;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  override isDestructive(input?: Record<string, unknown>): boolean {
    return !input?.append;
  }

  override getPath(input: Record<string, unknown>): string {
    return (input.file_path as string) || '';
  }

  /**
   * 将写入的文件注册到 FileRegistry
   * 异步执行，不阻塞工具调用响应
   */
  private registerWriteToFileRegistry(input: Record<string, unknown>): void {
    const filePath = input.file_path as string;
    const content = input.content as string;
    if (!filePath || content === undefined) return;

    Promise.resolve().then(async () => {
      try {
        const { FileRegistry } =
          await import('@modules/services/file/FileRegistry');
        const { FileSource } = await import('@modules/services/file/types');

        const resolved = resolveFilePath(filePath);
        const registry = FileRegistry.getInstance();
        await registry.initDatabase();

        await registry.registerFile({
          originalName: path.basename(resolved),
          content,
          source: FileSource.TOOL_WRITE,
          sourceId: 'file_write_tool',
          mimeType: 'text/plain',
          description: `FileWriteTool 写入: ${filePath}`,
          storeZone: 'inbound',
        });
      } catch (err) {
        handleError(err, {
          module: 'tools:FileWriteTool',
          action: 'registerWriteToFileRegistry',
        });
      }
    });
  }

  override async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const filePath = (input?.file_path as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    };
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Write: ${filePath}` : this.name;
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    return filePath
      ? `${append ? 'Appending to' : 'Writing to'} file: ${filePath}`
      : null;
  }

  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    return filePath
      ? `${append ? 'Append to' : 'Write to'} file: ${filePath}`
      : null;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }
}
