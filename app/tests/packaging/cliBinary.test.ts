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
  outfileForTarget,
  parseBuildArgs,
  parseBunTarget,
  parseSha256Sums,
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

  it('交叉编译目标：解析合法 target，非法给 null（不猜）', () => {
    expect(parseBunTarget('bun-darwin-x64')).toEqual({
      os: 'darwin',
      arch: 'x64',
    });
    expect(parseBunTarget('bun-windows-x64')).toEqual({
      os: 'win32',
      arch: 'x64',
    });
    expect(parseBunTarget('bun-linux-arm64-musl')).toEqual({
      os: 'linux',
      arch: 'arm64',
    });
    expect(parseBunTarget('darwin-x64')).toBeNull();
    expect(parseBunTarget('bun-plan9-x64')).toBeNull();
  });

  it('交叉编译产物名：与 G2 资产命名同源（Windows 带 .exe）', () => {
    expect(outfileForTarget('bun-darwin-x64')).toBe(
      'app/dist/cli-bin/liri-darwin-x64'
    );
    expect(outfileForTarget('bun-windows-arm64')).toBe(
      'app/dist/cli-bin/liri-win32-arm64.exe'
    );
    expect(outfileForTarget('bogus')).toBeNull();
  });

  it('参数解析：--target 两种写法都支持，且产物名按 target 推导', () => {
    expect(parseBuildArgs(['--target=bun-darwin-x64'])).toEqual({
      entry: DEFAULT_ENTRY,
      outfile: 'app/dist/cli-bin/liri-darwin-x64',
      target: 'bun-darwin-x64',
    });
    expect(parseBuildArgs(['--target', 'bun-darwin-x64'])).toEqual({
      entry: DEFAULT_ENTRY,
      outfile: 'app/dist/cli-bin/liri-darwin-x64',
      target: 'bun-darwin-x64',
    });
    expect(parseBuildArgs(['--target=bogus'])).toBeNull();
  });

  it('SHA256SUMS 解析：只认「64 位小写 hex + 两个空格 + 文件名」，可往返', () => {
    const entries = parseSha256Sums(
      `${'a'.repeat(64)}  liri-darwin-arm64\n${'b'.repeat(64)}  liri-darwin-x64\n\n垃圾行\n`
    );
    expect(entries).toEqual([
      { sha256: 'a'.repeat(64), name: 'liri-darwin-arm64' },
      { sha256: 'b'.repeat(64), name: 'liri-darwin-x64' },
    ]);
    expect(parseSha256Sums(renderSha256Sums(entries))).toEqual(entries);
  });
});
