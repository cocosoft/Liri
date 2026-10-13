// LSP 工具侧车 E2E 夹具：**方法感知**的极简「假 LSP 服务器」。
//
// 用途：为「侧车 "真接线"」做**真实进程级**打通 —— 侧车进程 `spawn` 本脚本作为**真实子进程**
// LS，按 LSP 帧（`Content-Length: N\r\n\r\n<body>`）收请求、按方法回**可断言**的结果。
//
// 与同目录 `fakeLspServer.js`（`TOOLGOV-LSP-BUN-STDIO` 回归夹具，恒回 `{ok:true}`）的差异：
// 本夹具**按 `method` 分派**（`initialize` / `textDocument/hover` / `textDocument/definition` /
// `shutdown`），使 E2E 能断言"结果确由 LS 回传"。
//
// S3 扩展（取消下传观测，`TOOLGOV-SIDECAR-S3`）：
// - `--hang-hover`：收到 `textDocument/hover` **不回复**（保持在飞，供取消下传观测）；
// - `--log <path>`：把收到的 `hover:<id>` / `cancel:<id>`（`$/cancelRequest`）追加写入该文件，
//   使父进程可断言"侧车确把取消转发为 LSP `$/cancelRequest`"。
//
// 使用 ESM（`app/package.json` `"type":"module"`）；`node` 与 `bun` 均可直接运行。
import { appendFileSync } from 'node:fs';

let buf = '';

const argv = process.argv.slice(2);
const HANG_HOVER = argv.includes('--hang-hover');
const logIdx = argv.indexOf('--log');
const LOG_PATH = logIdx >= 0 ? argv[logIdx + 1] : null;

function logNote(line) {
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, line + '\n');
  } catch {
    // 记录失败不阻断假 LS
  }
}

function writeBody(body) {
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
}

function respond(id, result) {
  writeBody(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function respondError(id, message) {
  writeBody(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } })
  );
}

function handle(msg) {
  // 通知（无 id）：initialized / didOpen / exit / **$/cancelRequest** 等
  if (msg.id === undefined) {
    if (msg.method === '$/cancelRequest') {
      const params = msg.params || {};
      logNote(`cancel:${params.id}`);
    }
    return;
  }
  switch (msg.method) {
    case 'initialize':
      return respond(msg.id, { capabilities: {} });
    case 'shutdown':
      return respond(msg.id, null);
    case 'textDocument/hover':
      logNote(`hover:${msg.id}`);
      if (HANG_HOVER) return; // 挂起：保持在飞，供取消下传观测
      return respond(msg.id, { contents: 'FAKE_HOVER' });
    case 'textDocument/definition':
      return respond(msg.id, [
        {
          uri: 'file:///fake-target.ts',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 5 },
          },
        },
      ]);
    default:
      return respondError(msg.id, `fake LS 未实现：${msg.method}`);
  }
}

function drain() {
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) return;
    const matched = buf.slice(0, sep).match(/Content-Length: (\d+)/);
    if (!matched) {
      buf = buf.slice(sep + 4);
      continue;
    }
    const len = Number(matched[1]);
    const start = sep + 4;
    if (buf.length < start + len) return; // 帧未收全，等下一块
    const body = buf.slice(start, start + len);
    buf = buf.slice(start + len);
    try {
      handle(JSON.parse(body));
    } catch {
      // 非法帧 ⇒ 忽略
    }
  }
}

process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  drain();
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
setInterval(() => {}, 1000);
