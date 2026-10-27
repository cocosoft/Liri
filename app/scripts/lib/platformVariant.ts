/**
 * platformVariant.ts — 原生包「平台变体」判别（构建期依赖裁剪）
 *
 * 背景（2026-10-27，AppImage 打包失败根因）：`copy-external-deps.ts` 会把
 * `pdfjs-dist` / `sharp` 的 **全部平台变体** 一起复制（如 `@img/sharp-win32-x64`、
 * `@napi-rs/canvas-linux-x64-musl`）。这些异平台二进制在当前宿主上永远用不到，
 * 却会让 Linux AppImage 打包失败：Tauri 的 appimage 步骤跑 `linuxdeploy`，
 * 后者对 AppDir 内每个 ELF 递归 `ldd`；musl 链接的 `.node` 在 glibc 宿主上
 * `ldd` 直接报错（实测 `invalid ELF header`），linuxdeploy 抛
 * `Failed to run ldd: exited with code 1` ⇒ 整步失败（Tauri 只回显
 * `failed to run linuxdeploy`）。
 *
 * 本模块只回答一个问题：**这个包名是不是"别的平台/libc 的变体"**。
 * - 命名覆盖两种写法：`sharp-linuxmusl-x64`（libc 在 os 位）与
 *   `canvas-linux-x64-musl`（libc 在尾位）；
 * - 不可识别出 os+arch 的包名一律视为**非平台包**（如 `sharp`、`@napi-rs/canvas`），
 *   不参与裁剪（CS03：不臆造规则）。
 */

/** 宿主平台三元组 */
export interface HostTriple {
  /** `process.platform` 取值域：`linux` / `darwin` / `win32` / … */
  os: string;
  /** `process.arch` 取值域：`x64` / `arm64` / … */
  arch: string;
  /** libc；仅 Linux 有意义。缺省按 glibc 处理（本仓 Linux 产物为 gnu 目标） */
  libc?: 'glibc' | 'musl';
}

/** 包名里的 os 记号（`linuxmusl` 是 sharp 的写法：os=linux + libc=musl） */
const OS_TOKENS = new Set([
  'linux',
  'linuxmusl',
  'darwin',
  'win32',
  'android',
  'freebsd',
]);

/** 包名里的 arch 记号 */
const ARCH_TOKENS = new Set([
  'x64',
  'arm64',
  'ia32',
  'arm',
  'ppc64',
  's390x',
  'riscv64',
]);

/** 包名尾部的 libc/abi 记号（只识别能区分 libc 的两个） */
const LIBC_TOKENS = new Set(['musl', 'gnu']);

/** 从包名解析平台变体；无法解析出 os+arch ⇒ `null`（非平台包） */
export function parsePlatformVariant(
  pkgName: string
): { os: string; arch: string; libc?: 'glibc' | 'musl' } | null {
  const parts = pkgName.toLowerCase().split('-');
  const osIdx = parts.findIndex((p) => OS_TOKENS.has(p));
  if (osIdx < 0) return null;

  const rawOs = parts[osIdx];
  const archIdx = parts.findIndex((p, i) => i > osIdx && ARCH_TOKENS.has(p));
  if (archIdx < 0) return null;

  const os = rawOs === 'linuxmusl' ? 'linux' : rawOs;
  let libc: 'glibc' | 'musl' | undefined =
    rawOs === 'linuxmusl' ? 'musl' : undefined;
  for (const token of parts.slice(archIdx + 1)) {
    if (!LIBC_TOKENS.has(token)) continue;
    libc = token === 'musl' ? 'musl' : 'glibc';
  }
  return { os, arch: parts[archIdx], libc };
}

/** 当前宿主的平台三元组 */
export function currentHostTriple(): HostTriple {
  return {
    os: process.platform,
    arch: process.arch,
    libc: process.platform === 'linux' ? 'glibc' : undefined,
  };
}

/**
 * 是否为**异平台变体**（应在构建期裁掉）。
 *
 * 判据：os 不同 / arch 不同 / libc 可判别且不同。三者任一命中即异平台。
 */
export function isForeignPlatformVariant(
  pkgName: string,
  host: HostTriple = currentHostTriple()
): boolean {
  const variant = parsePlatformVariant(pkgName);
  if (!variant) return false;
  if (variant.os !== host.os) return true;
  if (variant.arch !== host.arch) return true;
  if (variant.libc && variant.libc !== (host.libc ?? 'glibc')) return true;
  return false;
}
