// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D4 二期 · ③-B：Council 按议题选人（确定性）。
 *
 * 锁定语义：
 * - topic 为空 ⇒ 原样返回（与改动前一致）；
 * - 有专家命中 ⇒ 命中专家 + 通才（expertise 为空）；
 * - 无专家命中 ⇒ **返回全部**（fail-open，Council 仍能开）；
 * - 保持入参顺序、不做打分（无置信度事实源）。
 */

import { describe, expect, it } from 'bun:test';
import { selectAgentsForTopic } from '../../src/workspace/councilSelection';

const AGENTS = [
  { agentId: 'market', expertise: ['市场规模', '竞品分析'] },
  { agentId: 'arch', expertise: ['系统架构', '性能优化'] },
  { agentId: 'legal', expertise: ['合规', '隐私'] },
  { agentId: 'general', expertise: [] },
];

const ids = (agents: ReadonlyArray<{ agentId: string }>) =>
  agents.map((a) => a.agentId);

describe('selectAgentsForTopic', () => {
  it('topic 为空 ⇒ 原样返回全部', () => {
    expect(ids(selectAgentsForTopic(AGENTS))).toEqual([
      'market',
      'arch',
      'legal',
      'general',
    ]);
    expect(ids(selectAgentsForTopic(AGENTS, '   '))).toEqual([
      'market',
      'arch',
      'legal',
      'general',
    ]);
  });

  it('命中专家 ⇒ 专家 + 通才（保持入参顺序）', () => {
    expect(
      ids(selectAgentsForTopic(AGENTS, '请评估系统架构与性能优化方案'))
    ).toEqual(['arch', 'general']);
    expect(ids(selectAgentsForTopic(AGENTS, '竞品分析怎么做'))).toEqual([
      'market',
      'general',
    ]);
  });

  it('大小写 / 空格归一（英文议题）', () => {
    const agents = [{ agentId: 'a', expertise: ['API Design'] }];
    expect(ids(selectAgentsForTopic(agents, 'review the api design'))).toEqual([
      'a',
    ]);
  });

  it('无专家命中 ⇒ fail-open 返回全部（不静默收窄）', () => {
    expect(ids(selectAgentsForTopic(AGENTS, '今天天气不错'))).toEqual([
      'market',
      'arch',
      'legal',
      'general',
    ]);
  });

  it('领域词过短（<2 字符）视为噪声，不参与匹配', () => {
    const agents = [{ agentId: 'x', expertise: ['A'] }];
    expect(ids(selectAgentsForTopic(agents, 'A 方案'))).toEqual(['x']);
  });
});
