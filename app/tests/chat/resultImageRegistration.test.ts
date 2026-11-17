// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `registerImageToolResults` 的特征化测试（2026-11-17，T3 复杂度清理 stage 7）。
 *
 * 钉住的行为：
 *  ① 无结果数据 / 有错误 / 无会话 ⇒ 完全不触碰图像上下文与事件总线；
 *  ② 结果含图像路径 ⇒ 登记路径 + 更新会话图像上下文；
 *  ③ `glob` 的数组结果 ⇒ 回填目录清单（用于后续路径纠错）；
 *  ④ 媒体交付类工具 ⇒ 广播 `tool:completed`（携带 images/resultData）；普通工具不广播。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import * as notificationModule from '../../src/chat/services/EventNotificationService';
import { registerImageToolResults } from '../../src/chat/services/imageResultRegistration';

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function makeDeps(calls: string[]) {
  return {
    imageContextService: {
      extractImagePathsFromResult: (name: string) => {
        calls.push(`extract:${name}`);
        return ['/imgs/out.png'];
      },
      registerImagePaths: (_sid: string, paths: string[]) => {
        calls.push(`register:${paths.join(',')}`);
      },
      updateImageContext: (sid: string, name: string) => {
        calls.push(`update:${sid}:${name}`);
      },
      confirmedPaths: {
        addDirectoryListing: (dir: string, list: string[]) => {
          calls.push(`listing:${dir}:${list.length}`);
        },
      },
    } as never,
  };
}

const toolCall = { id: 'c1', name: 'image_svg_generate', sessionId: 's1' };

describe('registerImageToolResults：图像结果登记与媒体事件（特征化）', () => {
  it('① 无结果数据 ⇒ 不触碰图像上下文', () => {
    const calls: string[] = [];
    registerImageToolResults({
      toolCall,
      args: {},
      resultData: undefined,
      hasError: false,
      deps: makeDeps(calls),
    });

    expect(calls).toEqual([]);
  });

  it('① 有错误 / 无会话 ⇒ 不触碰图像上下文', () => {
    const calls: string[] = [];

    registerImageToolResults({
      toolCall,
      args: {},
      resultData: { images: [] },
      hasError: true,
      deps: makeDeps(calls),
    });
    registerImageToolResults({
      toolCall: { id: 'c2', name: 'image', sessionId: undefined },
      args: {},
      resultData: { images: [] },
      hasError: false,
      deps: makeDeps(calls),
    });

    expect(calls).toEqual([]);
  });

  it('② 成功结果 ⇒ 登记路径并更新上下文', () => {
    const calls: string[] = [];
    registerImageToolResults({
      toolCall,
      args: { prompt: 'x' },
      resultData: { images: ['/imgs/out.png'] },
      hasError: false,
      deps: makeDeps(calls),
    });

    expect(calls).toContain('extract:image_svg_generate');
    expect(calls).toContain('register:/imgs/out.png');
    expect(calls).toContain('update:s1:image_svg_generate');
  });

  it('③ glob 数组结果 ⇒ 回填目录清单', () => {
    const calls: string[] = [];
    registerImageToolResults({
      toolCall: { id: 'c3', name: 'glob', sessionId: 's1' },
      args: { path: '/ws/proj' },
      resultData: ['/ws/proj/a.png'] as unknown as Record<string, unknown>,
      hasError: false,
      deps: makeDeps(calls),
    });

    expect(calls).toContain('listing:/ws/proj:1');
  });

  it('④ 媒体工具 ⇒ 广播 tool:completed；普通工具不广播', () => {
    const emit = spyOn(
      notificationModule.eventNotificationService,
      'emitCustomEvent'
    ).mockImplementation((() => {}) as never) as unknown as {
      mock: { calls: unknown[][] };
      mockRestore: () => void;
    };
    spies.push(emit);

    registerImageToolResults({
      toolCall: { id: 'c4', name: 'image_display', sessionId: 's1' },
      args: {},
      resultData: { images: ['/imgs/a.png'] },
      hasError: false,
      deps: makeDeps([]),
    });
    registerImageToolResults({
      toolCall: { id: 'c5', name: 'file_read', sessionId: 's1' },
      args: {},
      resultData: { images: [] },
      hasError: false,
      deps: makeDeps([]),
    });

    expect(emit.mock.calls).toHaveLength(1);
    expect(emit.mock.calls[0]![0]).toBe('tool:completed');
  });
});
