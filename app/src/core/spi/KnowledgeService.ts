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
 * 知识库运维 SPI（core 层端口）—— 2026-09-30 台账 D-125（`R00-003` P6 / G4）
 *
 * **问题**：`chronos`（**infra**，定时维护）需调用 `knowledge`（**app**）的知识编译 / 巡检 /
 * 摘要构建（`runKnowledgeCompile` · `runKnowledgeLint` · `getDefaultDigestService`）
 * ⇒ 构成 `infra -> app` 倒挂（`R00-003` 盲区，2 处：`AutoDream` 与 `knowledgeMaintenance`）。
 *
 * **方案**：与既有 7 个 SPI **同构** —— core 定义端口与**转发代理**；实现在
 * `registerKnowledgeSpi()`（组合根缝）内**动态导入** `knowledge` 后注入。
 * `aiService` 取自 **`AiAccessService` SPI**（core → core，不额外产生跨层对）。
 *
 * **未注册时**：编译返回全零、巡检返回空、摘要为空操作 —— 消费方均已具备降级路径。
 */

/** 编译选项（`force` / `model` 为调用方实际传入者） */
export interface KnowledgeCompileOptionsDto {
  force?: boolean | undefined;
  model?: string | undefined;
}

/** 编译结果最小投影 */
export interface KnowledgeCompileResultDto {
  compiled: number;
  skipped: number;
  errors: string[];
}

/** 巡检问题最小投影（调用方仅读 `message`） */
export interface KnowledgeLintIssueDto {
  message: string;
}

/** 巡检结果 */
export interface KnowledgeLintResultDto {
  issues: KnowledgeLintIssueDto[];
}

/** 知识库运维端口（core 侧契约） */
export interface IKnowledgeService {
  /** 原 `runKnowledgeCompile(aiService, options)` */
  runCompile(
    options?: KnowledgeCompileOptionsDto
  ): Promise<KnowledgeCompileResultDto>;
  /** 原 `runKnowledgeLint()` */
  runLint(): Promise<KnowledgeLintResultDto>;
  /** 原 `getDefaultDigestService().buildDigest()` */
  buildDigest(): Promise<void>;
}

/** SPI 服务标识符常量 */
export const KNOWLEDGE_SERVICE_ID = 'core.spi.IKnowledgeService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerKnowledgeSpi 在启动时设置。
// infra 层（chronos）通过 resolveKnowledge() 获取，避免直接 import app 层。
// ---------------------------------------------------------------------------

let _service: IKnowledgeService | null = null;

const EMPTY_COMPILE: KnowledgeCompileResultDto = {
  compiled: 0,
  skipped: 0,
  errors: [],
};

/** 转发**代理**（延迟绑定，同 `resolveLogger()` 语义；注册前返回空值） */
const _proxy: IKnowledgeService = {
  runCompile: () => _service?.runCompile() ?? Promise.resolve(EMPTY_COMPILE),
  runLint: () => _service?.runLint() ?? Promise.resolve({ issues: [] }),
  buildDigest: () => _service?.buildDigest() ?? Promise.resolve(),
};

/** 获取知识库运维端口（未注册时为空值） */
export function resolveKnowledge(): IKnowledgeService {
  return _proxy;
}

/**
 * 注册知识库运维 SPI 实现到 DI 容器
 *
 * 动态导入 app 层（`knowledge`）实现并注册；此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 */
export async function registerKnowledgeSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IKnowledgeService
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入；
  // `aiService` 现于装配侧经 `resolveAiAccess()` 取得（core → core）。
  _service = service;

  container.registerDescriptor<IKnowledgeService>({
    id: KNOWLEDGE_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
