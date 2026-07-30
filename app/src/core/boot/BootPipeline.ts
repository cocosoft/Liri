/**
 * BootPipeline — 统一启动管道
 *
 * 提供单一启动入口，将初始化过程划分为 8 个有序阶段。
 * 各模块通过 register() 将自己的初始化逻辑注册到对应阶段，
 * execute() 按阶段顺序依次执行所有处理器。
 *
 * 用法:
 * ```ts
 * const pipeline = new BootPipeline();
 * pipeline.register(BootPhase.CONFIG_LOAD, async (ctx) => {
 *   await loadConfig();
 * });
 * await pipeline.execute({ mode: 'repl' });
 * ```
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { BootPhase, BOOT_PHASES, getBootPhaseMeta } from './BootPhase';

const logger = getLogger('BootPipeline');

/**
 * 启动管道上下文
 */
export interface BootContext {
  /** 启动模式 */
  mode: 'cli' | 'repl' | 'mcp' | 'daemon' | 'test' | 'oneshot';

  /** 启动参数 */
  args?: string[];

  /** 调试模式 */
  debug?: boolean;

  /** 详细日志 */
  verbose?: boolean;

  /** 是否跳过环境初始化（用于测试） */
  skipEnvInit?: boolean;

  /** 阶段间共享数据 */
  data: Map<string, unknown>;
}

/**
 * 阶段处理器函数
 */
export type BootHandler = (ctx: BootContext) => Promise<void>;

/**
 * 阶段处理器描述符
 */
export interface BootHandlerDescriptor {
  /** 处理器唯一标识 */
  id: string;

  /** 所属阶段 */
  phase: BootPhase;

  /** 处理器函数 */
  handler: BootHandler;

  /** 优先级（越大越先执行，默认 0） */
  priority?: number;

  /** 处理器描述 */
  description?: string;
}

/**
 * 启动事件类型
 */
export type BootEventType =
  | 'phase:start'
  | 'phase:end'
  | 'boot:complete'
  | 'boot:error';

/**
 * 启动事件
 */
export interface BootEvent {
  /** 事件类型 */
  type: BootEventType;

  /** 当前阶段 */
  phase: BootPhase;

  /** 阶段耗时（ms），仅 phase:end 有值 */
  duration?: number;

  /** 错误信息，仅 boot:error 有值 */
  error?: Error;

  /** 启动上下文 */
  ctx: BootContext;

  /** 时间戳 */
  timestamp: number;
}

/**
 * 启动事件监听器
 */
export type BootEventListener = (event: BootEvent) => void;

/**
 * 阶段执行结果
 */
export interface PhaseResult {
  /** 阶段枚举 */
  phase: BootPhase;

  /** 阶段显示名称 */
  label: string;

  /** 执行耗时（ms） */
  duration: number;

  /** 是否成功 */
  success: boolean;

  /** 错误信息（失败时） */
  error?: string;

  /** 成功处理器数 */
  handlerCount: number;

  /** 失败处理器数 */
  failedCount: number;
}

/**
 * 启动管道执行结果
 */
export interface BootResult {
  /** 是否全部成功 */
  success: boolean;

  /** 总耗时（ms） */
  totalDuration: number;

  /** 各阶段执行结果 */
  phases: PhaseResult[];

  /** 启动上下文（执行完毕后） */
  ctx: BootContext;
}

/**
 * 统一启动管道
 *
 * 职责:
 * 1. 管理启动阶段处理器
 * 2. 按顺序执行各阶段
 * 3. 发射阶段事件（供 UI 展示进度）
 * 4. 收集执行结果和性能数据
 */
export class BootPipeline {
  /** 各阶段的处理器列表 */
  private handlers: Map<BootPhase, BootHandlerDescriptor[]> = new Map();

  /** 事件监听器 */
  private listeners: Map<BootEventType, BootEventListener[]> = new Map();

  /** 是否正在执行中 */
  private executing: boolean = false;

  constructor() {
    // 为每个阶段初始化空处理器列表
    for (const meta of BOOT_PHASES) {
      this.handlers.set(meta.phase, []);
    }
  }

  /**
   * 注册阶段处理器
   *
   * @param descriptor - 处理器描述符
   * @throws 如果阶段不存在或正在执行中
   */
  register(descriptor: BootHandlerDescriptor): void {
    if (this.executing) {
      throw new Error('Cannot register handlers while pipeline is executing');
    }

    const list = this.handlers.get(descriptor.phase);
    if (!list) {
      throw new Error(`Unknown boot phase: ${descriptor.phase}`);
    }

    // 检查 ID 重复
    if (list.some((h) => h.id === descriptor.id)) {
      throw new Error(
        `Handler already registered: ${descriptor.id} (phase: ${descriptor.phase})`
      );
    }

    list.push(descriptor);
    // 按优先级降序排列（大的先执行）
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * 移除已注册的处理器
   */
  remove(id: string): boolean {
    if (this.executing) {
      throw new Error('Cannot remove handlers while pipeline is executing');
    }

    for (const [, list] of this.handlers) {
      const index = list.findIndex((h) => h.id === id);
      if (index !== -1) {
        list.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * 注册启动事件监听器
   */
  on(eventType: BootEventType, listener: BootEventListener): void {
    const list = this.listeners.get(eventType) ?? [];
    list.push(listener);
    this.listeners.set(eventType, list);
  }

  /**
   * 移除事件监听器
   */
  off(eventType: BootEventType, listener: BootEventListener): void {
    const list = this.listeners.get(eventType);
    if (list) {
      const index = list.indexOf(listener);
      if (index !== -1) {
        list.splice(index, 1);
      }
    }
  }

  /**
   * 发射事件
   */
  private emit(event: BootEvent): void {
    const list = this.listeners.get(event.type);
    if (list) {
      for (const listener of list) {
        try {
          listener(event);
        } catch (err) {
          logger.warn('Boot event listener error', {
            eventType: event.type,
            error: String(err),
          });
        }
      }
    }
  }

  /**
   * 执行完整启动管道
   *
   * 依次执行 8 个阶段，每个阶段内按优先级执行所有处理器。
   * 如果某阶段全部处理器失败，整个管道停止。
   *
   * @param options - 启动选项
   * @returns 启动结果
   */
  async execute(options?: {
    mode?: BootContext['mode'];
    args?: string[];
    debug?: boolean;
    verbose?: boolean;
    skipEnvInit?: boolean;
  }): Promise<BootResult> {
    if (this.executing) {
      throw new Error('Pipeline is already executing');
    }

    this.executing = true;
    const startTime = performance.now();

    // 构建启动上下文
    const ctx: BootContext = {
      mode: options?.mode ?? 'repl',
      args: options?.args,
      debug: options?.debug ?? false,
      verbose: options?.verbose ?? false,
      skipEnvInit: options?.skipEnvInit ?? false,
      data: new Map(),
    };

    const phaseResults: PhaseResult[] = [];
    let overallSuccess = true;

    try {
      // 按阶段顺序执行
      for (const meta of BOOT_PHASES) {
        const phaseStart = performance.now();
        const handlers = this.handlers.get(meta.phase) ?? [];

        logger.info(`[Boot] 阶段 ${meta.order}/8: ${meta.label}`);

        // 发射阶段开始事件
        this.emit({
          type: 'phase:start',
          phase: meta.phase,
          ctx,
          timestamp: Date.now(),
        });

        // 执行当前阶段的所有处理器
        let handlerCount = 0;
        let failedCount = 0;
        let phaseSuccess = true;

        for (const desc of handlers) {
          try {
            logger.debug(`[Boot] 执行处理器: ${desc.id}`);
            await desc.handler(ctx);
            handlerCount++;
          } catch (err) {
            failedCount++;
            await handleError(err, {
              module: 'core:boot',
              action: `handler:${desc.id}`,
            });

            // 如果启用了 debug 模式，抛出错终止
            if (ctx.debug) {
              phaseSuccess = false;
              overallSuccess = false;
              this.emit({
                type: 'boot:error',
                phase: meta.phase,
                error: err instanceof Error ? err : new Error(String(err)),
                ctx,
                timestamp: Date.now(),
              });
              throw err;
            }
          }
        }

        const phaseDuration = performance.now() - phaseStart;
        const phaseResult: PhaseResult = {
          phase: meta.phase,
          label: meta.label,
          duration: Math.round(phaseDuration),
          success: phaseSuccess,
          handlerCount,
          failedCount,
        };
        phaseResults.push(phaseResult);

        if (!phaseSuccess) {
          overallSuccess = false;
        }

        // 发射阶段结束事件
        this.emit({
          type: 'phase:end',
          phase: meta.phase,
          duration: Math.round(phaseDuration),
          ctx,
          timestamp: Date.now(),
        });

        logger.info(
          `[Boot] 阶段 ${meta.order}/8: ${meta.label} — ${handlerCount} ok, ${failedCount} fail (${Math.round(phaseDuration)}ms)`
        );
      }

      // 发射启动完成事件
      this.emit({
        type: 'boot:complete',
        phase: BootPhase.BOOT_COMPLETE,
        ctx,
        timestamp: Date.now(),
      });
    } catch (error) {
      overallSuccess = false;
      this.emit({
        type: 'boot:error',
        phase: BootPhase.BOOT_COMPLETE,
        error: error instanceof Error ? error : new Error(String(error)),
        ctx,
        timestamp: Date.now(),
      });

      // 在 debug 模式下，将错误传播给调用方
      if (ctx.debug) {
        throw error;
      }
    } finally {
      this.executing = false;
    }

    const totalDuration = Math.round(performance.now() - startTime);

    return {
      success: overallSuccess,
      totalDuration,
      phases: phaseResults,
      ctx,
    };
  }

  /**
   * 获取指定阶段的已注册处理器列表
   */
  getHandlers(phase?: BootPhase): BootHandlerDescriptor[] {
    if (phase) {
      return [...(this.handlers.get(phase) ?? [])];
    }
    const all: BootHandlerDescriptor[] = [];
    for (const [, list] of this.handlers) {
      all.push(...list);
    }
    return all;
  }

  /**
   * 清除所有已注册的处理器
   */
  clear(): void {
    if (this.executing) {
      throw new Error('Cannot clear handlers while pipeline is executing');
    }
    for (const [, list] of this.handlers) {
      list.length = 0;
    }
    this.listeners.clear();
  }

  /**
   * 是否正在执行中
   */
  isExecuting(): boolean {
    return this.executing;
  }
}

/**
 * 全局单例 BootPipeline 实例
 */
export const bootPipeline = new BootPipeline();
