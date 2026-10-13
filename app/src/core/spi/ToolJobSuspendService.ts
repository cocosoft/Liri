// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 侧车**作业挂起**端口（core 侧契约；T1-2② C₂，2026-10-13）。
 *
 * 定位：原文「长耗时侧车工具**不得同步阻塞**——提交后须能向内核投影 `SUSPENDED`，
 * 完成后通知解冻续跑」（`.trae/specs/sidecar-async-suspend.md` §1）②。
 *
 * **为什么要经 core 端口（而不是让 tools 直接 import query）**：`tools/**` 与 `query/**`
 * **同属 app 层**，但**已存在 `query → tools` 的模块级依赖**（`query/TAORLoop.ts` /
 * `QueryEngine.ts` 等 8 处）⇒ tools 若反向 import query 即成 **`tools ⇄ query` 模块级循环**。
 * 故此处只定义**窄契约**（core 不引用任何上层实现），实现体由 `query/toolJobSuspend.ts` 提供、
 * 在 `entrypoints/spiWiring.ts`（entry 层，可依赖任意层）**推送注册** ⇒ 零新增跨层倒挂、零环。
 *
 * **未注册语义（fail-closed，不伪造）**：`resolveToolJobSuspend()` 返回 **no-op 代理**
 * （`register/release` 均 `false`）⇒ 调用方**不挂起、不报错**，行为与"未启用"一致（CS03）。
 */
/**
 * 登记结果（**只报事实**）：开关关 / 未注册 ⇒ `registered:false` + 原因，**不是**错误。
 *
 * `'disabled'` = 功能开关未启用（`TOOL_JOB_SUSPEND=false`）；`'not_registered'` = SPI 未装配。
 */
export type ToolJobSuspendRegisterResult =
  | { registered: true }
  | { registered: false; reason: 'disabled' | 'not_registered' };

/** 作业挂起登记入参（**只报事实**：哪个会话、哪个作业） */
export interface ToolJobSuspendRegisterInput {
  /** 目标会话（挂起登记主键） */
  sessionId: string;
  /** 侧车作业 id（由 `job.submit` 的响应给出） */
  jobId: string;
}

/** 侧车作业挂起端口（core 侧契约） */
export interface IToolJobSuspendPort {
  /**
   * 向内核登记一条**作业挂起**（实现侧应登记为 `kind='tool-job'` 并投影 `SUSPENDED`）。
   *
   * @returns `registered` = 是否**实际登记**（开关关 / 未启用 ⇒ `false`，**不视为错误**）
   */
  register(input: ToolJobSuspendRegisterInput): ToolJobSuspendRegisterResult;
  /**
   * 释放该会话的**作业挂起**（幂等；**仅**释放 `kind='tool-job'` 的登记，
   * **不得**误放 budget/guard 挂起），并在实际释放时投影 `RUNNING`。
   *
   * @returns 是否**实际释放**
   */
  release(sessionId: string): boolean;
}

/** SPI 服务标识符常量 */
export const TOOL_JOB_SUSPEND_SERVICE_ID = 'core.spi.IToolJobSuspendPort';

let _service: IToolJobSuspendPort | null = null;

/** 转发代理（**未注册 ⇒ no-op**：不挂起、不释放、不报错 —— 与"未启用"同语义） */
const _proxy: IToolJobSuspendPort = {
  register: () => ({ registered: false, reason: 'not_registered' }),
  release: () => false,
};

/** 获取作业挂起端口（未注册时返回 no-op 代理） */
export function resolveToolJobSuspend(): IToolJobSuspendPort {
  return _service ?? _proxy;
}

/** 注册作业挂起 SPI 实现（**推送模型**；实现体由 `entrypoints/spiWiring.ts` 构建后传入） */
export async function registerToolJobSuspendSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IToolJobSuspendPort
): Promise<void> {
  _service = service;
  container.registerDescriptor<IToolJobSuspendPort>({
    id: TOOL_JOB_SUSPEND_SERVICE_ID,
    factory: () => _service as IToolJobSuspendPort,
    scope: 'singleton',
  });
}

/** 仅供测试：解绑实现（生产不使用）。 */
export function resetToolJobSuspendForTest(): void {
  _service = null;
}
