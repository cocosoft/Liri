import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import { AppError } from '../../error/types';
import { ErrorCodes } from '../../error/ErrorCodes';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { getConverterEngine } from '../../tools/converter/engine/ConverterEngine';
import { FileTypeDetector } from '../../tools/converter/engine/FileTypeDetector';
import { truncateToolResult, MAX_TOOL_RESULT_CHARS } from '@modules/query';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:FileConvertTool:FileConvertTool');

/**
 * 整形 `file_convert`（target_format=md）的返回：分段取回 + 源头截断 + 面向模型的取回指引。
 *
 * 2026-09-24 修复（台账 N-54 缺口 G-A/G-B）：此前 md 结果一旦超过工具结果上限即被
 * "头尾截断"，而 `newMessages` 只说"转换完成"、入参里也没有 offset/limit ⇒
 * 模型虽能从正文中间的标记看到截断，却**无法取回中段**，只能自建外部脚本
 * （python/pdfplumber）绕行（实机会话已验证）。
 * 现与 `file_read` 的 offset/limit **行语义对齐**（CS01：复用既有语义，不新造分页协议）。
 *
 * 分段模式**按上限收敛到整行**（不是"先切后截"）：真实 PDF 各页长度差异极大（实测 64 页
 * 用例中按平均行长推算的 limit 仍让 11 段里的 4 段超限），让模型猜一个安全 limit 只会白跑
 * 一轮；这里直接返回"装得下的整行 + 下一段起点"，模型无需猜数。
 */
export function shapeMarkdownResult(
  fullMarkdown: string,
  filePath: string,
  offset?: number,
  limit?: number
): { markdown: string; message: string } {
  const lines = fullMarkdown.split('\n');
  const totalLines = lines.length;

  if (offset !== undefined || limit !== undefined) {
    const startIdx = Math.max(0, (offset ?? 1) - 1);
    const requested = limit ?? totalLines;
    let endIdx = startIdx;
    let chars = 0;
    while (endIdx < totalLines && endIdx - startIdx < requested) {
      const add = lines[endIdx].length + (endIdx > startIdx ? 1 : 0);
      if (chars + add > MAX_TOOL_RESULT_CHARS) break;
      chars += add;
      endIdx++;
    }
    // 单行本身即超上限：至少返回该行（由 truncateToolResult 截断），否则原地空转
    if (endIdx === startIdx && startIdx < totalLines) endIdx = startIdx + 1;

    const raw = lines.slice(startIdx, endIdx).join('\n');
    const markdown = truncateToolResult(raw);
    const startLine = startIdx + 1;
    const range =
      startIdx >= totalLines
        ? `，offset=${startLine} 超出范围（全文共 ${totalLines} 行，本次无内容返回）`
        : `，当前返回第 ${startLine}-${endIdx} 行` +
          (markdown !== raw ? '（单行超过上限，已截断）' : '') +
          (endIdx < totalLines
            ? `，可继续用 offset=${endIdx + 1} 读取后续段落`
            : '');
    return {
      markdown,
      message: `转换完成: ${filePath} → Markdown（共 ${totalLines} 行）${range}`,
    };
  }

  const markdown = truncateToolResult(fullMarkdown);
  if (markdown === fullMarkdown) {
    return {
      markdown,
      message: `转换完成: ${filePath} → Markdown（共 ${totalLines} 行）`,
    };
  }

  return {
    markdown,
    message:
      `转换完成: ${filePath} → Markdown（共 ${totalLines} 行 / ${fullMarkdown.length} 字符）` +
      `——内容过长，已截断（仅保留头尾，中段丢弃）。` +
      `如需完整正文，请用 offset/limit 分段读取（如 offset=1），` +
      `工具会按上限自动返回整行并给出下一段起点。`,
  };
}

export class FileConvertTool extends BaseTool {
  override readonly name = 'file_convert';
  override readonly description =
    'Convert file to Markdown format, or convert locally to .docx (no LLM involved). ' +
    'For local file conversion requests (e.g. html/md → Word), prefer this over doc_generate ' +
    'to avoid reciting long content through the model.';

  override tags = [ToolTag.FILE];

  override readonly params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file to convert',
      required: true,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Source format (optional, auto-detected if omitted)',
      required: false,
    },
    {
      name: 'target_format',
      type: 'string',
      enum: ['md', 'docx'],
      description:
        'Target format: md (default, returns Markdown text) or docx (converts locally to .docx file in output dir, no model tokens)',
      required: false,
      default: 'md',
    },
    {
      name: 'offset',
      type: 'number',
      description:
        'Start line number (1-based) for segmented Markdown output; only applies when target_format=md. Use it to retrieve the middle/rest of a result that was reported as truncated.',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description:
        'Maximum number of lines to return for segmented Markdown output; only applies when target_format=md.',
      required: false,
    },
  ];
  override readonly aliases = ['convert', 'md'];
  override readonly searchHint = 'Convert a file to Markdown or docx';

  override async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const filePath = path.resolve(input.file_path as string);

      if (!fs.existsSync(filePath)) {
        return createToolResult('', {
          success: false,
          error: `文件不存在: ${filePath}`,
          output: `文件不存在: ${filePath}`,
          newMessages: [{ role: 'system', content: `文件不存在: ${filePath}` }],
        });
      }

      if (onProgress) {
        onProgress({
          toolUseID: 'file-convert-tool',
          data: {
            type: 'file_convert',
            filePath,
            isRunning: true,
            isComplete: false,
          },
        });
      }

      const engine = getConverterEngine();
      const detector = new FileTypeDetector();
      const stat = fs.statSync(filePath);

      const fileInfo = detector.detect(filePath, stat.size);

      const content = fs.readFileSync(filePath);

      const result = await engine.convertContent(fileInfo, content);

      const targetFormat = (input.target_format as string) || 'md';

      // docx 本地直转：需要完整内容（不截断），复用 DocGenerateTool 的 docx 生成能力，
      // 全程不经过模型输出通道（0 token、不截断、内存有界）。
      if (targetFormat === 'docx') {
        const fullMarkdown = result.markdown;
        const outputDir = (await import('@modules/core')).resolveOutputDir();
        const baseName = path.basename(filePath, path.extname(filePath));
        const { createWithOfficeCLI, createNativeDocx, isOfficeCLIAvailable } =
          await import('../DocGenerateTool/DocGenerateTool');

        const gen = isOfficeCLIAvailable()
          ? createWithOfficeCLI(baseName, fullMarkdown, 'docx', outputDir)
          : createNativeDocx(baseName, fullMarkdown, outputDir);

        if (onProgress) {
          onProgress({
            toolUseID: 'file-convert-tool',
            data: {
              type: 'file_convert',
              filePath,
              targetFormat: 'docx',
              outputPath: gen.filePath,
              isRunning: false,
              isComplete: true,
            },
          });
        }

        const outMsg = `转换完成: ${filePath} → ${gen.filePath}`;
        logger.info('FileConvertTool: 本地转换 docx 成功', {
          filePath,
          outputPath: gen.filePath,
          size: fs.statSync(gen.filePath).size,
        });
        return createToolResult(outMsg, {
          success: true,
          output: outMsg,
          newMessages: [{ role: 'system', content: outMsg }],
        });
      }

      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;

      if (onProgress) {
        onProgress({
          toolUseID: 'file-convert-tool',
          data: {
            type: 'file_convert',
            filePath,
            isRunning: false,
            isComplete: true,
          },
        });
      }

      // 源头截断 + 分段取回：docx 等大文件转换结果可达 800KB+，直接进上下文/持久化
      // 会推高内存峰值触发 GC 停摆（事件循环阻塞 70s → 任务中断）。
      // 整形（截断 / 分段 / 取回指引）见 shapeMarkdownResult。
      const { markdown, message } = shapeMarkdownResult(
        result.markdown,
        filePath,
        offset,
        limit
      );

      return createToolResult(markdown, {
        success: true,
        output: markdown,
        newMessages: [{ role: 'system', content: message }],
      });
    } catch (error) {
      const isUnsupported =
        error instanceof AppError &&
        error.code === String(ErrorCodes.UNSUPPORTED_FORMAT.code);
      const prefix = isUnsupported ? '格式不支持' : '转换失败';
      const msg = error instanceof Error ? error.message : String(error);

      return createToolResult(msg, {
        success: false,
        error: msg,
        output: msg,
        newMessages: [{ role: 'system', content: `${prefix}: ${msg}` }],
      });
    }
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    // md 模式只读返回文本；docx 模式写入 output 目录（AI 产出区），按非只读标记
    return (input?.target_format as string) !== 'docx';
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Convert: ${filePath}` : this.name;
  }
}
