/**
 * 设备配对服务
 * 对标 Hermes gateway/pairing.py
 * 提供设备发现、配对码生成和验证能力
 *
 * 模块归属：channels/ — 服务于通道系统的设备认证层。
 *   与消息路由（routing/）、通道注册（registry/）解耦，独立提供配对能力。
 *   配对成功后，设备信息通过 channels/events/ 事件总线发布 PAIRING_COMPLETED 事件，
 *   由通道注册层监听并建立设备-通道映射。
 *
 * 依赖关系：
 *   - 不依赖 routing/、registry/（仅依赖 events/ChannelEventBus）
 *   - 被 channels/ 体系内其他模块通过事件总线消费配对结果
 */
import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * 配对状态
 */
export type PairingStatus =
  | 'unpaired'
  | 'pairing'
  | 'paired'
  | 'expired'
  | 'rejected';

/**
 * 设备信息
 */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  ipAddress?: string;
  userAgent?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * 配对请求
 */
export interface PairingRequest {
  code: string;
  deviceId: string;
  userId: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

/**
 * 已配对设备
 */
export interface PairedDevice {
  deviceId: string;
  userId: string;
  pairCode: string | null;
  pairedAt: number;
  lastActiveAt: number;
  deviceName: string;
  approved: boolean;
}

/**
 * 配对配置
 */
export interface PairingConfig {
  codeLength: number;
  codeExpiryMs: number;
  maxAttempts: number;
  maxPairedDevices: number;
  autoApproveEnabled: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_PAIRING_CONFIG: PairingConfig = {
  codeLength: 6,
  codeExpiryMs: 300_000,
  maxAttempts: 5,
  maxPairedDevices: 10,
  autoApproveEnabled: false,
};

/**
 * 设备配对服务
 */
export class DevicePairingService extends EventEmitter {
  private pendingRequests: Map<string, PairingRequest> = new Map();
  private pairedDevices: Map<string, PairedDevice> = new Map();
  private knownDevices: Map<string, DeviceInfo> = new Map();
  private config: PairingConfig;

  constructor(config?: Partial<PairingConfig>) {
    super();
    this.config = { ...DEFAULT_PAIRING_CONFIG, ...config };
  }

  /**
   * 生成配对码
   * @param userId 用户 ID
   * @returns 配对码
   */
  generatePairingCode(userId: string): string {
    const code = crypto
      .randomInt(0, Math.pow(10, this.config.codeLength))
      .toString()
      .padStart(this.config.codeLength, '0');

    const request: PairingRequest = {
      code,
      deviceId: '',
      userId,
      status: 'pairing',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.codeExpiryMs,
      attempts: 0,
      maxAttempts: this.config.maxAttempts,
    };

    this.pendingRequests.set(code, request);

    this.emit('codeGenerated', { code, userId });

    setTimeout(() => this.expireCode(code), this.config.codeExpiryMs);

    return code;
  }

  /**
   * 验证配对码
   * @param code 配对码
   * @param deviceId 设备 ID
   * @param deviceName 设备名称
   * @returns 是否验证成功
   */
  validatePairingCode(
    code: string,
    deviceId: string,
    deviceName: string
  ): { success: boolean; message: string } {
    const request = this.pendingRequests.get(code);

    if (!request) {
      return { success: false, message: '配对码无效或不存在' };
    }

    request.attempts++;

    if (request.attempts > request.maxAttempts) {
      request.status = 'rejected';
      this.pendingRequests.delete(code);

      this.emit('pairingRejected', { code, reason: '尝试次数超限' });

      return { success: false, message: '配对尝试次数超限' };
    }

    if (Date.now() > request.expiresAt) {
      request.status = 'expired';
      this.pendingRequests.delete(code);

      return { success: false, message: '配对码已过期' };
    }

    if (this.pairedDevices.size >= this.config.maxPairedDevices) {
      return {
        success: false,
        message: `设备数量已达上限 (${this.config.maxPairedDevices})`,
      };
    }

    const paired: PairedDevice = {
      deviceId,
      userId: request.userId,
      pairCode: code,
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
      deviceName,
      approved: this.config.autoApproveEnabled,
    };

    this.pairedDevices.set(deviceId, paired);
    request.status = 'paired';
    this.pendingRequests.delete(code);

    this.emit('devicePaired', { deviceId, userId: request.userId, deviceName });

    return { success: true, message: '配对成功' };
  }

  /**
   * 注册已知设备
   * @param device 设备信息
   */
  registerDevice(device: DeviceInfo): void {
    const existing = this.knownDevices.get(device.deviceId);

    if (existing) {
      existing.lastSeenAt = Date.now();
      if (device.deviceName) existing.deviceName = device.deviceName;
    } else {
      device.firstSeenAt = Date.now();
      device.lastSeenAt = Date.now();
      this.knownDevices.set(device.deviceId, device);
    }
  }

  /**
   * 解配设备
   * @param deviceId 设备 ID
   */
  unpairDevice(deviceId: string): boolean {
    const deleted = this.pairedDevices.delete(deviceId);

    if (deleted) {
      this.emit('deviceUnpaired', { deviceId });
    }

    return deleted;
  }

  /**
   * 更新设备活动时间
   * @param deviceId 设备 ID
   */
  touchDevice(deviceId: string): void {
    const paired = this.pairedDevices.get(deviceId);

    if (paired) {
      paired.lastActiveAt = Date.now();
    }

    const known = this.knownDevices.get(deviceId);
    if (known) {
      known.lastSeenAt = Date.now();
    }
  }

  /**
   * 检查设备是否已配对
   * @param deviceId 设备 ID
   */
  isPaired(deviceId: string): boolean {
    return this.pairedDevices.has(deviceId);
  }

  /**
   * 检查设备是否已批准
   * @param deviceId 设备 ID
   */
  isApproved(deviceId: string): boolean {
    const paired = this.pairedDevices.get(deviceId);

    return !!paired && paired.approved;
  }

  /**
   * 获取所有已配对设备
   */
  getPairedDevices(): PairedDevice[] {
    return Array.from(this.pairedDevices.values());
  }

  /**
   * 获取已批准的设备 ID 列表
   */
  getApprovedDeviceIds(): string[] {
    return this.getPairedDevices()
      .filter((d) => d.approved)
      .map((d) => d.deviceId);
  }

  /**
   * 获取配对统计
   */
  getStats(): { paired: number; pending: number; known: number } {
    return {
      paired: this.pairedDevices.size,
      pending: this.pendingRequests.size,
      known: this.knownDevices.size,
    };
  }

  /**
   * 使配对码过期
   */
  private expireCode(code: string): void {
    const request = this.pendingRequests.get(code);

    if (request && request.status === 'pairing') {
      request.status = 'expired';
      this.pendingRequests.delete(code);

      this.emit('codeExpired', { code });
    }
  }

  /**
   * 清除所有状态
   */
  clear(): void {
    this.pendingRequests.clear();
    this.pairedDevices.clear();
    this.knownDevices.clear();
  }
}

/**
 * 全局设备配对服务
 */
let globalPairingService: DevicePairingService | null = null;

/**
 * 获取全局设备配对服务
 */
export function getDevicePairingService(): DevicePairingService {
  if (!globalPairingService) {
    globalPairingService = new DevicePairingService();
  }

  return globalPairingService;
}
