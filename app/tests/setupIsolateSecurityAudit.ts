/**
 * 测试全局隔离：安全审计日志重定向到临时目录（2026-11-13）
 *
 * **背景**（会话 `session_mwdcivrue74d4838ff` 观察期取证）：单元测试会经由**真实权限链**
 * 执行工具（如 `command: 'boom'` / `failing_tool`），而 `SecurityAuditLogger` 默认写
 * 用户真实 `<dataDir>/security/security-audit.log` ⇒ 实测 fixture 事件落进生产审计日志，
 * 进而被只读围栏的 S1/S2 规则当成真实决策抽样（污染观察期指标 3/4 与证据链）。
 *
 * **处置**：preload 阶段把 `LIRI_SECURITY_AUDIT_DIR` 指到进程级临时目录（幂等：已设则尊重），
 * 审计面照常写入，只是不碰用户数据目录。生产不设该变量 ⇒ 行为不变。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'LIRI_SECURITY_AUDIT_DIR';
if (!process.env[KEY]?.trim()) {
  process.env[KEY] = mkdtempSync(join(tmpdir(), 'liri-audit-'));
}
