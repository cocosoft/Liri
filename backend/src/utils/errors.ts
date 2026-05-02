/**
 * 错误处理工具
 * 定义错误类型和错误处理函数
 */

/**
 * 基础错误类
 */
export class PYAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * 命令格式错误
 */
export class MalformedCommandError extends PYAppError {}

/**
 * 中止错误
 */
export class AbortError extends PYAppError {
  constructor(message?: string) {
    super(message || 'Operation aborted');
    this.name = 'AbortError';
  }
}

/**
 * 配置解析错误
 */
export class ConfigParseError extends PYAppError {
  filePath: string;
  defaultConfig: unknown;

  constructor(message: string, filePath: string, defaultConfig: unknown) {
    super(message);
    this.name = 'ConfigParseError';
    this.filePath = filePath;
    this.defaultConfig = defaultConfig;
  }
}

/**
 * Shell命令错误
 */
export class ShellError extends PYAppError {
  constructor(
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code: number,
    public readonly interrupted: boolean
  ) {
    super('Shell command failed');
    this.name = 'ShellError';
  }
}

/**
 * 插件错误
 */
export class PluginError extends PYAppError {
  constructor(
    message: string,
    public readonly pluginName: string
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

/**
 * 工具执行错误
 */
export class ToolError extends PYAppError {
  constructor(
    message: string,
    public readonly toolName: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * 安全错误
 */
export class SecurityError extends PYAppError {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * 检查是否是中止错误
 * @param e 错误对象
 * @returns 是否是中止错误
 */
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof AbortError || (e instanceof Error && e.name === 'AbortError')
  );
}

/**
 * 将未知值转换为Error对象
 * @param e 未知值
 * @returns Error对象
 */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * 从未知错误中提取错误消息
 * @param e 未知错误
 * @returns 错误消息
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 提取错误的errno代码
 * @param e 错误对象
 * @returns errno代码
 */
export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') {
    return e.code;
  }
  return undefined;
}

/**
 * 检查是否是ENOENT错误
 * @param e 错误对象
 * @returns 是否是ENOENT错误
 */
export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT';
}

/**
 * 提取错误的路径信息
 * @param e 错误对象
 * @returns 路径信息
 */
export function getErrnoPath(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'path' in e && typeof e.path === 'string') {
    return e.path;
  }
  return undefined;
}

/**
 * 提取错误的简短堆栈信息
 * @param e 错误对象
 * @param maxFrames 最大堆栈帧数
 * @returns 简短堆栈信息
 */
export function shortErrorStack(e: unknown, maxFrames = 5): string {
  if (!(e instanceof Error)) return String(e);
  if (!e.stack) return e.message;

  // 堆栈格式："Name: message\n    at frame1\n    at frame2..."
  const lines = e.stack.split('\n');
  const header = lines[0] ?? e.message;
  const frames = lines.slice(1).filter((l) => l.trim().startsWith('at '));

  if (frames.length <= maxFrames) return e.stack;
  return [header, ...frames.slice(0, maxFrames)].join('\n');
}

/**
 * 检查是否是文件系统不可访问错误
 * @param e 错误对象
 * @returns 是否是文件系统不可访问错误
 */
export function isFsInaccessible(e: unknown): boolean {
  const code = getErrnoCode(e);
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'ELOOP'
  );
}

/**
 * 格式化错误信息
 * @param error 错误对象
 * @returns 格式化后的错误信息
 */
export function formatError(error: unknown): string {
  if (error instanceof AbortError) {
    return error.message;
  }
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = getErrorParts(error);
  const fullMessage =
    parts.filter(Boolean).join('\n').trim() || 'Command failed with no output';

  if (fullMessage.length <= 10000) {
    return fullMessage;
  }

  const halfLength = 5000;
  const start = fullMessage.slice(0, halfLength);
  const end = fullMessage.slice(-halfLength);
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`;
}

/**
 * 获取错误的各个部分
 * @param error 错误对象
 * @returns 错误部分数组
 */
export function getErrorParts(error: Error): string[] {
  if (error instanceof ShellError) {
    return [
      `Exit code ${error.code}`,
      error.interrupted ? 'Command interrupted' : '',
      error.stderr,
      error.stdout,
    ];
  }

  const parts = [error.message];
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr);
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout);
  }
  return parts;
}
