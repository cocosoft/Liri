/**
 * 第三方插件**子进程入口**（T25-08 P1）。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P1：子进程宿主」。
 *
 * 通信（复用 `@modules/utils/sidecarIpc`，禁第三套 IPC）：
 * - 出：`{type:'startup', pid, protocolVersion}` —— **完成导入 + 生命周期之后**才发，
 *   让宿主的 `start()` 成功即代表"插件已就绪"；
 * - 出：`{type:'notify', event:'tools.register', data:{tools}}` 声明工具形状；
 * - 出：`{type:'notify', event:'log'|'start.failed'}`；
 * - 入：`{id, method, params}` ⇒ 出 `{id, success, result|error}`。
 *
 * 能力面（**最小集**，其余一律 fail-closed 回 `NOT_IMPLEMENTED`）：
 * - `tool.execute`：调用插件声明的 handler；
 * - `plugin.lifecycle`：`deactivate` / `destroy`；
 * - `plugin.shutdown`：执行 `destroy` 后自退。
 *
 * 隔离边界（如实）：本进程**不继承宿主 `process.env`**（见 `buildPluginHostEnv`），
 * 因此读不到 `.env` 里的密钥；但**文件系统 / 网络仍与宿主同用户权限** ——
 * 那属于沙箱（Landlock 等）的职责，不在本切片承诺范围内。
 */
import readline from 'node:readline';
import { installParentLivenessGuard } from '@modules/utils/parentLiveness';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  decodeFrame,
  encodeFrame,
} from '@modules/utils/sidecarIpc';
import { createPluginContext } from '../../plugin-sdk/core';
import type { PluginContext } from '../../plugin-sdk/types';
import {
  PLUGIN_HOST_CHILD_METHOD,
  PLUGIN_HOST_EVENT,
  PLUGIN_HOST_METHOD,
  buildPluginHostChildRequest,
  readPluginConfigSnapshot,
  readPluginHostTarget,
} from './pluginHostProtocol';
import type { PluginToolDeclaration } from '../utils/toolRegistration';

type ToolHandler = (input: Record<string, unknown>) => unknown;

interface CollectedTool {
  declaration: PluginToolDeclaration;
  handler: ToolHandler;
}

/** 子进程入口依赖（测试可注入流与模块加载器，不真起进程） */
export interface PluginHostChildDeps {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  pid?: number;
  env?: NodeJS.ProcessEnv;
  /** 入口模块加载器（缺省真实 `import()`；测试注入假模块） */
  importEntry?: (entryPath: string) => Promise<unknown>;
  /** `plugin.shutdown` 之后的自退动作（缺省 `process.exit(0)`；测试注入替身） */
  onShutdown?: () => void;
  /** 子进程 → 宿主 请求的等待上限（默认 10s） */
  hostRequestTimeoutMs?: number;
}

export interface PluginHostChildHandle {
  /** 停心跳 + 解绑 stdin（不执行插件钩子） */
  stop(): void;
}

/**
 * 启动子进程侧运行时（在已注入 env 的前提下）。
 *
 * 失败（缺 env / 导入失败 / `initialize` 抛错）⇒ 发 `start.failed` 通知并返回句柄，
 * **由调用方决定是否 `process.exit`**（测试里不退出进程）。
 */
export function startPluginHostChild(
  deps: PluginHostChildDeps = {}
): PluginHostChildHandle {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const env = deps.env ?? process.env;

  const send = (frame: Record<string, unknown>): void => {
    try {
      output.write(encodeFrame(frame));
    } catch {
      // @ignore-catch — 子进程 → 宿主的出口；写失败（管道已断）无补救路径，静默即可
    }
  };

  /** 写完这一帧**再**执行后续（`plugin.shutdown` 用：回包不能因进程自退而丢） */
  const sendThen = (
    frame: Record<string, unknown>,
    after: () => void
  ): void => {
    try {
      output.write(encodeFrame(frame), () => after());
    } catch {
      after();
    }
  };

  const log = (level: string, message: string): void =>
    send({
      type: 'notify',
      event: PLUGIN_HOST_EVENT.LOG,
      data: { level, message },
    });

  const stopGuard = installParentLivenessGuard({ env });

  let rl: readline.Interface | null = null;

  // ── 子进程 → 宿主 的请求（当前仅 `config.set`）──────────────────────────
  // 复用同一套 request/response 帧（id 带 `child_` 前缀，宿主据此分流）。
  // ⚠️ 必须声明在 `handle` 之前：缺 env 时会提前 return，而 `handle.stop()` 仍要
  // 清理在飞请求（否则命中 TDZ）。
  let childSeq = 0;
  const childPending = new Map<
    string,
    {
      resolve: (frame: Record<string, unknown>) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const handle: PluginHostChildHandle = {
    stop: () => {
      stopGuard();
      rl?.close();
      // 停读后不可能再收到回包 ⇒ 在飞请求立即失败（不留悬挂定时器）
      abortChildRequests('插件宿主已关闭');
    },
  };

  const target = readPluginHostTarget(env);
  if (!target) {
    send({
      type: 'notify',
      event: PLUGIN_HOST_EVENT.START_FAILED,
      data: { message: '插件宿主缺少必要环境变量（id/dir/entry）' },
    });
    return handle;
  }

  const tools = new Map<string, ToolHandler>();
  let context: PluginContext | null = null;
  let instance: Record<string, unknown> | null = null;

  const callHost = (
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const frame = buildPluginHostChildRequest(++childSeq, method, params);
      const id = String(frame.id);
      const timeoutMs = deps.hostRequestTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        childPending.delete(id);
        reject(new Error(`插件宿主请求超时：${method}`));
      }, timeoutMs);
      childPending.set(id, { resolve, reject, timer });
      try {
        output.write(encodeFrame(frame));
      } catch (error) {
        clearTimeout(timer);
        childPending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  /** 在飞请求全部失败（宿主停止/通道断开时用；函数声明可被上方 `handle` 提前引用） */
  function abortChildRequests(reason: string): void {
    for (const [id, pending] of childPending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      childPending.delete(id);
    }
  }

  const settleChildRequest = (frame: Record<string, unknown>): void => {
    const id = frame.id;
    if (typeof id !== 'string') return;
    const pending = childPending.get(id);
    if (!pending) return;
    childPending.delete(id);
    clearTimeout(pending.timer);
    if (frame.success === false) {
      const err = (frame.error ?? {}) as Record<string, unknown>;
      pending.reject(new Error(String(err.message ?? '插件宿主请求失败')));
      return;
    }
    pending.resolve(frame);
  };

  /**
   * 插件配置 API。
   *
   * - **读**：来自宿主下发的一次性快照（`config.get` 是同步签名，不能在 `initialize` 里等往返）；
   * - **写**：`set()` 排队 → `save()` 一次 flush 并经宿主校验+落盘；失败在 `save()` 抛出，
   *   插件能看见原因（不静默成功）。
   * - 无快照（未授权 `config`）⇒ 返回 `undefined`，`createPluginContext` 回落 no-op 实现。
   */
  const buildConfigApi = (): PluginContext['config'] | undefined => {
    const snapshot = readPluginConfigSnapshot(env);
    if (snapshot === null) return undefined;
    const values = new Map<string, unknown>(Object.entries(snapshot));
    const pendingWrites: Array<Promise<unknown>> = [];
    return {
      get: <T>(key: string, defaultValue?: T): T =>
        (values.has(key) ? values.get(key) : defaultValue) as T,
      set: <T>(key: string, value: T): void => {
        const write = callHost(PLUGIN_HOST_CHILD_METHOD.CONFIG_SET, {
          key,
          value,
        }).then(() => {
          values.set(key, value);
        });
        // 失败要留到 save() 抛给插件；这里先挂空 catch，避免未 await 期间触发
        // unhandledRejection（进程级告警会把插件的正常容错误报成崩溃）
        write.catch(() => undefined);
        pendingWrites.push(write);
      },
      save: async (): Promise<void> => {
        const writes = pendingWrites.splice(0);
        await Promise.all(writes);
      },
    };
  };

  const runHook = async (names: readonly string[]): Promise<void> => {
    if (!instance || !context) return;
    for (const name of names) {
      const hook = instance[name];
      if (typeof hook !== 'function') continue;
      await (hook as (ctx: PluginContext) => unknown).call(instance, context);
      return;
    }
  };

  const onRequest = async (frame: Record<string, unknown>): Promise<void> => {
    const id = frame.id;
    if (typeof id !== 'string') return;
    const method = frame.method;
    const params = (frame.params ?? {}) as Record<string, unknown>;

    try {
      if (method === PLUGIN_HOST_METHOD.TOOL_EXECUTE) {
        const name = params['name'];
        if (typeof name !== 'string' || !tools.has(name)) {
          throw new Error(`插件未声明工具：${String(name)}`);
        }
        const handler = tools.get(name)!;
        const result = await handler(
          (params['input'] ?? {}) as Record<string, unknown>
        );
        send({ id, success: true, result: result ?? null });
        return;
      }
      if (method === PLUGIN_HOST_METHOD.LIFECYCLE) {
        const phase = params['phase'];
        if (phase === 'deactivate') await runHook(['deactivate', 'stop']);
        else if (phase === 'destroy') await runHook(['destroy', 'unload']);
        else throw new Error(`不支持的生命周期阶段：${String(phase)}`);
        send({ id, success: true, result: null });
        return;
      }
      if (method === PLUGIN_HOST_METHOD.SHUTDOWN) {
        await runHook(['destroy', 'unload']);
        // 回包**先落地**再停读/自退（否则宿主会因丢包而走超时强杀）
        sendThen({ id, success: true, result: null }, () => {
          handle.stop();
          deps.onShutdown?.();
        });
        return;
      }
      throw new Error(`插件宿主未实现的方法：${String(method)}`);
    } catch (error) {
      send({
        id,
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  // ── 异步启动（不阻塞 send/心跳注册）────────────────────────────────────
  void (async () => {
    const importEntry =
      deps.importEntry ?? ((p: string) => import(/* @vite-ignore */ p));
    try {
      const mod = await importEntry(target.entryPath);
      instance = resolvePluginObject(mod);
      const collected = collectTools(instance, mod);
      for (const t of collected) tools.set(t.declaration.name, t.handler);

      context = createPluginContext({
        pluginId: target.pluginId,
        pluginName:
          typeof instance?.['name'] === 'string'
            ? (instance['name'] as string)
            : target.pluginId,
        version:
          typeof instance?.['version'] === 'string'
            ? (instance['version'] as string)
            : '',
        log: {
          debug: (m: string) => log('debug', m),
          info: (m: string) => log('info', m),
          warn: (m: string) => log('warn', m),
          error: (m: string) => log('error', m),
        },
        config: buildConfigApi(),
      });

      await runHook(['initialize']);
      await runHook(['activate', 'start']);

      send({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.TOOLS_REGISTER,
        data: { tools: collected.map((t) => t.declaration) },
      });
      send({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: deps.pid ?? process.pid,
      });
    } catch (error) {
      send({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.START_FAILED,
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  })();

  rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    const frame = decodeFrame(line);
    if (!frame) return;
    if (typeof frame.id === 'string' && typeof frame.method === 'string') {
      void onRequest(frame);
      return;
    }
    // 宿主对我方请求的**回包**（只有 id + success，没有 method）
    if (typeof frame.id === 'string') settleChildRequest(frame);
    // 其它帧（heartbeat / notify）当前不消费：宿主不下发控制帧
  });

  return handle;
}

// 独立/子进程启动（宿主以 `runtime [本文件]` 拉起）；env 已由 `buildPluginHostEnv` 注入
if (import.meta.main) {
  startPluginHostChild({ onShutdown: () => process.exit(0) });
}

/**
 * 从模块命名空间解析插件对象。
 *
 * 接受：`export default` 的**类**（无参实例化）或**对象**；也接受 `export const plugin`。
 * 无法判定 ⇒ `null`（宿主不会因此崩：工具面为空、生命周期全跳过）。
 */
export function resolvePluginObject(
  mod: unknown
): Record<string, unknown> | null {
  const ns = (mod ?? {}) as Record<string, unknown>;
  const candidate = ns['default'] ?? ns['plugin'] ?? ns;
  if (typeof candidate === 'function') {
    try {
      return new (candidate as new () => object)() as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return candidate && typeof candidate === 'object'
    ? (candidate as Record<string, unknown>)
    : null;
}

/**
 * 收集插件声明的工具（`instance.tools` 或模块级 `tools`）。
 *
 * 只收**带 `execute` 函数**的项（没有 handler 就无法跨进程执行，声明它只会造出必然失败的工具）。
 */
export function collectTools(
  instance: Record<string, unknown> | null,
  mod: unknown
): CollectedTool[] {
  const ns = (mod ?? {}) as Record<string, unknown>;
  const raw: unknown[] = [];
  if (Array.isArray(instance?.['tools']))
    raw.push(...(instance!['tools'] as unknown[]));
  if (Array.isArray(ns['tools'])) raw.push(...(ns['tools'] as unknown[]));

  const out: CollectedTool[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const name = t['name'];
    const handler = t['execute'];
    if (typeof name !== 'string' || !name) continue;
    if (typeof handler !== 'function') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      declaration: {
        name,
        description:
          typeof t['description'] === 'string' ? t['description'] : '',
        parameters:
          t['parameters'] && typeof t['parameters'] === 'object'
            ? (t['parameters'] as Record<string, unknown>)
            : undefined,
      },
      handler: (input) =>
        (handler as (i: Record<string, unknown>) => unknown).call(item, input),
    });
  }
  return out;
}
