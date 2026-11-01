/**
 * 父进程存活看门狗（2026-10-24 · 基础设施专项 §6-#5 的第一刀：**子进程自清**）。
 *
 * 问题：长程任务 / 守护模式下主进程被 OOM、Ctrl+C 或 kill -9 硬杀时来不及 `stop()`，
 * 已拉起的侧车（LSP / 媒体）会变成**孤儿进程**并占住端口或子进程句柄 ⇒ 新实例反复
 * `EADDRINUSE`，形成"重启死亡螺旋"。
 *
 * 做法（契约对称）：
 *  ① 父进程 spawn 时注入 `<prefix>SIDECAR_PARENT_PID`（见 {@link parentPidEnv}）；
 *  ② 子进程在入口调用 {@link installParentLivenessGuard}，发现父进程不在即自我退出。
 *
 * ⚠️ 边界（如实）：
 *  - **只覆盖"子进程自清"**。启动期清理**历史孤儿**（按特征扫描并强杀）需要进程登记表，
 *    另立专项（基础设施专项 §6-#5 的剩余部分）；
 *  - 无该环境变量 ⇒ **完全不介入**（桌面端 / 其它父进程拉起时零行为变更）；
 *  - 检测间隔默认 2s（`intervalMs` 可覆写），即最坏约 2s 后自清。
 */
import { getProductIdentity } from '@openliri/kernel';

/** 注入给子进程的环境变量名（默认 `LIRI_SIDECAR_PARENT_PID`） */
export function parentPidEnvKey(): string {
  // 复用产品身份前缀（`envPrefix` 已规范化为以 `_` 结尾），不新增内核导出面。
  return `${getProductIdentity().envPrefix}SIDECAR_PARENT_PID`;
}

/** 父进程侧：spawn 时合并进子进程 env */
export function parentPidEnv(
  pid: number = process.pid
): Record<string, string> {
  return { [parentPidEnvKey()]: String(pid) };
}

/** 判断进程是否存在（`EPERM` = 存在但无权限 ⇒ 视为存活） */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ParentGuardDeps {
  /** 读取父 PID 的环境（默认 `process.env`；测试注入） */
  env?: NodeJS.ProcessEnv;
  /** 检测间隔（默认 2000ms） */
  intervalMs?: number;
  /** 存活判定（默认 `process.kill(pid, 0)`；测试注入） */
  isAlive?: (pid: number) => boolean;
  /** 退出动作（默认 `process.exit`；测试注入） */
  exit?: (code?: number) => void;
  /** 自清前的回调（日志 / 测试观测） */
  onDetach?: (parentPid: number) => void;
}

/**
 * 安装看门狗，返回 disposer（停表）。
 * 未注入父 PID ⇒ 返回空 disposer，**不建定时器**。
 */
export function installParentLivenessGuard(
  deps: ParentGuardDeps = {}
): () => void {
  const env = deps.env ?? process.env;
  const parentPid = Number.parseInt(env[parentPidEnvKey()]?.trim() ?? '', 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    return () => undefined;
  }

  const isAlive = deps.isAlive ?? defaultIsAlive;
  const exit = deps.exit ?? ((code?: number) => process.exit(code));
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped || isAlive(parentPid)) return;
    stopped = true;
    clearInterval(timer);
    deps.onDetach?.(parentPid);
    exit(0);
  }, deps.intervalMs ?? 2_000);

  // 不阻止进程自然退出（看门狗不该成为"进程退不出去"的原因）
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
