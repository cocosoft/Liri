/**
 * 记忆关联网络
 * 管理记忆之间的关联关系，支持递归检索关联记忆
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 关联类型
 */
export type RelationType =
  | 'tag'
  | 'content'
  | 'reference'
  | 'temporal'
  | 'project';

/**
 * 记忆关联边
 */
export interface MemoryRelation {
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  strength: number;
  createdAt: number;
}

/**
 * 关联网络统计
 */
export interface RelationNetworkStats {
  totalMemories: number;
  totalRelations: number;
  avgRelationsPerMemory: number;
  mostConnectedMemory: string | null;
  relationTypeDistribution: Record<RelationType, number>;
}

/**
 * 记忆关联网络
 */
export class MemoryRelationGraph {
  private relations: Map<string, MemoryRelation[]> = new Map();
  private reverseRelations: Map<string, MemoryRelation[]> = new Map();
  private maxDepth: number = 3;
  private maxRelationsPerMemory: number = 50;

  constructor(maxDepth: number = 3, maxRelationsPerMemory: number = 50) {
    this.maxDepth = maxDepth;
    this.maxRelationsPerMemory = maxRelationsPerMemory;
  }

  /**
   * 添加关联
   */
  addRelation(relation: MemoryRelation): void {
    const { sourceId, targetId, relationType, strength } = relation;

    if (!this.relations.has(sourceId)) {
      this.relations.set(sourceId, []);
    }
    const sourceRelations = this.relations.get(sourceId)!;

    const existingIndex = sourceRelations.findIndex(
      (r) => r.targetId === targetId && r.relationType === relationType
    );

    if (existingIndex >= 0) {
      sourceRelations[existingIndex].strength = strength;
      sourceRelations[existingIndex].createdAt = Date.now();
    } else {
      if (sourceRelations.length < this.maxRelationsPerMemory) {
        sourceRelations.push(relation);
      } else {
        logger.warn(`Memory ${sourceId} has reached max relations limit`);
      }
    }

    if (!this.reverseRelations.has(targetId)) {
      this.reverseRelations.set(targetId, []);
    }
    this.reverseRelations.get(targetId)!.push({
      ...relation,
      sourceId: targetId,
      targetId: sourceId,
    });
  }

  /**
   * 批量添加关联
   */
  addRelations(relations: MemoryRelation[]): void {
    for (const relation of relations) {
      this.addRelation(relation);
    }
  }

  /**
   * 移除记忆的所有关联
   */
  removeMemory(memoryId: string): void {
    const forwardRelations = this.relations.get(memoryId) || [];
    for (const relation of forwardRelations) {
      const reverse = this.reverseRelations.get(relation.targetId) || [];
      const filtered = reverse.filter((r) => r.targetId !== memoryId);
      if (filtered.length > 0) {
        this.reverseRelations.set(relation.targetId, filtered);
      } else {
        this.reverseRelations.delete(relation.targetId);
      }
    }
    this.relations.delete(memoryId);

    const reverseRelations = this.reverseRelations.get(memoryId) || [];
    for (const relation of reverseRelations) {
      const forward = this.relations.get(relation.targetId) || [];
      const filtered = forward.filter((r) => r.targetId !== memoryId);
      if (filtered.length > 0) {
        this.relations.set(relation.targetId, filtered);
      } else {
        this.relations.delete(relation.targetId);
      }
    }
    this.reverseRelations.delete(memoryId);
  }

  /**
   * 获取记忆的直接关联
   */
  getDirectRelations(memoryId: string): MemoryRelation[] {
    return this.relations.get(memoryId) || [];
  }

  /**
   * 获取记忆的反向关联
   */
  getReverseRelations(memoryId: string): MemoryRelation[] {
    return this.reverseRelations.get(memoryId) || [];
  }

  /**
   * 递归获取关联记忆
   */
  getRelatedMemories(
    memoryId: string,
    options: {
      maxDepth?: number;
      includeReverse?: boolean;
      minStrength?: number;
      relationTypes?: RelationType[];
    } = {}
  ): Map<
    string,
    { memoryId: string; depth: number; strength: number; path: string[] }
  > {
    const {
      maxDepth = this.maxDepth,
      includeReverse = true,
      minStrength = 0,
      relationTypes,
    } = options;

    const result = new Map<
      string,
      { memoryId: string; depth: number; strength: number; path: string[] }
    >();
    const visited = new Set<string>();
    const queue: Array<{
      id: string;
      depth: number;
      strength: number;
      path: string[];
    }> = [];

    const directRelations = this.relations.get(memoryId) || [];
    for (const relation of directRelations) {
      if (relation.strength < minStrength) continue;
      if (relationTypes && !relationTypes.includes(relation.relationType))
        continue;

      queue.push({
        id: relation.targetId,
        depth: 1,
        strength: relation.strength,
        path: [memoryId, relation.targetId],
      });
    }

    if (includeReverse) {
      const reverse = this.reverseRelations.get(memoryId) || [];
      for (const relation of reverse) {
        if (relation.strength < minStrength) continue;
        if (relationTypes && !relationTypes.includes(relation.relationType))
          continue;

        queue.push({
          id: relation.targetId,
          depth: 1,
          strength: relation.strength,
          path: [memoryId, relation.targetId],
        });
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) continue;
      visited.add(current.id);

      result.set(current.id, {
        memoryId: current.id,
        depth: current.depth,
        strength: current.strength,
        path: current.path,
      });

      if (current.depth >= maxDepth) continue;

      const nextRelations = this.relations.get(current.id) || [];
      for (const relation of nextRelations) {
        if (visited.has(relation.targetId)) continue;
        if (relation.strength < minStrength) continue;
        if (relationTypes && !relationTypes.includes(relation.relationType))
          continue;

        queue.push({
          id: relation.targetId,
          depth: current.depth + 1,
          strength: Math.min(current.strength, relation.strength),
          path: [...current.path, relation.targetId],
        });
      }
    }

    return result;
  }

  /**
   * 查找两个记忆之间的关联路径
   */
  findPath(sourceId: string, targetId: string): string[] | null {
    if (sourceId === targetId) return [sourceId];

    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [];

    queue.push({ id: sourceId, path: [sourceId] });

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) continue;
      visited.add(current.id);

      const relations = this.relations.get(current.id) || [];
      for (const relation of relations) {
        if (relation.targetId === targetId) {
          return [...current.path, targetId];
        }

        if (!visited.has(relation.targetId)) {
          queue.push({
            id: relation.targetId,
            path: [...current.path, relation.targetId],
          });
        }
      }
    }

    return null;
  }

  /**
   * 检查是否存在循环关联
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const relations = this.relations.get(nodeId) || [];
      for (const relation of relations) {
        if (!visited.has(relation.targetId)) {
          if (dfs(relation.targetId)) return true;
        } else if (recursionStack.has(relation.targetId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    const nodeIds = Array.from(this.relations.keys());
    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * 获取网络统计信息
   */
  getStats(): RelationNetworkStats {
    const allMemoryIds = new Set([
      ...Array.from(this.relations.keys()),
      ...Array.from(this.reverseRelations.keys()),
    ]);

    const totalMemories = allMemoryIds.size;
    let totalRelations = 0;
    const mostConnectedMemory = { id: '', count: 0 };
    const relationTypeDistribution: Record<RelationType, number> = {
      tag: 0,
      content: 0,
      reference: 0,
      temporal: 0,
      project: 0,
    };

    const relationKeys = Array.from(this.relations.keys());
    for (const memoryId of relationKeys) {
      const relations = this.relations.get(memoryId) || [];
      totalRelations += relations.length;

      if (relations.length > mostConnectedMemory.count) {
        mostConnectedMemory.id = memoryId;
        mostConnectedMemory.count = relations.length;
      }

      for (const relation of relations) {
        relationTypeDistribution[relation.relationType]++;
      }
    }

    return {
      totalMemories,
      totalRelations,
      avgRelationsPerMemory:
        totalMemories > 0 ? totalRelations / totalMemories : 0,
      mostConnectedMemory:
        mostConnectedMemory.count > 0 ? mostConnectedMemory.id : null,
      relationTypeDistribution,
    };
  }

  /**
   * 清除所有关联
   */
  clear(): void {
    this.relations.clear();
    this.reverseRelations.clear();
  }

  /**
   * 序列化
   */
  serialize(): MemoryRelation[] {
    const result: MemoryRelation[] = [];
    const relationValues = Array.from(this.relations.values());
    for (const relations of relationValues) {
      result.push(...relations);
    }
    return result;
  }

  /**
   * 反序列化
   */
  deserialize(relations: MemoryRelation[]): void {
    this.clear();
    this.addRelations(relations);
  }

  /**
   * 获取所有关联的记忆ID
   */
  getAllRelatedMemoryIds(memoryId: string): Set<string> {
    const related = this.getRelatedMemories(memoryId);
    return new Set(related.keys());
  }

  /**
   * 计算两个记忆的相似度
   */
  calculateSimilarity(memoryId1: string, memoryId2: string): number {
    const related1 = this.getAllRelatedMemoryIds(memoryId1);
    const related2 = this.getAllRelatedMemoryIds(memoryId2);

    const related1Array = Array.from(related1);
    const related2Array = Array.from(related2);

    const intersection = new Set(
      related1Array.filter((id) => related2.has(id))
    );
    const union = new Set([...related1Array, ...related2Array]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

/**
 * 关联网络单例
 */
export const memoryRelationGraph = new MemoryRelationGraph();
