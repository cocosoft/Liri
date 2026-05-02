/**
 * 文件路径和类型常量
 * 基于CC源码 cc_code/backend/constants/files.ts 实现
 * 定义二进制文件扩展名、文件检测等常量
 */

/**
 * 二进制文件扩展名集合
 * 这些文件无法作为文本有意义地比较，且通常较大
 */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.mpeg', '.mpg',
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.aiff', '.opus',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.z', '.tgz', '.iso',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.obj', '.lib', '.app', '.msi', '.deb', '.rpm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.pyc', '.pyo', '.class', '.jar', '.war', '.ear', '.node', '.wasm', '.rlib',
  '.sqlite', '.sqlite3', '.db', '.mdb', '.idx',
  '.psd', '.ai', '.eps', '.sketch', '.fig', '.xd', '.blend', '.3ds', '.max',
  '.swf', '.fla',
  '.lockb', '.dat', '.data',
]);

/**
 * 检查文件路径是否具有二进制扩展名
 */
export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 二进制内容检测的读取字节数
 */
const BINARY_CHECK_SIZE = 8192;

/**
 * 通过检查空字节或高比例不可打印字符判断缓冲区是否包含二进制内容
 */
export function isBinaryContent(buffer: Buffer): boolean {
  const checkSize = Math.min(buffer.length, BINARY_CHECK_SIZE);

  let nonPrintable = 0;
  for (let i = 0; i < checkSize; i++) {
    const byte = buffer[i]!;
    if (byte === 0) {
      return true;
    }
    if (
      byte < 32 &&
      byte !== 9 &&
      byte !== 10 &&
      byte !== 13
    ) {
      nonPrintable++;
    }
  }

  return nonPrintable / checkSize > 0.1;
}
