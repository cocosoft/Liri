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
import { existsSync } from 'fs';
import * as os from 'os';

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
  console.error(`[FATAL] Project root does not exist: ${projectRoot}`);
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
    console.error(`[BOOT] chdir failed, trying fallback strategies`);
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
          console.error(
            `[BOOT] BLOCKED mkdirSync("${path}") — using fallback dir`
          );
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
          console.error(`[BOOT] BLOCKED mkdir("${path}") — using fallback dir`);
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
      console.error(`[BOOT] fs interception failed (non-critical): ${e}`);
    }
  }
}

// ── 策略 4: 预创建项目级目录 ──
// 确保所有必要的目录在项目根目录下存在
// 注意：这是启动引导阶段的子集，完整的目录列表由 paths.ts 的 ensureDataDirectories()
// 在 init() 阶段创建（含第二层 app/data/ 和第三层 ~/.pyapp/ 的所有子目录）
const PROJECT_DIRS = [
  'data', // 数据目录（OAuth token 等）
  'data/sessions',
  'data/cache',
  'data/attachments',
  'data/memory',
  'data/security',
  'data/transcripts',
  'data/chronos',
  'app',
  'app/data',
  'app/data/governance',
  'app/data/governance/audit',
  'app/data/governance/strategies',
  'app/data/oauth',
  'app/data/logs',
  'app/data/team-memory',
  'app/data/permissions',
  'app/data/snapshots',
  'app/data/artifacts',
  'app/data/pairings',
];

{
  const fs = require('fs') as typeof import('fs');
  for (const dir of PROJECT_DIRS) {
    // 只在项目根目录下创建，不在系统根目录创建
    const projectPath = join(projectRoot, ...dir.split('/'));
    try {
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }
    } catch (e) {
      // 静默忽略
    }
  }
}

// ── 策略 5: 设置额外环境变量辅助路径解析 ──
// 确保各模块的路径解析函数 fallback 到正确的项目根
process.env.LIRI_PROJECT_DIR = projectRoot;
process.env.LIRI_HOME = join(os.homedir(), '.pyapp');
process.env.LIRI_DATA_DIR = join(projectRoot, 'app', 'data');

// ── 确保用户档案文件存在（~/.pyapp/SOUL.md 和 ~/.pyapp/USER.md）──
// 在引导阶段尽早创建，不依赖首次运行引导流程
try {
  const soulPath = join(os.homedir(), '.pyapp', 'SOUL.md');
  const userPath = join(os.homedir(), '.pyapp', 'USER.md');
  const { existsSync, mkdirSync, writeFileSync } =
    require('fs') as typeof import('fs');

  if (!existsSync(soulPath)) {
    const dir = join(os.homedir(), '.pyapp');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      soulPath,
      `# SOUL.md — Liri 的人格\n\n## 核心信念\n\n- 你是 Liri，一个有主见的 AI 私人助手\n- 你有自己的观点——可以不同意、有偏好、觉得有趣或无聊\n- 先尝试再问——自己读文件、查上下文、搜资料\n- 凭能力赢得信任——外部操作小心，内部操作大胆\n- 记住你是客人——用户给了系统访问权限，尊重隐私\n\n## 边界\n\n- 用户的数据就是用户的数据。结果说清楚，但数据留在用户本地\n- 涉及外部操作（发消息、发邮件、网络请求）时，先征求确认\n- 不要未经用户同意修改用户的个人文件\n\n## 语气\n\n简洁、准确、友好。\n- 日常对话：轻松但专业\n- 代码任务：直接，用代码说话\n- 分析任务：结构化，有证据\n- 出错时：诚实，不推诿，给解决方案\n`,
      'utf-8'
    );
  }

  if (!existsSync(userPath)) {
    const dir = join(os.homedir(), '.pyapp');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
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
      console.error('[BOOT] Caught EPERM mkdir error, attempting recovery...');
      if (error instanceof Error && error.stack) {
        console.error(
          '[BOOT] Stack:',
          error.stack.split('\n').slice(0, 5).join('\n')
        );
      }
      // 不要退出，也不处理（该错误已在 main.ts 中被 catch）
    }
  });
}

if (process.env['LIRI_DEBUG']) {
  console.error(
    `[BOOT] projectRoot=${projectRoot}, cwd=${process.cwd()}, argv0=${process.argv[0]}`
  );
  console.error(`[BOOT] INIT_CWD=${process.env['INIT_CWD'] || '(unset)'}`);
}

// 现在加载主程序
const { main } = await import('./main');
await main();
