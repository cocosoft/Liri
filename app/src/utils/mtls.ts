/**
 * mTLS 工具
 */

import fs from 'fs';
import { configManager } from '@modules/config';

/**
 * mTLS 配置
 */
export interface MTLSConfig {
  cert: string;
  key: string;
  passphrase?: string;
}

/**
 * 获取mTLS配置
 */
export function getMTLSConfig(): MTLSConfig | undefined {
  try {
    // 检查环境变量
    const certPath = configManager.env('MTLS_CERT_PATH');
    const keyPath = configManager.env('MTLS_KEY_PATH');
    const passphrase = configManager.env('MTLS_PASSPHRASE');

    if (!certPath || !keyPath) {
      return undefined;
    }

    if (!fs.existsSync(certPath)) {
      return undefined;
    }

    if (!fs.existsSync(keyPath)) {
      return undefined;
    }

    const cert = fs.readFileSync(certPath, 'utf8');
    const key = fs.readFileSync(keyPath, 'utf8');

    return {
      cert,
      key,
      passphrase,
    };
  } catch {
    return undefined;
  }
}
