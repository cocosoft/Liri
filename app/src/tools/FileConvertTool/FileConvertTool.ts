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
import { truncateToolResult } from '@modules/query';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:FileConvertTool:FileConvertTool');

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

      // 源头截断：docx 等大文件转换结果可达 800KB+，直接进上下文/持久化
      // 会推高内存峰值触发 GC 停摆（事件循环阻塞 70s → 任务中断）。
      // 此处截断后，API 消息与 messages.jsonl 持久化均为小结果。
      const markdown = truncateToolResult(result.markdown);

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

      return createToolResult(markdown, {
        success: true,
        output: markdown,
        newMessages: [
          { role: 'system', content: `转换完成: ${filePath} → Markdown` },
        ],
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
