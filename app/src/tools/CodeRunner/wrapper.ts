/**
 * CodeRunner wrapper 脚本生成器（CM-3 核心安全防线）
 *
 * 运行时验证发现（2026-08-25）：
 *   - Bun 全局对象（含 write/spawn 等方法）为 writable=false/configurable=false，
 *     既不能 delete 也不能覆盖 → "delete 净化"对 Bun 失效
 *   - delete globalThis.process 会破坏 Bun 运行时内部（readline/streams 依赖全局 process）→ 不可 delete
 *   - new Function 参数遮蔽存在严格模式参数名（eval）冲突与 this 泄漏问题
 *  采用 **node:vm 真实上下文隔离**（Bun 已验证支持）：
 *   - vm 上下文内 Bun/process/fetch 天然为 undefined（不注入即不可见）
 *   - 原型链逃逸被 V8 context 边界阻断（{}.constructor.constructor 无法逃出）
 *   - 顶层 await 通过 async IIFE 包装支持
 *
 *   ① 捕获 stdio + process.exit + argv + 全局异常监听
 *   ② console 接管重定向 stderr（stdout 严格保留给协议帧）
 *   ③ 注册 Bun.plugin（filter 匹配全部路径，仅放行相对/绝对路径，onLoad 抛错）堵动态 import
 *   ④ 读取用户脚本 → Bun.Transpiler().transformSync 转译 TS → JS
 *   ⑤ vm.createContext 白名单注入（__liriRuntime/console/setTimeout/...）→ 执行
 *   ⑥ done() 协议：脚本显式声明完成 → flush → exit(0)
 *      顶层异常 → JSON error 帧走 stdout + stderr + exit(1)
 *
 * wrapper 是主进程生成的受信脚本，写盘到临时目录后由 `bun run` 执行，
 * 不进入仓库源码（不经 lint:arch/typecheck）。
 */

/** 生成 wrapper 脚本内容 */
export function generateWrapperScript(): string {
  return `// CodeRunner wrapper (generated, do not edit)
import * as readline from 'node:readline';
import * as vm from 'node:vm';
import { isAbsolute } from 'node:path';
import { promises as fsp } from 'node:fs';

// ① 先捕获 stdio 引用 + 退出函数 + argv（delete 前完成）
const stdin = process.stdin;
const stdout = process.stdout;
const stderr = process.stderr;
const exit = process.exit.bind(process);
const userScriptArg = process.argv[2] || './user.ts';

// RPC 帧发送（sendFrame 需在异常监听器之前定义——回调执行时引用）
function sendFrame(obj) { stdout.write(JSON.stringify(obj) + '\\n'); }

// 全局异常兜底：结构化 error 帧 + stderr + 非 0 退出
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  sendFrame({ method: 'error', error: { type: 'UnhandledRejection', message } });
  stderr.write('CodeRunner unhandledRejection: ' + message + '\\n');
  exit(1);
});
process.on('uncaughtException', (err) => {
  const message = err instanceof Error ? err.message : String(err);
  sendFrame({
    method: 'error',
    error: {
      type: 'UncaughtException',
      message,
      stack: err instanceof Error ? err.stack : undefined,
    },
  });
  stderr.write('CodeRunner uncaughtException: ' + message + '\\n');
  exit(1);
});

// ② 接管 console：stdout 仅协议帧，用户日志走 stderr
const consoleShim = {
  log: (...args) => stderr.write(args.map(String).join(' ') + '\\n'),
  info: (...args) => stderr.write(args.map(String).join(' ') + '\\n'),
  warn: (...args) => stderr.write(args.map(String).join(' ') + '\\n'),
  error: (...args) => stderr.write(args.map(String).join(' ') + '\\n'),
};

// RPC 请求-响应配对（换行分隔 JSON 帧）
const pending = new Map();
let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  sendFrame({ id, method, params });
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
}

const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error((msg.error && msg.error.message) || 'rpc error'));
  }
});

// ③ Bun.plugin：堵住动态 import 逃逸（node:/裸模块/@scope/pkg/pkg/subpath 全拦）
Bun.plugin({
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('./') || args.path.startsWith('../') || isAbsolute(args.path)) {
        return; // 放行用户自身文件（相对/绝对路径）
      }
      return { path: '__blocked__', namespace: '__blocked__' };
    });
    build.onLoad({ filter: /.*/, namespace: '__blocked__' }, (args) => ({
      contents: 'throw new Error("blocked module: ' + args.path + '")',
      loader: 'js',
    }));
  },
});

// ④ 读取用户脚本 → 转译 TS → JS（Bun.Transpiler 需在 delete Bun 之前使用）
const runtime = {
  callTool: (name, args) => rpc('callTool', { name: String(name), args: args || {} }),
  readContext: (opts) => rpc('readContext', { opts: opts || {} }),
  writeOutput: (data) => { rpc('writeOutput', { data: data ?? null }); },
  emitEvent: (type, data) => { rpc('emitEvent', { type: String(type), data: data ?? null }); },
  done: (result) => {
    sendFrame({ method: 'done', result: result ?? null });
    exit(0);
  },
};

// ⑤ vm 真实上下文隔离：白名单注入（__liriRuntime/console/setTimeout/...），
//    Bun/process/fetch 等不注入 → 上下文内天然不可见；原型链逃逸被 context 边界阻断
const vmSandbox = {
  __liriRuntime: runtime,
  console: consoleShim,
  setTimeout,
  setInterval,
  queueMicrotask,
};
vm.createContext(vmSandbox);

async function main() {
  const source = await fsp.readFile(userScriptArg, 'utf8');
  const jsCode = new Bun.Transpiler().transformSync(source);
  // async IIFE 包装：支持脚本顶层 await
  const wrapped = '(async () => {\\n' + jsCode + '\\n})()';
  const promise = vm.runInContext(wrapped, vmSandbox, { filename: 'user.ts' });
  await promise;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  sendFrame({ method: 'error', error: { type: 'LoadError', message, stack: err instanceof Error ? err.stack : undefined } });
  stderr.write('CodeRunner load error: ' + message + '\\n');
  exit(1);
});
`;
}
