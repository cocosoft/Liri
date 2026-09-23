/**
 * O4（v7.1）「终止按进程组」—— **真机验证**（方案 §8.3-① 要求：跨平台进程管理须真机取证）。
 *
 * 被修缺陷：`twoPhaseKill()` 原实现只 `child.kill()`（kill **直接**子进程）⇒ CodeRunner
 * 执行的用户脚本若再派生后台进程，**孙进程会存活**（继续占 CPU、继续改工作目录）。
 *
 * 验证方式（用"孙进程心跳文件"证明，避免依赖 PID 探测的歧义）：
 *   父进程（node/bun）──**detached 派生**──> 孙进程（每 150ms 向心跳文件追加一个字符）
 *   调 `twoPhaseKill(父)` 后断言：
 *     ① 父进程退出；
 *     ② 孙进程**不再写心跳**（后续两次取样大小相同）。
 *   并附**对照组**（复现旧行为 `child.kill()`）断言"孙进程继续写" ⇒ 证明本用例**能区分新旧实现**。
 *
 * ⚠ 为什么孙进程必须 `detached: true` 派生（本轮实测校准，勿删）：
 * 诊断实验（本机 Windows + bun，同一"父→孙"harness）显示 ——
 *   · 孙进程**非** detached 时：只 `child.kill()` 父进程，**孙进程也随之死亡**（bun/Windows 的
 *     作业对象/控制台语义把子进程一并带走）⇒ 该形态**无法判别**新旧实现；
 *   · 孙进程 `detached: true` 时：只 kill 父进程后**孙进程仍在写心跳**（6 → 14 字节），
 *     而 `taskkill /T /F` 后停止（19 → 19）⇒ **这才是 Windows 上的可判别复现**，
 *     也对应真实场景（用户脚本后台起服务/守护进程）。
 *
 * 覆盖边界（如实登记）：本机为 **Windows** ⇒ 实际验证 `taskkill /T /F` 分支；
 * POSIX 的 `process.kill(-pid)` 进程组分支**未真机验证**（需 POSIX 环境；其失败时回退 `child.kill`）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { twoPhaseKill } from '../../../src/tools/CodeRunner/CrossPlatformRunner';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir = '';
let parentScript = '';
let grandchildScript = '';

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'liri-killgroup-'));

  grandchildScript = join(dir, 'grandchild.js');
  parentScript = join(dir, 'parent.js');

  // 孙进程：每 150ms 追加一个字符到心跳文件，并把自身 pid 写到 pid 文件（供清理用）
  await fs.writeFile(
    grandchildScript,
    "const fs=require('fs');const hb=process.argv[2],pf=process.argv[3];" +
      'try{fs.writeFileSync(pf,String(process.pid))}catch{};' +
      "setInterval(()=>{try{fs.appendFileSync(hb,'.')}catch{}},150);"
  );

  // 父进程：**detached 派生**孙进程（模拟"用户脚本后台起进程"），随后自身常驻
  await fs.writeFile(
    parentScript,
    "const {spawn}=require('child_process');const hb=process.argv[2],pf=process.argv[3];" +
      "spawn(process.execPath,[require('path').join(__dirname,'grandchild.js'),hb,pf]," +
      "{stdio:'ignore',detached:true});" +
      'setInterval(()=>{},1000);'
  );
});

afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function sizeOf(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return 0;
  }
}

async function readPid(path: string): Promise<number | null> {
  try {
    const pid = Number((await fs.readFile(path, 'utf8')).trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 兜底清理（避免失败路径留下孤儿进程） */
function killByPid(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* 已退出 */
  }
}

/** 启动"父 → 孙"两级进程，返回父进程句柄与心跳/pid 文件路径 */
async function startProcessTree(tag: string) {
  const heartbeat = join(dir, `hb-${tag}.txt`);
  const pidFile = join(dir, `pid-${tag}.txt`);
  const parent = spawn(process.execPath, [parentScript, heartbeat, pidFile], {
    stdio: 'ignore',
    // 与生产 spawn 同参：POSIX 下自成进程组（Windows 无需）
    detached: process.platform !== 'win32',
  });

  // 等孙进程开始写心跳
  let waited = 0;
  while ((await sizeOf(heartbeat)) === 0 && waited < 8000) {
    await sleep(100);
    waited += 100;
  }
  return { parent, heartbeat, pidFile };
}

describe('O4「终止按进程组」：真机验证', () => {
  test('twoPhaseKill ⇒ 直接子进程与**孙进程**均终止（心跳停止）', async () => {
    const { parent, heartbeat, pidFile } = await startProcessTree('new');
    const grandchildPid = await readPid(pidFile);

    const beforeKill = await sizeOf(heartbeat);
    expect(beforeKill).toBeGreaterThan(0); // 前提：孙进程确实在跑

    const exited = new Promise<boolean>((resolve) => {
      parent.once('exit', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });

    twoPhaseKill(parent); // ← 被测实现

    // ① 直接子进程退出
    expect(await exited).toBe(true);

    // ② 孙进程不再写心跳（等一拍收尾可能的在途写入，再取两点比较）
    await sleep(600);
    const snap1 = await sizeOf(heartbeat);
    await sleep(1000);
    const snap2 = await sizeOf(heartbeat);
    expect(snap2).toBe(snap1);

    // 兜底（防实现回归导致孤儿残留）
    if (grandchildPid !== null) killByPid(grandchildPid);
  });

  test('对照组（旧行为 child.kill）⇒ 孙进程**继续**写心跳（证明本用例非空）', async () => {
    const { parent, heartbeat, pidFile } = await startProcessTree('old');
    const grandchildPid = await readPid(pidFile);

    const exited = new Promise<boolean>((resolve) => {
      parent.once('exit', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });

    // 旧实现语义：只终止直接子进程
    try {
      parent.kill('SIGTERM');
    } catch {
      /* already exited */
    }
    expect(await exited).toBe(true);

    await sleep(600);
    const snap1 = await sizeOf(heartbeat);
    await sleep(1000);
    const snap2 = await sizeOf(heartbeat);

    // 孙进程仍活着 ⇒ 心跳继续增长（这正是被修缺陷的真实后果）
    expect(snap2).toBeGreaterThan(snap1);

    // 清理孤儿（父已死 ⇒ 只能按 pid 直接杀）
    if (grandchildPid !== null) killByPid(grandchildPid);
  });
});
