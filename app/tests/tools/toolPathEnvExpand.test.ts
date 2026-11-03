/**
 * 2026-11-03 实时巡检：路径里的环境变量必须展开
 *
 * 现场：项目产物里出现**字面量** `%TEMP%` 目录
 *（`<项目>\%TEMP%\k08_metrics.js`）—— 模型按 Windows 习惯写 `%TEMP%\x.js`，
 * 解析侧不展开 ⇒ 被当成普通目录名落进工作区，污染产物并被后续 glob 反复抓出。
 *
 * `resolveFilePath()` 是 FileRead/FileWrite/FileEdit/Grep/Glob 的**共同入口**
 * ⇒ 在它这里展开一次，全链路生效。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  expandEnvVarsInPath,
  resolveFilePath,
} from '../../src/tools/utils/ToolUtils';

const ORIGINAL_TEMP = process.env.TEMP;

afterEach(() => {
  if (ORIGINAL_TEMP === undefined) delete process.env.TEMP;
  else process.env.TEMP = ORIGINAL_TEMP;
});

describe('expandEnvVarsInPath', () => {
  it('展开 %NAME%（Windows 形态）', () => {
    expect(expandEnvVarsInPath('%TEMP%\\k08_metrics.js')).toBe(
      `${process.env.TEMP}\\k08_metrics.js`
    );
  });

  it('展开 ${NAME}（花括号形态）', () => {
    // 用平台必有的 TEMP（Windows 下 HOME 可能未设置）
    expect(expandEnvVarsInPath('${TEMP}/x')).toBe(`${process.env.TEMP}/x`);
  });

  it('未定义的变量保持原样（不猜、不拼错目录）', () => {
    expect(expandEnvVarsInPath('%LIRI_NO_SUCH_VAR%\\x')).toBe(
      '%LIRI_NO_SUCH_VAR%\\x'
    );
  });

  it('不展开裸 $NAME（避免误伤含 $ 的合法文件名）', () => {
    expect(expandEnvVarsInPath('a$b.txt')).toBe('a$b.txt');
  });

  it('无变量时原样返回', () => {
    expect(expandEnvVarsInPath('C:\\work\\a.js')).toBe('C:\\work\\a.js');
  });
});

describe('resolveFilePath', () => {
  it('相对路径里的 %TEMP% 不再变成工作区下的字面量目录', () => {
    const baseDir = join(tmpdir(), 'liri-env-base');
    process.env.TEMP = join(tmpdir(), 'liri-env-temp');

    const resolved = resolveFilePath('%TEMP%\\k08_metrics.js', baseDir);

    expect(resolved).toBe(resolve(process.env.TEMP, 'k08_metrics.js'));
    expect(resolved).not.toContain('%TEMP%');
  });
});
