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
 * 知识图谱端口 SPI（core 层端口）—— 2026-10-01 台账 D-148（`R00-001` BULK-007）
 *
 * **问题**：**infra** 层的 `chronos/autoDream/DreamGraphPhase` 需把 wiki 目录的
 * `[[link]]` 双链写入 **app** 层 `knowledge` 的 `kg_edges` 表
 * ⇒ 直接静态导入 `@modules/knowledge/graph/KnowledgeGraph` 等
 * **3 条 import** ⇒ 构成 **`infra -> app` 倒挂**。
 *
 * **方案**：与既有 SPI 同构 —— core 定义端口与**转发代理**；实现由组合根
 * （`entrypoints/spiWiring.ts`，entry 层）注入。
 *
 * **为什么是"三个工厂 + 一个静态方法"而不是"编译域双链"这一整块能力**：
 * 扫描 wiki、解析 `[[link]]`、去重后建边，是 **chronos 侧的业务语义**（它自己决定扫哪些域、
 * 用什么正则、边的 `attributes` 写什么）；把它们搬进实现侧等于**把业务逻辑搬家**。
 * 因此端口只暴露"能拿到哪些对象"，业务留在消费方 —— 类型经 `unknown` 边界由消费方收窄。
 *
 * **未注册时**：`createGraph` / `createSchemaLoader` 返回 `null`（消费方跳过本阶段）；
 * `listDomains` 返回 `[]`；`generateEntityId` 返回 `''`。
 */

/** 已注册的域（`DomainManager.list()` 的最小投影） */
export interface KnowledgeDomainDto {
  name: string;
}

/** 知识图谱端口（core 侧契约） */
export interface IKnowledgeGraphPort {
  /** 创建知识图谱实例（原 `new KnowledgeGraph(dbPath)`）；未注册时返回 `null` */
  createGraph(dbPath: string): unknown;
  /** 创建 schema 加载器（原 `new SchemaLoader(undefined, domain)`）；未注册时返回 `null` */
  createSchemaLoader(domain: string): unknown;
  /** 列出已注册的域（原 `new DomainManager().list()`） */
  listDomains(): Promise<KnowledgeDomainDto[]>;
  /** 生成实体 ID（原 static `KnowledgeGraph.generateEntityId`） */
  generateEntityId(domain: string, kind: string, slug: string): string;
}

/** SPI 服务标识符常量 */
export const KNOWLEDGE_GRAPH_SERVICE_ID = 'core.spi.IKnowledgeGraphPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerKnowledgeGraphSpi 在启动时设置。
// infra 层（chronos）通过 resolveKnowledgeGraph() 获取，避免直接 import app 层。
// ---------------------------------------------------------------------------

let _service: IKnowledgeGraphPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveBroadcast()` 语义） */
const _proxy: IKnowledgeGraphPort = {
  createGraph: (dbPath) => _service?.createGraph(dbPath) ?? null,
  createSchemaLoader: (domain) => _service?.createSchemaLoader(domain) ?? null,
  listDomains: () => _service?.listDomains() ?? Promise.resolve([]),
  generateEntityId: (domain, kind, slug) =>
    _service?.generateEntityId(domain, kind, slug) ?? '',
};

/** 获取知识图谱端口（未注册时返回空操作代理） */
export function resolveKnowledgeGraph(): IKnowledgeGraphPort {
  return _proxy;
}

/**
 * 注册知识图谱 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerKnowledgeGraphSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IKnowledgeGraphPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<IKnowledgeGraphPort>({
    id: KNOWLEDGE_GRAPH_SERVICE_ID,
    factory: () => _service as IKnowledgeGraphPort,
    scope: 'singleton',
  });
}
