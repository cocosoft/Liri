// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 剩余二期：单文件二进制构建脚本的**纯函数**部分。
 *
 * 说明：真正的 `bun build --compile` 已实测通过（产物 + SHA256SUMS 生成）；
 * 用例只锁参数解析 / 产物命名 / 校验和渲染的确定性。
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ENTRY,
  defaultOutfile,
  parseBuildArgs,
  renderSha256Sums,
} from '../../../scripts/build-cli-binary';

describe('build-cli-binary 纯函数', () => {
  it('默认产物名按平台带后缀', () => {
    expect(defaultOutfile('win32', 'x64')).toBe(
      'app/dist/cli-bin/liri-win32-x64.exe'
    );
    expect(defaultOutfile('darwin', 'arm64')).toBe(
      'app/dist/cli-bin/liri-darwin-arm64'
    );
    expect(defaultOutfile('linux', 'x64')).toBe(
      'app/dist/cli-bin/liri-linux-x64'
    );
  });

  it('参数解析：缺省入口 + 平台产物；显式参数覆盖', () => {
    expect(parseBuildArgs([])).toEqual({
      entry: DEFAULT_ENTRY,
      outfile: defaultOutfile(),
    });
    expect(
      parseBuildArgs(['--entry', 'app/src/pyapp.ts', '--outfile', 'out/liri'])
    ).toEqual({ entry: 'app/src/pyapp.ts', outfile: 'out/liri' });
  });

  it('空值参数 ⇒ null（不静默用默认值）', () => {
    expect(parseBuildArgs(['--entry', ' '])).toBeNull();
    expect(parseBuildArgs(['--outfile', ''])).toBeNull();
  });

  it('SHA256SUMS：按文件名升序、`<hash>  <name>`、行尾换行', () => {
    const text = renderSha256Sums([
      { name: 'b.exe', sha256: 'b'.repeat(64) },
      { name: 'a.tar.gz', sha256: 'a'.repeat(64) },
    ]);
    expect(text).toBe(
      `${'a'.repeat(64)}  a.tar.gz\n${'b'.repeat(64)}  b.exe\n`
    );
    expect(renderSha256Sums([])).toBe('\n');
  });
});
