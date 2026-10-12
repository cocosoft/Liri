// TOOLGOV-LSP-BUN-STDIO 回归夹具：极简「假 LSP 服务器」。
//
// 用途：验证 `LSPServer` 在 bun 下能正常 `start()` / `send()` / 解析 stdout —— 原实现因对
// `stdin` 调 `setEncoding`（bun 的 child_process 流不提供）而在 `start()` 抛错 ⇒ `status=ERROR`
// ⇒ `lsp` 工具起不来。
//
// 行为：累积 stdin ⇒ 按 LSP 帧（`Content-Length: N\r\n\r\n<body>`）解析出请求 ⇒ 回一条同 id 的
// 响应帧。不使用 require/import，node 与 bun 均可直接运行。
let buf = '';

function tryRespond() {
  const sep = buf.indexOf('\r\n\r\n');
  if (sep === -1) return;
  const matched = buf.slice(0, sep).match(/Content-Length: (\d+)/);
  if (!matched) {
    buf = buf.slice(sep + 4);
    return;
  }
  const len = Number(matched[1]);
  const start = sep + 4;
  if (buf.length < start + len) return; // 帧未收全，等下一块

  const body = buf.slice(start, start + len);
  buf = buf.slice(start + len);

  let id = 0;
  try {
    id = JSON.parse(body).id;
  } catch {
    id = 0;
  }
  const resp = JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } });
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(resp)}\r\n\r\n${resp}`
  );
}

process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  tryRespond();
});
process.stdin.resume();
setInterval(() => {}, 1000);
