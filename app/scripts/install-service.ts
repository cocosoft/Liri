/**
 * install-service.ts — 跨平台守护进程服务安装脚本
 *
 * 支持 Windows (schtasks)、macOS (launchd)、Linux (systemd) 三平台，
 * 将 Liri 后端应用安装为系统自启服务。
 *
 * 用法:
 *   bun run scripts/install-service.ts install   — 安装并启动服务
 *   bun run scripts/install-service.ts uninstall — 卸载服务
 *   bun run scripts/install-service.ts start     — 启动服务
 *   bun run scripts/install-service.ts stop      — 停止服务
 *   bun run scripts/install-service.ts restart   — 重启服务
 *   bun run scripts/install-service.ts status    — 查看服务状态
 *
 *   --dev        使用 bun run 开发模式（默认使用编译后的二进制文件）
 *   --binary     指定编译后的二进制文件路径（默认自动检测 dist/ 目录）
 *   --schtasks   强制使用 schtasks 计划任务（非管理员用户部署时使用，默认优先 nssm）
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaemonService } from '../src/daemon/service/DaemonService.ts';
import type { ServiceConfig } from '../src/daemon/service/DaemonService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 脚本所在目录的上级（app/ 目录） */
const APP_DIR = resolve(__dirname, '..');

/** 项目根目录（PY_APP/） */
const PROJECT_ROOT = resolve(APP_DIR, '..');

/** 编译产物目录 */
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');

/** 内置 nssm 目录 */
const NSSM_DIR = resolve(APP_DIR, 'scripts', 'nssm');

/** 服务名称（Windows 任务名、Linux systemd 单元名、macOS launchd 标签） */
const SERVICE_NAME = 'liri-backend';

/** 服务显示名称 */
const SERVICE_DISPLAY_NAME = 'Liri Backend Service';

/** 服务描述 */
const SERVICE_DESCRIPTION = 'Liri AI 后端守护进程 — 跨平台 AI 助手服务';

/** 支持的命令列表 */
const VALID_ACTIONS = ['install', 'uninstall', 'start', 'stop', 'restart', 'status'] as const;

type Action = (typeof VALID_ACTIONS)[number];

interface ScriptOptions {
  action: Action;
  devMode: boolean;
  binaryPath?: string;
  forceSchtasks: boolean;
}

/**
 * 解析命令行参数
 */
function parseArgs(): ScriptOptions {
  const argv = process.argv.slice(2);
  let action: Action = 'status';
  let devMode = false;
  let binaryPath: string | undefined;
  let forceSchtasks = false;

  for (const arg of argv) {
    if (arg === '--dev') {
      devMode = true;
    } else if (arg === '--schtasks') {
      forceSchtasks = true;
    } else if (arg.startsWith('--binary=')) {
      binaryPath = arg.split('=')[1];
    } else if ((VALID_ACTIONS as readonly string[]).includes(arg)) {
      action = arg as Action;
    }
  }

  return { action, devMode, binaryPath, forceSchtasks };
}

/**
 * 查找编译后的二进制文件
 * 查找：liri_terminal(.exe)
 */
function findCompiledBinary(): string | null {
  const isWin = process.platform === 'win32';
  const candidates = ['liri_terminal'];

  for (const name of candidates) {
    const fullPath = join(DIST_DIR, isWin ? `${name}.exe` : name);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * 查找 nssm.exe 路径（仅 Windows）
 */
function findNssmPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;

  // 1. 检查项目内置的 nssm
  const localNssm = join(NSSM_DIR, 'nssm.exe');
  if (existsSync(localNssm)) {
    return localNssm;
  }

  // 2. 检查 PATH
  try {
    const result = execSync('where nssm', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: 'cmd.exe',
    });
    const lines = result.trim().split('\n');
    if (lines.length > 0 && lines[0].length > 0) {
      return lines[0].trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * 构建服务配置
 */
function buildServiceConfig(options: ScriptOptions): ServiceConfig {
  let execPath: string;
  let args: string[];
  let workingDir: string;

  if (options.devMode) {
    // 开发模式：使用 bun run
    const bunPath = findBunPath();
    execPath = bunPath;
    args = ['run', 'src/main.ts', 'daemon'];
    workingDir = APP_DIR;
  } else {
    // 生产模式：使用编译后的二进制文件
    const binary = options.binaryPath || findCompiledBinary();

    if (!binary) {
      console.error('');
      console.error('❌ 未找到编译后的二进制文件。');
      console.error('   请先运行编译命令:');
      console.error('     Windows:  bun run build:win');
      console.error('     macOS:    bun run build:mac');
      console.error('     Linux:    bun run build:linux');
      console.error('');
      console.error('   或者使用 --dev 参数以开发模式运行:');
      console.error('     bun run scripts/install-service.ts install --dev');
      console.error('');
      process.exit(1);
    }

    execPath = binary;
    args = ['daemon'];
    workingDir = APP_DIR;
  }

  return {
    name: SERVICE_NAME,
    displayName: SERVICE_DISPLAY_NAME,
    description: SERVICE_DESCRIPTION,
    execPath,
    args,
    workingDir,
    envVars: {
      LIRI_SERVICE_MODE: '1',
    },
    // Windows 平台默认自动查找 nssm；--schtasks 时强制使用 schtasks
    // （nssm 注册系统服务需要管理员权限，普通用户无法创建服务）
    nssmPath: options.forceSchtasks ? undefined : findNssmPath(),
  };
}

/**
 * 查找 bun 可执行文件路径
 * 优先返回真实的 bun.exe（shim 如 bun.ps1 无法被计划任务/服务直接 CreateProcess 执行）
 */
function findBunPath(): string {
  const isWin = process.platform === 'win32';

  if (isWin) {
    // 1. npm 全局安装的真实 exe
    const npmBun = join(
      process.env.APPDATA ?? '',
      'npm',
      'node_modules',
      'bun',
      'bin',
      'bun.exe'
    );
    if (existsSync(npmBun)) return npmBun;

    // 2. 用户级 ~/.bun 安装
    const userBun = join(homedir(), '.bun', 'bin', 'bun.exe');
    if (existsSync(userBun)) return userBun;
  }

  try {
    const result = execSync('where bun', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: 'cmd.exe',
    });
    const lines = result
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // 3. 全局路径中优先 .exe（跳过 .ps1/.cmd shim）
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exe) return exe;
    if (lines.length > 0) return lines[0];
  } catch {
    // fallback to global path
  }

  return isWin ? 'bun.exe' : 'bun';
}

/**
 * 获取平台名称的中文描述
 */
function getPlatformLabel(forceSchtasks = false): string {
  switch (process.platform) {
    case 'win32':
      return forceSchtasks || !findNssmPath() ? 'Windows (schtasks)' : 'Windows (nssm)';
    case 'darwin':
      return 'macOS (launchd)';
    case 'linux':
      return 'Linux (systemd)';
    default:
      return process.platform;
  }
}

/**
 * 执行服务操作并打印结果
 */
function executeAction(service: DaemonService, action: Action): void {
  const actionLabels: Record<Action, string> = {
    install: '安装',
    uninstall: '卸载',
    start: '启动',
    stop: '停止',
    restart: '重启',
    status: '状态查询',
  };

  console.log(`\n🔧 正在${actionLabels[action]}服务...`);

  const result = service.execute(action);

  if (result.success) {
    console.log(`✅ ${actionLabels[action]}成功: ${result.message}`);
  } else {
    console.error(`❌ ${actionLabels[action]}失败: ${result.message}`);
    process.exit(1);
  }
}

/**
 * 显示服务详细信息
 */
function showServiceInfo(service: DaemonService, config: ServiceConfig, forceSchtasks = false): void {
  const status = service.getStatus();

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  Liri 守护进程服务信息');
  console.log('═══════════════════════════════════════');
  console.log(`  平台:         ${getPlatformLabel(forceSchtasks)}`);
  console.log(`  服务名称:     ${config.name}`);
  console.log(`  显示名称:     ${config.displayName}`);
  console.log(`  描述:         ${config.description}`);
  console.log(`  可执行文件:   ${config.execPath}`);
  console.log(`  参数:         ${config.args.join(' ')}`);
  console.log(`  工作目录:     ${config.workingDir}`);
  console.log(`  运行状态:     ${status.running ? '🟢 运行中' : '🔴 已停止'}`);
  if (status.pid !== undefined) {
    console.log(`  PID:          ${status.pid}`);
  }
  if (status.uptime !== undefined) {
    const uptimeSec = Math.floor(status.uptime / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    console.log(`  运行时长:     ${hours}时${mins}分${secs}秒`);
  }
  console.log('───────────────────────────────────────');
  console.log('  管理命令:');
  console.log(`    启动:   bun run scripts/install-service.ts start`);
  console.log(`    停止:   bun run scripts/install-service.ts stop`);
  console.log(`    重启:   bun run scripts/install-service.ts restart`);
  console.log(`    状态:   bun run scripts/install-service.ts status`);
  console.log(`    卸载:   bun run scripts/install-service.ts uninstall`);
  console.log('═══════════════════════════════════════\n');
}

/**
 * 主函数
 */
function main(): void {
  const options = parseArgs();

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  Liri 跨平台服务管理工具');
  console.log(`  平台: ${getPlatformLabel(options.forceSchtasks)}`);
  console.log(`  模式: ${options.devMode ? '开发模式 (bun)' : '生产模式 (编译二进制)'}`);
  console.log('═══════════════════════════════════════\n');

  const config = buildServiceConfig(options);
  const service = new DaemonService(config);

  if (!options.devMode) {
    const binaryPath = options.binaryPath || findCompiledBinary();
    if (binaryPath) {
      console.log(`  编译产物: ${binaryPath}\n`);
    }
  }

  executeAction(service, options.action);

  if (options.action === 'install' || options.action === 'status') {
    showServiceInfo(service, config, options.forceSchtasks);
  }
}

main();
