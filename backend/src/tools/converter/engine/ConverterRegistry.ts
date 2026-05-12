import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { Logger } from '@modules/monitoring/logs/Logger';
import type { BaseConverter } from './BaseConverter';
import type { ConversionResult, ConversionContext, FileInfo } from './types';
import {
  PRIORITY_SPECIFIC_FILE_FORMAT,
  PRIORITY_GENERIC_FILE_FORMAT,
  PRIORITY_FALLBACK,
} from './types';

const logger = new Logger();

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
      throw AppError.fromCode(ErrorCodes.UNSUPPORTED_FORMAT, {
        context: {
          extension: fileInfo.extension,
          mimeType: fileInfo.mimeType,
          path: fileInfo.path,
        },
      });
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
