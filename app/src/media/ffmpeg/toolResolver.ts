/**
 * toolResolver.ts — ffmpeg/ffprobe 可执行文件解析（打包资源契约：内置优先，PATH 兜底）
 *
 * 打包布局统一为 <运行根>/ffmpeg/bin/{ffmpeg,ffprobe}[.exe]（tauri resources / 便携包 / Docker 三处同源）。
 * 解析优先级：
 *   1. 环境变量 LIRI_FFMPEG_DIR（显式覆盖，便于测试/容器注入）
 *   2. 编译产物 exe 同级目录（Windows/Linux）或 Mac .app 的 Resources 目录
 *   3. 运行根（PYAPP_PROJECT_DIR / dist / app 子目录）
 *   4. 兜底：裸命令名（依赖系统 PATH）
 *
 * 每个候选目录内按 ['', 'ffmpeg/bin', 'ffmpeg'] 相对布局探测。
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TOOL_DIR_REL = ['', 'ffmpeg/bin', 'ffmpeg'] as const;

export type MediaTool = 'ffmpeg' | 'ffprobe';

function findToolIn(root: string, tool: MediaTool): string | undefined {
  if (!root || !fs.existsSync(root)) return undefined;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const fileName = tool + ext;
  for (const rel of TOOL_DIR_REL) {
    const candidate = path.join(root, rel, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 收集候选运行根（去重保序） */
function runRoots(): string[] {
  const roots: string[] = [];
  const envDir = process.env.LIRI_FFMPEG_DIR;
  if (envDir) roots.push(envDir);

  const exeDir = path.dirname(process.execPath);
  if (exeDir && exeDir !== '.') {
    roots.push(exeDir);
    // macOS .app: 可执行在 Contents/MacOS，资源在 Contents/Resources
    roots.push(path.join(exeDir, '..', 'Resources'));
  }

  const projectRoot = process.env.PYAPP_PROJECT_DIR || process.cwd();
  roots.push(projectRoot);
  roots.push(path.join(projectRoot, 'dist'));
  roots.push(path.join(projectRoot, 'app'));

  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/**
 * 解析 ffmpeg/ffprobe 可执行文件路径。
 * 命中内置/覆盖路径返回绝对路径；否则返回裸命令名（交给系统 PATH 解析）。
 */
export function resolveToolPath(tool: MediaTool): string {
  for (const root of runRoots()) {
    const hit = findToolIn(root, tool);
    if (hit) return hit;
  }
  return tool;
}

export const resolveFFmpegPath = (): string => resolveToolPath('ffmpeg');
export const resolveFFprobePath = (): string => resolveToolPath('ffprobe');

// 供脚本直接调用：bun run toolResolver.ts <ffmpeg|ffprobe>
const isDirectRun =
  import.meta.url && typeof process !== 'undefined' && process.argv[1];
if (
  isDirectRun &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const tool = (process.argv[2] as MediaTool) || 'ffmpeg';
  // eslint-disable-next-line no-console
  console.log(resolveToolPath(tool));
}
