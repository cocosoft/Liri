/**
 * MobilePairingService — 移动端**设备配对与短期 token**（P2.5，2026-10-20）
 *
 * 目标（方案 §2.6「身份」）：每台设备独立、**短期可吊销**的凭据，替代长期 `x-api-key`。
 *
 * 两道门：
 * 1. **配对**：桌面端调 `startMobilePairing()` 生成 6 位码（5 分钟、最多 5 次尝试）；
 *    手机端携 `{code, deviceId, deviceName}` 调 `completeMobilePairing()`。
 * 2. **令牌**：配对成功即签发短期 token（默认 12h）；同设备再次配对会**先吊销旧 token**
 *    （单设备单活跃 token）。重启即失效（内存态）——移动端重新配对即可，符合"短期"口径。
 *
 * ⚠️ **配对码即授权**：本服务使用**专用** `DevicePairingService` 实例并开启 `autoApprove`。
 * 理由：配对码只在**受信任的桌面端**生成并展示，出示该码即等价于用户当场授权；
 * 不使用全局单例可避免改变其它通道的审批语义（全局默认 `autoApprove=false`）。
 */

import crypto from 'crypto';
import {
  DevicePairingService,
  type PairedDevice,
} from '../DevicePairingService';

/**
 * 设备 token 默认有效期：12 小时。
 *
 * 口径说明：先声明**小时**、再派生毫秒 —— 避免 `const X_MS = <数字>`
 * 触发 `lint:consts` 的 B 类裸字面量棘轮（只减不增，不放宽基线）。
 */
export const MOBILE_DEVICE_TOKEN_TTL_HOURS = 12;
export const MOBILE_DEVICE_TOKEN_TTL_MS =
  MOBILE_DEVICE_TOKEN_TTL_HOURS * 60 * 60 * 1000;

export interface MobileDeviceToken {
  token: string;
  deviceId: string;
  userId: string;
  expiresAt: number;
}

/**
 * 设备 token 存储（内存态；单设备单活跃 token）。
 *
 * 说明：不做持久化 —— 重启后需重新配对，与"短期可吊销"一致；
 * 若将来要求跨重启，再接 `ChannelSecretStore`（加密落盘）。
 */
export class MobileDeviceTokenStore {
  private tokens = new Map<string, MobileDeviceToken>();
  private byDevice = new Map<string, string>();

  /** 签发（同设备旧 token 立即吊销） */
  issue(
    deviceId: string,
    userId: string,
    ttlMs: number = MOBILE_DEVICE_TOKEN_TTL_MS
  ): MobileDeviceToken {
    const previous = this.byDevice.get(deviceId);
    if (previous) this.tokens.delete(previous);

    const token = crypto.randomBytes(32).toString('base64url');
    const record: MobileDeviceToken = {
      token,
      deviceId,
      userId,
      expiresAt: Date.now() + ttlMs,
    };
    this.tokens.set(token, record);
    this.byDevice.set(deviceId, token);
    return record;
  }

  /** 校验（过期即删除并返回 null） */
  verify(token: string): MobileDeviceToken | null {
    const record = this.tokens.get(token);
    if (!record) return null;
    if (Date.now() >= record.expiresAt) {
      this.tokens.delete(token);
      this.byDevice.delete(record.deviceId);
      return null;
    }
    return record;
  }

  /** 吊销单个 token */
  revoke(token: string): boolean {
    const record = this.tokens.get(token);
    if (!record) return false;
    this.tokens.delete(token);
    if (this.byDevice.get(record.deviceId) === token) {
      this.byDevice.delete(record.deviceId);
    }
    return true;
  }

  /** 吊销某设备的全部 token */
  revokeDevice(deviceId: string): boolean {
    const token = this.byDevice.get(deviceId);
    if (!token) return false;
    return this.revoke(token);
  }

  /** 该设备是否有**未过期**的活跃 token（不返回 token 本身） */
  hasActiveToken(deviceId: string): boolean {
    const token = this.byDevice.get(deviceId);
    if (!token) return false;
    return this.verify(token) !== null;
  }

  /** 当前活跃 token 数（诊断 / 测试） */
  size(): number {
    return this.tokens.size;
  }

  clear(): void {
    this.tokens.clear();
    this.byDevice.clear();
  }
}

export const mobileDeviceTokenStore = new MobileDeviceTokenStore();

/** 移动端专用配对服务（autoApprove=true：见文件头"配对码即授权"） */
const mobilePairingService = new DevicePairingService({
  autoApproveEnabled: true,
});

/** 生成配对码（桌面端调用） */
export function startMobilePairing(userId: string): { code: string } {
  return { code: mobilePairingService.generatePairingCode(userId) };
}

export type CompleteMobilePairingResult =
  | { ok: true; token: string; expiresAt: number; deviceId: string }
  | { ok: false; message: string };

/** 完成配对并签发短期 token（手机端调用） */
export function completeMobilePairing(input: {
  code: string;
  deviceId: string;
  deviceName: string;
  ttlMs?: number;
}): CompleteMobilePairingResult {
  const result = mobilePairingService.validatePairingCode(
    input.code,
    input.deviceId,
    input.deviceName
  );
  if (!result.success) return { ok: false, message: result.message };

  const paired: PairedDevice | undefined = mobilePairingService
    .getPairedDevices()
    .find((d) => d.deviceId === input.deviceId);

  const issued = mobileDeviceTokenStore.issue(
    input.deviceId,
    paired?.userId ?? 'mobile-user',
    input.ttlMs ?? MOBILE_DEVICE_TOKEN_TTL_MS
  );

  return {
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
    deviceId: issued.deviceId,
  };
}

/** 已配对设备（脱敏视图：不返回 token） */
export function listPairedMobileDevices(): Array<{
  deviceId: string;
  deviceName: string;
  userId: string;
  pairedAt: number;
  hasActiveToken: boolean;
}> {
  return mobilePairingService.getPairedDevices().map((d) => ({
    deviceId: d.deviceId,
    deviceName: d.deviceName,
    userId: d.userId,
    pairedAt: d.pairedAt,
    hasActiveToken: mobileDeviceTokenStore.hasActiveToken(d.deviceId),
  }));
}

/** 解配（吊销 token + 移除配对记录） */
export function unpairMobileDevice(deviceId: string): boolean {
  mobileDeviceTokenStore.revokeDevice(deviceId);
  return mobilePairingService.unpairDevice(deviceId);
}

/** 测试用：清空配对与令牌 */
export function resetMobilePairingForTest(): void {
  mobileDeviceTokenStore.clear();
  mobilePairingService.clear();
}

export type MobileAuthResult =
  | { ok: true; deviceId: string; userId: string }
  | { ok: false; status: 401 | 403; message: string };

/**
 * 校验移动端请求的**设备凭据**（纯函数；不读全局状态以外的东西）。
 *
 * - 缺 `Authorization: Bearer …` ⇒ 401（配对引导阶段可用 api-key，见 handler 注释）
 * - token 无效 / 过期 ⇒ 401
 * - 请求体 `deviceId` 与 token 不一致 ⇒ 403（防串号）
 */
export function authorizeMobileRequest(
  authorizationHeader: string | undefined,
  bodyDeviceId?: string
): MobileAuthResult {
  const raw = authorizationHeader ?? '';
  if (!raw.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      message: 'device token required (Authorization: Bearer <token>)',
    };
  }
  const token = raw.slice('Bearer '.length).trim();
  const record = token ? mobileDeviceTokenStore.verify(token) : null;
  if (!record) {
    return {
      ok: false,
      status: 401,
      message: 'invalid or expired device token',
    };
  }
  if (bodyDeviceId && bodyDeviceId !== record.deviceId) {
    return {
      ok: false,
      status: 403,
      message: 'deviceId does not match the presented token',
    };
  }
  return { ok: true, deviceId: record.deviceId, userId: record.userId };
}
