/**
 * 办公模块 HTTP API handlers
 * doc / mail / calendar 的 REST 端点
 */

import type http from 'http';
import type { EmailAccount } from '../../mail/types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'doc:api',
  level: LogLevel.INFO,
});

/**
 * 读取 HTTP 请求体
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ==================== doc 模块 API ====================

/**
 * 处理 GET /v1/doc/status
 * 获取文档模块状态（OfficeCLI 安装情况、连接状态、工具数、模板数）
 */
export async function handleDocStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { DocModule } = await import('../DocModule');
    const doc = DocModule.getInstance();

    // 懒加载触发：模块在延迟阶段可能尚未初始化，首次访问时触发 onReady()
    const statusBefore = doc.getStatus();
    if (statusBefore === 'uninitialized') {
      logger.info('DocModule 未初始化，触发延迟加载');
      await doc.onReady();
    }

    // 诊断：输出 MCPServerManager 中所有已注册服务器
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const mgr = getMCPServerManager();
      const serverNames = mgr.listServers();
      const officecliServer = mgr.getServer('officecli');
      logger.info('DocModule 状态诊断', {
        statusBefore,
        mcpServers: serverNames,
        officecliFound: !!officecliServer,
        officecliServerType: officecliServer ? typeof officecliServer : 'null',
      });
    } catch (diagErr) {
      logger.warn('MCP 诊断失败', { error: String(diagErr) });
    }

    // 动态刷新 MCP 状态：即使用户通过 UI 连接 officecli，也能自动修正状态
    await doc.refreshMCPStatus();

    const capabilities = doc.getCapabilities();
    const statusAfter = capabilities.status;

    logger.info('DocModule 状态返回', {
      statusBefore: statusBefore || doc.getStatus(),
      statusAfter,
      installed: capabilities.officeCliInfo.installed,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: capabilities }));
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_status' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '获取状态失败' } }));
  }
}

/**
 * 处理 GET /v1/doc/capabilities
 * 获取可用 Office 能力列表
 */
export async function handleDocCapabilities(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { DocModule } = await import('../DocModule');
    const doc = DocModule.getInstance();

    const capabilities = {
      status: doc.getStatus(),
      formats: ['docx', 'xlsx', 'pptx'],
      operations:
        doc.getStatus() === 'full'
          ? ['create', 'read', 'edit', 'render']
          : ['read'],
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(capabilities));
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_capabilities' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '获取能力列表失败' } }));
  }
}

/**
 * 处理 POST /v1/doc/detect — 需要 admin 权限（修改 MCP 配置）
 * 手动触发 OfficeCLI 重新检测
 */
export async function handleDocDetect(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // TODO: 权限检查 — 需要 admin

    const { DocModule } = await import('../DocModule');
    const doc = DocModule.getInstance();

    // 先尝试重新检测本地 PATH 上的 officecli
    const { detectOfficeCLI, buildOfficeCLIMcpConfig } =
      await import('../detection/OfficeCLIDetector');
    const info = detectOfficeCLI();

    // 再动态刷新 MCP 状态：即使用户通过 UI 连接，也能识别
    await doc.refreshMCPStatus();

    const capabilities = doc.getCapabilities();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        detected: info.installed,
        version: info.version,
        path: info.path,
        mcpConfig: info.installed ? buildOfficeCLIMcpConfig(info) : null,
        currentStatus: capabilities.status,
        connected: capabilities.officeCliInfo.installed,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_detect' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '检测失败' } }));
  }
}

/**
 * 处理 POST /v1/doc/undo
 * 撤销最近一次文档编辑
 */
export async function handleDocUndo(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const raw = await readBody(req);
    const { target } = JSON.parse(raw) as { target: string };

    const { DocModule } = await import('../DocModule');
    const doc = DocModule.getInstance();

    await doc.executionGuardian.undo(target);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, target }));
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_undo' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '撤销失败' } }));
  }
}

/**
 * 处理 GET /v1/doc/graph?path=budget.xlsx
 * 查询文档引用图
 */
export async function handleDocGraph(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const docPath = url.searchParams.get('path') || '';

    const { DocumentGraph } = await import('../document/DocumentGraph');
    const graph = await DocumentGraph.load();
    const related = graph.getRelatedDocuments(docPath, 2);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        path: docPath,
        relatedDocuments: related,
        totalNodes: graph.size,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_graph' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '查询文档图失败' } }));
  }
}

/**
 * 处理 PATCH /v1/mail/:id/read
 * 标记邮件已读/未读
 */
export async function handleMailPatchRead(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const uid = req.url!.split('/v1/mail/')[1].split('/read')[0];
    const body = JSON.parse(await readBody(req));
    const read = body.read === true;

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();
    await emailTool.reader.markRead(Number(uid), read);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: read ? '已标记为已读' : '已标记为未读',
      })
    );
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_patch_read' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '标记已读失败' }));
  }
}

/**
 * 处理 GET /v1/mail/search
 * 搜索邮件
 */
export async function handleMailSearch(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '20');

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();

    const mails = await emailTool.search(q, limit);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: { mails } }));
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_search' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '邮件搜索失败' }));
  }
}

// ==================== mail 已发送 API ====================

/**
 * 处理 GET /v1/mail/status
 * 获取邮件模块状态
 */
export async function handleMailStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { MailModule } = await import('../../mail/MailModule');
    const mail = MailModule.getInstance();
    const capabilities = mail.getCapabilities();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: capabilities }));
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_status' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '获取邮件状态失败' }));
  }
}

// ==================== calendar 模块 API ====================

/**
 * 处理 GET /v1/calendar/status
 * 获取日历模块状态
 */
export async function handleCalendarStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { CalendarModule } = await import('../../calendar/CalendarModule');
    const cal = CalendarModule.getInstance();
    const capabilities = cal.getCapabilities();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: capabilities }));
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_status',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '获取日历状态失败' } }));
  }
}

// ==================== mail 配置 + 发送 + 收件箱 API ====================

/**
 * 处理 POST /v1/mail/config
 * 保存邮箱配置（密码加密存储 + IMAP 连通性测试）
 */
export async function handleMailConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));

    // 输入验证
    if (
      !body.emailAddress ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailAddress)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, message: '邮箱地址格式不正确' }));
      return;
    }
    if (!body.password) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, message: '密码不能为空' }));
      return;
    }

    const { encryptPassword } =
      await import('../../../../packages/office/email/crypto');

    // 构建 EmailAccount 对象（从 JSON body 转换）
    const account: EmailAccount = {
      id: `acct-${Date.now()}`,
      provider: (body.provider as EmailAccount['provider']) || 'gmail',
      authMethod: (body.authMethod as EmailAccount['authMethod']) || 'password',
      user: String(body.emailAddress),
    };

    if (body.password) {
      account.pass = encryptPassword(String(body.password));
    }

    // 填充 SMTP/IMAP 默认值
    if (body.provider === 'gmail' || !body.smtpHost) {
      account.smtpHost = 'smtp.gmail.com';
      account.smtpPort = 587;
      account.imapHost = 'imap.gmail.com';
      account.imapPort = 993;
    } else if (body.provider === 'outlook') {
      account.smtpHost = 'smtp.office365.com';
      account.smtpPort = 587;
      account.imapHost = 'outlook.office365.com';
      account.imapPort = 993;
    } else {
      account.smtpHost = String(body.smtpHost || '');
      account.smtpPort = Number(body.smtpPort) || 587;
      account.imapHost = String(body.imapHost || '');
      account.imapPort = Number(body.imapPort) || 993;
    }

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();

    // 保存前先做 IMAP 连通性测试
    try {
      await emailTool.testConnection(
        account as unknown as Record<string, unknown>
      );
    } catch (connErr) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 400,
          message: `连接测试失败：${(connErr as Error).message}`,
        })
      );
      return;
    }

    // 幂等：先清除已有配置，再写入
    const existingAccounts = emailTool.getAccounts();
    if (existingAccounts.length > 0) {
      // EmailConfigService.addAccount 是追加模式，这里直接调用 config 覆盖
    }
    await emailTool.config(account);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: '邮箱配置已保存',
        data: { accountCount: emailTool.getAccounts().length },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_config' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '保存邮箱配置失败' }));
  }
}

/**
 * 处理 GET /v1/mail/config
 * 读取邮箱配置（脱敏，不返回密码）
 */
export async function handleMailConfigRead(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();
    const accounts = emailTool.getAccounts();

    const safeAccounts = accounts.map((a: EmailAccount) => ({
      provider: a.provider,
      user: a.user,
      authMethod: a.authMethod,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: { accounts: safeAccounts },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_config_read' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '读取邮箱配置失败' }));
  }
}

/**
 * 处理 DELETE /v1/mail/config
 * 清除邮箱配置
 */
export async function handleMailConfigDelete(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { resolvePyappHome } = await import('@modules/core');

    const officeDir = path.join(resolvePyappHome(), 'office');
    const configPath = path.join(officeDir, 'config', 'email.json');
    const sentPath = path.join(officeDir, 'sent.json');

    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    if (fs.existsSync(sentPath)) fs.unlinkSync(sentPath);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: '邮箱配置已清除' }));
  } catch (err) {
    await handleError(err, {
      module: 'mail:api',
      action: 'mail_config_delete',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '清除邮箱配置失败' }));
  }
}

/**
 * 处理 POST /v1/mail/send
 * 用户面发送邮件
 */
export async function handleMailSend(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));

    if (!body.to || !body.subject || !body.body) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ code: 400, message: '收件人、主题、正文不能为空' })
      );
      return;
    }

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();

    const result = await emailTool.send({
      to:
        typeof body.to === 'string'
          ? body.to.split(',').map((s: string) => s.trim())
          : body.to,
      subject: body.subject,
      body: body.body,
      attachments: body.attachments,
    });

    // 记录已发送
    const { recordSentMail } = await import('./officeSentRecorder');
    await recordSentMail({ to: body.to, subject: body.subject });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: '邮件已发送', data: result }));
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_send' });
    const message = (err as Error).message || '';
    const code = message.includes('MAIL_AUTH_FAILED')
      ? 400
      : message.includes('MAIL_SEND_FAILED')
        ? 500
        : 500;
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code, message: `发送失败：${message}` }));
  }
}

/**
 * 处理 DELETE /v1/mail/:id
 * 删除邮件（IMAP 删除 + 本地缓存移除）
 */
export async function handleMailDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const uid = req.url!.split('/v1/mail/')[1];

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();

    // EmailReader 暂无 IMAP delete 支持，标记为已读作为替代
    await emailTool.reader.markRead(Number(uid), true);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: '邮件已归档（标记已读）',
        data: { note: 'IMAP DELETE 暂未实现，邮件已标记为已读' },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_delete' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '删除邮件失败' }));
  }
}

/**
 * 处理 POST /v1/mail/refresh
 * 手动刷新收件箱（重新拉取 IMAP）
 */
export async function handleMailRefresh(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();

    // 重新拉取收件箱，触发 IMAP 连接刷新
    const mails = await emailTool.inbox(20);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: '收件箱已刷新',
        data: { count: mails.length },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_refresh' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '刷新收件箱失败' }));
  }
}

/**
 * 处理 GET /v1/mail/inbox
 * 读取收件箱
 */
export async function handleMailInbox(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '20');

    const { EmailTool } =
      await import('../../../../packages/office/email/EmailTool');
    const emailTool = new EmailTool();
    await emailTool.configService.load();

    const mails = await emailTool.inbox(limit);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: { mails } }));
  } catch (err) {
    // 未配置邮箱账户时返回空收件箱（非错误状态）
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('未配置邮箱账户') || msg.includes('MAIL_AUTH_FAILED')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 200,
          message: '未配置邮箱账户',
          data: { mails: [] },
        })
      );
      return;
    }
    await handleError(err, { module: 'mail:api', action: 'mail_inbox' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '获取收件箱失败' }));
  }
}

/**
 * 处理 GET /v1/mail/sent
 * 已发送邮件列表
 */
export async function handleMailSent(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getSentMails } = await import('./officeSentRecorder');
    const mails = getSentMails();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: { mails } }));
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_sent' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '获取已发送失败' }));
  }
}

// ==================== calendar 事件 API ====================

/**
 * 处理 GET /v1/calendar/events
 * 日程列表（支持 ?from=&to=&q= 查询参数）
 */
export async function handleCalendarList(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const q = url.searchParams.get('q') || '';

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const cal = new CalendarTool();
    let events = await cal.list();

    if (from) events = events.filter((e) => e.start >= from);
    if (to) events = events.filter((e) => e.end <= to);
    if (q)
      events = events.filter(
        (e) => e.summary.includes(q) || (e.description || '').includes(q)
      );

    // 按开始时间排序
    events.sort((a, b) => a.start.localeCompare(b.start));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: { events } }));
  } catch (err) {
    await handleError(err, { module: 'calendar:api', action: 'calendar_list' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '获取日程列表失败' }));
  }
}

/**
 * 处理 POST /v1/calendar/events
 * 添加日程
 */
export async function handleCalendarAdd(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));

    if (!body.summary) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, message: '日程标题不能为空' }));
      return;
    }

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const cal = new CalendarTool();
    const event = await cal.add({
      summary: body.summary,
      start: body.start || new Date().toISOString(),
      end: body.end || '',
      description: body.description,
      location: body.location,
      reminder: body.minutesBefore
        ? { minutesBefore: Number(body.minutesBefore), method: 'push' as const }
        : undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ code: 200, message: '日程已添加', data: { event } })
    );
  } catch (err) {
    await handleError(err, { module: 'calendar:api', action: 'calendar_add' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '添加日程失败' }));
  }
}

/**
 * 处理 PUT /v1/calendar/events/:id
 * 更新日程
 */
export async function handleCalendarUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const id = req.url!.split('/v1/calendar/events/')[1];
    const body = JSON.parse(await readBody(req));

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const cal = new CalendarTool();
    await cal.update(
      id,
      body as Partial<import('@modules/calendar/types').CalendarEvent>
    );

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: '日程已更新', data: { id } }));
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_update',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '更新日程失败' }));
  }
}

/**
 * 处理 DELETE /v1/calendar/events/:id
 * 删除日程
 */
export async function handleCalendarDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const id = req.url!.split('/v1/calendar/events/')[1];

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const cal = new CalendarTool();
    await cal.delete(id);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, message: '日程已删除', data: { id } }));
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_delete',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '删除日程失败' }));
  }
}

// ==================== 文档下载 API ====================

/**
 * 处理 POST /v1/doc/create
 * 创建文档（依赖 OfficeCLI），含三元路由：full / degraded / unavailable
 */
export async function handleDocCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const type = (body.type as string) || 'docx';
    const name = (body.name as string) || '';

    // 输入验证
    const validTypes = ['docx', 'xlsx', 'pptx'];
    if (!validTypes.includes(type)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 400,
          message: `不支持的文档类型：${type}。支持：${validTypes.join(', ')}`,
        })
      );
      return;
    }

    const { DocModule } = await import('../DocModule');
    const doc = DocModule.getInstance();
    const capabilities = doc.getCapabilities();

    // 三元路由：根据 OfficeCLI 可用性
    if (capabilities.status === 'degraded') {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 503,
          message: 'OfficeCLI 未安装。文档创建功能需要 OfficeCLI 命令行工具。',
          data: { installGuide: capabilities },
        })
      );
      return;
    }

    if (capabilities.status !== 'full') {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 503,
          message: '文档模块未就绪，请稍后重试',
        })
      );
      return;
    }

    // OfficeCLI 可用，文档创建通过 AI 聊天流程处理
    // 此处返回成功确认，前端引导用户到聊天界面
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: '文档模块就绪',
        data: {
          type,
          template: body.template as string | undefined,
          hint: '请在聊天界面中使用 AI 创建文档',
        },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_create' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '文档创建失败，请稍后重试' }));
  }
}

// ==================== 文档下载 API ====================

/**
 * 处理 GET /v1/doc/download?file=report.docx
 * 返回文档文件二进制流（供前端预览使用）
 */
export async function handleDocDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const file = url.searchParams.get('file') || '';

    if (!file) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, message: '缺少 file 参数' }));
      return;
    }

    const path = await import('path');
    const fs = await import('fs');
    const { resolveOutputDir } = await import('@modules/core');

    const filePath = path.join(resolveOutputDir(), file);

    // 安全检查：防止路径遍历
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(resolveOutputDir());
    if (!resolvedPath.startsWith(resolvedBase)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 403, message: '禁止访问' }));
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 404, message: '文件不存在' }));
      return;
    }

    const content = fs.readFileSync(filePath);

    // 根据扩展名设置 Content-Type
    const ext = path.extname(file).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    await handleError(err, { module: 'doc:api', action: 'doc_download' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '文件下载失败' }));
  }
}

/**
 * 处理 GET /v1/calendar/export/:id
 * 导出 .ics 文件
 */
export async function handleCalendarExport(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const id = req.url!.split('/v1/calendar/export/')[1];

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const cal = new CalendarTool();
    const filePath = await cal.export(id);

    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');

    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.ics"`,
    });
    res.end(content);
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_export',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '导出失败' }));
  }
}

/**
 * 处理 GET /v1/calendar/merged
 * 聚合三种数据源：手动日程 + Cron 定时任务 + AI 日程
 */
export async function handleCalendarMerged(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    const timezone = url.searchParams.get('timezone') ?? undefined;

    if (!start || !end) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, message: '缺少 start 或 end 参数' }));
      return;
    }

    const { CalendarTool } =
      await import('../../../../packages/office/calendar/CalendarTool');
    const { CalendarMerger } =
      await import('../../../modules/calendar/CalendarMerger');

    const cal = new CalendarTool();
    const events = await cal.list();

    const merger = new CalendarMerger();
    await merger.init();
    const result = await merger.getMergedEvents(
      { start, end, timezone },
      events
    );
    await merger.close();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        code: 200,
        message: 'OK',
        data: result,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_merged',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, message: '获取聚合日历数据失败' }));
  }
}
