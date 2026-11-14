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
 * SkillProvider 统一技能来源契约
 *
 * 对齐 deepseek-harness `packages/skill/skill` 的 Provider 抽象：
 * - list() 发现候选（含 rank 优先级 + locator 私有句柄）
 * - get(candidate) 加载完整技能
 * - invalidate() 使缓存失效（当前加载器无缓存，预留契约）
 *
 * 现有 4 个来源加载器 + 第三方适配器均实现本接口；
 * 新增技能来源只需实现 SkillProvider 并加入聚合数组。
 */

import type { Skill } from '../types/index.js';
import { SkillSource } from '../types/index.js';

/**
 * 技能来源优先级（低值优先）
 * 对齐现有加载顺序语义：后加载者同名覆盖前序（Bundled → user → project → plugin → mcp）
 */
export const PROVIDER_RANK = {
  /** MCP 服务器技能（最后加载，覆盖前序） */
  MCP: 10,
  /** 第三方市场适配器技能（ClawHub 等） */
  ADAPTER: 20,
  /** 插件声明技能 */
  PLUGIN: 30,
  /** 官方发布技能（项目数据目录） */
  OFFICIAL: 50,
  /** 用户技能（~/.pyapp/skills） */
  USER: 70,
  /** 内置技能（最先加载，被后续覆盖） */
  BUILTIN: 90,
} as const;

/**
 * 技能候选 — 发现阶段的目录条目
 * locator 为 Provider 私有句柄，get(candidate) 时原样传回
 */
export interface SkillCandidate {
  name: string;
  description?: string;
  source: SkillSource;
  /** 来源优先级（低值优先，重名时决定胜者） */
  rank: number;
  /** Provider 私有句柄 */
  locator: unknown;
}

/**
 * 技能来源提供者（统一抽象）
 * 新增技能来源只需实现本接口，无需改动 SkillRegistry 消费方
 */
export interface SkillProvider {
  /** 唯一名称（如 'bundled' / 'file:user' / 'mcp' / 'clawhub'） */
  readonly name: string;
  /** 列出当前来源可用的技能候选 */
  list(): Promise<SkillCandidate[]>;
  /** 按候选加载完整技能（候选失效返回 undefined） */
  get(candidate: SkillCandidate): Promise<Skill | undefined>;
  /** 使内部缓存失效（当前加载器无缓存，契约预留） */
  invalidate(): void;
}

/**
 * 将 loadSkills 结果桥接为候选列表
 * 当前全量加载语义下 locator 即 Skill 本体
 */
export function toCandidates(skills: Skill[], rank: number): SkillCandidate[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    rank,
    locator: skill,
  }));
}

/**
 * 聚合多个 Provider：按 Provider 顺序 list + get，同名后者覆盖
 * 等价现有「loaders 数组 → registerBatch」的顺序语义，可安全替换
 *
 * L1（2026-09-01）：可选 `sortByRank`——开启后按候选 rank 降序处理
 * （rank 高先入、rank 低后入覆盖 = 低 rank 优先），与传入顺序无关。
 * 默认 false 保持现状零回归。
 */
export async function collectSkillsFromProviders(
  providers: readonly SkillProvider[],
  options?: { sortByRank?: boolean }
): Promise<Skill[]> {
  const entries: Array<{
    provider: SkillProvider;
    candidates: SkillCandidate[];
  }> = [];
  for (const provider of providers) {
    entries.push({ provider, candidates: await provider.list() });
  }

  if (options?.sortByRank) {
    // rank 低值优先：降序处理（高 rank 先入、低 rank 后入覆盖）
    entries.sort((a, b) => {
      const ra = a.candidates[0]?.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.candidates[0]?.rank ?? Number.MAX_SAFE_INTEGER;
      return rb - ra;
    });
  }

  const merged = new Map<string, Skill>();
  for (const { provider, candidates } of entries) {
    for (const candidate of candidates) {
      const skill = await provider.get(candidate);
      if (skill) merged.set(skill.name, skill);
    }
  }
  return Array.from(merged.values());
}
