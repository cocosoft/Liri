/**
 * p38-inbox-probe.ts — `verify:p38` 的**子进程**审批项播种器（2026-11-10）
 *
 * 单独成进程的原因：`InboxManager` 会持有 sqlite 句柄，若在验证主进程里创建审批项，
 * 临时目录在退出时删不掉（Windows 句柄延迟释放）。子进程创建完即退出 ⇒ 句柄随之释放。
 *
 * 输入（env）：`P38_RECEIVER_BASE`（如 `http://127.0.0.1:53649`）；
 * 输出（stdout 末行）：`{"okId":"…","failId":"…"}`
 */
import { inboxManager } from '@openliri/service/runtime/InboxManager';

const base = process.env.P38_RECEIVER_BASE;
if (!base) {
  console.error('缺少 P38_RECEIVER_BASE');
  process.exit(2);
}

async function make(title: string, path: string): Promise<string> {
  const item = await inboxManager.submit({
    sessionId: 'sess-p38-verify',
    type: 'approval',
    title,
    message: 'P38 端到端验证探针',
    offlineCapable: false,
    source: 'verify:p38',
    channelId: 'webhook',
    channelSessionId: `${base}${path}`,
  } as never);
  return (item as { id: string }).id;
}

const okId = await make('P38 探针-成功', '/ok');
const failId = await make('P38 探针-失败', '/fail');
console.log(JSON.stringify({ okId, failId }));
process.exit(0);
