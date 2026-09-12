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
 * PathGuard × 工具箱覆盖回归（O26，2026-09-12）
 *
 * 背景：PathGuard 原按**工具名白名单**取路径，与工具箱实际注册名（`file_read` +
 * `file_path`）不一致 → 路径检查静默失效，`app/.env` 曾被如实读出（O26 实测）。
 * 本测试用**真实工具清单**（`getAllBaseTools()`，无 mock）锁死两类漂移：
 *   ① 新增/改名工具若声明了路径类参数却未被 `PATH_ARG_KEYS` 覆盖 → 失败；
 *   ② 新增 shell 类工具（声明 `command` 参数）若未被 PathGuard 识别 → 失败。
 */
import { describe, expect, test } from 'bun:test';
import { PathGuard } from './PathGuard.js';
import { PATH_ARG_KEYS, NON_PATH_ARG_KEYS } from '@modules/constants';
import { getAllBaseTools } from '../tools/ToolFactory.js';

/** 命中内置拒绝列表的探测路径（`.env` 实体） */
const DENIED = 'C:\\probe\\.env';
/** 应当放行的探测路径（普通源码） */
const ALLOWED = 'C:\\probe\\src\\index.ts';

describe('PathGuard × 工具箱覆盖（O26 / O28）', () => {
  test('规范清单完整性：路径类参数应显式登记在 PATH_ARG_KEYS', () => {
    const blind: string[] = [];

    for (const tool of getAllBaseTools()) {
      const pathKeys = (tool.params ?? [])
        .map((p) => p.name)
        .filter((key) => /path|file|dir/i.test(key))
        .filter((key) => !NON_PATH_ARG_KEYS.has(key));

      if (pathKeys.length === 0) continue;
      const covered = pathKeys.some((key) => PATH_ARG_KEYS.has(key));
      if (!covered) blind.push(`${tool.name} :: ${pathKeys.join(',')}`);
    }

    expect(blind).toEqual([]);
  });

  test('凡声明 command 参数的 shell 类工具，命令串路径都被提取', () => {
    const guard = new PathGuard();
    const blind = getAllBaseTools()
      .filter((tool) => (tool.params ?? []).some((p) => p.name === 'command'))
      .filter(
        (tool) =>
          guard.checkToolCall(tool.name, { command: `type ${DENIED}` }).allowed
      )
      .map((tool) => tool.name);

    expect(blind).toEqual([]);
  });

  test('file_read / file_write / file_edit 的真实参数名已被检查', () => {
    const guard = new PathGuard();

    expect(
      guard.checkToolCall('file_read', { file_path: DENIED }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('file_write', { file_path: DENIED }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('file_edit', { file_path: DENIED }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('file_read', { file_path: ALLOWED }).allowed
    ).toBe(true);
  });

  test('shell 命令串中的凭据路径被拦，普通路径与 URL 不受影响', () => {
    const guard = new PathGuard();

    expect(
      guard.checkToolCall('bash', {
        command: 'type C:\\Users\\me\\.ssh\\id_rsa',
      }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('powershell', {
        command: 'Get-Content ~/.pyapp/credentials/x.json',
      }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('bash', { command: `cat ${DENIED}` }).allowed
    ).toBe(false);

    expect(
      guard.checkToolCall('bash', { command: 'dir C:\\probe\\src' }).allowed
    ).toBe(true);
    expect(
      guard.checkToolCall('powershell', {
        command: 'Invoke-WebRequest https://api.example.com/v1/models',
      }).allowed
    ).toBe(true);
  });

  test('模板文件与源码目录不回归（O25 误报面）', () => {
    const guard = new PathGuard();

    expect(
      guard.checkToolCall('file_read', {
        file_path: 'C:\\probe\\app\\.env.example',
      }).allowed
    ).toBe(true);
    expect(
      guard.checkToolCall('file_read', {
        file_path: 'C:\\probe\\src\\auth\\AuthManager.ts',
      }).allowed
    ).toBe(true);
  });

  test('shell 相对路径 / 裸文件名被拦（O28①）', () => {
    const guard = new PathGuard();

    expect(guard.checkToolCall('bash', { command: 'type .env' }).allowed).toBe(
      false
    );
    expect(
      guard.checkToolCall('bash', { command: 'copy .env out.txt' }).allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('bash', { command: 'findstr JWT_SECRET .env' })
        .allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('powershell', {
        command: 'cd secrets; type token.json',
      }).allowed
    ).toBe(false);
  });

  test('相对路径解析不误伤普通命令（O28① 误报面）', () => {
    const guard = new PathGuard();

    expect(
      guard.checkToolCall('bash', { command: 'cd secrets && ls' }).allowed
    ).toBe(true);
    expect(
      guard.checkToolCall('bash', {
        command: 'git commit -m "read .env notes"',
      }).allowed
    ).toBe(true);
    expect(
      guard.checkToolCall('bash', { command: 'dir C:\\probe\\src' }).allowed
    ).toBe(true);
  });

  test('动态注册工具（MCP/插件）的路径参数也纳入检查（O28②）', () => {
    const guard = new PathGuard();

    expect(
      guard.checkToolCall('mcp__filesystem__read', { targetFile: DENIED })
        .allowed
    ).toBe(false);
    expect(
      guard.checkToolCall('plugin_x__save', { outputFilePath: DENIED }).allowed
    ).toBe(false);

    // 键形命中但值不是凭据 → 不误伤
    expect(guard.checkToolCall('mcp__x', { fileType: 'pdf' }).allowed).toBe(
      true
    );
    expect(guard.checkToolCall('mcp__y', { dir: 'asc' }).allowed).toBe(true);
    // 显式豁免仍生效（file_id 不是路径）
    expect(guard.checkToolCall('file_read', { file_id: DENIED }).allowed).toBe(
      true
    );
  });
});
