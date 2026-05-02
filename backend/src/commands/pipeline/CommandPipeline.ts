export enum PipelineStage {
  PRE_VALIDATE = 'pre_validate',
  PRE_AUTHORIZE = 'pre_authorize',
  PRE_PROCESS = 'pre_process',
  EXECUTE = 'execute',
  POST_PROCESS = 'post_process',
  POST_LOG = 'post_log',
}

export interface PipelineContext {
  commandName: string;
  args: string;
  parsedArgs: Record<string, any>;
  metadata?: Record<string, any>;
  result?: any;
  error?: Error;
  startTime: number;
  endTime?: number;
  duration?: number;
  stage: PipelineStage;
  abort?: boolean;
  abortReason?: string;
}

export type PipelineHandler = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;

export interface PipelineMiddleware {
  id: string;
  stage: PipelineStage;
  handler: PipelineHandler;
  priority: number;
  description?: string;
}

export interface PipelineExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  stages: Array<{ stage: PipelineStage; duration: number }>;
}

export interface IPipeline {
  use(middleware: PipelineMiddleware): void;
  remove(id: string): boolean;
  execute(commandName: string, args: string, parsedArgs?: Record<string, any>): Promise<PipelineExecutionResult>;
  getMiddlewares(stage?: PipelineStage): PipelineMiddleware[];
  clear(): void;
}

export class CommandPipeline implements IPipeline {
  private middlewares: Map<PipelineStage, PipelineMiddleware[]> = new Map();
  private stageOrder: PipelineStage[] = [
    PipelineStage.PRE_VALIDATE,
    PipelineStage.PRE_AUTHORIZE,
    PipelineStage.PRE_PROCESS,
    PipelineStage.EXECUTE,
    PipelineStage.POST_PROCESS,
    PipelineStage.POST_LOG,
  ];

  constructor() {
    for (const stage of this.stageOrder) {
      this.middlewares.set(stage, []);
    }
  }

  use(middleware: PipelineMiddleware): void {
    const list = this.middlewares.get(middleware.stage);
    if (!list) throw new Error(`Unknown pipeline stage: ${middleware.stage}`);
    if (list.find(m => m.id === middleware.id)) {
      throw new Error(`Middleware already registered: ${middleware.id}`);
    }
    list.push(middleware);
    list.sort((a, b) => b.priority - a.priority);
  }

  remove(id: string): boolean {
    for (const [, list] of this.middlewares) {
      const idx = list.findIndex(m => m.id === id);
      if (idx !== -1) {
        list.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  async execute(commandName: string, args: string, parsedArgs?: Record<string, any>): Promise<PipelineExecutionResult> {
    const ctx: PipelineContext = {
      commandName,
      args,
      parsedArgs: parsedArgs || {},
      startTime: Date.now(),
      stage: PipelineStage.PRE_VALIDATE,
    };

    const stageDurations: Array<{ stage: PipelineStage; duration: number }> = [];

    try {
      for (const stage of this.stageOrder) {
        if (ctx.abort) break;

        ctx.stage = stage;
        const stageStart = Date.now();
        const handlers = this.middlewares.get(stage) || [];

        if (handlers.length === 0) continue;

        let index = 0;
        const runHandler = async (): Promise<void> => {
          if (ctx.abort || index >= handlers.length) return;
          const handler = handlers[index++];
          await handler.handler(ctx, runHandler);
        };

        await runHandler();
        stageDurations.push({ stage, duration: Date.now() - stageStart });
      }

      ctx.endTime = Date.now();
      ctx.duration = ctx.endTime - ctx.startTime;

      if (ctx.abort) {
        return {
          success: false,
          error: ctx.abortReason || 'Pipeline aborted',
          duration: ctx.duration,
          stages: stageDurations,
        };
      }

      return {
        success: true,
        result: ctx.result,
        duration: ctx.duration,
        stages: stageDurations,
      };
    } catch (error) {
      ctx.endTime = Date.now();
      ctx.duration = ctx.endTime - ctx.startTime;
      ctx.error = error as Error;

      return {
        success: false,
        error: (error as Error).message,
        duration: ctx.duration,
        stages: stageDurations,
      };
    }
  }

  getMiddlewares(stage?: PipelineStage): PipelineMiddleware[] {
    if (stage) return [...(this.middlewares.get(stage) || [])];
    const all: PipelineMiddleware[] = [];
    for (const [, list] of this.middlewares) {
      all.push(...list);
    }
    return all;
  }

  clear(): void {
    for (const [, list] of this.middlewares) {
      list.length = 0;
    }
  }
}

export const commandPipeline = new CommandPipeline();
