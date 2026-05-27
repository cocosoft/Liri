/**
 * Discord 通道诊断模块
 * 对标 OpenClaw extensions/discord/src/doctor.ts
 */

export interface DiagnosisResult {
  healthy: boolean;
  checks: DiagnosisCheck[];
  summary: string;
}

export interface DiagnosisCheck {
  name: string;
  passed: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface DiscordDiagnosisContext {
  hasBotToken: boolean;
  isConnected: boolean;
  isGatewayReady: boolean;
  intents: number;
  gatewayUrl: string;
  botId?: string;
  lastHeartbeatAck: number | null;
}

export function diagnoseDiscord(ctx: DiscordDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseGateway(ctx));
  checks.push(diagnoseHeartbeat(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Discord 诊断通过（${checks.length}/${checks.length}）`
        : `Discord 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: DiscordDiagnosisContext): DiagnosisCheck {
  return {
    name: '配置检查',
    passed: ctx.hasBotToken,
    message: ctx.hasBotToken
      ? `Bot Token 已设置 (intents: ${ctx.intents})`
      : '缺少 botToken',
    detail: { hasBotToken: ctx.hasBotToken, intents: ctx.intents },
  };
}

function diagnoseGateway(ctx: DiscordDiagnosisContext): DiagnosisCheck {
  if (!ctx.hasBotToken) {
    return {
      name: 'Gateway 状态',
      passed: false,
      message: 'Token 未设置，无法连接 Gateway',
    };
  }
  return {
    name: 'Gateway 状态',
    passed: ctx.isGatewayReady,
    message: ctx.isGatewayReady
      ? `Gateway 已就绪${ctx.botId ? ` (Bot ID: ${ctx.botId})` : ''}`
      : ctx.isConnected
        ? 'Gateway 已连接但尚未就绪'
        : 'Gateway 未连接',
    detail: {
      isConnected: ctx.isConnected,
      isGatewayReady: ctx.isGatewayReady,
      gatewayUrl: ctx.gatewayUrl,
    },
  };
}

function diagnoseHeartbeat(ctx: DiscordDiagnosisContext): DiagnosisCheck {
  if (!ctx.isConnected) {
    return {
      name: '心跳状态',
      passed: false,
      message: '未连接，无心跳',
    };
  }
  const now = Date.now();
  const ackAgo = ctx.lastHeartbeatAck ? now - ctx.lastHeartbeatAck : null;
  return {
    name: '心跳状态',
    passed: ackAgo !== null && ackAgo < 60000,
    message:
      ackAgo !== null
        ? `上次心跳确认：${Math.round(ackAgo / 1000)} 秒前`
        : '尚未收到心跳确认',
    detail: { lastHeartbeatAck: ctx.lastHeartbeatAck },
  };
}
