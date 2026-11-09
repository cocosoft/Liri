// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-10）：阶段交付物投影 —— 不得把"步骤描述（指令）"当成"事实"下传到下一阶段。
 */

import { describe, expect, it } from 'bun:test';
import {
  formatStageDeliverable,
  projectStageDeliverable,
} from '../../src/tasks/stageDeliverable';

describe('P1：阶段交付物投影', () => {
  it('只收已完成步骤的结果为事实，未完成步骤的输出不算"已成立"', () => {
    const deliverable = projectStageDeliverable({
      goal: '产出需求规格',
      steps: [
        { status: 'completed', result: 'PRD 已写入 prd.md' },
        { status: 'failed', result: '半截内容' },
      ],
    });
    expect(deliverable.facts).toEqual(['PRD 已写入 prd.md']);
  });

  it('验收标准与产物台账保序去重', () => {
    const deliverable = projectStageDeliverable({
      steps: [
        {
          acceptanceCriteria: 'file_read 读取 prd.md 含七章',
          artifacts: ['prd.md'],
        },
        {
          acceptanceCriteria: 'file_read 读取 prd.md 含七章',
          artifacts: ['prd.md', 'design.md'],
        },
      ],
    });
    expect(deliverable.criteria).toEqual(['file_read 读取 prd.md 含七章']);
    expect(deliverable.artifacts).toEqual(['prd.md', 'design.md']);
  });

  it('超长结果按 200 字截断（防把下一阶段 prompt 吃满）', () => {
    const deliverable = projectStageDeliverable({
      steps: [{ status: 'completed', result: 'x'.repeat(500) }],
    });
    expect(deliverable.facts[0]!.length).toBe(201);
    expect(deliverable.facts[0]!.endsWith('…')).toBe(true);
  });

  it('提示词投影带"禁止重复创建"契约，且不含步骤描述', () => {
    const text = formatStageDeliverable(
      projectStageDeliverable({
        goal: '产出需求规格',
        steps: [
          {
            status: 'completed',
            result: 'PRD 已写入 prd.md',
            artifacts: ['prd.md'],
            acceptanceCriteria: 'file_read 读取 prd.md 含七章',
          },
        ],
      })
    );
    expect(text).toContain('已成立事实（禁止重复创建/重新实现）');
    expect(text).toContain('产物（已存在）：prd.md');
    expect(text).toContain('file_read 读取 prd.md 含七章');
    expect(text).toContain('PRD 已写入 prd.md');
  });
});
