import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { Logger } from '@modules/monitoring';
import type { BaseConverter } from './BaseConverter';
import type { ConversionResult, ConversionContext, FileInfo } from './types';
import {
  PRIORITY_SPECIFIC_FILE_FORMAT,
  PRIORITY_GENERIC_FILE_FORMAT,
  PRIORITY_FALLBACK,
} from './types';

const logger = new Logger({ module: 'tools:converter:registry' });

const KNOWN_UNSUPPORTED_FORMATS: Record<string, string> = {
  '.doc': '不支持旧版 Word 格式（.doc），请将文件另存为 .docx 后重试',
  '.dot': '不支持 Word 97-2003 模板格式（.dot），请将文件另存为 .docx 后重试',
  '.dotx': '不支持 Word 模板格式（.dotx），请将文件另存为 .docx 后重试',
  '.docm': '不支持带宏的 Word 文档（.docm），请将文件另存为 .docx 后重试',
  '.rtf': '不支持 RTF 格式（.rtf），请将文件另存为 .docx 后重试',
  '.odt': '不支持 OpenDocument 文本格式（.odt），请将文件另存为 .docx 后重试',
  '.wps': '不支持 WPS 格式（.wps），请将文件另存为 .docx 后重试',
  '.wpt': '不支持 WPS 模板格式（.wpt），请将文件另存为 .docx 后重试',
  '.xlsm': '不支持带宏的 Excel 格式（.xlsm），请将文件另存为 .xlsx 后重试',
  '.ods': '不支持 OpenDocument 表格格式（.ods），请将文件另存为 .xlsx 后重试',
  '.ppsm':
    '不支持带宏的 PowerPoint 放映格式（.ppsm），请将文件另存为 .pptx 后重试',
  '.ppsx': '不支持 PowerPoint 放映格式（.ppsx），请将文件另存为 .pptx 后重试',
  '.odp': '不支持 OpenDocument 演示格式（.odp），请将文件另存为 .pptx 后重试',
};

const SUPPORTED_FORMATS_SUMMARY =
  '.txt、.md、.docx、.pdf、.epub、.html、.xlsx、.xls、.csv、.pptx、.jpg、.png、.mp3、.wav、.json、.zip、.ipynb、.msg';

export class ConverterRegistry {
  private converters: BaseConverter[] = [];

  register(converter: BaseConverter): void {
    this.converters.push(converter);
    logger.debug(`注册转换器: ${converter.name}`, {
      extensions: converter.supportedExtensions,
      priority: converter.priority,
    });
  }

  getConverters(): readonly BaseConverter[] {
    return this.converters;
  }

  findConverter(info: FileInfo): BaseConverter | undefined {
    const sorted = this.getSortedConverters(info);
    for (const converter of sorted) {
      if (converter.accepts(info)) {
        return converter;
      }
    }
    return undefined;
  }

  private getSortedConverters(info: FileInfo): BaseConverter[] {
    const ext = info.extension.toLowerCase();

    const specific: BaseConverter[] = [];
    const generic: BaseConverter[] = [];
    const fallback: BaseConverter[] = [];

    for (const c of this.converters) {
      const hasExtMatch = c.supportedExtensions.some(
        (e) => e.toLowerCase() === ext
      );
      const hasMimeMatch = c.supportedMimeTypes.some((m) => {
        const mime = info.mimeType.toLowerCase();
        return (
          mime === m || (m.endsWith('/*') && mime.startsWith(m.slice(0, -1)))
        );
      });

      if (hasExtMatch || hasMimeMatch) {
        switch (c.priority) {
          case PRIORITY_SPECIFIC_FILE_FORMAT:
            specific.push(c);
            break;
          case PRIORITY_GENERIC_FILE_FORMAT:
            generic.push(c);
            break;
          case PRIORITY_FALLBACK:
            fallback.push(c);
            break;
          default:
            generic.push(c);
        }
      }
    }

    return [...specific, ...generic, ...fallback];
  }

  async findAndConvert(context: ConversionContext): Promise<ConversionResult> {
    const { fileInfo } = context;
    const matchingConverters = this.getSortedConverters(fileInfo);

    if (matchingConverters.length === 0) {
      const ext = fileInfo.extension.toLowerCase();
      const specificHint = KNOWN_UNSUPPORTED_FORMATS[ext];

      let message: string;
      if (specificHint) {
        message = specificHint;
      } else {
        const displayExt = ext || fileInfo.mimeType || '未知';
        message = `不支持的文件格式（${displayExt}）。当前支持：${SUPPORTED_FORMATS_SUMMARY}`;
      }

      logger.warning(`无匹配转换器`, {
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        path: fileInfo.path,
      });

      throw new AppError(
        message,
        ErrorCategory.DATA,
        ErrorSeverity.MEDIUM,
        String(ErrorCodes.UNSUPPORTED_FORMAT.code),
        {
          extension: fileInfo.extension,
          mimeType: fileInfo.mimeType,
          path: fileInfo.path,
        }
      );
    }

    const errors: Array<{ name: string; error: unknown }> = [];
    for (const converter of matchingConverters) {
      try {
        const result = await converter.convert(context);
        logger.info(`转换成功`, {
          converter: converter.name,
          path: fileInfo.path,
        });
        return result;
      } catch (e) {
        logger.warning(`转换器 ${converter.name} 失败，尝试下一个`, {
          error: e,
        });
        errors.push({ name: converter.name, error: e });
      }
    }

    throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
      context: {
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        attemptedConverters: errors.map((e) => e.name),
      },
    });
  }
}
