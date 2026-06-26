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

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

/**
 * Liri 启动入口
 *
 * 在加载任何 app 模块前确定项目根目录，
 * 通过多重策略确保所有 process.cwd() 调用和 fs.mkdir* 调用使用正确路径。
 *
 * 策略优先级：
 *   1. process.chdir() — OS 级别 chdir，对所有层生效
 *   2. Object.defineProperty override process.cwd — JS 层兜底
 *   3. fs.mkdirSync/mkdir 拦截 — 检测根路径写入时重定向至 projectRoot
 */
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import { getLogger } from './monitoring/logs/Logger';

const bootLogger = getLogger('pyapp');

/**
 * 确定项目根目录
 * 按优先级：
 *   1. --project-dir 命令行参数
 *   2. LIRI_PROJECT_DIR 环境变量
 *   3. process.argv[0] → exe 所在目录的父目录（exe 在 dist/ 下）
 *   4. INIT_CWD 环境变量
 *   5. 当前目录（原样返回）
 */
function determineProjectRoot(): string {
  const argv = process.argv;

  // 1. 命令行参数 --project-dir
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-dir' && i + 1 < argv.length) {
      const dir = argv[i + 1].trim();
      if (dir) return resolve(dir);
    }
    if (argv[i].startsWith('--project-dir=')) {
      const dir = argv[i].split('=')[1]?.trim();
      if (dir) return resolve(dir);
    }
  }

  // 2. 环境变量
  const envDir = process.env.LIRI_PROJECT_DIR?.trim();
  if (envDir) return resolve(envDir);

  // 3. 从 exe 路径推断（argv[0] 指向用户硬盘上的实际 exe）
  const argv0 = argv[0] || '';
  if (argv0.endsWith('.exe')) {
    const exeDir = dirname(argv0);
    // exe 在 dist/ 下，项目根为父目录
    const baseName = exeDir.split(/[\\/]/).pop() || '';
    if (baseName === 'dist') {
      return resolve(exeDir, '..');
    }
    return exeDir;
  }

  // 4. INIT_CWD 环境变量
  const initCwd = process.env['INIT_CWD']?.trim();
  if (initCwd) return resolve(initCwd);

  return resolve(process.cwd() || '.');
}

/**
 * 清洗路径字符串：去除引号、空白字符等可能潜入的杂质
 */
function sanitizePath(raw: string): string {
  return raw.replace(/['"]/g, '').trim();
}

// =========================================
// 启动引导 — 在加载任何 app 模块前执行
// =========================================
const projectRoot = sanitizePath(determineProjectRoot());

// 确保目录存在再继续
if (!existsSync(projectRoot)) {
  bootLogger.fatal('Project root does not exist', { projectRoot });
  process.exit(1);
}

// 设置环境变量供后续模块使用
process.env.LIRI_PROJECT_DIR = projectRoot;

// 额外环境变量兜底：某些库/模块可能使用 PWD 或 INIT_CWD
process.env.PWD = projectRoot;
process.env.INIT_CWD = process.env.INIT_CWD || projectRoot;

// ── 策略 1: process.chdir() ──
// Bun 编译 exe 中 chdir 可能不生效，但正常 Node/Bun 环境下可靠
try {
  process.chdir(projectRoot);
} catch (e) {
  if (process.env['LIRI_DEBUG']) {
    bootLogger.error('chdir failed, trying fallback strategies', {
      error: String(e),
    });
  }
}

// ── 策略 2: Object.defineProperty override process.cwd ──
// 相比直接赋值 process.cwd = fn，defineProperty 的拦截更彻底
{
  const origCwd = process.cwd.bind(process);

  Object.defineProperty(process, 'cwd', {
    value: (): string => {
      const actual = origCwd();
      // 如果 cwd 是根路径（如 \ 或 D:\），返回 projectRoot
      if (actual === '\\' || actual === '/' || /^[A-Za-z]:\\$/.test(actual)) {
        return projectRoot;
      }
      return actual;
    },
    writable: true,
    configurable: true,
  });
}

// ── 策略 3: 拦截 fs.mkdirSync/mkdir，检测根路径时重定向 ──
// 在 Bun 编译 exe 中 require('fs') 可能返回冻结对象，此策略可能无效，
// 捕获异常时静默降级
{
  function isRootPath(p: unknown): boolean {
    if (typeof p !== 'string' || !p) return false;
    const norm = p.replace(/['"]/g, '');
    return norm === '\\' || norm === '/' || /^[A-Za-z]:\\$/.test(norm);
  }

  try {
    const fsModule: any = require('fs');
    const origMkdirSync: Function = fsModule.mkdirSync.bind(fsModule);
    fsModule.mkdirSync = function patchedMkdirSync(
      path: any,
      options?: any
    ): any {
      if (isRootPath(path)) {
        if (process.env['LIRI_DEBUG']) {
          bootLogger.error('BLOCKED mkdirSync', { path: String(path) });
        }
        return origMkdirSync(join(projectRoot, 'app', 'data'), options);
      }
      return origMkdirSync(path, options);
    };

    const origMkdir: Function = fsModule.mkdir.bind(fsModule);
    fsModule.mkdir = function patchedMkdir(
      path: any,
      options: any,
      callback?: any
    ): any {
      if (isRootPath(path)) {
        if (process.env['LIRI_DEBUG']) {
          bootLogger.error('BLOCKED mkdir', { path: String(path) });
        }
        if (typeof options === 'function') {
          return origMkdir(join(projectRoot, 'app', 'data'), options);
        }
        return origMkdir(join(projectRoot, 'app', 'data'), options, callback);
      }
      return origMkdir(path, options, callback);
    };
  } catch (e) {
    if (process.env['LIRI_DEBUG']) {
      bootLogger.error('fs interception failed (non-critical)', {
        error: String(e),
      });
    }
  }
}

// ── 策略 4: 预创建项目级目录 ──
// 确保所有必要的目录存在。
// 注意：项目数据（第二层）已移至用户目录 ~/.pyapp/data/，
//       由 paths.ts 的 ensureDataDirectories() 在 init() 阶段创建。
//       此处仅创建项目结构目录（app/ 用于文档等只读资源）。
const PROJECT_DIRS = ['app'];

{
  const fs = require('fs') as typeof import('fs');
  for (const dir of PROJECT_DIRS) {
    // 只在项目根目录下创建，不在系统根目录创建
    const projectPath = join(projectRoot, ...dir.split('/'));
    try {
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }
    } catch (_e) {
      // 静默忽略
      bootLogger.error('创建项目目录失败:', _e as Error);
    }
  }
}

// ── 策略 5: 设置额外环境变量辅助路径解析 ──
// 确保各模块的路径解析函数 fallback 到正确的项目根
process.env.LIRI_PROJECT_DIR = projectRoot;

// 校验 os.homedir() 返回值，防止回退到 C:\Users\Default 等系统保护目录
const userHome = os.homedir();
const invalidHomeDirs = ['C:\\Users\\Default', 'C:\\Users\\default'];
if (!userHome || invalidHomeDirs.includes(userHome)) {
  const homeDrive = process.env.HOMEDRIVE || '';
  const homePath = process.env.HOMEPATH || '';
  if (homeDrive && homePath) {
    process.env.LIRI_HOME = join(homeDrive + homePath, '.pyapp');
  } else if (process.env.USERPROFILE) {
    process.env.LIRI_HOME = join(process.env.USERPROFILE, '.pyapp');
  } else {
    // 最后兜底：使用项目目录下的 data 子目录
    process.env.LIRI_HOME = join(projectRoot, 'app', 'data', 'pyapp');
  }
} else {
  process.env.LIRI_HOME = join(userHome, '.pyapp');
}
process.env.LIRI_DATA_DIR = join(process.env.LIRI_HOME, 'data');

// ── 策略 6: 加载 .env 文件 ──
// Bun 自动加载 .env 仅在 CWD 中查找，而 .env 位于 app/ 子目录，
// 因此需要手动加载，确保 DEEPSEEK_API_KEY 等环境变量可用。
{
  try {
    const envPath = join(projectRoot, 'app', '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        // 跳过空行和注释
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        // 不覆盖已存在的环境变量（例如由 shell 注入的）
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // 非致命：.env 加载失败不影响启动
  }
}

// ── 确保用户档案文件存在（SOUL.md 和 USER.md）──
// 使用 resolvePyappHome() 逻辑，尊重 LIRI_HOME 环境变量
try {
  const liriHomeVal = process.env['LIRI_HOME']?.trim();
  const pyappDir = liriHomeVal
    ? resolve(liriHomeVal)
    : join(os.homedir(), '.pyapp');

  const soulPath = join(pyappDir, 'SOUL.md');
  const userPath = join(pyappDir, 'USER.md');
  const { existsSync, mkdirSync, writeFileSync } =
    require('fs') as typeof import('fs');

  if (!existsSync(pyappDir)) {
    mkdirSync(pyappDir, { recursive: true });
  }

  if (!existsSync(soulPath)) {
    writeFileSync(
      soulPath,
      `# SOUL.md — Liri 的人格\n\n## 核心信念\n\n- 你是 Liri，一个有主见的 AI 私人助手\n- 你有自己的观点——可以不同意、有偏好、觉得有趣或无聊\n- 先尝试再问——自己读文件、查上下文、搜资料\n- 凭能力赢得信任——外部操作小心，内部操作大胆\n- 记住你是客人——用户给了系统访问权限，尊重隐私\n\n## 边界\n\n- 用户的数据就是用户的数据。结果说清楚，但数据留在用户本地\n- 涉及外部操作（发消息、发邮件、网络请求）时，先征求确认\n- 不要未经用户同意修改用户的个人文件\n\n## 语气\n\n简洁、准确、友好。\n- 日常对话：轻松但专业\n- 代码任务：直接，用代码说话\n- 分析任务：结构化，有证据\n- 出错时：诚实，不推诿，给解决方案\n`,
      'utf-8'
    );
  }

  if (!existsSync(userPath)) {
    writeFileSync(
      userPath,
      `# USER.md — 用户身份\n\n## 基本信息\n\n- 称呼：用户\n- 专业领域：软件开发\n- 技术栈偏好：TypeScript, Rust, Python\n- 工作场景：编程开发\n\n## 沟通偏好\n\n- 回复语言：中文\n- 详细程度：平衡\n`,
      'utf-8'
    );
  }
} catch {
  // 非致命：用户档案文件创建失败不影响启动
}

// ── 策略 6: 全局异常捕获（进程级兜底） ──
// 捕获 mkdir '\' 等不可恢复的系统调用 EPERM 错误，
// 尝试创建关键目录后重试
{
  const projectDirsExisted = new Set<string>();
  const markDirCreated = (p: string) => {
    projectDirsExisted.add(p);
    projectDirsExisted.add(p.replace(/\\/g, '/'));
  };

  for (const dir of PROJECT_DIRS) {
    markDirCreated(dir);
    markDirCreated(join(projectRoot, ...dir.split('/')));
  }

  process.on('uncaughtException', (error) => {
    const msg = error?.message || String(error);
    if (
      msg.includes('EPERM') &&
      (msg.includes("mkdir '\\'") || msg.includes('mkdir'))
    ) {
      bootLogger.error('Caught EPERM mkdir error, attempting recovery...');
      if (error instanceof Error && error.stack) {
        bootLogger.error('Stack', {
          stack: error.stack.split('\n').slice(0, 5).join('\n'),
        });
      }
      // 不要退出，也不处理（该错误已在 main.ts 中被 catch）
    }
  });
}

if (process.env['LIRI_DEBUG']) {
  bootLogger.error('BOOT context', {
    projectRoot,
    cwd: process.cwd(),
    argv0: process.argv[0],
    initCwd: process.env['INIT_CWD'] || '(unset)',
  });
}

// ── 策略 7: 模块解析重定向（bun build --compile 外部依赖兜底） ──
// Bun 编译的单文件 exe 中，模块根路径为虚拟路径（如 B:/~BUN/root/liri_coding），
// 导致 --external 标记的包（如 sqlite3）无法通过系统 require 找到。
// 此处 hook Module._resolveFilename，将标记的外部包重定向到实际 node_modules。
try {
  const Module = require('module') as any;
  const { createRequire } = await import('module');
  const { fileURLToPath } = await import('url');
  const hookFile = fileURLToPath(import.meta.url);
  const exeRequire = createRequire(hookFile);

  const EXTERNAL_REDIRECTS = ['sqlite3', 'bindings', 'file-uri-to-path'];

  const origResolveFilename = Module._resolveFilename.bind(Module);
  Module._resolveFilename = function patchedResolveFilename(
    request: string,
    parent: any,
    isMain: boolean,
    options: any
  ): string {
    if (EXTERNAL_REDIRECTS.includes(request)) {
      try {
        return exeRequire.resolve(request);
      } catch {
        // fallback to original
      }
    }
    return origResolveFilename(request, parent, isMain, options);
  };
} catch (e) {
  if (process.env['LIRI_DEBUG']) {
    bootLogger.error('Module._resolveFilename hook failed', {
      error: String(e),
    });
  }
}

// 现在加载主程序
const { main } = await import('./main');
await main();
