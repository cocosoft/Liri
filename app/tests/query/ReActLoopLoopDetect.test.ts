// MIT License
// Copyright (c) 2026 190615273@qq.com
// ReActLoop 无进展熔断判定（D 项）纯函数回归测试（2026-08-30）
// 直接测试 loopGuard 纯函数，规避 TAORLoop↔ReActLoop 深层循环依赖 TDZ。
// 覆盖：buildRoundSignature 排序拼接；isRepeatedLoop 连续相同判定/不同签名/阈值边界。

import { describe, expect, it } from 'bun:test';
import {
  buildRoundSignature,
  fileToolSignatureArgs,
  isRepeatedLoop,
} from '@modules/query/loopGuard';
import type { ActResult } from '@modules/query/ReActLoop';

function actResult(names: string[]): ActResult {
  return {
    results: names.map((name) => ({
      toolCallId: `id-${name}`,
      name,
      status: 'success' as const,
    })),
    allSucceeded: true,
    anyAborted: false,
  };
}

describe('buildRoundSignature（D 项）', () => {
  it('工具名排序拼接，与调用顺序无关', () => {
    const a = buildRoundSignature(actResult(['tool_search', 'config']));
    const b = buildRoundSignature(actResult(['config', 'tool_search']));
    expect(a).toBe(b);
    expect(a).toBe('config:success|tool_search:success');
  });

  it('状态差异改变签名', () => {
    const ok = buildRoundSignature(actResult(['sessions']));
    const fail: ActResult = {
      results: [
        {
          toolCallId: 'id-sessions',
          name: 'sessions',
          status: 'error',
          error: 'sessionId is required',
        },
      ],
      allSucceeded: false,
      anyAborted: false,
    };
    expect(buildRoundSignature(fail)).not.toBe(ok);
  });
});

describe('isRepeatedLoop（D 项）', () => {
  it('窗口尾部连续 threshold 轮相同 → true', () => {
    const sigs = ['a', 'b', 'b', 'b'];
    expect(isRepeatedLoop(sigs, 3)).toBe(true);
  });

  it('不足 threshold 轮 → false', () => {
    expect(isRepeatedLoop(['a', 'b'], 3)).toBe(false);
    expect(isRepeatedLoop([], 3)).toBe(false);
  });

  it('有不同签名 → false', () => {
    expect(isRepeatedLoop(['a', 'b', 'a'], 3)).toBe(false);
  });

  it('threshold <= 0 禁用 → false', () => {
    expect(isRepeatedLoop(['x', 'x', 'x'], 0)).toBe(false);
  });
});

/**
 * P1-2（2026-11-06）：`file_edit` 轮签名坍缩回归。
 *
 * 缺陷（真机 `session_mw4n94q10d049b6b3e`）：旧口径只取 `file_path` + `content.length`，
 * 而 `file_edit` 没有 `content` ⇒ 长度恒为 0 ⇒ 同文件的不同编辑签名完全相同
 * （`file_edit:success:{"contentLength":"0","file_path":…}`）⇒ 10 轮窗口内 3 次即
 * `no_progress` 熔断，实际三次编辑内容各不相同且全部成功。
 */
describe('file_edit 轮签名（P1-2）', () => {
  /** 按生产口径构造单工具轮的签名（ReActLoop 先经 fileToolSignatureArgs 归一化） */
  function sigOf(name: string, input: Record<string, unknown>): string {
    return buildRoundSignature({
      results: [{ name, status: 'success', toolCallId: `id-${name}` }],
      toolInputs: [{ id: `id-${name}`, input: fileToolSignatureArgs(input) }],
    });
  }

  const file = 'E:\\proj\\scripts\\simulate.ts';

  it('同文件的三次不同编辑 → 三个不同签名（不再被判无进展）', () => {
    const sigs = [
      sigOf('file_edit', {
        file_path: file,
        old_string: 'let maxPieceCount = 0;',
        new_string: 'let maxPieceCount = 0;\nlet capped = 0;',
      }),
      sigOf('file_edit', {
        file_path: file,
        old_string: "    console.log('单局最多方块');",
        new_string: "    console.log('单局最多方块  :', stats.maxPieceCount);",
      }),
      sigOf('file_edit', {
        file_path: file,
        old_string: 'if (e.status === "over")',
        new_string: 'if (e.status === "playing") capped++',
      }),
    ];
    expect(new Set(sigs).size).toBe(3);
    expect(isRepeatedLoop(sigs, 3)).toBe(false);
  });

  it('同一处同一改法重复三次 → 同签名（真无进展仍熔断）', () => {
    const same = {
      file_path: file,
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    };
    const sigs = [
      sigOf('file_edit', same),
      sigOf('file_edit', same),
      sigOf('file_edit', same),
    ];
    expect(new Set(sigs).size).toBe(1);
    expect(isRepeatedLoop(sigs, 3)).toBe(true);
  });

  it('仅 replace_all 不同 → 签名不同（替换范围是不同动作）', () => {
    const base = { file_path: file, old_string: 'a', new_string: 'b' };
    expect(sigOf('file_edit', base)).not.toBe(
      sigOf('file_edit', { ...base, replace_all: true })
    );
  });

  it('file_write 仍按内容长度区分（既有 P15 口径不回退）', () => {
    const write = (content: string) =>
      sigOf('file_write', { file_path: file, content });
    expect(write('abc')).not.toBe(write('abcdef'));
    expect(write('abc')).toBe(write('xyz')); // 同长度同签名（沿用既有口径）
  });
});
