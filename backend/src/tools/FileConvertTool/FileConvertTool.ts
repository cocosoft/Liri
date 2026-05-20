import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { getConverterEngine } from '../../tools/converter/engine/ConverterEngine';
import { FileTypeDetector } from '../../tools/converter/engine/FileTypeDetector';

export class FileConvertTool extends BaseTool {
  override readonly name = 'file_convert';
  override readonly description = 'Convert file to Markdown format';

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
  ];
  override readonly aliases = ['convert', 'md'];
  override readonly searchHint = 'Convert a file to Markdown';

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

      return createToolResult(result.markdown, {
        success: true,
        output: result.markdown,
        newMessages: [
          { role: 'system', content: `转换完成: ${filePath} → Markdown` },
        ],
      });
    } catch (error: any) {
      return createToolResult(error.message, {
        success: false,
        error: error.message,
        output: error.message,
        newMessages: [
          { role: 'system', content: `转换失败: ${error.message}` },
        ],
      });
    }
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Convert: ${filePath}` : this.name;
  }
}
