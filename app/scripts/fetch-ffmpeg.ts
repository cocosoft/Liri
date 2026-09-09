/**
 * fetch-ffmpeg.ts — 打包资源契约：将 ffmpeg/ffprobe 落到 <target>/ffmpeg/bin/
 *
 * 布局（与 media/ffmpeg/toolResolver.ts 一致）：
 *   <target>/ffmpeg/bin/{ffmpeg,ffprobe}[.exe]
 *
 * 用法:
 *   bun run scripts/fetch-ffmpeg.ts --from <bin目录|exe文件> --target <根目录>
 *     --from  指向已有 ffmpeg/ffprobe 的目录或单个可执行文件（确定性来源，CI 传预置工件）
 *     --target 产物根（默认 ../dist；tauri 资源/便携包/Docker 分别传入各自根）
 *     --platform win-x64|linux-x64|macos-arm64（仅影响扩展名与提示；默认按当前系统）
 *
 * 远端直下（BtbN/Gyan，zip/tar.xz 格式差异大）暂为 TODO：确认可用源后接入 CI，
 * 避免引入不确定下载导致发版失败。当前“内置 ffmpeg”先由 --from 显式喂入。
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Opts {
  from: string;
  target: string;
  platform: string;
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const o: Opts = { from: '', target: path.resolve(__dirname, '..', '..', 'dist'), platform: process.platform === 'win32' ? 'win-x64' : 'linux-x64' };
  for (const a of args) {
    if (a.startsWith('--from=')) o.from = a.split('=')[1];
    else if (a.startsWith('--target=')) o.target = a.split('=')[1];
    else if (a.startsWith('--platform=')) o.platform = a.split('=')[1];
  }
  if (!o.from) {
    console.error('[fetch-ffmpeg] 缺少 --from（ffmpeg 目录或 exe 路径）');
    process.exit(1);
  }
  return o;
}

const EXE = process.platform === 'win32' ? '.exe' : '';

function main(): void {
  const o = parseArgs();
  const from = path.resolve(o.from);
  const binDir = path.join(path.resolve(o.target), 'ffmpeg', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const fromStat = fs.statSync(from);
  const sources: Array<{ name: string; file: string }> = [];
  if (fromStat.isDirectory()) {
    for (const exe of ['ffmpeg', 'ffprobe']) {
      for (const cand of [path.join(from, exe + EXE), path.join(from, exe)]) {
        if (fs.existsSync(cand)) { sources.push({ name: exe + EXE, file: cand }); break; }
      }
    }
  } else {
    sources.push({ name: path.basename(from), file: from });
  }

  if (sources.length === 0) {
    console.error(`[fetch-ffmpeg] --from 下未找到 ffmpeg/ffprobe: ${from}`);
    process.exit(1);
  }

  for (const s of sources) {
    const dest = path.join(binDir, s.name);
    fs.copyFileSync(s.file, dest);
    console.log(`  ✓ ${s.name} -> ${dest}`);
  }

  const probe = path.join(binDir, 'ffmpeg' + EXE);
  const r = spawnSync(probe, ['-version'], { encoding: 'utf-8', timeout: 20_000 });
  if (r.status !== 0) {
    console.error('[fetch-ffmpeg] 产物自检失败（ffmpeg -version 非 0）');
    process.exit(1);
  }
  console.log('  version: ' + (r.stdout || '').split('\n')[0]);
  console.log('[fetch-ffmpeg] 完成');
}

main();
