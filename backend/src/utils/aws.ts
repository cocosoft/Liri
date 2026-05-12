/**
 * AWS 认证工具
 *
 * 管理 AWS 凭证的获取、缓存和验证。
 * 无第三方 SDK 依赖，通过 child_process 调用 AWS CLI 获取凭证。
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const execAsync = promisify(exec);

/**
 * AWS 短期凭证格式
 */
export interface AwsCredentials {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration?: string;
}

/**
 * AWS STS 输出格式
 */
export interface AwsStsOutput {
  Credentials: AwsCredentials;
}

/**
 * 验证 AWS STS assume-role 输出
 */
export function isValidAwsStsOutput(obj: unknown): obj is AwsStsOutput {
  if (!obj || typeof obj !== 'object') return false;

  const output = obj as Record<string, unknown>;

  if (!output.Credentials || typeof output.Credentials !== 'object')
    return false;

  const credentials = output.Credentials as Record<string, unknown>;

  return (
    typeof credentials.AccessKeyId === 'string' &&
    typeof credentials.SecretAccessKey === 'string' &&
    typeof credentials.SessionToken === 'string' &&
    credentials.AccessKeyId.length > 0 &&
    credentials.SecretAccessKey.length > 0 &&
    credentials.SessionToken.length > 0
  );
}

/**
 * 检查错误是否为凭证提供者错误
 */
export function isAwsCredentialsProviderError(err: unknown): boolean {
  return (
    (err as { name?: string } | undefined)?.name === 'CredentialsProviderError'
  );
}

/**
 * 从 ~/.aws/credentials 文件解析 AWS 凭证
 *
 * 解析 INI 格式的凭证文件，支持默认 profile 和指定 profile。
 *
 * @param profile - AWS profile 名称（默认 "default"）
 * @returns 解析到的凭证，未找到时返回 null
 */
export function parseAwsCredentialsFile(
  profile: string = 'default'
): AwsCredentials | null {
  const credPath = join(homedir(), '.aws', 'credentials');

  if (!existsSync(credPath)) return null;

  try {
    const content = readFileSync(credPath, 'utf-8');
    const lines = content.split('\n');

    let currentProfile: string | null = null;
    let accessKeyId = '';
    let secretAccessKey = '';
    let sessionToken = '';
    let inTargetProfile = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // 空行或注释
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Profile 头
      const profileMatch = trimmed.match(/^\[(.+)\]$/);
      if (profileMatch) {
        currentProfile = profileMatch[1];
        inTargetProfile = currentProfile === profile;
        continue;
      }

      if (!inTargetProfile) continue;

      // Key=Value 行
      const kvMatch = trimmed.match(/^([a-zA-Z_]+)\s*=\s*(.+)$/);
      if (!kvMatch) continue;

      const key = kvMatch[1];
      const value = kvMatch[2];

      switch (key) {
        case 'aws_access_key_id':
          accessKeyId = value;
          break;
        case 'aws_secret_access_key':
          secretAccessKey = value;
          break;
        case 'aws_session_token':
          sessionToken = value;
          break;
      }
    }

    if (accessKeyId && secretAccessKey) {
      return {
        AccessKeyId: accessKeyId,
        SecretAccessKey: secretAccessKey,
        SessionToken: sessionToken,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 验证 AWS STS 调用者身份
 *
 * 通过 AWS CLI 调用 sts get-caller-identity 验证凭证有效性。
 *
 * @throws 如果无法获取调用者身份
 */
export async function checkStsCallerIdentity(): Promise<void> {
  try {
    const { stdout } = await execAsync('aws sts get-caller-identity', {
      timeout: 10000,
    });
    const result = JSON.parse(stdout);
    if (!result.Arn) {
      throw new AppError('Unable to retrieve caller identity', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
  } catch (error) {
    throw new AppError(
      `AWS STS caller identity check failed: ` +
        `${error instanceof Error ? error.message : String(error)}`
    , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }
}

/**
 * 通过 AWS CLI 获取凭证
 *
 * 调用 `aws configure export-credentials` 获取当前配置的凭证。
 *
 * @returns 当前凭证
 * @throws 如果无法获取凭证
 */
export async function getAwsCredentials(): Promise<AwsCredentials> {
  try {
    const { stdout } = await execAsync(
      'aws configure export-credentials --format json',
      { timeout: 10000 }
    );
    return JSON.parse(stdout) as AwsCredentials;
  } catch (error) {
    throw new AppError(
      `Failed to get AWS credentials: ` +
        `${error instanceof Error ? error.message : String(error)}`
    , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }
}

/**
 * 检查 AWS 凭证是否可用
 *
 * 先尝试 AWS CLI export，失败后解析凭证文件回退。
 *
 * @returns 是否有可用凭证
 */
export async function hasAwsCredentials(): Promise<boolean> {
  try {
    await getAwsCredentials();
    return true;
  } catch {
    const creds = parseAwsCredentialsFile();
    return creds !== null;
  }
}
