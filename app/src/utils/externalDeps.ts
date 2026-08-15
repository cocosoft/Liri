/**
 * externalDeps.ts — 编译产物外部依赖加载
 *
 * bun build --compile 模式下，--external 标记的 npm 包（sharp / pdfjs-dist）
 * 不内联进 exe。运行时必须从真实可执行文件同级目录的 node_modules 加载，
 * 而非 import.meta.url 对应的虚拟路径（--compile 下形如 B:/~BUN/root/liri_terminal）。
 *
 * 用法：
 *   import { loadSharp } from '@modules/utils/externalDeps';
 *   const sharp = loadSharp();
 */

import { createRequire } from 'module';
import { dirname, join, basename } from 'path';
import { existsSync } from 'fs';

// --compile 模式检测：曾用 import.meta.url.includes('~BUN')，但当前 Bun 版本下
// compile 产物的 import.meta.url 不含该标记（实测失效）。改用 process.execPath：
// dev/--target=bun 为 bun.exe，--compile 为 liri_terminal.exe。
const isCompiledBinary = !basename(process.execPath)
  .toLowerCase()
  .startsWith('bun');

/** 编译模式下基于真实 exe 路径的 require；非编译模式退化为源码路径 */
export function getExternalRequire(): NodeRequire {
  if (isCompiledBinary) {
    return createRequire(join(dirname(process.execPath), '_external_.js'));
  }
  return createRequire(import.meta.url);
}

/**
 * 探测外部包是否可加载（编译产物检测专用）
 *
 * compile 模式下 Bun 的 resolver（require.resolve / createRequire().resolve）
 * 基于打包模块图解析，不访问真实文件系统，对 --external 的 sharp/pdfjs-dist
 * 恒失败（pyapp.ts 的 Module._resolveFilename hook 只对运行时 require 生效）。
 * 因此做文件级探测：与 pyapp.ts SEARCH_DIRS 对齐，检查 exe 同级 node_modules。
 *
 * @param request 包名（支持子路径，如 'pdfjs-dist/legacy/build/pdf'）
 */
export function probeExternalModule(request: string): boolean {
  // 开发模式：标准 resolver 可用（从 app/node_modules 解析）
  if (!isCompiledBinary) {
    try {
      require.resolve(request);
      return true;
    } catch {
      return false;
    }
  }

  const exeDir = dirname(process.execPath);
  const pkgName = request.split('/')[0];
  const searchDirs = [join(exeDir, 'node_modules'), join(exeDir, 'deps')];
  for (const dir of searchDirs) {
    const base = join(dir, pkgName);
    if (!existsSync(base)) continue;
    const subPath = request.slice(pkgName.length).replace(/^\//, '');
    if (!subPath || existsSync(join(base, subPath))) return true;
  }
  return false;
}

let _sharp: typeof import('sharp') | null = null;
let _sharpError: Error | null = null;

/**
 * 延迟加载 sharp（原生插件，无法被 bun build --compile 内联）
 * 一级策略：直接 require（开发模式 bun run 正常工作）
 * 二级策略：基于 exe 真实路径 createRequire（编译产物）
 */
export function loadSharp(): typeof import('sharp') {
  if (_sharp) return _sharp;
  if (_sharpError) throw _sharpError;

  try {
    _sharp = require('sharp') as typeof import('sharp');
    return _sharp;
  } catch (err) {
    _sharpError = err as Error;
  }
  try {
    _sharp = getExternalRequire()('sharp') as typeof import('sharp');
    _sharpError = null;
    return _sharp;
  } catch (err) {
    _sharpError = err as Error;
  }
  throw _sharpError;
}

let _pdfjsDist: string | null = null;
let _pdfjsError: Error | null = null;

/**
 * 加载外部 npm 包（编译产物中 external 化，无法顶层 import/require）
 * - 开发模式：直接 require
 * - 编译产物：基于 exe 真实路径 createRequire
 * @param name 包名（支持子路径，如 pdfjs-dist/legacy/build/pdf）
 */
export function loadExternal(name: string): unknown {
  try {
    return require(name);
  } catch (err) {
    if (!isCompiledBinary) throw err;
  }
  try {
    return getExternalRequire()(name);
  } catch (err) {
    // 尝试3：Node 兼容层 require（pyapp.ts 已注册 Module._resolveFilename hook，
    // 编译产物中会重定向到 exe 同级 node_modules）
    return require(name);
  }
}

/**
 * 解析 pdfjs-dist 的安装路径（package.json 所在目录）
 * 用于定位 cmaps/ 资源；加载失败的场景下抛错由调用方兜底
 */
export function resolvePdfjsDistPath(): string {
  if (_pdfjsDist) return _pdfjsDist;
  if (_pdfjsError) throw _pdfjsError;

  try {
    _pdfjsDist = dirname(require.resolve('pdfjs-dist/package.json'));
    return _pdfjsDist;
  } catch (err) {
    _pdfjsError = err as Error;
  }
  try {
    _pdfjsDist = dirname(
      getExternalRequire().resolve('pdfjs-dist/package.json')
    );
    _pdfjsError = null;
    return _pdfjsDist;
  } catch (err) {
    _pdfjsError = err as Error;
  }
  throw _pdfjsError;
}
