// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SkillMemoryGraph — 技能×记忆学习图谱（P1-7，对标 Hermes learning_graph build_learning_graph）
 *
 * 以技能为节点、记忆卡片为目标建立关联（技能 → 相关记忆），支持双向查询：
 *   - getMemoriesForSkill(skillId)：技能关联的记忆（检索时按技能召回相关上下文）
 *   - getSkillsForMemory(memoryId)：记忆关联的技能（推断记忆可复用的技能）
 *   - buildFromMemories(memories, skillNames)：从记忆 tags 自动构建（技能名与 tag 匹配）
 *
 * 数据结构独立（不依赖记忆系统内部实现），内存图谱；持久化由调用方按需落盘。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('memory:utils:skillMemoryGraph');

/** 技能↔记忆关联来源 */
export type SkillMemorySource = 'tag' | 'manual';

/** 技能↔记忆关联边 */
export interface SkillMemoryLink {
  skillId: string;
  memoryId: string;
  strength: number;
  source: SkillMemorySource;
  createdAt: number;
}

/** 自动构建输入（最小记忆视图，tags 为关联依据） */
export interface SkillMemorySourceItem {
  id: string;
  tags?: string[];
}

/** 图谱统计 */
export interface SkillMemoryGraphStats {
  skillCount: number;
  memoryCount: number;
  linkCount: number;
  avgMemoriesPerSkill: number;
}

/**
 * 技能×记忆学习图谱（无状态可复用；内部双向索引）
 */
export class SkillMemoryGraph {
  private skillToMemories: Map<string, Map<string, SkillMemoryLink>> =
    new Map();
  private memoryToSkills: Map<string, Map<string, SkillMemoryLink>> = new Map();

  /** 建立技能↔记忆双向关联（同一对已存在时覆盖 strength/source） */
  addLink(
    skillId: string,
    memoryId: string,
    strength = 1,
    source: SkillMemorySource = 'manual'
  ): void {
    const link: SkillMemoryLink = {
      skillId,
      memoryId,
      strength,
      source,
      createdAt: Date.now(),
    };
    if (!this.skillToMemories.has(skillId)) {
      this.skillToMemories.set(skillId, new Map());
    }
    this.skillToMemories.get(skillId)!.set(memoryId, link);
    if (!this.memoryToSkills.has(memoryId)) {
      this.memoryToSkills.set(memoryId, new Map());
    }
    this.memoryToSkills.get(memoryId)!.set(skillId, link);
  }

  /** 移除技能↔记忆关联 */
  removeLink(skillId: string, memoryId: string): void {
    this.skillToMemories.get(skillId)?.delete(memoryId);
    this.memoryToSkills.get(memoryId)?.delete(skillId);
  }

  /** 技能关联的全部记忆 */
  getMemoriesForSkill(skillId: string): SkillMemoryLink[] {
    return Array.from(this.skillToMemories.get(skillId)?.values() ?? []).sort(
      (a, b) => b.strength - a.strength
    );
  }

  /** 记忆关联的全部技能 */
  getSkillsForMemory(memoryId: string): SkillMemoryLink[] {
    return Array.from(this.memoryToSkills.get(memoryId)?.values() ?? []);
  }

  /** 图谱中的全部技能 ID */
  getSkills(): string[] {
    return Array.from(this.skillToMemories.keys());
  }

  /** 图谱中的全部记忆 ID */
  getMemories(): string[] {
    return Array.from(this.memoryToSkills.keys());
  }

  /**
   * 从记忆集合自动构建技能关联（对标 Hermes build_learning_graph）：
   * 记忆 tags 与技能名不区分大小写匹配 → 建立 source='tag' 关联。
   * @returns 新建关联数
   */
  buildFromMemories(
    memories: SkillMemorySourceItem[],
    skillNames: string[]
  ): number {
    const normalizedSkills = skillNames.map((s) => s.toLowerCase());
    let added = 0;
    for (const mem of memories) {
      const tags = (mem.tags ?? []).map((t) => t.toLowerCase());
      for (let i = 0; i < normalizedSkills.length; i++) {
        if (tags.includes(normalizedSkills[i])) {
          this.addLink(skillNames[i], mem.id, 1, 'tag');
          added++;
        }
      }
    }
    if (added > 0) {
      logger.info('技能×记忆图谱自动构建完成', {
        added,
        memories: memories.length,
        skills: skillNames.length,
      });
    }
    return added;
  }

  /** 图谱统计 */
  stats(): SkillMemoryGraphStats {
    const skills = this.getSkills();
    const memories = this.getMemories();
    const totalLinks = skills.reduce(
      (acc, s) => acc + (this.skillToMemories.get(s)?.size ?? 0),
      0
    );
    return {
      skillCount: skills.length,
      memoryCount: memories.length,
      linkCount: totalLinks,
      avgMemoriesPerSkill: skills.length > 0 ? totalLinks / skills.length : 0,
    };
  }
}
