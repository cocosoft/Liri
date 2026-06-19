import type { CommandContext, CommandResult } from '@modules/commands';
import { getConverterEngine } from '@modules/tools/converter/engine/ConverterEngine.js';
import { FileTypeDetector } from '@modules/tools/converter/engine/FileTypeDetector.js';
import * as fs from 'fs';
import * as path from 'path';

function buildHelpText(): string {
  return [
    'Convert 命令帮助:',
    '',
    '将文件转换为 Markdown 格式。支持多种文件格式。',
    '',
    '用法:',
    '  /convert <file_path>       转换指定文件为 Markdown',
    '  /convert help              显示此帮助',
    '',
    '支持的格式:',
    '  文本类:  .txt .md .json .csv .tsv .xml .html .yaml',
    '  Office:  .docx .xlsx .xls .pptx',
    '  文档类:  .pdf .epub',
    '  媒体类:  .jpg .png .gif .bmp .svg .webp .mp3 .wav .m4a .flac .ogg',
    '  其他:    .ipynb .rss .atom .msg .zip',
    '',
    '示例:',
    '  /convert document.docx',
    '  /convert report.pdf',
    '  /convert notebook.ipynb',
    '',
    '注意:',
    '  部分格式需要安装相应的可选依赖，缺失时会提示安装命令。',
  ].join('\n');
}

const convertCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    if (!args.trim() || args.trim().toLowerCase() === 'help') {
      return { success: true, message: buildHelpText() };
    }

    const filePath = args.trim();

    try {
      const resolvedPath = path.resolve(filePath);

      if (!fs.existsSync(resolvedPath)) {
        return {
          success: false,
          message: `文件不存在: ${resolvedPath}`,
        };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return {
          success: false,
          message: `路径为目录: ${resolvedPath}，请指定文件路径。`,
        };
      }

      const engine = getConverterEngine();
      const detector = new FileTypeDetector();
      const fileInfo = detector.detect(resolvedPath, stat.size);
      const content = fs.readFileSync(resolvedPath);
      const result = await engine.convertContent(fileInfo, content);

      return {
        success: true,
        message: result.markdown,
      };
    } catch (error: any) {
      const message = error.message || String(error);
      if (message.includes('MISSING_DEPENDENCY')) {
        return {
          success: false,
          message: `转换失败: 缺少依赖\n${message}`,
        };
      }
      if (message.includes('UNSUPPORTED_FORMAT')) {
        return {
          success: false,
          message: `不支持的文件格式: ${filePath}\n使用 /convert help 查看支持的格式。`,
        };
      }
      return {
        success: false,
        message: `转换失败: ${message}`,
      };
    }
  },

  buildHelpText,
};

export default convertCommand;
