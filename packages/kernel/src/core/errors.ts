/**
 * core 侧错误基座与错误值归一化工具 —— core 侧共享实现。
 *
 * 2026-09-30 分层倒挂收口（第 1 批，D-62）：错误值归一化纯函数
 * （`toError` / `errorMessage` / `isAbortError`）由 infra 层（`error/utils.ts`）下沉至此 ——
 * 原实现被 core 侧 `core/utils/ErrorHandler` 直接引用，构成 core → infra 倒挂
 * （A 类台账，见 .trae/specs/layer-inversion-a-class-inventory.md §3.5.1）。
 *
 * 2026-09-30 分层倒挂收口（第 2 批）：错误基座 `AppError` / `ErrorCategory` / `ErrorSeverity`
 * 由 infra 层（`error/types.ts`）下沉至此 —— 三者被 core 侧 di / extensibility / lazy /
 * tokenBudget / systemgraph / migration / media-generation / modules / mcp 等多处直接引用，
 * 原位置构成 core → infra 倒挂（同一 A 类台账）。`error/types.ts` 保留同名转出
 * ⇒ `@modules/error` 对外导出名与签名逐字不变。
 *
 * 本文件**零依赖**（置于模块根，跨模块消费方按相对路径直连，避免 R03-002 子目录导入）。
 *
 * `isAbortError` 的等价性说明：`error` 层的 `AbortError` 构造期必设 `name='AbortError'`
 * 且继承 `Error` ⇒ 其任何实例都满足 `instanceof Error && name === 'AbortError'`，
 * 故此处按 `name` 判定与按类判定**行为一致**（不引入跨层引用）。
 */

/**
 * 错误分类枚举
 */
export enum ErrorCategory {
  NETWORK = 'network',
  FILESYSTEM = 'filesystem',
  PERMISSION = 'permission',
  VALIDATION = 'validation',
  EXECUTION = 'execution',
  CONFIGURATION = 'configuration',
  API = 'api',
  DATABASE = 'database',
  RESOURCE = 'resource',
  DATA = 'data',
  OPERATION = 'operation',
  UNKNOWN = 'unknown',
}

/**
 * 错误严重程度枚举
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 应用错误基类
 */
export class AppError extends Error {
  /**
   * 构造函数
   * @param message 错误信息
   * @param category 错误分类
   * @param severity 错误严重程度
   * @param code 错误代码
   * @param context 错误上下文
   * @param errorId 错误 ID（用于生产环境溯源）
   */
  constructor(
    message: string,
    public category: ErrorCategory,
    public severity: ErrorSeverity,
    public code?: string,
    public context?: Record<string, unknown>,
    public errorId?: number
  ) {
    super(message);
    this.name = 'AppError';
  }

  /**
   * 从标准错误码创建 AppError
   * @param errorDef 错误码定义
   * @param options 可选参数
   */
  static fromCode(
    errorDef: { code: number; message: string; level: string },
    options?: {
      category?: ErrorCategory;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ): AppError {
    const category = options?.category ?? ErrorCategory.UNKNOWN;
    const severity = AppError.levelToSeverity(errorDef.level);
    const error = new AppError(
      errorDef.message,
      category,
      severity,
      String(errorDef.code),
      options?.context
    );
    if (options?.cause) {
      error.cause = options.cause;
    }
    return error;
  }

  private static levelToSeverity(level: string): ErrorSeverity {
    switch (level) {
      case 'CRITICAL':
        return ErrorSeverity.CRITICAL;
      case 'ERROR':
        return ErrorSeverity.HIGH;
      case 'WARN':
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.LOW;
    }
  }
}

/**
 * 将未知值转换为 Error
 * @param error 未知值
 * @returns Error 实例
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 从错误中提取消息
 * @param error 错误对象
 * @returns 错误消息
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 检查错误是否为中止错误
 * @param error 错误对象
 * @returns 是否为中止错误
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
