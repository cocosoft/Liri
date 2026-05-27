/**
 * FileReadTool - Limits
 * 对标CC FileReadTool limits.ts
 * 读取限制控制模块
 */

export interface ReadLimits {
  maxFileSize: number;
  maxLinesPerFile: number;
  maxTotalSize: number;
  maxFilesPerRead: number;
  maxDirectoryDepth: number;
  maxOutputSize: number;
  maxLineLength: number;
  allowedEncodings: string[];
  timeoutMs: number;
}

export interface ReadLimitResult {
  allowed: boolean;
  reason?: string;
  limitValue?: number;
  actualValue?: number;
}

const DEFAULT_LIMITS: ReadLimits = {
  maxFileSize: 10 * 1024 * 1024,
  maxLinesPerFile: 50000,
  maxTotalSize: 50 * 1024 * 1024,
  maxFilesPerRead: 100,
  maxDirectoryDepth: 10,
  maxOutputSize: 1024 * 1024,
  maxLineLength: 10000,
  allowedEncodings: ['utf-8', 'ascii', 'utf-16le', 'latin1'],
  timeoutMs: 30000,
};

export class ReadLimitManager {
  private limits: ReadLimits;

  constructor(limits?: Partial<ReadLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  checkFileSize(size: number): ReadLimitResult {
    if (size > this.limits.maxFileSize) {
      return {
        allowed: false,
        reason: `File size ${formatSize(size)} exceeds limit ${formatSize(this.limits.maxFileSize)}`,
        limitValue: this.limits.maxFileSize,
        actualValue: size,
      };
    }

    return { allowed: true };
  }

  checkLineCount(lineCount: number): ReadLimitResult {
    if (lineCount > this.limits.maxLinesPerFile) {
      return {
        allowed: false,
        reason: `Line count ${lineCount} exceeds limit ${this.limits.maxLinesPerFile}`,
        limitValue: this.limits.maxLinesPerFile,
        actualValue: lineCount,
      };
    }

    return { allowed: true };
  }

  checkTotalSize(totalSize: number): ReadLimitResult {
    if (totalSize > this.limits.maxTotalSize) {
      return {
        allowed: false,
        reason: `Total size ${formatSize(totalSize)} exceeds limit ${formatSize(this.limits.maxTotalSize)}`,
        limitValue: this.limits.maxTotalSize,
        actualValue: totalSize,
      };
    }

    return { allowed: true };
  }

  checkFileCount(fileCount: number): ReadLimitResult {
    if (fileCount > this.limits.maxFilesPerRead) {
      return {
        allowed: false,
        reason: `File count ${fileCount} exceeds limit ${this.limits.maxFilesPerRead}`,
        limitValue: this.limits.maxFilesPerRead,
        actualValue: fileCount,
      };
    }

    return { allowed: true };
  }

  checkDirectoryDepth(depth: number): ReadLimitResult {
    if (depth > this.limits.maxDirectoryDepth) {
      return {
        allowed: false,
        reason: `Directory depth ${depth} exceeds limit ${this.limits.maxDirectoryDepth}`,
        limitValue: this.limits.maxDirectoryDepth,
        actualValue: depth,
      };
    }

    return { allowed: true };
  }

  checkOutputSize(outputSize: number): ReadLimitResult {
    if (outputSize > this.limits.maxOutputSize) {
      return {
        allowed: false,
        reason: `Output size ${formatSize(outputSize)} exceeds limit ${formatSize(this.limits.maxOutputSize)}`,
        limitValue: this.limits.maxOutputSize,
        actualValue: outputSize,
      };
    }

    return { allowed: true };
  }

  checkLineLength(lineLength: number): ReadLimitResult {
    if (lineLength > this.limits.maxLineLength) {
      return {
        allowed: false,
        reason: `Line length ${lineLength} exceeds limit ${this.limits.maxLineLength}`,
        limitValue: this.limits.maxLineLength,
        actualValue: lineLength,
      };
    }

    return { allowed: true };
  }

  checkEncoding(encoding: string): ReadLimitResult {
    const normalized = encoding.toLowerCase().replace(/[^a-z0-9-]/g, '');

    const allowed = this.limits.allowedEncodings.some(
      (e) => e.toLowerCase().replace(/[^a-z0-9-]/g, '') === normalized
    );

    if (!allowed) {
      return {
        allowed: false,
        reason: `Encoding "${encoding}" is not in allowed list: ${this.limits.allowedEncodings.join(', ')}`,
      };
    }

    return { allowed: true };
  }

  checkAll(
    fileSize: number,
    lineCount: number,
    encoding: string
  ): ReadLimitResult {
    const checks = [
      this.checkFileSize(fileSize),
      this.checkLineCount(lineCount),
      this.checkEncoding(encoding),
    ];

    for (const check of checks) {
      if (!check.allowed) return check;
    }

    return { allowed: true };
  }

  updateLimits(limits: Partial<ReadLimits>): void {
    Object.assign(this.limits, limits);
  }

  getLimits(): ReadLimits {
    return { ...this.limits };
  }

  resetToDefaults(): void {
    this.limits = { ...DEFAULT_LIMITS };
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function createReadLimitManager(
  limits?: Partial<ReadLimits>
): ReadLimitManager {
  return new ReadLimitManager(limits);
}

export { formatSize };
