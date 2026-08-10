import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolvePyappHome } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('bridge:device');

export interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  trustedAt: number;
  lastSeen: number;
  fingerprint: string;
  expiresAt?: number;
  isDefault?: boolean;
}

/**
 * 默认设备过期时间（30天）
 */
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function getDevicesPath(): string {
  return path.join(resolvePyappHome(), 'trusted_devices.json');
}

export function loadTrustedDevices(): TrustedDevice[] {
  try {
    const p = getDevicesPath();
    if (!fs.existsSync(p)) return [];
    const devices = JSON.parse(fs.readFileSync(p, 'utf-8')) as TrustedDevice[];
    // 过滤过期设备
    return devices.filter((d) => !isDeviceExpired(d));
  } catch {
    void handleError(new Error('Failed to load trusted devices'), {
      module: 'bridge:device',
      action: 'loadTrustedDevices',
    });
    return [];
  }
}

function saveTrustedDevices(devices: TrustedDevice[]): void {
  const p = getDevicesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(devices, null, 2), 'utf-8');
}

/**
 * 检查设备是否过期
 */
export function isDeviceExpired(device: TrustedDevice): boolean {
  if (!device.expiresAt) return false;
  return Date.now() > device.expiresAt;
}

/**
 * 获取信任设备Token
 */
export function getTrustedDeviceToken(deviceId: string): string | null {
  const devices = loadTrustedDevices();
  const d = devices.find((x) => x.deviceId === deviceId);
  if (!d) return null;
  if (isDeviceExpired(d)) return null;
  d.lastSeen = Date.now();
  saveTrustedDevices(devices);
  return d.fingerprint;
}

/**
 * 获取默认设备的Token
 */
export function getDefaultTrustedDeviceToken(): string | null {
  const devices = loadTrustedDevices();
  const defaultDevice = devices.find((d) => d.isDefault && !isDeviceExpired(d));
  if (!defaultDevice) {
    // 如果没有默认设备，返回第一个未过期的设备
    const firstValid = devices.find((d) => !isDeviceExpired(d));
    return firstValid ? firstValid.fingerprint : null;
  }
  defaultDevice.lastSeen = Date.now();
  saveTrustedDevices(devices);
  return defaultDevice.fingerprint;
}

/**
 * 注册信任设备
 */
export function registerTrustedDevice(
  name: string,
  expiresAt?: number
): TrustedDevice {
  const devices = loadTrustedDevices();
  // 如果没有默认设备，设置新设备为默认设备
  const hasDefault = devices.some((d) => d.isDefault);

  const device: TrustedDevice = {
    deviceId: randomUUID(),
    deviceName: name || `device_${devices.length + 1}`,
    trustedAt: Date.now(),
    lastSeen: Date.now(),
    fingerprint: randomUUID().replace(/-/g, ''),
    expiresAt: expiresAt || Date.now() + DEFAULT_EXPIRY_MS,
    isDefault: !hasDefault,
  };
  devices.push(device);
  saveTrustedDevices(devices);
  return device;
}

/**
 * 设置默认设备
 */
export function setDefaultDevice(deviceId: string): boolean {
  const devices = loadTrustedDevices();
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device || isDeviceExpired(device)) return false;

  // 清除其他设备的默认标记
  devices.forEach((d) => {
    d.isDefault = false;
  });
  device.isDefault = true;
  device.lastSeen = Date.now();
  saveTrustedDevices(devices);
  return true;
}

/**
 * 删除信任设备
 */
export function removeTrustedDevice(deviceId: string): boolean {
  const devices = loadTrustedDevices();
  const initialLength = devices.length;
  const filtered = devices.filter((d) => d.deviceId !== deviceId);
  if (filtered.length === initialLength) return false;
  saveTrustedDevices(filtered);
  return true;
}

/**
 * 刷新设备Token
 */
export function refreshDeviceToken(deviceId: string): string | null {
  const devices = loadTrustedDevices();
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device || isDeviceExpired(device)) return null;

  // 生成新的fingerprint
  device.fingerprint = randomUUID().replace(/-/g, '');
  device.lastSeen = Date.now();
  device.expiresAt = Date.now() + DEFAULT_EXPIRY_MS;
  saveTrustedDevices(devices);
  return device.fingerprint;
}

/**
 * 检查设备是否可信
 */
export function isDeviceTrusted(deviceId: string): boolean {
  const devices = loadTrustedDevices();
  const device = devices.find((d) => d.deviceId === deviceId);
  return !!device && !isDeviceExpired(device);
}

/**
 * 获取所有有效设备列表
 */
export function getValidDevices(): TrustedDevice[] {
  return loadTrustedDevices().filter((d) => !isDeviceExpired(d));
}

/**
 * 更新设备信息
 */
export function updateDevice(
  deviceId: string,
  updates: Partial<Pick<TrustedDevice, 'deviceName' | 'expiresAt'>>
): boolean {
  const devices = loadTrustedDevices();
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device || isDeviceExpired(device)) return false;

  if (updates.deviceName !== undefined) {
    device.deviceName = updates.deviceName;
  }
  if (updates.expiresAt !== undefined) {
    device.expiresAt = updates.expiresAt;
  }
  device.lastSeen = Date.now();
  saveTrustedDevices(devices);
  return true;
}
