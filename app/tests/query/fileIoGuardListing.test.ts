// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 文件 IO 守卫：**只读**重复访问不硬拦（2026-11-09 `pdca_mw8lrnmb`；2026-11-10 `pdca_mwair2wg`）
 *
 * 真机现场 ①：step_10 的职责是"用 glob 列出工作区产物做交付前检查"，模型在每次写入后重新列举，
 * 第 4 次同目标命中 `fileIOBlock=4` ⇒ `文件IO循环已被阻止` ⇒ 整步 `aborted / failed(non_converged)`。
 * 真机现场 ②（2026-11-10）：设计步连续读同一份 `需求说明.md` ×4 ⇒ `terminationReason=io_loop`
 * ⇒ 设计产物缺失 ⇒ 目标门 `PDCA_GOAL_NOT_CONVERGED`。
 *
 * 口径：`glob`（列举）、`grep`（检索）与 `file_read`（内容读）这类**只读无副作用**访问最多
 * 警告 + 就地 steer（永不硬拦）；写类口径不变。
 */

import { describe, expect, it } from 'bun:test';
import { guardFileIoAccesses } from '@modules/query/taor/helpers.js';
import type { FileIOLoopDetector } from '@modules/query/FileIOLoopDetector.js';

type Detector = Pick<FileIOLoopDetector, 'checkBeforeAccess'>;

/** 模拟"已到阻断阈值"的检测器 */
const blockedDetector = {
  checkBeforeAccess: () => ({
    blocked: true,
    warning: false,
    message: '[IO_REPEAT] 最近 6 次访问中，同一目标重复 ×4',
  }),
} as unknown as Detector;

/** 模拟"未到阈值"的检测器 */
const clearDetector = {
  checkBeforeAccess: () => ({ blocked: false, warning: false }),
} as unknown as Detector;

describe('文件 IO 守卫：只读列举降级为警告', () => {
  it('glob 命中阻断阈值 ⇒ 不进入 blocked，只给一次警告（含"基于已有结果作答"）', () => {
    const out = guardFileIoAccesses(
      [{ id: 'c1', name: 'glob', input: { path: 'C:/ws', pattern: '*' } }],
      blockedDetector,
      new Set()
    );
    expect(out.blocked).toHaveLength(0);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('基于已有结果作答');
  });

  it('同一目标只警告一次（同一 run 内不刷屏）', () => {
    const warned = new Set<string>();
    const first = guardFileIoAccesses(
      [{ id: 'c1', name: 'glob', input: { path: 'C:/ws', pattern: '*' } }],
      blockedDetector,
      warned
    );
    const second = guardFileIoAccesses(
      [{ id: 'c2', name: 'glob', input: { path: 'C:/ws', pattern: '*' } }],
      blockedDetector,
      warned
    );
    expect(first.warnings).toHaveLength(1);
    expect(second.warnings).toHaveLength(0);
  });

  it('file_read 命中阻断阈值 ⇒ 不进入 blocked，只给一次警告（内容读无副作用）', () => {
    const out = guardFileIoAccesses(
      [
        {
          id: 'c5',
          name: 'file_read',
          input: { file_path: 'C:/ws/需求说明.md' },
        },
      ],
      blockedDetector,
      new Set()
    );
    expect(out.blocked).toHaveLength(0);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('基于已有结果作答');
  });

  it('grep 命中阻断阈值 ⇒ 只读检索同样只警告、不 blocked', () => {
    const out = guardFileIoAccesses(
      [
        {
          id: 'c6',
          name: 'grep',
          input: { searchPath: 'C:/ws', pattern: 'TODO' },
        },
      ],
      blockedDetector,
      new Set()
    );
    expect(out.blocked).toHaveLength(0);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('基于已有结果作答');
  });

  it('读写类工具重复访问 ⇒ 仍然硬拦（口径不变）', () => {
    const out = guardFileIoAccesses(
      [{ id: 'c3', name: 'file_write', input: { file_path: 'C:/ws/a.js' } }],
      blockedDetector,
      new Set()
    );
    expect(out.blocked).toHaveLength(1);
    expect(out.warnings).toHaveLength(0);
  });

  it('未命中阻断 ⇒ 零输出（零行为变更）', () => {
    const out = guardFileIoAccesses(
      [{ id: 'c4', name: 'glob', input: { path: 'C:/ws', pattern: '*' } }],
      clearDetector,
      new Set()
    );
    expect(out.blocked).toHaveLength(0);
    expect(out.warnings).toHaveLength(0);
  });
});
