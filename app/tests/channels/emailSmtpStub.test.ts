/**
 * 邮件通道 SMTP 协议桩（2026-11-01，非 HTTP 通道的第一条）。
 *
 * Email 走**自研 SMTP 客户端**（`node:net`），无法用 fetch mock。这里起一个**本机临时
 * SMTP 服务**（127.0.0.1，随机端口），走完 EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA，
 * 然后把实际投递的 MIME 报文抓下来断言：收件人、RFC 2047 主题编码（中文）、正文。
 *
 * 边界（如实）：只覆盖明文 SMTP（STARTTLS 由服务端回 500 走降级分支），不覆盖 TLS 握手本身。
 */
import { describe, expect, it, afterEach } from 'bun:test';
import { createServer, type Server, type Socket } from 'node:net';
import { createEmailChannel } from '../../src/channels/email/EmailChannel';

interface SmtpStub {
  server: Server;
  port: number;
  data: string[];
  commands: string[];
}

function startSmtpStub(): Promise<SmtpStub> {
  const data: string[] = [];
  const commands: string[] = [];
  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf-8');
    socket.write('220 stub ESMTP\r\n');
    let buffer = '';
    let inData = false;
    let stage: 'idle' | 'awaitUser' | 'awaitPass' = 'idle';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 OK id=<msg-1@stub>\r\n');
          } else {
            data.push(line);
          }
          continue;
        }

        commands.push(line);
        if (line.startsWith('EHLO')) socket.write('250 OK\r\n');
        else if (line === 'STARTTLS') socket.write('500 not supported\r\n');
        else if (line === 'AUTH LOGIN') {
          stage = 'awaitUser';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (stage === 'awaitUser') {
          stage = 'awaitPass';
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (stage === 'awaitPass') {
          stage = 'idle';
          socket.write('235 Authentication succeeded\r\n');
        } else if (line.startsWith('MAIL FROM')) socket.write('250 OK\r\n');
        else if (line.startsWith('RCPT TO')) socket.write('250 OK\r\n');
        else if (line === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === 'QUIT') socket.write('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {
      /* 测试内忽略连接错误 */
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, data, commands });
    });
  });
}

let stub: SmtpStub | null = null;

afterEach(async () => {
  if (stub) {
    await new Promise<void>((resolve) => stub!.server.close(() => resolve()));
    stub = null;
  }
});

async function connect(
  stubPort: number
): Promise<ReturnType<typeof createEmailChannel>> {
  const ch = createEmailChannel();
  await ch.lifecycle.connect({
    host: '127.0.0.1',
    port: stubPort,
    secure: false,
    user: 'u@example.com',
    pass: 'secret',
    fromAddress: 'from@example.com',
    fromName: 'Liri',
  });
  return ch;
}

describe('邮件通道 SMTP 桩', () => {
  it('握手顺序 + 投递报文的 To/Subject（RFC 2047）/正文', async () => {
    stub = await startSmtpStub();
    const ch = await connect(stub.port);

    const r = await ch.outbound.sendText('to@example.com', '你好，世界');

    expect(r.success).toBe(true);
    // 握手与投递命令（顺序即协议契约）
    const seq = stub.commands.filter((c) =>
      /^(EHLO|AUTH|MAIL FROM|RCPT TO|DATA|QUIT)/.test(c)
    );
    expect(seq[0]!.startsWith('EHLO')).toBe(true);
    expect(seq[1]).toBe('AUTH LOGIN');
    expect(seq).toContain('MAIL FROM:<from@example.com>');
    expect(seq).toContain('RCPT TO:<to@example.com>');
    expect(seq).toContain('DATA');

    // MIME 报文：中文主题必须走 RFC 2047 base64 编码（上游/邮件客户端才认得）
    const mail = stub.data.join('\r\n');
    expect(mail).toContain('To: to@example.com');
    const subjectB64 = Buffer.from('Liri 消息通知', 'utf-8').toString('base64');
    expect(mail).toContain(`Subject: =?UTF-8?B?${subjectB64}?=`);
    expect(mail).toContain('MIME-Version: 1.0');
    expect(mail).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(mail).toContain('你好，世界');

    await ch.lifecycle.disconnect();
  });
});
