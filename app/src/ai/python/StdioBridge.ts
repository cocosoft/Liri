/**
 * StdioBridge
 * TypeScript ↔ Python 进程的 StdIO JSON-RPC 桥接层（视觉链路专用，复用 JsonRpcBridge 基类）
 *
 * 协议：每行一个 JSON 消息（换行分隔，无粘包）
 * 生命周期：spawn → startup(3s超时) → 请求/响应循环 → destroy
 *
 * 本类保持视觉链路行为不变（startup 超时 3s、默认 vision_worker.py 脚本）；
 * 通用桥能力（notify、参数化超时、env 治理）见 JsonRpcBridge。
 */
import { spawn } from 'child_process';
import path from 'path';
import { JsonRpcBridge } from './JsonRpcBridge';

/** 解析 vision_worker.py 路径（兼容开发与编译两种模式） */
function resolveVisionWorkerScript(): string {
  const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();
  return path.resolve(
    projectDir,
    'app',
    'src',
    'ai',
    'python',
    'vision_worker.py'
  );
}

/**
 * StdioBridge
 * 管理一个 Python vision_worker 子进程，支持并发请求（FIFO 序列化）
 */
export class StdioBridge extends JsonRpcBridge {
  constructor(pythonPath = 'python', workerScript?: string) {
    super({
      pythonPath,
      workerScript: workerScript ?? resolveVisionWorkerScript(),
      // 视觉链路保持原 3s startup 超时；Python 插件桥按需传更长超时
      startupTimeoutMs: 3000,
    });
  }
}

/**
 * 确保 Python 可用
 * 在首次使用前调用以检测 python 命令是否在 PATH 中
 */
export async function checkPythonAvailable(
  pythonPath = 'python'
): Promise<boolean> {
  try {
    const proc = spawn(pythonPath, ['--version'], { stdio: 'pipe' });
    return new Promise((resolve) => {
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  } catch (err) {
    return false;
  }
}

/**
 * 获取 Python 版本号（PY-4，checkPythonAvailable 只返回 boolean 不够）
 * 解析 `python --version` 输出并返回 "3.13.1" 形式；失败返回 null。
 * 注意：老版本 Python 的 --version 输出到 stderr，需 stdout/stderr 双抓。
 */
export async function getPythonVersion(
  pythonPath = 'python'
): Promise<string | null> {
  try {
    const proc = spawn(pythonPath, ['--version'], { stdio: 'pipe' });
    return new Promise((resolve) => {
      let output = '';
      proc.stdout.on('data', (d: Buffer) => {
        output += d.toString();
      });
      proc.stderr.on('data', (d: Buffer) => {
        output += d.toString();
      });
      proc.on('close', () => {
        const match = output.match(/Python\s+(\d+\.\d+(?:\.\d+)?)/);
        resolve(match ? match[1] : null);
      });
      proc.on('error', () => resolve(null));
    });
  } catch (err) {
    return null;
  }
}

/** 版本号数组化（"3.10.1" → [3,10,1]） */
function versionParts(v: string): number[] {
  return v
    .split('.')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

/** 比较两个版本（a vs b），返回 -1/0/1 */
function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * 判断当前版本是否满足 spec（如 ">=3.10" / ">=3.10.0"）
 * 无法解析的 spec 视为不限制（返回 true）。
 */
export function satisfiesPythonVersion(
  current: string | null,
  spec: string
): boolean {
  if (!current) return false;
  const match = spec.match(/^([><=]+)\s*(\d+(?:\.\d+){0,2})$/);
  if (!match) return true;
  const [, op, ver] = match;
  const cmp = compareVersions(current, ver);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '==':
      return cmp === 0;
    default:
      return true;
  }
}
