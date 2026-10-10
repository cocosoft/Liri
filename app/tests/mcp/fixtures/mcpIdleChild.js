// P2-8 契约测试夹具：一个「保持存活」的 stdio 子进程。
// 用途：验证 SDK 轨（`StdioClientTransport`）子进程的**回收边界** —— SDK 轨不在
// `ChildProcessTracker` 内，其回收由 `transport.close()` 承接（`closeAll()` 用的就是它）。
//
// 行为：读 stdin（保持打开）⇒ 收到 stdin 'end'（transport.close() 先 end stdin）即退出。
// 不使用 require/import，node 与 bun 均可直接运行。
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
