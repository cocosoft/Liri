import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type {
  ConversionResult,
  ConversionContext,
  FileInfo,
  ConversionOptions,
} from './types';
import { ConverterRegistry } from './ConverterRegistry';
import { FileTypeDetector } from './FileTypeDetector';
import { PlainTextConverter } from '../converters/PlainTextConverter';
import { CsvConverter } from '../converters/CsvConverter';
import { HtmlConverter } from '../converters/HtmlConverter';
import { DocxConverter } from '../converters/DocxConverter';
import { XlsxConverter } from '../converters/XlsxConverter';
import { XlsConverter } from '../converters/XlsConverter';
import { PptxConverter } from '../converters/PptxConverter';
import { PdfConverter } from '../converters/PdfConverter';
import { ImageConverter } from '../converters/ImageConverter';
import { AudioConverter } from '../converters/AudioConverter';
import { EpubConverter } from '../converters/EpubConverter';
import {
  ZipConverter,
  setZipConverterEngine,
} from '../converters/ZipConverter';
import { IpynbConverter } from '../converters/IpynbConverter';
import { RssConverter } from '../converters/RssConverter';
import { OutlookMsgConverter } from '../converters/OutlookMsgConverter';

const logger = getLogger('tools:converter:engine');

/** 文件转换大小上限：超过则拒绝转换，避免大文件解析导致内存/CPU 耗尽（死机） */
const MAX_CONVERT_FILE_SIZE = 50 * 1024 * 1024;

export class ConverterEngine {
  private static instance: ConverterEngine;
  private registry: ConverterRegistry;
  private detector: FileTypeDetector;
  private initialized = false;

  private constructor() {
    this.registry = new ConverterRegistry();
    this.detector = new FileTypeDetector();
  }

  static getInstance(): ConverterEngine {
    if (!ConverterEngine.instance) {
      ConverterEngine.instance = new ConverterEngine();
    }
    return ConverterEngine.instance;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.registerBuiltinConverters();
      this.initialized = true;
    }
  }

  private registerBuiltinConverters(): void {
    this.registry.register(new PlainTextConverter());
    this.registry.register(new CsvConverter());
    this.registry.register(new HtmlConverter());
    this.registry.register(new DocxConverter());
    this.registry.register(new XlsxConverter());
    this.registry.register(new XlsConverter());
    this.registry.register(new PptxConverter());
    this.registry.register(new PdfConverter());
    this.registry.register(new ImageConverter());
    this.registry.register(new AudioConverter());
    this.registry.register(new EpubConverter());
    this.registry.register(new ZipConverter());
    this.registry.register(new IpynbConverter());
    this.registry.register(new RssConverter());
    this.registry.register(new OutlookMsgConverter());
    logger.info('内置转换器注册完成');

    // 注入 ZipConverter 的转换引擎引用（DI 模式，避免循环依赖）
    setZipConverterEngine((fileInfo, buffer) =>
      this.convertContent(fileInfo, buffer)
    );
  }

  getRegistry(): ConverterRegistry {
    this.ensureInitialized();
    return this.registry;
  }

  getDetector(): FileTypeDetector {
    this.ensureInitialized();
    return this.detector;
  }

  async convertFile(
    filePath: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    this.ensureInitialized();
    const fs = await import('fs');
    const stats = fs.statSync(filePath);

    if (stats.size > MAX_CONVERT_FILE_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      throw new AppError(
        `文件过大（${sizeMB}MB），超过转换上限 ${MAX_CONVERT_FILE_SIZE / 1024 / 1024}MB，请拆分文件或转换为文本格式`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'FILE_TOO_LARGE',
        { context: { path: filePath, size: stats.size } }
      );
    }

    const fileInfo = this.detector.detect(filePath, stats.size);
    const content = fs.readFileSync(filePath);

    const context: ConversionContext = {
      fileInfo,
      content,
      options,
    };

    logger.info(`开始转换文件`, {
      path: filePath,
      extension: fileInfo.extension,
    });
    return this.registry.findAndConvert(context);
  }

  async convertContent(
    fileInfo: FileInfo,
    content: Buffer | string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    this.ensureInitialized();
    const context: ConversionContext = { fileInfo, content, options };
    return this.registry.findAndConvert(context);
  }
}

export function getConverterEngine(): ConverterEngine {
  return ConverterEngine.getInstance();
}
