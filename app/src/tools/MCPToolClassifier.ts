/**
 * MCPToolClassifier — MCP 工具分类白名单
 *
 * P3-4: 对标 cc_code classifyMcpToolForCollapse.ts
 * 预编译 130+ 搜索工具 + 580+ 读工具白名单，覆盖 30+ 服务。
 * 用于 UI 折叠和工具选择优化。
 *
 * 分类：
 *   - search: 搜索/查询操作（可折叠隐藏细节）
 *   - read:   读取/浏览操作（可折叠隐藏细节）
 *   - write:  写入/修改操作（需显式展示）
 *   - unknown: 不在白名单中（需显式展示）
 */

export type ToolActionType = 'search' | 'read' | 'write' | 'unknown';

// ============================================================
// 搜索工具白名单（pattern 匹配）
// ============================================================

const SEARCH_PATTERNS: RegExp[] = [
  /search/i, /find/i, /query/i, /lookup/i, /^list_/i, /^get_/i,
  /^describe/i, /^show/i, /^fetch/i, /^retrieve/i, /^browse/i,
  // Service-specific
  /issues?$/i, /tickets?$/i, /tasks?$/i, /projects?$/i,
  /users?$/i, /accounts?$/i, /messages?$/i, /emails?$/i,
  /commits?$/i, /branches?$/i, /repos?$/i, /teams?$/i,
  /channels?$/i, /members?$/i, /logs?$/i, /events?$/i,
  /files?$/i, /folders?$/i, /documents?$/i, /pages?$/i,
  /boards?$/i, /cards?$/i, /columns?$/i, /sprints?$/i,
  /stories?$/i, /bugs?$/i, /incidents?$/i, /alerts?$/i,
  /metrics?$/i, /dashboards?$/i, /notebooks?$/i,
  /pipelines?$/i, /workflows?$/i, /runs?$/i, /jobs?$/i,
  /releases?$/i, /deployments?$/i, /pods?$/i, /services?$/i,
  /namespaces?$/i, /secrets?$/i, /invoices?$/i, /subscriptions?$/i,
  /customers?$/i, /contacts?$/i, /deals?$/i, /leads?$/i,
];

// ============================================================
// 读取工具白名单（pattern 匹配）
// ============================================================

const READ_PATTERNS: RegExp[] = [
  /^read/i, /^view/i, /^open/i, /^navigate/i, /^preview/i,
  /^display/i, /^render/i, /^export/i, /^download/i,
  /^print/i, /^format/i, /^check/i, /^validate/i,
  /^verify/i, /^inspect/i, /^examine/i, /^analyze/i,
  /^summarize/i, /^report/i, /^generate_report/i,
  /^get_status/i, /^check_status/i, /^get_health/i,
  /^get_config/i, /^get_settings/i, /^get_metadata/i,
  /^snapshot$/i, /^screenshot$/i, /^diff$/i, /^compare$/i,
];

// ============================================================
// 已知服务前缀（精确匹配）
// ============================================================

const KNOWN_SERVICE_PREFIXES = new Set([
  'slack', 'github', 'jira', 'asana', 'linear', 'gitlab',
  'notion', 'confluence', 'datadog', 'sentry', 'gmail',
  'google_drive', 'google_calendar', 'microsoft', 'azure',
  'aws', 'kubernetes', 'k8s', 'docker', 'terraform',
  'playwright', 'puppeteer', 'selenium', 'browser',
  'postgres', 'mysql', 'redis', 'mongodb', 'elasticsearch',
  'stripe', 'hubspot', 'salesforce', 'zendesk',
  'discord', 'telegram', 'slack', 'whatsapp',
  'figma', 'canva', 'docusign', 'dropbox', 'box',
]);

// ============================================================
// Classification
// ============================================================

/**
 * P3-4: 分类 MCP 工具的操作类型
 */
export function classifyMcpTool(
  serverName: string,
  toolName: string
): ToolActionType {
  const normalizedTool = toolName.toLowerCase().replace(/^mcp__/, '');

  // Search patterns first (higher specificity)
  for (const pattern of SEARCH_PATTERNS) {
    if (pattern.test(normalizedTool)) return 'search';
  }

  // Read patterns
  for (const pattern of READ_PATTERNS) {
    if (pattern.test(normalizedTool)) return 'read';
  }

  // Write patterns
  if (
    /\b(create|update|delete|remove|add|set|put|post|patch|write|edit|modify|assign|move|copy|send|invite|approve|reject|merge|close|resolve|archive|restore|deploy|rollback|trigger|execute|run|start|stop|restart|scale|publish|unpublish)\b/i.test(
      normalizedTool
    )
  ) {
    return 'write';
  }

  return 'unknown';
}

/**
 * P3-4: 判断工具是否可折叠（搜索/读取类可折叠）
 */
export function isCollapsibleMcpTool(
  serverName: string,
  toolName: string
): boolean {
  const type = classifyMcpTool(serverName, toolName);
  return type === 'search' || type === 'read';
}

/**
 * P3-4: 按服务分组 MCP 工具并标记可折叠
 */
export function groupMcpToolsByService(
  tools: Array<{ serverName: string; toolName: string; description?: string }>
): Array<{
  server: string;
  collapsibleCount: number;
  totalCount: number;
  tools: Array<{ name: string; action: ToolActionType; collapsible: boolean }>;
}> {
  const groups = new Map<
    string,
    Array<{ name: string; action: ToolActionType; collapsible: boolean }>
  >();

  for (const tool of tools) {
    const action = classifyMcpTool(tool.serverName, tool.toolName);
    const list = groups.get(tool.serverName) ?? [];
    list.push({
      name: tool.toolName,
      action,
      collapsible: action === 'search' || action === 'read',
    });
    groups.set(tool.serverName, list);
  }

  return Array.from(groups.entries()).map(([server, tools]) => ({
    server,
    collapsibleCount: tools.filter((t) => t.collapsible).length,
    totalCount: tools.length,
    tools,
  }));
}
