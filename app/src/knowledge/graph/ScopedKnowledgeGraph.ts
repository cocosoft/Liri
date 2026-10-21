/**
 * ScopedKnowledgeGraph — **身份感知的知识图谱代理**（多租户 P1）
 *
 * 背景：`KnowledgeRouter` 的知识图谱是**进程级注入**的单个实例
 * （`knowledgeRouter['knowledgeGraph'] = graph`），而图谱数据在 `app.db` 里。
 * 若它固定指向启动时的共享库，租户请求的 GraphRAG 检索会读到别人的图谱。
 *
 * 做法：注入本代理，**每次调用**按当前请求身份取对应的 `KnowledgeGraph` 实例
 * （本地身份 ⇒ 共享 `app.db`，零变更；已认证 ⇒ `<scoped>/app.db`）。
 * 与 `ScopedCheckpointStorage` 同构：不动注入点之外的任何调用方。
 *
 * 为什么不用"共享实例换连接"：`KnowledgeGraph` 持有单字段 `db`，`await` 交错会串库。
 */
import { KnowledgeGraph } from './KnowledgeGraph.js';
import { resolveScopedDbPath } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '../../core/identity/requestScope.js';
import { registerScopedResource } from '../../core/identity/scopedResources.js';

const logger = getLogger('knowledge:graph:scoped');

type Graph = KnowledgeGraph;

export class ScopedKnowledgeGraph {
  /** 本地身份 / 无请求作用域 ⇒ 共享库实例 */
  private local: Graph | null = null;
  /** 已认证身份 ⇒ 各自实例（键 = `<tenantId>:<userId>`） */
  private scoped = new Map<string, Graph>();
  /** 同一身份的并发首调共用一次初始化（避免重复建连/DDL） */
  private pending = new Map<string, Promise<Graph>>();
  /** 调用方设置的边 schema —— 新实例创建时统一套用 */
  private edgeSchemas?: Parameters<Graph['setEdgeSchemas']>[0];

  /** 当前身份对应的图谱实例（惰性创建 + 初始化） */
  private graph(): Promise<Graph> {
    const principal = getRequestPrincipal();
    const key = isLocalPrincipal(principal) ? '' : principalKeyOf(principal);

    const cached = key === '' ? this.local : this.scoped.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.pending.get(key);
    if (existing) return existing;

    const opening = (async () => {
      const graph = new KnowledgeGraph(resolveScopedDbPath(principal));
      if (this.edgeSchemas) graph.setEdgeSchemas(this.edgeSchemas);
      await graph.init();
      if (key === '') this.local = graph;
      else {
        this.scoped.set(key, graph);
        // 多租户 P5：登记 closer（关连接 + 摘除本实例缓存），删租户时统一释放文件句柄
        registerScopedResource(key, async () => {
          await graph.close();
          this.scoped.delete(key);
        });
      }
      this.pending.delete(key);
      return graph;
    })();

    this.pending.set(key, opening);
    return opening;
  }

  /** 初始化当前身份的图谱（启动期调用 ⇒ 本地共享库，与改造前等价） */
  async init(): Promise<void> {
    await this.graph();
  }

  setEdgeSchemas(schemas: Parameters<Graph['setEdgeSchemas']>[0]): void {
    this.edgeSchemas = schemas;
    this.local?.setEdgeSchemas(schemas);
    for (const graph of this.scoped.values()) graph.setEdgeSchemas(schemas);
  }

  async addEdge(
    ...args: Parameters<Graph['addEdge']>
  ): ReturnType<Graph['addEdge']> {
    return (await this.graph()).addEdge(...args);
  }

  async getEdge(
    ...args: Parameters<Graph['getEdge']>
  ): ReturnType<Graph['getEdge']> {
    return (await this.graph()).getEdge(...args);
  }

  async deleteEdge(
    ...args: Parameters<Graph['deleteEdge']>
  ): ReturnType<Graph['deleteEdge']> {
    return (await this.graph()).deleteEdge(...args);
  }

  async queryEdges(
    ...args: Parameters<Graph['queryEdges']>
  ): ReturnType<Graph['queryEdges']> {
    return (await this.graph()).queryEdges(...args);
  }

  async getStats(
    ...args: Parameters<Graph['getStats']>
  ): ReturnType<Graph['getStats']> {
    return (await this.graph()).getStats(...args);
  }

  async exportJsonl(
    ...args: Parameters<Graph['exportJsonl']>
  ): ReturnType<Graph['exportJsonl']> {
    return (await this.graph()).exportJsonl(...args);
  }

  async cleanupOrphans(
    ...args: Parameters<Graph['cleanupOrphans']>
  ): ReturnType<Graph['cleanupOrphans']> {
    return (await this.graph()).cleanupOrphans(...args);
  }

  /** 关闭所有已建实例（本地 + 各身份） */
  async close(): Promise<void> {
    const graphs = [
      ...(this.local ? [this.local] : []),
      ...this.scoped.values(),
    ];
    this.local = null;
    this.scoped.clear();
    this.pending.clear();
    for (const graph of graphs) {
      try {
        await graph.close();
      } catch (err) {
        logger.warning('知识图谱实例关闭失败（已忽略）', {
          error: String(err),
        });
      }
    }
  }
}
