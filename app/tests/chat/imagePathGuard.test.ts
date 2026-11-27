// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 图像输入路径守卫（`chat/services/imagePathGuard.ts`）回归。
 *
 * P1-2（2026-11-28，真机 `session_mwz477wj251057474e`）：模型用 `file_write` 把 SVG 写进
 * **会话工作区**（写入已被工作区授权放行），随后 `image convert` 以
 * `not in known image paths` 拒绝 —— 只能继续用 bash 找渲染器（38 次调用 / 15 次失败 / 熔断）。
 * 现口径：工作区内的绝对路径直接放行；工作区外未登记路径仍拒绝。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';

import { guardImageInputPath } from '../../src/chat/services/imagePathGuard';
import type { ImagePathGuardDeps } from '../../src/chat/services/imagePathGuard';

const WS = join(tmpdir(), 'liri-image-guard-ws');
const INSIDE = join(WS, 'output', 'pelican-bicycle.svg');
const OUTSIDE = join(tmpdir(), 'liri-image-guard-other', 'unknown.png');
const KNOWN = join(tmpdir(), 'liri-image-guard-media', 'uploaded.png');

function makeDeps(over: Partial<ImagePathGuardDeps> = {}): ImagePathGuardDeps {
  return {
    imageContextService: {
      getImageContext: () => undefined,
      // 非空 ⇒ 走"已知集合"判定（空集合是恒放行的短路分支）
      getKnownImagePaths: () => [KNOWN],
      findClosestPath: () => null,
    },
    getSession: () => undefined,
    ...over,
  };
}

function call(inputPath: string, deps: ImagePathGuardDeps) {
  return guardImageInputPath({
    toolCall: { id: 'tc-1', name: 'image', sessionId: 'sess-guard' },
    args: { action: 'convert', inputPath },
    deps,
  });
}

describe('guardImageInputPath · P1-2 工作区内图件放行', () => {
  it('工作区内绝对路径 ⇒ 放行（不修正、不拒绝）', async () => {
    const outcome = await call(
      INSIDE,
      makeDeps({ getSessionWorkspacePath: () => WS })
    );
    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toBeUndefined();
  });

  it('未注入工作区解析 ⇒ 保持旧行为（工作区路径仍按已知集合拒绝）', async () => {
    const outcome = await call(INSIDE, makeDeps());
    expect(outcome.result).not.toBeNull();
    expect(String(outcome.result?.error ?? '')).toContain(
      'not in known image paths'
    );
  });

  it('工作区外且无最接近匹配 ⇒ 仍拒绝（不放宽越界面）', async () => {
    const outcome = await call(
      OUTSIDE,
      makeDeps({ getSessionWorkspacePath: () => WS })
    );
    expect(outcome.result).not.toBeNull();
    expect(outcome.result?.toolName).toBe('image');
  });

  it('相对路径不触发工作区放行（同一 worktree 内的相对路径仍走已知集合）', async () => {
    const outcome = await call(
      join('output', 'pelican-bicycle.svg'),
      makeDeps({ getSessionWorkspacePath: () => WS })
    );
    expect(outcome.result).not.toBeNull();
  });

  it('非图像工具 ⇒ 守卫不介入（零行为变更）', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'tc-2', name: 'file_read', sessionId: 'sess-guard' },
      args: { inputPath: OUTSIDE },
      deps: makeDeps({ getSessionWorkspacePath: () => WS }),
    });
    expect(outcome.result).toBeNull();
  });
});
