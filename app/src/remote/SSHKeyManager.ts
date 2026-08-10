//
/**
 * SSH密钥管理器
 * 负责SSH密钥的生成、管理、存储和生命周期管理
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('remote:SSHKeyManager');

const execPromise = promisify(exec);

/**
 * SSH密钥对
 */
export interface SSHKeyPair {
  /**
   * 密钥ID
   */
  id: string;

  /**
   * 密钥名称
   */
  name: string;

  /**
   * 公钥内容
   */
  publicKey: string;

  /**
   * 私钥路径
   */
  privateKeyPath: string;

  /**
   * 公钥路径
   */
  publicKeyPath: string;

  /**
   * 密钥类型
   */
  type: 'rsa' | 'ed25519' | 'ecdsa';

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 密钥指纹
   */
  fingerprint: string;

  /**
   * 是否已加载到ssh-agent
   */
  loadedToAgent: boolean;
}

/**
 * SSH密钥存储选项
 */
export interface SSHKeyStorageOptions {
  /**
   * 密钥存储目录（默认 ~/.ssh/Liri/）
   */
  storageDir?: string;

  /**
   * 密钥类型（默认 ed25519）
   */
  keyType?: 'rsa' | 'ed25519' | 'ecdsa';

  /**
   * RSA密钥位数（仅rsa类型有效，默认4096）
   */
  rsaBits?: number;

  /**
   * 密钥注释
   */
  comment?: string;

  /**
   * 密钥密码（可选）
   */
  passphrase?: string;
}

/**
 * SSH密钥管理器
 */
export class SSHKeyManager {
  private storageDir: string;
  private keys: Map<string, SSHKeyPair> = new Map();

  constructor(storageDir?: string) {
    this.storageDir = storageDir || join(homedir(), '.ssh', 'Liri');
  }

  /**
   * 初始化密钥存储目录
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.storageDir)) {
      await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    }
    await this.loadExistingKeys();
  }

  /**
   * 生成新的SSH密钥对
   */
  async generateKey(options: SSHKeyStorageOptions = {}): Promise<SSHKeyPair> {
    const keyType = options.keyType || 'ed25519';
    const keyName = options.comment || `py-app-key-${Date.now()}`;
    const keyId = randomUUID().slice(0, 8);
    const privateKeyPath = join(this.storageDir, `id_${keyId}`);
    const publicKeyPath = `${privateKeyPath}.pub`;

    let cmd: string;
    switch (keyType) {
      case 'rsa':
        const bits = options.rsaBits || 4096;
        cmd = `ssh-keygen -t rsa -b ${bits} -f "${privateKeyPath}" -N "${options.passphrase || ''}" -C "${keyName}"`;
        break;
      case 'ecdsa':
        cmd = `ssh-keygen -t ecdsa -b 256 -f "${privateKeyPath}" -N "${options.passphrase || ''}" -C "${keyName}"`;
        break;
      case 'ed25519':
      default:
        cmd = `ssh-keygen -t ed25519 -f "${privateKeyPath}" -N "${options.passphrase || ''}" -C "${keyName}"`;
        break;
    }

    try {
      await execPromise(cmd);

      const [publicKey, _privateKeyContent, fingerprintResult] =
        await Promise.all([
          readFile(publicKeyPath, 'utf-8'),
          readFile(privateKeyPath, 'utf-8'),
          this.getFingerprint(privateKeyPath),
        ]);

      const keyPair: SSHKeyPair = {
        id: keyId,
        name: keyName,
        publicKey: publicKey.trim(),
        privateKeyPath,
        publicKeyPath,
        type: keyType,
        createdAt: new Date(),
        fingerprint: fingerprintResult.trim(),
        loadedToAgent: false,
      };

      this.keys.set(keyId, keyPair);
      return keyPair;
    } catch (error) {
      await this.cleanupKeyFiles(privateKeyPath, publicKeyPath);
      throw new AppError(
        `SSH key generation failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 列出所有管理的密钥
   */
  listKeys(): SSHKeyPair[] {
    return Array.from(this.keys.values());
  }

  /**
   * 获取指定密钥
   */
  getKey(keyId: string): SSHKeyPair | undefined {
    return this.keys.get(keyId);
  }

  /**
   * 删除密钥
   */
  async deleteKey(keyId: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key) {
      return false;
    }

    try {
      await this.removeFromAgent(keyId);
      await this.cleanupKeyFiles(key.privateKeyPath, key.publicKeyPath);
      this.keys.delete(keyId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将密钥加载到 ssh-agent
   */
  async addToAgent(keyId: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key) {
      return false;
    }

    try {
      await execPromise(`ssh-add "${key.privateKeyPath}"`);
      key.loadedToAgent = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 ssh-agent 移除密钥
   */
  async removeFromAgent(keyId: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key || !key.loadedToAgent) {
      return false;
    }

    try {
      await execPromise(`ssh-add -d "${key.privateKeyPath}"`);
      key.loadedToAgent = false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出 ssh-agent 中已加载的密钥
   */
  async listAgentKeys(): Promise<string[]> {
    try {
      const { stdout } = await execPromise('ssh-add -l');
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 将公钥添加到 authorized_keys
   */
  async addToAuthorizedKeys(keyId: string, host?: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key) {
      return false;
    }

    const authKeysPath = host
      ? join(homedir(), '.ssh', `authorized_keys_${host}`)
      : join(homedir(), '.ssh', 'authorized_keys');

    try {
      await execPromise(`echo "${key.publicKey}" >> "${authKeysPath}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取公钥内容
   */
  getPublicKey(keyId: string): string | null {
    const key = this.keys.get(keyId);
    return key ? key.publicKey : null;
  }

  /**
   * 获取密钥指纹
   */
  private async getFingerprint(keyPath: string): Promise<string> {
    try {
      const { stdout } = await execPromise(`ssh-keygen -lf "${keyPath}"`);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * 加载已存在的密钥
   */
  private async loadExistingKeys(): Promise<void> {
    try {
      const files = await readdir(this.storageDir);
      const privateKeyFiles = files.filter(
        (f) => !f.endsWith('.pub') && !f.startsWith('.')
      );

      for (const file of privateKeyFiles) {
        const keyPath = join(this.storageDir, file);
        const pubKeyPath = `${keyPath}.pub`;

        if (!existsSync(pubKeyPath)) {
          continue;
        }

        try {
          const [publicKey, fingerprintResult] = await Promise.all([
            readFile(pubKeyPath, 'utf-8'),
            this.getFingerprint(keyPath),
          ]);

          const keyId = file.replace('id_', '');
          this.keys.set(keyId, {
            id: keyId,
            name: `loaded-${keyId}`,
            publicKey: publicKey.trim(),
            privateKeyPath: keyPath,
            publicKeyPath: pubKeyPath,
            type: this.detectKeyType(publicKey),
            createdAt: new Date(),
            fingerprint: fingerprintResult.trim(),
            loadedToAgent: false,
          });
        } catch (err) {
          // skip unreadable keys

          handleError(err, {
            module: 'remote:SSHKeyManager',
            action: 'loadKeyFile',
          });
        }
      }
    } catch (err) {
      // storage dir might not exist yet

      handleError(err, {
        module: 'remote:SSHKeyManager',
        action: 'loadKeysFromDir',
      });
    }
  }

  /**
   * 检测密钥类型
   */
  private detectKeyType(publicKey: string): 'rsa' | 'ed25519' | 'ecdsa' {
    if (publicKey.includes('ssh-ed25519')) return 'ed25519';
    if (publicKey.includes('ecdsa')) return 'ecdsa';
    if (publicKey.includes('ssh-rsa')) return 'rsa';
    return 'ed25519';
  }

  /**
   * 清理密钥文件
   */
  private async cleanupKeyFiles(...paths: string[]): Promise<void> {
    for (const p of paths) {
      try {
        if (existsSync(p)) {
          await unlink(p);
        }
      } catch (err) {
        // ignore cleanup failures

        handleError(err, {
          module: 'remote:SSHKeyManager',
          action: 'cleanupKeys',
        });
      }
    }
  }
}
