/**
 * A2A RPC 跨文件契约（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：`A2APortSlice` / `A2ARpcDeps` 原定义在 `a2a-rpc.ts`，
 * 而 `a2a-rpc-stream.ts` 反向 `import type` 它 —— 与 `a2a-rpc.ts` 对 stream 的
 * **动态导入**（madge 同样计为边）构成环。契约类型下沉后两端只依赖本叶子模块。
 */
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type { A2ATask } from '@modules/types/a2a';

/**
 * A2A 端口类型（**从 `getCoreAPI()` 派生**）。
 *
 * 刻意**不** `import type { A2APort } from '@modules/runtime/api/a2aPorts'` ——
 * 那是 service 层模块的**子目录路径**，静态引用会撞 R03-002「模块出口单一」的白名单判定；
 * 用派生类型等价且零新跨模块边。
 */
export type A2APortSlice = Awaited<
  ReturnType<ReturnType<typeof getCoreAPI>['getA2APort']>
>;

/**
 * 由 `a2a-routes.ts` 注入的依赖（**唯一**的跨文件契约）。
 *
 * 四个方法都与**委派**相关：状态（`hasDelegator`）与三个执行面（有界等待上限、共用委派核心、
 * 流式直连）。由宿主注入而非 import，既避免循环依赖，也保证 REST 与 RPC **共用同一实现**。
 */
export interface A2ARpcDeps {
  /** 委派后端是否已装配（未装配 ⇒ 两个写操作**如实**报错，**不伪造**成功） */
  hasDelegator(): boolean;
  /** 有界等待上限（ms；REST 与 RPC 同源） */
  maxWaitMs(): number;
  /** 委派核心（**与 REST 共用**）：创建任务 → 有界等待 → 完成或转 `working` */
  runDelegation(
    port: A2APortSlice,
    message: string,
    agentId: string | undefined,
    waitMs: number
  ): Promise<{ completed: boolean; task: A2ATask }>;
  /** 直连委派（**流式**用：不做有界等待；调用方已确认 `hasDelegator()`） */
  delegate(message: string, agentId: string | undefined): Promise<string>;
}
