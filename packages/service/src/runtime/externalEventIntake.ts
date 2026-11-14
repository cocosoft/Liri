/**
 * externalEventIntake —— 外部事件**入站受理层**（D1，2026-11-14，service 层）
 *
 * 为什么在 service 层：HTTP handler（app/infrastructure）需要调用它，
 * 而 handler **不得反向依赖** `app/tasks`（任务域）⇒ 判定逻辑落 service，
 * `app/tasks/sources` 只负责"投递到来源"与装配（依赖方向 app → service）。
 *
 * 职责（纯判定 + 进程内状态，不碰网络/DB）：
 * 1. **签名校验**：`sha256=<hex>(HMAC-SHA256(secret, rawBody))`，常量时间比较；
 *    密钥未配置 ⇒ **fail-closed 拒绝**（503），不做"无签名也放行"。
 * 2. **载荷校验**：必须 JSON 对象；`X-Liri-Event-Id` 必填（幂等键）；大小上限。
 * 3. **去重**：同一 `eventId` 在 TTL 内重复投递 ⇒ 拒绝（409），与 `SourceRegistry`
 *    的 `triggerId` 幂等形成双层保护。
 * 4. **速率上限**：按来源的滑动窗口（默认 30 次/分钟），超限 ⇒ 429。
 *
 * 审计：拒绝返回结构化 `reason`（调用方写日志/审计）；成功路径由
 * `SourceRegistry → ticketSink` 落工作项（`trigger:<id>` 台账可查）。
 */
import { createHmac, timingSafeEqual } from 'crypto';

/** 拒绝原因（机器可读；调用方据此映射 HTTP 状态码与审计文案） */
export type ExternalEventRejectReason =
  | 'secret_not_configured'
  | 'bad_signature'
  | 'invalid_body'
  | 'missing_event_id'
  | 'payload_too_large'
  | 'duplicate'
  | 'rate_limited'
  | 'not_delivered';

export type ExternalEventIntakeResult =
  | { ok: true; eventId: string; threadId?: string }
  | { ok: false; reason: ExternalEventRejectReason };

/** 拒绝原因 → HTTP 状态码（唯一映射点，handler 不重复判断） */
export const REJECT_STATUS: Readonly<Record<ExternalEventRejectReason, number>> =
  {
    secret_not_configured: 503,
    bad_signature: 401,
    invalid_body: 400,
    missing_event_id: 400,
    payload_too_large: 413,
    duplicate: 409,
    rate_limited: 429,
    not_delivered: 503,
  };

/** 受理参数（缺省值集中在此；密钥由装配处从 env 读取） */
export interface ExternalEventIntakeConfig {
  secret: string;
  maxPayloadBytes: number;
  dedupeTtlMs: number;
  ratePerMinute: number;
}

export const DEFAULT_EXTERNAL_EVENT_CONFIG: ExternalEventIntakeConfig = {
  secret: '',
  // 64 KB：外部事件只需"发生了什么"的结构化摘要，不是文件传输通道
  maxPayloadBytes: 64 * 1024,
  dedupeTtlMs: 10 * 60 * 1000,
  ratePerMinute: 30,
};

/** 计算签名（导出供发送方/测试复用；与校验同一实现） */
export function computeExternalEventSignature(
  secret: string,
  rawBody: string
): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** 常量时间比较（长度不等 ⇒ false；两侧同为定长 hex 串） */
export function verifyExternalEventSignature(
  secret: string,
  rawBody: string,
  header: string | undefined
): boolean {
  const provided = (header ?? '').trim();
  if (!secret || !provided) return false;
  const expected = computeExternalEventSignature(secret, rawBody);
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ExternalEventIntakeDeps {
  /** 投递到来源（`externalEventSource.emit`） */
  emit: (input: {
    eventId: string;
    payload: Record<string, unknown>;
    threadId?: string;
  }) => Promise<boolean>;
  config?: Partial<ExternalEventIntakeConfig>;
  /** 当前时刻（测试注入） */
  now?: () => number;
}

export class ExternalEventIntake {
  private readonly config: ExternalEventIntakeConfig;
  private readonly now: () => number;
  /** eventId → 首次受理时刻（TTL 清理） */
  private readonly seen = new Map<string, number>();
  /** 来源 → 最近一分钟内的受理时刻（滑动窗口） */
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly deps: ExternalEventIntakeDeps) {
    this.config = { ...DEFAULT_EXTERNAL_EVENT_CONFIG, ...deps.config };
    this.now = deps.now ?? Date.now;
  }

  async handle(input: {
    sourceId: string;
    rawBody: string;
    signature?: string;
    eventId?: string;
    threadId?: string;
  }): Promise<ExternalEventIntakeResult> {
    if (!this.config.secret) {
      return { ok: false, reason: 'secret_not_configured' };
    }
    if (
      !verifyExternalEventSignature(
        this.config.secret,
        input.rawBody,
        input.signature
      )
    ) {
      return { ok: false, reason: 'bad_signature' };
    }
    if (
      Buffer.byteLength(input.rawBody, 'utf8') > this.config.maxPayloadBytes
    ) {
      return { ok: false, reason: 'payload_too_large' };
    }

    const eventId = (input.eventId ?? '').trim();
    if (!eventId) return { ok: false, reason: 'missing_event_id' };

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return { ok: false, reason: 'invalid_body' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, reason: 'invalid_body' };
    }

    const now = this.now();
    this.prune(now);

    if (this.seen.has(eventId)) return { ok: false, reason: 'duplicate' };

    const stamps = (this.recent.get(input.sourceId) ?? []).filter(
      (t) => now - t < 60_000
    );
    if (stamps.length >= this.config.ratePerMinute) {
      return { ok: false, reason: 'rate_limited' };
    }

    const delivered = await this.deps.emit({
      eventId,
      payload: payload as Record<string, unknown>,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    });
    if (!delivered) return { ok: false, reason: 'not_delivered' };

    // 只在**投递成功后**记账（投递失败允许重试；at-least-once 语义）
    this.seen.set(eventId, now);
    stamps.push(now);
    this.recent.set(input.sourceId, stamps);
    return {
      ok: true,
      eventId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    };
  }

  /** 懒清理：过期去重项与窗口外时刻（不引入定时器） */
  private prune(now: number): void {
    for (const [id, at] of this.seen) {
      if (now - at >= this.config.dedupeTtlMs) this.seen.delete(id);
    }
    for (const [sourceId, stamps] of this.recent) {
      const kept = stamps.filter((t) => now - t < 60_000);
      if (kept.length === 0) this.recent.delete(sourceId);
      else this.recent.set(sourceId, kept);
    }
  }

  /** 仅供测试/诊断：当前去重条目数 */
  size(): number {
    return this.seen.size;
  }
}

/** 装配端口：由 `app/tasks/sources/externalEventWiring` 在启用时注入 */
let intake: ExternalEventIntake | null = null;

export function setExternalEventIntake(next: ExternalEventIntake | null): void {
  intake = next;
}

/** HTTP handler 取用；`null` ⇒ 未启用（默认关，handler 回 503） */
export function getExternalEventIntake(): ExternalEventIntake | null {
  return intake;
}
