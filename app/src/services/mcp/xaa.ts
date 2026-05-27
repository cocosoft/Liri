/**
 * Cross-App Access：跨应用MCP服务器访问控制
 */

export interface XAAConfig {
  enabled: boolean;
  idpUrl?: string;
  clientId?: string;
  clientSecret?: string;
  allowedOrigins: string[];
  tokenExpiryMinutes?: number;
  refreshTokenExpiryDays?: number;
}

export interface XAATokenPayload {
  server: string;
  permissions: string[];
  iat: number;
  exp: number;
  jti?: string;
  clientId?: string;
}

export interface XAATokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface XAAPermission {
  name: string;
  description: string;
  allowedMethods?: string[];
}

/**
 * XAA错误类型枚举
 */
export enum XAAErrorType {
  DISABLED = 'XAA_DISABLED',
  INVALID_TOKEN_FORMAT = 'INVALID_TOKEN_FORMAT',
  MISSING_REQUIRED_FIELDS = 'MISSING_REQUIRED_FIELDS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_ISSUE_TIME = 'INVALID_ISSUE_TIME',
  INVALID_ORIGIN = 'INVALID_ORIGIN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED = 'REFRESH_TOKEN_EXPIRED',
  MISSING_CLIENT_ID = 'MISSING_CLIENT_ID',
  INVALID_SERVER_NAME = 'INVALID_SERVER_NAME',
  PERMISSION_NOT_FOUND = 'PERMISSION_NOT_FOUND',
}

/**
 * XAA错误详情
 */
export interface XAAError {
  type: XAAErrorType;
  message: string;
  code: number;
  details?: Record<string, unknown>;
}

/**
 * XAA验证结果
 */
export interface XAAValidationResult {
  valid: boolean;
  error?: XAAError;
  payload?: XAATokenPayload;
}

/**
 * XAA权限检查结果
 */
export interface XAAPermissionCheckResult {
  allowed: boolean;
  error?: XAAError;
  missingPermissions?: string[];
}

let xaaConfig: XAAConfig = {
  enabled: false,
  allowedOrigins: [],
  tokenExpiryMinutes: 60,
  refreshTokenExpiryDays: 7,
};

const knownPermissions: XAAPermission[] = [
  { name: 'read', description: '读取资源权限' },
  { name: 'write', description: '写入资源权限' },
  { name: 'execute', description: '执行工具权限' },
  { name: 'admin', description: '管理员权限' },
];

/**
 * 创建XAA错误对象
 */
function createXAAError(
  type: XAAErrorType,
  details?: Record<string, unknown>
): XAAError {
  const errorMessages: Record<XAAErrorType, { message: string; code: number }> =
    {
      [XAAErrorType.DISABLED]: {
        message: 'XAA authentication is disabled',
        code: 403,
      },
      [XAAErrorType.INVALID_TOKEN_FORMAT]: {
        message: 'Invalid token format',
        code: 401,
      },
      [XAAErrorType.MISSING_REQUIRED_FIELDS]: {
        message: 'Missing required fields in token',
        code: 401,
      },
      [XAAErrorType.TOKEN_EXPIRED]: { message: 'Token has expired', code: 401 },
      [XAAErrorType.INVALID_ISSUE_TIME]: {
        message: 'Token issue time is invalid (future timestamp)',
        code: 401,
      },
      [XAAErrorType.INVALID_ORIGIN]: {
        message: 'Origin is not allowed',
        code: 403,
      },
      [XAAErrorType.INSUFFICIENT_PERMISSIONS]: {
        message: 'Insufficient permissions',
        code: 403,
      },
      [XAAErrorType.INVALID_REFRESH_TOKEN]: {
        message: 'Invalid refresh token',
        code: 401,
      },
      [XAAErrorType.REFRESH_TOKEN_EXPIRED]: {
        message: 'Refresh token has expired',
        code: 401,
      },
      [XAAErrorType.MISSING_CLIENT_ID]: {
        message: 'Client ID is required but not configured',
        code: 500,
      },
      [XAAErrorType.INVALID_SERVER_NAME]: {
        message: 'Server name is invalid or empty',
        code: 400,
      },
      [XAAErrorType.PERMISSION_NOT_FOUND]: {
        message: 'Permission not found',
        code: 404,
      },
    };

  const { message, code } = errorMessages[type];
  return { type, message, code, details };
}

export function isXAAEnabled(): boolean {
  return xaaConfig.enabled;
}

export function configureXAA(config: Partial<XAAConfig>): void {
  xaaConfig = { ...xaaConfig, ...config };
}

export function getXAAConfig(): XAAConfig {
  return { ...xaaConfig };
}

export function isOriginAllowed(origin: string): boolean {
  if (!xaaConfig.enabled) return false;
  if (xaaConfig.allowedOrigins.length === 0) return true;
  return xaaConfig.allowedOrigins.some((allowed) => {
    if (allowed === '*') return true;
    if (allowed.endsWith('/*')) {
      return origin.startsWith(allowed.replace('/*', ''));
    }
    if (allowed.includes('*')) {
      const regexPattern = allowed.replace(/\*/g, '.*');
      return new RegExp(`^${regexPattern}$`).test(origin);
    }
    return origin === allowed;
  });
}

/**
 * 检查Origin是否允许（带详细错误信息）
 */
export function checkOriginAllowed(origin: string): {
  allowed: boolean;
  error?: XAAError;
} {
  if (!xaaConfig.enabled) {
    return { allowed: false, error: createXAAError(XAAErrorType.DISABLED) };
  }

  if (!origin || typeof origin !== 'string') {
    return {
      allowed: false,
      error: createXAAError(XAAErrorType.INVALID_ORIGIN, { origin }),
    };
  }

  if (xaaConfig.allowedOrigins.length === 0) {
    return { allowed: true };
  }

  const isAllowed = isOriginAllowed(origin);
  if (!isAllowed) {
    return {
      allowed: false,
      error: createXAAError(XAAErrorType.INVALID_ORIGIN, {
        origin,
        allowedOrigins: xaaConfig.allowedOrigins,
      }),
    };
  }

  return { allowed: true };
}

export function createXAAToken(
  serverName: string,
  permissions: string[]
): string {
  const expiryMinutes = xaaConfig.tokenExpiryMinutes || 60;
  const payload: XAATokenPayload = {
    server: serverName,
    permissions,
    iat: Date.now(),
    exp: Date.now() + expiryMinutes * 60 * 1000,
    jti: generateTokenId(),
    clientId: xaaConfig.clientId,
  };
  return `xaa_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

/**
 * 创建XAA Token（带验证）
 */
export function createXAATokenSafe(
  serverName: string,
  permissions: string[]
): { token?: string; error?: XAAError } {
  if (
    !serverName ||
    typeof serverName !== 'string' ||
    serverName.trim() === ''
  ) {
    return {
      error: createXAAError(XAAErrorType.INVALID_SERVER_NAME, { serverName }),
    };
  }

  if (!Array.isArray(permissions) || permissions.length === 0) {
    return {
      error: createXAAError(XAAErrorType.INSUFFICIENT_PERMISSIONS, {
        permissions,
      }),
    };
  }

  // 验证权限是否存在
  const invalidPermissions = permissions.filter(
    (p) => !knownPermissions.some((kp) => kp.name === p)
  );
  if (invalidPermissions.length > 0) {
    return {
      error: createXAAError(XAAErrorType.PERMISSION_NOT_FOUND, {
        invalidPermissions,
      }),
    };
  }

  const token = createXAAToken(serverName, permissions);
  return { token };
}

export function decodeXAAToken(token: string): XAATokenPayload | null {
  try {
    if (!token.startsWith('xaa_')) return null;
    const payloadStr = Buffer.from(token.slice(4), 'base64url').toString();
    return JSON.parse(payloadStr) as XAATokenPayload;
  } catch {
    return null;
  }
}

/**
 * 解码XAA Token（带详细错误信息）
 */
export function decodeXAATokenSafe(token: string): {
  payload?: XAATokenPayload;
  error?: XAAError;
} {
  if (!token || typeof token !== 'string') {
    return {
      error: createXAAError(XAAErrorType.INVALID_TOKEN_FORMAT, { token }),
    };
  }

  if (!token.startsWith('xaa_')) {
    return {
      error: createXAAError(XAAErrorType.INVALID_TOKEN_FORMAT, {
        reason: 'Missing xaa_ prefix',
      }),
    };
  }

  try {
    const payloadStr = Buffer.from(token.slice(4), 'base64url').toString();
    const payload = JSON.parse(payloadStr) as XAATokenPayload;
    return { payload };
  } catch (err) {
    return {
      error: createXAAError(XAAErrorType.INVALID_TOKEN_FORMAT, {
        reason: err instanceof Error ? err.message : 'Parse error',
      }),
    };
  }
}

export function validateXAAToken(token: string): {
  valid: boolean;
  reason?: string;
  payload?: XAATokenPayload;
} {
  const payload = decodeXAAToken(token);
  if (!payload) {
    return { valid: false, reason: 'Invalid token format' };
  }

  if (!payload.server || !payload.permissions || !payload.iat || !payload.exp) {
    return { valid: false, reason: 'Missing required fields' };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, reason: 'Token expired' };
  }

  if (Date.now() < payload.iat) {
    return { valid: false, reason: 'Invalid issue time' };
  }

  return { valid: true, payload };
}

/**
 * 验证XAA Token（带详细错误信息）
 */
export function validateXAATokenDetailed(token: string): XAAValidationResult {
  if (!xaaConfig.enabled) {
    return { valid: false, error: createXAAError(XAAErrorType.DISABLED) };
  }

  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      error: createXAAError(XAAErrorType.INVALID_TOKEN_FORMAT, { token }),
    };
  }

  const decodeResult = decodeXAATokenSafe(token);
  if (decodeResult.error) {
    return { valid: false, error: decodeResult.error };
  }

  const payload = decodeResult.payload!;

  // 检查必需字段
  const missingFields: string[] = [];
  if (!payload.server) missingFields.push('server');
  if (!payload.permissions || !Array.isArray(payload.permissions))
    missingFields.push('permissions');
  if (!payload.iat) missingFields.push('iat');
  if (!payload.exp) missingFields.push('exp');

  if (missingFields.length > 0) {
    return {
      valid: false,
      error: createXAAError(XAAErrorType.MISSING_REQUIRED_FIELDS, {
        missingFields,
      }),
    };
  }

  // 检查过期时间
  const now = Date.now();
  if (now > payload.exp) {
    const timeUntilExpiry = Math.floor((payload.exp - now) / 1000);
    return {
      valid: false,
      error: createXAAError(XAAErrorType.TOKEN_EXPIRED, {
        expiresAt: payload.exp,
        timeUntilExpiry,
        server: payload.server,
      }),
    };
  }

  // 检查签发时间
  if (now < payload.iat) {
    return {
      valid: false,
      error: createXAAError(XAAErrorType.INVALID_ISSUE_TIME, {
        issuedAt: payload.iat,
        currentTime: now,
      }),
    };
  }

  return { valid: true, payload };
}

export function hasPermission(token: string, permission: string): boolean {
  const validation = validateXAAToken(token);
  if (!validation.valid || !validation.payload) {
    return false;
  }
  return validation.payload.permissions.includes(permission);
}

export function hasAllPermissions(
  token: string,
  permissions: string[]
): boolean {
  const validation = validateXAAToken(token);
  if (!validation.valid || !validation.payload) {
    return false;
  }
  return permissions.every((p) => validation.payload!.permissions.includes(p));
}

export function hasAnyPermission(
  token: string,
  permissions: string[]
): boolean {
  const validation = validateXAAToken(token);
  if (!validation.valid || !validation.payload) {
    return false;
  }
  return permissions.some((p) => validation.payload!.permissions.includes(p));
}

/**
 * 检查权限（带详细错误信息）
 */
export function checkPermissions(
  token: string,
  requiredPermissions: string[],
  requireAll: boolean = true
): XAAPermissionCheckResult {
  const validation = validateXAATokenDetailed(token);
  if (!validation.valid) {
    return { allowed: false, error: validation.error };
  }

  const payload = validation.payload!;
  const userPermissions = payload.permissions;

  const missingPermissions = requiredPermissions.filter(
    (p) => !userPermissions.includes(p)
  );

  if (requireAll && missingPermissions.length > 0) {
    return {
      allowed: false,
      error: createXAAError(XAAErrorType.INSUFFICIENT_PERMISSIONS, {
        required: requiredPermissions,
        missing: missingPermissions,
        current: userPermissions,
      }),
      missingPermissions,
    };
  }

  if (
    !requireAll &&
    !requiredPermissions.some((p) => userPermissions.includes(p))
  ) {
    return {
      allowed: false,
      error: createXAAError(XAAErrorType.INSUFFICIENT_PERMISSIONS, {
        required: requiredPermissions,
        current: userPermissions,
        requireAll: false,
      }),
      missingPermissions: requiredPermissions,
    };
  }

  return { allowed: true };
}

/**
 * 检查单个权限（带详细错误信息）
 */
export function checkPermission(
  token: string,
  permission: string
): XAAPermissionCheckResult {
  return checkPermissions(token, [permission], true);
}

export function createTokenPair(
  serverName: string,
  permissions: string[]
): XAATokenPair {
  const accessToken = createXAAToken(serverName, permissions);
  const refreshToken = createRefreshToken();
  const expiryMinutes = xaaConfig.tokenExpiryMinutes || 60;

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiryMinutes * 60 * 1000,
  };
}

/**
 * 创建Token Pair（带验证）
 */
export function createTokenPairSafe(
  serverName: string,
  permissions: string[]
): { tokenPair?: XAATokenPair; error?: XAAError } {
  const tokenResult = createXAATokenSafe(serverName, permissions);
  if (tokenResult.error) {
    return { error: tokenResult.error };
  }

  const tokenPair = createTokenPair(serverName, permissions);
  return { tokenPair };
}

export function refreshAccessToken(
  refreshToken: string,
  serverName: string
): XAATokenPair | null {
  if (!isValidRefreshToken(refreshToken)) {
    return null;
  }

  const permissions = extractPermissionsFromRefreshToken(refreshToken) || [
    'read',
  ];
  return createTokenPair(serverName, permissions);
}

/**
 * 刷新访问令牌（带详细错误信息）
 */
export function refreshAccessTokenSafe(
  refreshToken: string,
  serverName: string
): { tokenPair?: XAATokenPair; error?: XAAError } {
  if (!xaaConfig.enabled) {
    return { error: createXAAError(XAAErrorType.DISABLED) };
  }

  if (!refreshToken || typeof refreshToken !== 'string') {
    return {
      error: createXAAError(XAAErrorType.INVALID_REFRESH_TOKEN, {
        refreshToken,
      }),
    };
  }

  if (!refreshToken.startsWith('xar_')) {
    return {
      error: createXAAError(XAAErrorType.INVALID_REFRESH_TOKEN, {
        reason: 'Missing xar_ prefix',
      }),
    };
  }

  try {
    const payloadStr = Buffer.from(
      refreshToken.slice(4),
      'base64url'
    ).toString();
    const payload = JSON.parse(payloadStr);

    if (payload.type !== 'refresh') {
      return {
        error: createXAAError(XAAErrorType.INVALID_REFRESH_TOKEN, {
          reason: 'Invalid token type',
        }),
      };
    }

    if (Date.now() > payload.exp) {
      return {
        error: createXAAError(XAAErrorType.REFRESH_TOKEN_EXPIRED, {
          expiresAt: payload.exp,
        }),
      };
    }

    const permissions = payload.permissions || ['read'];
    const tokenPair = createTokenPair(serverName, permissions);
    return { tokenPair };
  } catch (err) {
    return {
      error: createXAAError(XAAErrorType.INVALID_REFRESH_TOKEN, {
        reason: err instanceof Error ? err.message : 'Parse error',
      }),
    };
  }
}

export function getKnownPermissions(): XAAPermission[] {
  return [...knownPermissions];
}

export function registerPermission(permission: XAAPermission): void {
  if (!knownPermissions.find((p) => p.name === permission.name)) {
    knownPermissions.push(permission);
  }
}

/**
 * 注册权限（带验证）
 */
export function registerPermissionSafe(permission: XAAPermission): {
  success: boolean;
  error?: XAAError;
} {
  if (
    !permission.name ||
    typeof permission.name !== 'string' ||
    permission.name.trim() === ''
  ) {
    return {
      success: false,
      error: createXAAError(XAAErrorType.INVALID_SERVER_NAME, { permission }),
    };
  }

  if (!permission.description || typeof permission.description !== 'string') {
    return {
      success: false,
      error: createXAAError(XAAErrorType.MISSING_REQUIRED_FIELDS, {
        reason: 'description is required',
      }),
    };
  }

  if (knownPermissions.find((p) => p.name === permission.name)) {
    return {
      success: false,
      error: createXAAError(XAAErrorType.PERMISSION_NOT_FOUND, {
        reason: `Permission '${permission.name}' already exists`,
      }),
    };
  }

  knownPermissions.push(permission);
  return { success: true };
}

export function getPermissionDescription(
  permissionName: string
): string | undefined {
  return knownPermissions.find((p) => p.name === permissionName)?.description;
}

/**
 * 获取权限详情（带详细错误信息）
 */
export function getPermissionSafe(permissionName: string): {
  permission?: XAAPermission;
  error?: XAAError;
} {
  const permission = knownPermissions.find((p) => p.name === permissionName);
  if (!permission) {
    return {
      error: createXAAError(XAAErrorType.PERMISSION_NOT_FOUND, {
        permissionName,
      }),
    };
  }
  return { permission };
}

function generateTokenId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function createRefreshToken(): string {
  const expiryDays = xaaConfig.refreshTokenExpiryDays || 7;
  const payload = {
    type: 'refresh',
    iat: Date.now(),
    exp: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    jti: generateTokenId(),
  };
  return `xar_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

function isValidRefreshToken(refreshToken: string): boolean {
  try {
    if (!refreshToken.startsWith('xar_')) return false;
    const payloadStr = Buffer.from(
      refreshToken.slice(4),
      'base64url'
    ).toString();
    const payload = JSON.parse(payloadStr);
    if (payload.type !== 'refresh') return false;
    if (Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function extractPermissionsFromRefreshToken(
  refreshToken: string
): string[] | null {
  try {
    if (!refreshToken.startsWith('xar_')) return null;
    const payloadStr = Buffer.from(
      refreshToken.slice(4),
      'base64url'
    ).toString();
    const payload = JSON.parse(payloadStr);
    return payload.permissions || ['read'];
  } catch {
    return null;
  }
}
