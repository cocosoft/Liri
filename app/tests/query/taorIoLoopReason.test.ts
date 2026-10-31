// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `buildFileIoBlockReason` —— 文件 IO 循环拦截的模型可见文案（2026-10-31）。
 *
 * 口径（用户裁定）：**维持 abort 整轮**，仅补可观测。原文案是常量
 * 「文件IO循环已被阻止」⇒ 模型无法分辨「同一路径重复」还是「同一 pattern 重复」，
 * 只能原样重试。现文案带检测器明细（`[IO] 连续读 … ×N`）、pattern 与可操作方向。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildFileIoBlockReason,
  toFileIoLoopBlocked,
} from '../../src/query/taor/helpers';

describe('buildFileIoBlockReason', () => {
  it('带 pattern：含明细、pattern 与改道建议', () => {
    const reason = buildFileIoBlockReason('[IO] 连续读 E:/proj ×4', 'src/**');
    expect(reason).toContain('文件IO循环已被阻止（本次调用未执行）');
    expect(reason).toContain('[IO] 连续读 E:/proj ×4');
    expect(reason).toContain('pattern=src/**');
    expect(reason).toContain('整轮已终止');
    expect(reason).toContain('请改用不同的 pattern/路径');
  });

  it('无 pattern（file_read 等）：不出现 pattern 段，其余一致', () => {
    const reason = buildFileIoBlockReason('[IO] 连续读 a.md ×4');
    expect(reason).toContain('[IO] 连续读 a.md ×4');
    expect(reason).not.toContain('pattern=');
    expect(reason).toContain('整轮已终止');
  });
});

describe('toFileIoLoopBlocked', () => {
  it('从入参提取 pattern 并产出拦截条目（id/name/reason 齐全）', () => {
    const entry = toFileIoLoopBlocked(
      {
        id: 'call_1',
        name: 'glob',
        input: { pattern: 'src/**', path: 'E:/proj' },
      },
      'E:/proj',
      '[IO] 连续读 E:/proj ×4'
    );
    expect(entry.id).toBe('call_1');
    expect(entry.name).toBe('glob');
    expect(entry.reason).toContain('[IO] 连续读 E:/proj ×4');
    expect(entry.reason).toContain('pattern=src/**');
  });

  it('入参非字符串 pattern ⇒ 不臆造 pattern 段', () => {
    const entry = toFileIoLoopBlocked(
      { id: 'call_2', name: 'file_read', input: { pattern: 42 } },
      'a.md'
    );
    expect(entry.reason).not.toContain('pattern=');
    expect(entry.reason).toContain('连续重复访问');
  });
});
