/**
 * 文档引用图
 * 轻量级有向图，追踪文档间引用关系
 * 持久化到 ~/.pyapp/office/.document-graph.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:document');

/** 持久化文件路径 */
function getGraphPath(): string {
  return path.join(resolvePyappHome(), 'office', '.document-graph.json');
}

/**
 * 文档引用图
 * 支持 BFS 查询引用链，Phase 1 仅预留接口
 */
export class DocumentGraph {
  private edges: Map<string, Set<string>> = new Map();

  /**
   * 从磁盘加载引用图
   */
  static async load(): Promise<DocumentGraph> {
    const graph = new DocumentGraph();
    try {
      const graphPath = getGraphPath();
      if (fs.existsSync(graphPath)) {
        const raw = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
        for (const [source, targets] of Object.entries(raw)) {
          graph.edges.set(source, new Set(targets as string[]));
        }
        logger.debug('文档引用图已加载', { nodeCount: graph.edges.size });
      }
    } catch (error) {
      logger.warn('文档引用图加载失败，使用空白图', { error: String(error) });
    }
    return graph;
  }

  /**
   * 持久化到磁盘
   */
  async save(): Promise<void> {
    try {
      const raw: Record<string, string[]> = {};
      for (const [source, targets] of this.edges) {
        raw[source] = [...targets];
      }
      fs.writeFileSync(getGraphPath(), JSON.stringify(raw), 'utf-8');
    } catch (error) {
      logger.warn('文档引用图保存失败', { error: String(error) });
    }
  }

  /**
   * 记录引用关系：source 引用了 target
   */
  recordReference(source: string, target: string): void {
    if (!this.edges.has(source)) {
      this.edges.set(source, new Set());
    }
    this.edges.get(source)!.add(target);
  }

  /**
   * 获取关联文档列表（BFS，最大 depth 层）
   */
  getRelatedDocuments(docPath: string, depth: number = 2): string[] {
    const visited = new Set<string>();
    const queue: [string, number][] = [[docPath, 0]];

    while (queue.length > 0) {
      const [current, d] = queue.shift()!;
      if (d >= depth || visited.has(current)) continue;
      visited.add(current);

      const neighbors = this.edges.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push([neighbor, d + 1]);
          }
        }
      }
    }

    return [...visited].filter((p) => p !== docPath);
  }

  /**
   * 获取当前引用图节点数
   */
  get size(): number {
    return this.edges.size;
  }
}
