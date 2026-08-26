/**
 * PythonPluginInstaller — Python 插件安装器（PY-6）
 *
 * 职责（已定案 b：安装时输出 plugin.json 桥接清单）：
 * 1. 创建独立 venv（每插件一个，与一插件一进程对齐）
 * 2. venv 内 pip install requirements（失败回滚：清 venv）
 * 3. 生成/更新 plugin.json 桥接清单（含 entry.python），供 PluginLoader 文件发现链路识别
 *
 * 安全策略（3.6）：独立 venv 隔离；依赖白名单/用户确认由安装入口层执行，本模块仅安装。
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { PythonPluginConfig } from '../core/PythonPluginAdapter';

const logger = getLogger('plugins:install:pythonPluginInstaller');

/** Python 安装结果 */
export interface PythonInstallResult {
  success: boolean;
  /** venv 内解释器路径（spawn 必传） */
  venvPythonPath?: string;
  /** 桥接清单路径 */
  bridgeManifestPath?: string;
  error?: string;
}

/** venv 解释器路径（Windows Scripts/ 下，Unix bin/ 下） */
function venvPythonPath(venvDir: string): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');
}

/**
 * 已知二进制（带 C 扩展）包黑名单（PY-6 白名单收紧）：
 * 这些包无法用纯 Python 判断其依赖树，供应链风险高，首版拒绝自动安装。
 */
const BINARY_PACKAGE_BLACKLIST = [
  'numpy',
  'scipy',
  'pandas',
  'torch',
  'tensorflow',
  'opencv-python',
  'opencv-contrib-python',
  'lxml',
  'pydantic',
  'pydantic-core',
  'cryptography',
  'pyaudio',
  'pillow',
  'matplotlib',
  'scikit-learn',
];

/** 解析 requirements 项中的包名（去除版本/约束/索引前缀） */
function packageNameFromRequirement(req: string): string {
  // 处理常见形式：pkg、pkg==1.0、pkg>=1.0、pkg[extra]>=1.0、-e git+...
  const cleaned = req.trim().replace(/^[^a-zA-Z0-9_.-]+/, '');
  const base = cleaned.split(/[<>=!~\[ ]/)[0];
  return base.toLowerCase();
}

/** 检查 requirements 是否命中二进制包黑名单 */
export function findBlacklistedRequirements(requirements: string[]): string[] {
  const blacklisted: string[] = [];
  for (const req of requirements) {
    const name = packageNameFromRequirement(req);
    if (name && BINARY_PACKAGE_BLACKLIST.includes(name)) {
      blacklisted.push(name);
    }
  }
  return blacklisted;
}

/**
 * 为 Python 插件安装依赖并生成桥接清单
 * @param pluginDir 插件安装目录
 * @param manifest 插件 manifest（含 entry.python / python 版本约束）
 * @param pythonPath 系统 python 解释器（用于创建 venv）
 * @returns 安装结果（venv 解释器路径）
 */
export async function installPythonPlugin(
  pluginDir: string,
  manifest: {
    id?: string;
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    entry?: { python?: string };
    python?: string;
    requirements?: string[];
  },
  pythonPath = 'python'
): Promise<PythonInstallResult> {
  const entryPython = manifest.entry?.python;
  if (!entryPython) {
    return { success: false, error: 'manifest 缺少 entry.python' };
  }

  const bridgePath = join(pluginDir, 'plugin.json');
  // 已存在桥接清单（含 entry.python）则跳过
  if (existsSync(bridgePath)) {
    try {
      const existing = JSON.parse(readFileSync(bridgePath, 'utf-8'));
      if (existing.entry?.python) {
        return {
          success: true,
          venvPythonPath: venvPythonPath(join(pluginDir, '.venv')),
          bridgeManifestPath: bridgePath,
        };
      }
    } catch {
      // 解析失败按未安装处理
    }
  }

  // 1. 创建独立 venv
  const venvDir = join(pluginDir, '.venv');
  const create = spawnSync(pythonPath, ['-m', 'venv', venvDir], {
    stdio: 'pipe',
    encoding: 'utf-8',
    timeout: 120_000,
  });
  if (create.status !== 0) {
    rmSync(venvDir, { recursive: true, force: true });
    return {
      success: false,
      error: `创建 venv 失败: ${create.stderr?.trim() || create.stdout?.trim() || 'unknown'}`,
    };
  }
  const py = venvPythonPath(venvDir);

  // 2. venv 内安装依赖（失败回滚：清 venv；白名单：拒绝已知二进制包）
  const requirements = manifest.requirements ?? [];
  const blacklisted = findBlacklistedRequirements(requirements);
  if (blacklisted.length > 0) {
    rmSync(venvDir, { recursive: true, force: true });
    return {
      success: false,
      error: `依赖含白名单外二进制包，已拒绝安装: ${blacklisted.join(', ')}（首版仅支持纯 Python 依赖）`,
    };
  }
  if (requirements.length > 0) {
    const pip = spawnSync(py, ['-m', 'pip', 'install', ...requirements], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 300_000,
    });
    if (pip.status !== 0) {
      rmSync(venvDir, { recursive: true, force: true });
      return {
        success: false,
        error: `pip install 失败: ${pip.stderr?.trim() || pip.stdout?.trim() || 'unknown'}`,
      };
    }
  }

  // 3. 生成 plugin.json 桥接清单（扁平格式，PluginLoader.loadManifest 兼容）
  const bridge = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    type: 'python',
    entry: { python: entryPython },
    python: manifest.python,
    main: '',
  };
  try {
    writeFileSync(bridgePath, JSON.stringify(bridge, null, 2), 'utf-8');
  } catch (error) {
    rmSync(venvDir, { recursive: true, force: true });
    return {
      success: false,
      error: `写入桥接清单失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  logger.info(`Python plugin 安装完成: ${bridge.id}`, {
    venv: venvDir,
    requirements: requirements.length,
  });
  return { success: true, venvPythonPath: py, bridgeManifestPath: bridgePath };
}

/** 卸载 Python 插件：移除 venv 与桥接清单（uninstall 时调用） */
export function uninstallPythonPlugin(pluginDir: string): void {
  try {
    rmSync(join(pluginDir, '.venv'), { recursive: true, force: true });
  } catch (error) {
    logger.warn('卸载 Python venv 失败', { error });
  }
}

/**
 * 从插件目录解析 PythonPluginConfig（M1 编排层核心）
 * 发现链路消费方：市场安装生成 plugin.json（type:'python' + entry.python）后，
 * 本函数解析 venv 解释器 + 入口脚本，构造可直接 registerPythonPlugin 的配置。
 * @param pluginDir 插件安装目录
 * @returns PythonPluginConfig；非 Python 插件/清单缺失返回 null
 */
export function resolvePythonPluginConfig(
  pluginDir: string
): PythonPluginConfig | null {
  const bridgePath = join(pluginDir, 'plugin.json');
  if (!existsSync(bridgePath)) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(bridgePath, 'utf-8'));
  } catch {
    return null;
  }
  const base =
    parsed && typeof parsed.plugin === 'object' && parsed.plugin !== null
      ? (parsed.plugin as Record<string, unknown>)
      : parsed;
  const entryPython =
    base.entry && typeof base.entry === 'object'
      ? (base.entry as Record<string, unknown>).python
      : undefined;
  if (base.type !== 'python' || typeof entryPython !== 'string') {
    return null;
  }

  // venv 内解释器（P0-1：spawn 必传，杜绝 PATH 误用）
  const venvPython =
    process.platform === 'win32'
      ? join(pluginDir, '.venv', 'Scripts', 'python.exe')
      : join(pluginDir, '.venv', 'bin', 'python');

  return {
    pluginId: String(base.id ?? ''),
    pluginName: String(base.name ?? ''),
    version: String(base.version ?? '0.1.0'),
    pythonPath: venvPython,
    workerScript: join(pluginDir, entryPython),
    inject: Array.isArray(base.inject) ? (base.inject as string[]) : undefined,
    injectOptional: Array.isArray(base.injectOptional)
      ? (base.injectOptional as string[])
      : undefined,
    env: process.env,
  };
}
