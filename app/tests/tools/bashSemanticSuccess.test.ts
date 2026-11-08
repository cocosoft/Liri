// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F3 / F5 的**真实执行接线**（2026-11-04，前端会话跟踪）。
 *
 * 纯函数判据已由 `bashSearchNoMatch.test.ts` / `bashPathNotFound.test.ts` 覆盖；
 * 本文件用真实 shell 跑两条真机形态的命令，验证"成功归类 + 结构化标记"确实接在 `execute()` 里：
 *   ① `dir <不存在的路径>` ⇒ 路径不存在（F5）；
 *   ② `dir /b /s /ad 2>nul | findstr <无匹配>` ⇒ 检索无匹配（F3）；
 *   ③ 对照组：`findstr <缺失文件>`（exit 2）仍是失败 —— 防止把真失败也归成成功。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  BashTool,
  resetGraySwitchWarningForTest,
} from '../../src/tools/bash/BashTool.js';
import { ApprovedCommandRegistry } from '@openliri/infra/permission/ApprovedCommandRegistry';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

async function run(command: string) {
  const reg = new ApprovedCommandRegistry(60_000, false);
  try {
    const tool = new BashTool(reg);
    return await tool.execute({ command }, makeContext('sess-semantic'));
  } finally {
    reg.dispose();
    resetGraySwitchWarningForTest();
  }
}

afterEach(() => {
  resetGraySwitchWarningForTest();
});

// 三条用例都跑 **cmd.exe 形态**命令（`dir` / `findstr`）——非 Windows 宿主没有这些命令，
// 只会得到 "command not found"（且被 security gate 拦成 path_safety）⇒ 断言"成功 + 标记"
// 必然失败。故整块按平台条件跳过（2026-11-08 CI ubuntu/macos 真机红）。
describe.skipIf(process.platform !== 'win32')(
  'realdir 语义：路径不存在 / 检索无匹配 不再算失败',
  () => {
    it('dir 不存在的路径 ⇒ 成功 + pathNotFound 标记 + 可读文案', async () => {
      const result = await run('dir "__f5_no_such_dir_9c1f__"');
      expect(result.success).toBe(true);
      expect(result.metadata?.pathNotFound).toBe(true);
      expect(String(result.data ?? '')).toContain('路径不存在');
    });

    it('dir | findstr 无匹配 ⇒ 成功 + searchNoMatch 标记', async () => {
      const result = await run(
        'dir /b /s /ad 2>nul | findstr /i "__f3_no_such_token_9c1f__"'
      );
      expect(result.success).toBe(true);
      expect(result.metadata?.searchNoMatch).toBe(true);
      expect(String(result.data ?? '')).toContain('检索无匹配');
    });

    it('对照组：findstr 缺失文件（exit 2）仍判失败（不误伤真失败）', async () => {
      const result = await run('findstr /i x "__f3_no_such_file_9c1f__.txt"');
      expect(result.success).toBe(false);
      expect(result.metadata?.searchNoMatch).toBeUndefined();
      expect(result.metadata?.pathNotFound).toBeUndefined();
    });
  }
);
