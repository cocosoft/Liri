/**
 * /doctor 命令 - 系统诊断
 */

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  suggestion?: string;
}

export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'Node.js',
    status: process.version ? 'ok' : 'error',
    message: `v${process.version}`,
  });

  checks.push({
    name: 'Platform',
    status: 'ok',
    message: `${process.platform} ${process.arch}`,
  });

  checks.push({
    name: 'CWD',
    status: 'ok',
    message: process.cwd(),
  });

  const memUsage = process.memoryUsage();
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  checks.push({
    name: 'Memory',
    status: heapMB > 500 ? 'warning' : 'ok',
    message: `${heapMB} MB heap used`,
    suggestion:
      heapMB > 500 ? 'Consider increasing --max-old-space-size' : undefined,
  });

  const uptimeMin = Math.round(process.uptime() / 60);
  checks.push({
    name: 'Uptime',
    status: 'ok',
    message: `${uptimeMin} min`,
  });

  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const statusIcon = { ok: '✓', warning: '⚠', error: '✗' };

  return checks
    .map((c) => {
      const line = `${statusIcon[c.status]} ${c.name}: ${c.message}`;
      return c.suggestion ? `${line}\n   → ${c.suggestion}` : line;
    })
    .join('\n');
}
