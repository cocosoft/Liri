import { getLogger } from '@modules/monitoring';
import type { FileInfo } from './types';
import path from 'path';

const logger = getLogger('tools:converter:detector');

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dotx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.docm': 'application/vnd.ms-word.document.macroenabled.12',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.mp4': 'video/mp4',
  '.ipynb': 'application/x-ipynb+json',
  '.rss': 'application/rss+xml',
  '.atom': 'application/atom+xml',
  '.msg': 'application/vnd.ms-outlook',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from('%PDF-');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF_MAGIC = Buffer.from('GIF8');
const OGG_MAGIC = Buffer.from('OggS');
const FLAC_MAGIC = Buffer.from('fLaC');
const RIFF_MAGIC = Buffer.from('RIFF');

export class FileTypeDetector {
  detect(filePath: string, fileSize: number): FileInfo {
    const ext = path.extname(filePath).toLowerCase();
    const mimeFromExt = EXTENSION_MIME_MAP[ext] || 'application/octet-stream';

    const base: FileInfo = {
      path: filePath,
      extension: ext,
      mimeType: mimeFromExt,
      size: fileSize,
    };

    if (ext && mimeFromExt !== 'application/octet-stream') {
      logger.debug(`第一层扩展名检测匹配`, {
        extension: ext,
        mimeType: mimeFromExt,
      });
      return base;
    }

    return base;
  }

  async detectWithContent(
    filePath: string,
    content: Buffer
  ): Promise<FileInfo> {
    const fileSize = content.length;
    const ext = path.extname(filePath).toLowerCase();
    const mimeFromExt = EXTENSION_MIME_MAP[ext] || 'application/octet-stream';

    const baseInfo: FileInfo = {
      path: filePath,
      extension: ext,
      mimeType: mimeFromExt,
      size: fileSize,
    };

    if (ext && mimeFromExt !== 'application/octet-stream') {
      return baseInfo;
    }

    const magicResult = this.detectByMagicBytes(content);
    if (magicResult) {
      logger.debug(`第三层 Magic Bytes 检测匹配`, {
        extension: magicResult.extension,
      });
      return magicResult;
    }

    const ooxmlResult = this.detectOoxml(content);
    if (ooxmlResult) {
      logger.debug(`第四层 OOXML 内容检测匹配`, {
        extension: ooxmlResult.extension,
      });
      return ooxmlResult;
    }

    if (this.isTextContent(content)) {
      return {
        ...baseInfo,
        extension: '.txt',
        mimeType: 'text/plain',
      };
    }

    return baseInfo;
  }

  private detectByMagicBytes(content: Buffer): FileInfo | null {
    if (content.length < 8) return null;

    if (this.matchesMagic(content, PDF_MAGIC)) {
      return this.makeFileInfo('application/pdf', '.pdf');
    }

    if (this.matchesMagic(content, PNG_MAGIC)) {
      return this.makeFileInfo('image/png', '.png');
    }

    if (this.matchesMagic(content, JPEG_MAGIC)) {
      return this.makeFileInfo('image/jpeg', '.jpg');
    }

    if (this.matchesMagic(content, GIF_MAGIC)) {
      return this.makeFileInfo('image/gif', '.gif');
    }

    if (this.matchesMagic(content, OGG_MAGIC)) {
      return this.makeFileInfo('audio/ogg', '.ogg');
    }

    if (this.matchesMagic(content, FLAC_MAGIC)) {
      return this.makeFileInfo('audio/flac', '.flac');
    }

    if (
      this.matchesMagic(content, RIFF_MAGIC) &&
      content.subarray(8, 12).toString() === 'WAVE'
    ) {
      return this.makeFileInfo('audio/wav', '.wav');
    }

    return null;
  }

  private detectOoxml(content: Buffer): FileInfo | null {
    if (!this.matchesMagic(content, ZIP_MAGIC)) return null;
    if (content.length < 512) return null;

    const searchStr = (str: string): boolean => {
      const buf = Buffer.from(str);
      return content.includes(buf);
    };

    if (searchStr('word/main.xml')) {
      return this.makeFileInfo(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.docx'
      );
    }
    if (searchStr('xl/workbook.xml')) {
      return this.makeFileInfo(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xlsx'
      );
    }
    if (searchStr('ppt/presentation.xml')) {
      return this.makeFileInfo(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pptx'
      );
    }

    if (
      searchStr('META-INF/container.xml') ||
      searchStr('OEBPS/') ||
      searchStr('opf')
    ) {
      return this.makeFileInfo('application/epub+zip', '.epub');
    }

    return this.makeFileInfo('application/zip', '.zip');
  }

  private matchesMagic(content: Buffer, magic: Buffer): boolean {
    if (content.length < magic.length) return false;
    for (let i = 0; i < magic.length; i++) {
      if (content[i] !== magic[i]) return false;
    }
    return true;
  }

  private isTextContent(content: Buffer): boolean {
    const sample = content.subarray(0, Math.min(1024, content.length));
    let nullCount = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        nullCount++;
      }
    }
    return nullCount / sample.length < 0.1;
  }

  private makeFileInfo(mimeType: string, extension: string): FileInfo {
    return {
      path: '',
      extension,
      mimeType,
      size: 0,
    };
  }
}
