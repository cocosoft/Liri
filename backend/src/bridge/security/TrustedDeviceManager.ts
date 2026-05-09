//
/**
 * 信任设备管理器
 * 负责管理信任设备的注册、验证和Token管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  trustedAt: number;
  lastSeen: number;
  fingerprint: string;
  expiresAt?: number;
  isDefault?: boolean;
}

export interface DeviceManagerOptions {
  /** 设备文件路径 */
  devicesPath?: string;
  /** 默认过期时间（毫秒） */
  defaultExpiryMs?: number;
  /** 是否自动设置第一个设备为默认 */
  autoSetDefault?: boolean;
}

const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

class DeviceManager {
  private devicesPath: string;
  private defaultExpiryMs: number;
  private autoSetDefault: boolean;

  constructor(options: DeviceManagerOptions = {}) {
    this.devicesPath =
      options.devicesPath ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.py_app',
        'trusted_devices.json'
      );
    this.defaultExpiryMs = options.defaultExpiryMs || DEFAULT_EXPIRY_MS;
    this.autoSetDefault = options.autoSetDefault ?? true;
  }

  private loadDevices(): TrustedDevice[] {
    try {
      if (!fs.existsSync(this.devicesPath)) {
        return [];
      }
      const content = fs.readFileSync(this.devicesPath, 'utf-8');
      const devices = JSON.parse(content) as TrustedDevice[];
      return devices.filter((d) => !this.isExpired(d));
    } catch {
      return [];
    }
  }

  private saveDevices(devices: TrustedDevice[]): void {
    fs.mkdirSync(path.dirname(this.devicesPath), { recursive: true });
    fs.writeFileSync(
      this.devicesPath,
      JSON.stringify(devices, null, 2),
      'utf-8'
    );
  }

  private isExpired(device: TrustedDevice): boolean {
    if (!device.expiresAt) {
      return false;
    }
    return Date.now() > device.expiresAt;
  }

  register(name?: string, expiresAt?: number): TrustedDevice {
    const devices = this.loadDevices();

    if (this.autoSetDefault && devices.length === 0) {
      const device: TrustedDevice = {
        deviceId: randomUUID(),
        deviceName: name || 'default',
        trustedAt: Date.now(),
        lastSeen: Date.now(),
        fingerprint: randomUUID().replace(/-/g, ''),
        expiresAt: expiresAt || Date.now() + this.defaultExpiryMs,
        isDefault: true,
      };
      devices.push(device);
      this.saveDevices(devices);
      return device;
    }

    const device: TrustedDevice = {
      deviceId: randomUUID(),
      deviceName: name || `device_${devices.length + 1}`,
      trustedAt: Date.now(),
      lastSeen: Date.now(),
      fingerprint: randomUUID().replace(/-/g, ''),
      expiresAt: expiresAt || Date.now() + this.defaultExpiryMs,
      isDefault: false,
    };
    devices.push(device);
    this.saveDevices(devices);
    return device;
  }

  getToken(deviceId: string): string | null {
    const devices = this.loadDevices();
    const device = devices.find((d) => d.deviceId === deviceId);
    if (!device || this.isExpired(device)) {
      return null;
    }
    device.lastSeen = Date.now();
    this.saveDevices(devices);
    return device.fingerprint;
  }

  getDefaultToken(): string | null {
    const devices = this.loadDevices();
    const defaultDevice = devices.find(
      (d) => d.isDefault && !this.isExpired(d)
    );
    if (defaultDevice) {
      defaultDevice.lastSeen = Date.now();
      this.saveDevices(devices);
      return defaultDevice.fingerprint;
    }
    const firstValid = devices.find((d) => !this.isExpired(d));
    if (firstValid) {
      firstValid.lastSeen = Date.now();
      this.saveDevices(devices);
      return firstValid.fingerprint;
    }
    return null;
  }

  setDefault(deviceId: string): boolean {
    const devices = this.loadDevices();
    const device = devices.find((d) => d.deviceId === deviceId);
    if (!device || this.isExpired(device)) {
      return false;
    }
    devices.forEach((d) => {
      d.isDefault = false;
    });
    device.isDefault = true;
    device.lastSeen = Date.now();
    this.saveDevices(devices);
    return true;
  }

  remove(deviceId: string): boolean {
    const devices = this.loadDevices();
    const initialLength = devices.length;
    const filtered = devices.filter((d) => d.deviceId !== deviceId);
    if (filtered.length === initialLength) {
      return false;
    }
    this.saveDevices(filtered);
    return true;
  }

  refreshToken(deviceId: string): string | null {
    const devices = this.loadDevices();
    const device = devices.find((d) => d.deviceId === deviceId);
    if (!device || this.isExpired(device)) {
      return null;
    }
    device.fingerprint = randomUUID().replace(/-/g, '');
    device.lastSeen = Date.now();
    device.expiresAt = Date.now() + this.defaultExpiryMs;
    this.saveDevices(devices);
    return device.fingerprint;
  }

  isTrusted(deviceId: string): boolean {
    const devices = this.loadDevices();
    const device = devices.find((d) => d.deviceId === deviceId);
    return !!device && !this.isExpired(device);
  }

  list(): TrustedDevice[] {
    return this.loadDevices();
  }

  update(
    deviceId: string,
    updates: { deviceName?: string; expiresAt?: number }
  ): boolean {
    const devices = this.loadDevices();
    const device = devices.find((d) => d.deviceId === deviceId);
    if (!device || this.isExpired(device)) {
      return false;
    }
    if (updates.deviceName !== undefined) {
      device.deviceName = updates.deviceName;
    }
    if (updates.expiresAt !== undefined) {
      device.expiresAt = updates.expiresAt;
    }
    device.lastSeen = Date.now();
    this.saveDevices(devices);
    return true;
  }

  cleanup(): number {
    const devices = this.loadDevices();
    const before = devices.length;
    const filtered = devices.filter((d) => !this.isExpired(d));
    const removed = before - filtered.length;
    if (removed > 0) {
      this.saveDevices(filtered);
    }
    return removed;
  }
}

let defaultManager: DeviceManager | undefined;

export function getDeviceManager(
  options?: DeviceManagerOptions
): DeviceManager {
  if (!defaultManager) {
    defaultManager = new DeviceManager(options);
  }
  return defaultManager;
}

export function resetDeviceManager(): void {
  defaultManager = undefined;
}
