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
 * 会话在线质量端口 SPI（core 层端口）—— 2026-10-06，U4（在线质量评估器）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 **D6**（消费点）。
 *
 * **问题**：**infra** 层的 `chronos/autoDream/AutoDream` 需要"哪些轮次质量高"来取进化素材，
 * 而该信号（`turn/quality` 事件）落在**由 `chat`（app 层）持有**的事件日志里
 * ⇒ 直读即构成 **`infra -> app` 倒挂**（`session` 为 service 层，`infra → service` 同属倒挂）。
 *
 * **方案**：与既有 SPI 同构（`IKnowledgeGraphPort` 是同一动因的先例，D-148）——
 * core 定义端口与**转发代理**；实现由组合根（`entrypoints/spiWiring.ts`，entry 层）注入。
 *
 * **端口只暴露"摘要"而不是原始事件**：梦境要的是"这个会话里哪几轮值得看"，
 * 不是重放事件流；暴露原始事件会把 chat 的存储契约泄漏成 infra 的依赖面。
 *
 * **未注册时**：`getTurnQualitySummary` 返回 `null`（消费方跳过本路输入）。
 */

/** 单会话在线质量摘要（core 侧 DTO；字段为**最小必要**） */
export interface TurnQualitySummaryDto {
  /** 已评分轮数 */
  total: number;
  /** 平均分（0..1；`total === 0` 时无意义，调用方应先看 `total`） */
  avgScore: number;
  /** 高价值轮号（`score ≥ 高阈`），升序 */
  highValueTurns: number[];
  /** 低价值轮号（`score < 可疑阈`），升序 */
  lowValueTurns: number[];
}

/** 会话在线质量端口（core 侧契约） */
export interface ISessionQualityPort {
  /**
   * 取某会话的在线质量摘要。
   *
   * @returns `null` = 无数据 / 未注册实现（消费方**跳过**该路输入，不造默认值）
   */
  getTurnQualitySummary(
    sessionId: string
  ): Promise<TurnQualitySummaryDto | null>;
}

/** SPI 服务标识符常量 */
export const SESSION_QUALITY_SERVICE_ID = 'core.spi.ISessionQualityPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerSessionQualitySpi 在启动时设置。
// infra 层（chronos/autoDream）通过 resolveSessionQuality() 获取，
// 避免直接 import app 层（chat / evals / session storage）。
// ---------------------------------------------------------------------------

let _service: ISessionQualityPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveKnowledgeGraph()` 语义） */
const _proxy: ISessionQualityPort = {
  getTurnQualitySummary: (sessionId) =>
    _service?.getTurnQualitySummary(sessionId) ?? Promise.resolve(null),
};

/** 获取会话在线质量端口（未注册时返回空操作代理） */
export function resolveSessionQuality(): ISessionQualityPort {
  return _proxy;
}

/**
 * 注册会话在线质量 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerSessionQualitySpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: ISessionQualityPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<ISessionQualityPort>({
    id: SESSION_QUALITY_SERVICE_ID,
    factory: () => _service as ISessionQualityPort,
    scope: 'singleton',
  });
}
