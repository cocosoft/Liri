/**
 * 办公模块 HTTP API handlers
 * doc / mail / calendar 的 REST 端点
 */

import type http from 'http';
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
    const capabilities = doc.getCapabilities();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(capabilities));
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

    const { detectOfficeCLI, buildOfficeCLIMcpConfig } =
      await import('../detection/OfficeCLIDetector');

    const info = detectOfficeCLI();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        detected: info.installed,
        version: info.version,
        path: info.path,
        mcpConfig: info.installed ? buildOfficeCLIMcpConfig(info) : null,
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

// ==================== mail 模块 API ====================

/**
 * 处理 GET /v1/mail/status
 * 获取邮件模块状态
 */
export async function handleMailStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ready' }));
  } catch (err) {
    await handleError(err, { module: 'mail:api', action: 'mail_status' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '获取邮件状态失败' } }));
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
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ready' }));
  } catch (err) {
    await handleError(err, {
      module: 'calendar:api',
      action: 'calendar_status',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '获取日历状态失败' } }));
  }
}
