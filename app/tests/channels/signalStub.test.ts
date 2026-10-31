/**
 * Signal 通道上游 CLI 契约桩（2026-11-01，非 HTTP 第三条）。
 *
 * Signal 走 `execFile('signal-cli', [...])`，不触网、也不便跨平台伪造可执行文件
 * （Windows 下 `.cmd` 需 shell）。因此本用例钉的是**上游 CLI 参数契约** + **诚实失败**：
 *   ① `-a <account> send -m <message> <target>` 的顺序与旗标；
 *   ② 图片走同一条命令、正文加 `[图片] ` 前缀；
 *   ③ 缺 account ⇒ 提前如实失败，不调起 CLI（不产生「以为发了」的假成功）。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildSignalSendArgs,
  createSignalChannel,
} from '../../src/channels/signal/SignalChannel';

describe('Signal 上游 CLI 契约', () => {
  it('文本：参数为 -a <account> send -m <message> <target>', () => {
    expect(
      buildSignalSendArgs('+8613800000000', '你好', '+8613900000000')
    ).toEqual(['-a', '+8613800000000', 'send', '-m', '你好', '+8613900000000']);
  });

  it('图片：同一命令，正文带 [图片] 前缀', () => {
    expect(
      buildSignalSendArgs('+8613800000000', '[图片] https://x/y.png', '+8613')
    ).toEqual([
      '-a',
      '+8613800000000',
      'send',
      '-m',
      '[图片] https://x/y.png',
      '+8613',
    ]);
  });

  it('未配置 account ⇒ 发送立即失败（不调起 signal-cli）', async () => {
    const ch = createSignalChannel();

    const r = await ch.outbound.sendText('+8613900000000', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toContain('缺少 account');
  });

  it('缺 account 时配置校验失败（fail-closed）', () => {
    const ch = createSignalChannel();

    const result = ch.config.validate({});

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('account'))).toBe(true);
  });
});
