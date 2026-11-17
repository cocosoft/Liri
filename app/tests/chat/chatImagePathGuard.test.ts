// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `guardImageInputPath` 的特征化测试（2026-11-17，T3 复杂度清理 stage 4）。
 *
 * 背景：`ToolExecutionService._executeInternal` 的「图像路径校验」整段搬出为
 * `chat/services/imagePathGuard.ts`（依赖注入图像上下文与会话读取）。
 *
 * 钉住的行为：
 *  ① 非图像工具 / 无会话 ⇒ 放行，且不读取图像上下文；
 *  ② `inputPath` 缺省 ⇒ 从图像上下文补全（`image` 工具优先「最近编辑」，其余优先「最近分析」）；
 *  ③ `canvas` 的 `elements[0].src` 可作 `inputPath`；
 *  ④ 路径不在已知集合 ⇒ 自动修正到最接近路径（返回 `patchedArgs`）；
 *  ⑤ 无法修正 ⇒ 拒绝执行（`Invalid path: …`）；
 *  ⑥ 已知集合为空 ⇒ 放行（不因"无参照"拒绝）。
 */
import { describe, expect, it } from 'bun:test';

import { guardImageInputPath } from '../../src/chat/services/imagePathGuard';
import type { ImagePathGuardDeps } from '../../src/chat/services/imagePathGuard';

function makeDeps(partial: {
  knownPaths?: string[];
  closest?: string | null;
  context?: Record<string, unknown>;
  session?: unknown;
  calls?: string[];
}): ImagePathGuardDeps {
  const calls = partial.calls ?? [];
  return {
    imageContextService: {
      getImageContext: ((_sid: string) => {
        calls.push('getImageContext');
        return partial.context as never;
      }) as never,
      getKnownImagePaths: ((_sid: string) => {
        calls.push('getKnownImagePaths');
        return partial.knownPaths ?? [];
      }) as never,
      findClosestPath: ((_input: string, _known: string[]) => {
        calls.push('findClosestPath');
        return (partial.closest ?? null) as never;
      }) as never,
    },
    getSession: (() => {
      calls.push('getSession');
      return partial.session as never;
    }) as never,
  };
}

const baseArgs = { inputPath: '/imgs/a.png' };

describe('guardImageInputPath：图像输入路径守卫（特征化）', () => {
  it('① 非图像工具 ⇒ 放行且不读取图像上下文', async () => {
    const calls: string[] = [];
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c1', name: 'file_read', sessionId: 's1' },
      args: baseArgs,
      deps: makeDeps({ calls }),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('② 无 inputPath + image 工具 ⇒ 用「最近编辑」补全', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c2', name: 'image', sessionId: 's2' },
      args: {},
      deps: makeDeps({
        context: {
          lastEditedImage: { filePath: '/imgs/edited.png' },
          lastAnalyzedImage: { filePath: '/imgs/analyzed.png' },
        },
        knownPaths: ['/imgs/edited.png'],
      }),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toMatchObject({
      inputPath: '/imgs/edited.png',
    });
  });

  it('② 无 inputPath + image_analysis ⇒ 优先「最近分析」', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c3', name: 'image_analysis', sessionId: 's3' },
      args: {},
      deps: makeDeps({
        context: {
          lastEditedImage: { filePath: '/imgs/edited.png' },
          lastAnalyzedImage: { filePath: '/imgs/analyzed.png' },
        },
        knownPaths: ['/imgs/analyzed.png'],
      }),
    });

    expect(outcome.patchedArgs).toMatchObject({
      inputPath: '/imgs/analyzed.png',
    });
  });

  it('③ canvas 的 elements[0].src 作为 inputPath', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c4', name: 'canvas', sessionId: 's4' },
      args: { elements: [{ src: '/imgs/canvas.png' }] },
      deps: makeDeps({ knownPaths: ['/imgs/canvas.png'] }),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toBeUndefined();
  });

  it('④ 路径不在已知集合 ⇒ 修正到最接近路径', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c5', name: 'image', sessionId: 's5' },
      args: { inputPath: '/imgs/typo.png' },
      deps: makeDeps({
        knownPaths: ['/imgs/real.png'],
        closest: '/imgs/real.png',
      }),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toMatchObject({ inputPath: '/imgs/real.png' });
  });

  it('⑤ 无法修正 ⇒ 拒绝执行并回可读错误', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c6', name: 'image', sessionId: 's6' },
      args: { inputPath: '/imgs/unknown.png' },
      deps: makeDeps({ knownPaths: ['/imgs/real.png'], closest: null }),
    });

    expect(outcome.result).toMatchObject({
      toolCallId: 'c6',
      toolName: 'image',
      result: null,
    });
    expect(String(outcome.result?.error)).toContain('Invalid path');
  });

  it('⑥ 已知集合为空 ⇒ 放行（不因无参照拒绝）', async () => {
    const outcome = await guardImageInputPath({
      toolCall: { id: 'c7', name: 'image', sessionId: 's7' },
      args: { inputPath: '/imgs/any.png' },
      deps: makeDeps({ knownPaths: [] }),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.patchedArgs).toBeUndefined();
  });
});
