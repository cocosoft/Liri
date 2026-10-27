/**
 * platformVariant 判别（构建期依赖裁剪）
 *
 * 背景：`copy-external-deps.ts` 曾把 `pdfjs-dist` / `sharp` 的全部平台变体一起复制，
 * 其中 musl 变体（`@napi-rs/canvas-linux-x64-musl`）在 glibc 宿主上 `ldd` 报
 * `invalid ELF header` ⇒ linuxdeploy 抛 `Failed to run ldd` ⇒ Linux AppImage 打包失败。
 */
import { describe, expect, it } from 'bun:test';
import {
  isForeignPlatformVariant,
  parsePlatformVariant,
  type HostTriple,
} from '../../scripts/lib/platformVariant';

const LINUX_X64: HostTriple = { os: 'linux', arch: 'x64', libc: 'glibc' };
const WIN_X64: HostTriple = { os: 'win32', arch: 'x64' };
const MAC_ARM: HostTriple = { os: 'darwin', arch: 'arm64' };

describe('platformVariant 解析', () => {
  it('识别 os+arch（napi-rs 形态，libc 在尾位）', () => {
    expect(parsePlatformVariant('@napi-rs/canvas-linux-x64-musl')).toEqual({
      os: 'linux',
      arch: 'x64',
      libc: 'musl',
    });
    expect(parsePlatformVariant('@napi-rs/canvas-linux-x64-gnu')).toEqual({
      os: 'linux',
      arch: 'x64',
      libc: 'glibc',
    });
  });

  it('识别 sharp 的 linuxmusl 写法（libc 在 os 位）', () => {
    expect(parsePlatformVariant('@img/sharp-linuxmusl-x64')).toEqual({
      os: 'linux',
      arch: 'x64',
      libc: 'musl',
    });
    expect(parsePlatformVariant('@img/sharp-linux-x64')).toEqual({
      os: 'linux',
      arch: 'x64',
    });
  });

  it('非平台包返回 null（不参与裁剪）', () => {
    expect(parsePlatformVariant('sharp')).toBeNull();
    expect(parsePlatformVariant('@napi-rs/canvas')).toBeNull();
    expect(parsePlatformVariant('pdfjs-dist')).toBeNull();
  });
});

describe('异平台判定', () => {
  it('glibc Linux 宿主：保留 gnu，剔除 musl 与异 OS', () => {
    expect(
      isForeignPlatformVariant('@napi-rs/canvas-linux-x64-gnu', LINUX_X64)
    ).toBe(false);
    expect(
      isForeignPlatformVariant('@napi-rs/canvas-linux-x64-musl', LINUX_X64)
    ).toBe(true);
    expect(
      isForeignPlatformVariant('@img/sharp-linuxmusl-x64', LINUX_X64)
    ).toBe(true);
    expect(isForeignPlatformVariant('@img/sharp-win32-x64', LINUX_X64)).toBe(
      true
    );
    expect(
      isForeignPlatformVariant('@img/sharp-libvips-linux-x64', LINUX_X64)
    ).toBe(false);
  });

  it('Windows / macOS 宿主各自只保留本平台', () => {
    expect(isForeignPlatformVariant('@img/sharp-win32-x64', WIN_X64)).toBe(
      false
    );
    expect(isForeignPlatformVariant('@img/sharp-linux-x64', WIN_X64)).toBe(
      true
    );
    expect(isForeignPlatformVariant('@img/sharp-darwin-arm64', MAC_ARM)).toBe(
      false
    );
    expect(
      isForeignPlatformVariant('@napi-rs/canvas-linux-x64-gnu', MAC_ARM)
    ).toBe(true);
  });

  it('负向对照：非平台包永不剔除（防"裁过头"）', () => {
    for (const host of [LINUX_X64, WIN_X64, MAC_ARM]) {
      expect(isForeignPlatformVariant('sharp', host)).toBe(false);
      expect(isForeignPlatformVariant('@napi-rs/canvas', host)).toBe(false);
    }
  });
});
