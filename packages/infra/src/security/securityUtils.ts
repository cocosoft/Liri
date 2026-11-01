import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const logger = getLogger('security:utils');

function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    /^del\s/i,
    /^erase\s/i,
    /^format\s/i,
    /^rd\s/i,
    /^rmdir\s/i,
    /^rm\s/i,
    /^chmod\s/i,
    /^chown\s/i,
    /^kill\s/i,
    /^shutdown\s/i,
    /^reboot\s/i,
    /^nc\s/i,
    /^netcat\s/i,
    /^curl\s/i,
    /^wget\s/i,
    /[;&|]\s*rm\s/i,
    /[;&|]\s*del\s/i,
    /[;&|]\s*format\s/i,
    /^sudo\s/i,
    /^su\s/i,
    /^runas\s/i,
    /^mv\s/i,
    /^cp\s/i,
    /^move\s/i,
    /^copy\s/i,
    /^export\s/i,
    /^set\s/i,
    /^taskkill\s/i,
    /^ps\s/i,
    /^pkill\s/i,
  ];

  return dangerousPatterns.some((pattern) => pattern.test(command));
}

export function isPathTraversal(path: string): boolean {
  const traversalPatterns = [
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e%2f/,
    /%2e%2e%5c/,
    /..%2f/,
    /..%5c/,
  ];
  return traversalPatterns.some((pattern) => pattern.test(path));
}

export function sanitizePath(path: string): string {
  let sanitized = path
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    .replace(/%2e%2e%2f/g, '')
    .replace(/%2e%2e%5c/g, '')
    .replace(/..%2f/g, '')
    .replace(/..%5c/g, '');

  if (sanitized.startsWith('/') || sanitized.startsWith('\\')) {
    sanitized = sanitized.slice(1);
  }

  return sanitized;
}

export function validateCommandArgs(args: string[]): {
  valid: boolean;
  error?: string;
} {
  for (const arg of args) {
    if (isPathTraversal(arg)) {
      return {
        valid: false,
        error: 'Path traversal detected in argument',
      };
    }

    if (
      arg.includes(';') ||
      arg.includes('|') ||
      arg.includes('&') ||
      arg.includes('`') ||
      arg.includes('$') ||
      arg.includes('>') ||
      arg.includes('<')
    ) {
      return {
        valid: false,
        error: 'Dangerous characters detected in argument',
      };
    }
  }

  return { valid: true };
}

export function preExecutionCheck(
  command: string,
  args: string[]
): {
  safe: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (isDangerousCommand(command)) {
    warnings.push('Command "' + command + '" is potentially dangerous');
  }

  const validationResult = validateCommandArgs(args);
  if (!validationResult.valid && validationResult.error) {
    errors.push(validationResult.error);
  }

  return {
    safe: errors.length === 0,
    warnings,
    errors,
  };
}

export function sanitizeUnicode(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u202E\u202D]/g, '');
}

export function recursivelySanitizeUnicode(input: unknown): unknown {
  if (typeof input === 'string') {
    return sanitizeUnicode(input);
  } else if (Array.isArray(input)) {
    return input.map((item: unknown) => recursivelySanitizeUnicode(item));
  } else if (input !== null && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    const obj = input as Record<string, unknown>;
    for (const key in obj) {
      result[key] = recursivelySanitizeUnicode(obj[key]);
    }
    return result;
  }
  return input;
}

export class InputValidator {
  static validateString(
    input: string,
    options: {
      maxLength?: number;
      minLength?: number;
      pattern?: RegExp;
      allowedChars?: string;
      disallowedChars?: string;
    } = {}
  ): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];
    let sanitized = input;

    if (options.maxLength && input.length > options.maxLength) {
      errors.push(`Input exceeds maximum length of ${options.maxLength}`);
    }
    if (options.minLength && input.length < options.minLength) {
      errors.push(`Input is below minimum length of ${options.minLength}`);
    }

    if (options.pattern && !options.pattern.test(input)) {
      errors.push('Input does not match required pattern');
    }

    if (options.allowedChars) {
      const invalidChars = input
        .split('')
        .filter((char) => !options.allowedChars!.includes(char));
      if (invalidChars.length > 0) {
        errors.push(
          `Input contains disallowed characters: ${invalidChars.join(', ')}`
        );
      }
    }

    if (options.disallowedChars) {
      const invalidChars = input
        .split('')
        .filter((char) => options.disallowedChars!.includes(char));
      if (invalidChars.length > 0) {
        errors.push(
          `Input contains forbidden characters: ${invalidChars.join(', ')}`
        );
        sanitized = input
          .split('')
          .filter((char) => !options.disallowedChars!.includes(char))
          .join('');
      }
    }

    sanitized = sanitizeUnicode(sanitized);

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  static validateFilePath(path: string): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];

    if (isPathTraversal(path)) {
      errors.push('Path traversal detected');
    }

    const dangerousChars = [';', '|', '&', '`', '$', '>', '<'];
    const foundChars = dangerousChars.filter((char) => path.includes(char));
    if (foundChars.length > 0) {
      errors.push(`Dangerous characters detected: ${foundChars.join(', ')}`);
    }

    if (path.length > 4096) {
      errors.push('Path is too long');
    }

    const sanitized = sanitizePath(path);

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  static validateUrl(url: string): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];

    const dangerousProtocols = ['javascript:', 'vbscript:', 'data:'];
    const hasDangerousProtocol = dangerousProtocols.some((protocol) =>
      url.toLowerCase().startsWith(protocol)
    );

    if (hasDangerousProtocol) {
      errors.push(`Dangerous protocol detected: ${url.split(':')[0]}`);
      return {
        valid: false,
        errors,
        sanitized: '',
      };
    }

    try {
      const parsedUrl = new URL(url);

      const allowedProtocols = ['http:', 'https:', 'ftp:'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        errors.push(`Protocol not allowed: ${parsedUrl.protocol}`);
      }

      if (!parsedUrl.hostname) {
        errors.push('Invalid hostname');
      }

      if (isPathTraversal(parsedUrl.pathname)) {
        errors.push('Path traversal detected in URL');
      }
    } catch {
      errors.push('Invalid URL format');
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized: url,
    };
  }

  static validateNumber(
    input: number,
    options: {
      min?: number;
      max?: number;
      integerOnly?: boolean;
    } = {}
  ): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (options.min !== undefined && input < options.min) {
      errors.push(`Value is below minimum of ${options.min}`);
    }
    if (options.max !== undefined && input > options.max) {
      errors.push(`Value is above maximum of ${options.max}`);
    }

    if (options.integerOnly && !Number.isInteger(input)) {
      errors.push('Value must be an integer');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static validateObject(
    obj: Record<string, unknown>,
    schema: {
      [key: string]: {
        type: 'string' | 'number' | 'boolean' | 'array' | 'object';
        required?: boolean;
        pattern?: RegExp;
        min?: number;
        max?: number;
        maxLength?: number;
        minLength?: number;
      };
    }
  ): {
    valid: boolean;
    errors: string[];
    sanitized?: Record<string, unknown>;
  } {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, rule] of Object.entries(schema)) {
      const value = obj[key];

      if (
        rule.required &&
        (value === undefined || value === null || value === '')
      ) {
        errors.push(`Field '${key}' is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        let typeValid = true;
        switch (rule.type) {
          case 'string':
            typeValid = typeof value === 'string';
            break;
          case 'number':
            typeValid = typeof value === 'number';
            break;
          case 'boolean':
            typeValid = typeof value === 'boolean';
            break;
          case 'array':
            typeValid = Array.isArray(value);
            break;
          case 'object':
            typeValid = typeof value === 'object' && !Array.isArray(value);
            break;
        }

        if (!typeValid) {
          errors.push(`Field '${key}' must be of type ${rule.type}`);
          continue;
        }

        if (rule.type === 'string') {
          const strValue = value as string;
          if (
            rule.minLength !== undefined &&
            strValue.length < rule.minLength
          ) {
            errors.push(
              `Field '${key}' is below minimum length of ${rule.minLength}`
            );
          }
          if (
            rule.maxLength !== undefined &&
            strValue.length > rule.maxLength
          ) {
            errors.push(
              `Field '${key}' exceeds maximum length of ${rule.maxLength}`
            );
          }
          if (rule.pattern && !rule.pattern.test(strValue)) {
            errors.push(`Field '${key}' does not match required pattern`);
          }
          sanitized[key] = sanitizeUnicode(strValue);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined,
    };
  }

  static validateArray<T>(
    array: T[],
    itemValidator: (item: T) => {
      valid: boolean;
      errors: string[];
      sanitized?: T;
    }
  ): {
    valid: boolean;
    errors: string[];
    sanitized: T[];
  } {
    const errors: string[] = [];
    const sanitized: T[] = [];

    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const validation = itemValidator(item);

      if (!validation.valid) {
        errors.push(...validation.errors.map((err) => `Item ${i}: ${err}`));
      }

      if (validation.sanitized !== undefined) {
        sanitized.push(validation.sanitized);
      } else {
        sanitized.push(item);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  static validateBatch(
    validations: Array<{
      name: string;
      value: unknown;
      validator: (value: unknown) => {
        valid: boolean;
        errors: string[];
        sanitized?: unknown;
      };
    }>
  ): {
    valid: boolean;
    errors: string[];
    sanitized: Record<string, unknown>;
  } {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const validation of validations) {
      const result = validation.validator(validation.value);

      if (!result.valid) {
        errors.push(
          ...result.errors.map((err) => `${validation.name}: ${err}`)
        );
      }

      sanitized[validation.name] =
        result.sanitized !== undefined ? result.sanitized : validation.value;
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }
}

export class OutputEncoder {
  static encodeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  static encodeJavaScript(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/\b/g, '\\b');
  }

  static encodeCss(input: string): string {
    return input.replace(/[^\w\s]/g, (match) => {
      const charCode = match.charCodeAt(0);
      return '\\' + charCode.toString(16) + ' ';
    });
  }

  static encodeAttribute(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  static safeHtml(html: string): string {
    const sanitized = html
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
      .replace(/<object[^>]*>.*?<\/object>/gi, '')
      .replace(/<embed[^>]*>.*?<\/embed>/gi, '')
      .replace(/<applet[^>]*>.*?<\/applet>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(
        /(href|src|action)=\s*["'](javascript|vbscript|data):[^"']*["']/gi,
        ''
      );

    return sanitized;
  }

  static safeJsonStringify(obj: unknown): string {
    const sanitized = this.sanitizeObjectForJson(obj);
    return JSON.stringify(sanitized);
  }

  private static sanitizeObjectForJson(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.encodeHtml(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item: unknown) => this.sanitizeObjectForJson(item));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>
      )) {
        sanitized[key] = this.sanitizeObjectForJson(value);
      }
      return sanitized;
    }

    return obj;
  }

  static safeConsoleLog(message: string, data?: unknown): void {
    const safeMessage = this.encodeJavaScript(message);
    if (data !== undefined) {
      const safeData = this.sanitizeObjectForJson(data);
      logger.info(safeMessage, safeData);
    } else {
      logger.info(safeMessage);
    }
  }

  static safeHtmlOutput(elementId: string, content: string): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = this.safeHtml(content);
    }
  }

  static safeSetAttribute(
    element: Element,
    attribute: string,
    value: string
  ): void {
    const safeAttribute = this.encodeAttribute(attribute);
    const safeValue = this.encodeAttribute(value);
    element.setAttribute(safeAttribute, safeValue);
  }

  static safeSetTextContent(element: Element, text: string): void {
    const safeText = this.encodeHtml(text);
    element.textContent = safeText;
  }

  static safeSetStyle(
    element: HTMLElement,
    property: string,
    value: string
  ): void {
    const safeProperty = this.encodeCss(property);
    const safeValue = this.encodeCss(value);
    element.style.setProperty(safeProperty, safeValue);
  }
}

export function validateObject(
  obj: unknown,
  schema: Record<string, unknown>,
  _options?: Record<string, unknown>
): void {
  for (const [key, ruleDef] of Object.entries(schema)) {
    const ruleMap = ruleDef as Record<string, unknown>;
    const value = (obj as Record<string, unknown>)[key];

    if (ruleMap.required && (value === undefined || value === null)) {
      throw new AppError(
        'Field ' + key + ' is required',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        '600'
      );
    }

    if (value !== undefined && value !== null) {
      const rules = ruleMap as {
        type?: string;
        required?: boolean;
        minLength?: number;
        maxLength?: number;
        min?: number;
        max?: number;
        enum?: unknown[];
        validate?: (v: unknown) => boolean;
      };

      if (rules.type) {
        if (typeof value !== rules.type) {
          throw new AppError(
            'Field ' + key + ' must be of type ' + rules.type,
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }

        if (rules.type === 'string') {
          const strValue = value as string;
          if (
            rules.minLength !== undefined &&
            strValue.length < rules.minLength
          ) {
            throw new AppError(
              'Field ' +
                key +
                ' must be at least ' +
                rules.minLength +
                ' characters',
              ErrorCategory.VALIDATION,
              ErrorSeverity.HIGH,
              '600'
            );
          }
          if (
            rules.maxLength !== undefined &&
            strValue.length > rules.maxLength
          ) {
            throw new AppError(
              'Field ' +
                key +
                ' must be at most ' +
                rules.maxLength +
                ' characters',
              ErrorCategory.VALIDATION,
              ErrorSeverity.HIGH,
              '600'
            );
          }
        }

        if (rules.type === 'number') {
          const numValue = value as number;
          if (rules.min !== undefined && numValue < rules.min) {
            throw new AppError(
              'Field ' + key + ' must be at least ' + rules.min,
              ErrorCategory.VALIDATION,
              ErrorSeverity.HIGH,
              '600'
            );
          }
          if (rules.max !== undefined && numValue > rules.max) {
            throw new AppError(
              'Field ' + key + ' must be at most ' + rules.max,
              ErrorCategory.VALIDATION,
              ErrorSeverity.HIGH,
              '600'
            );
          }
        }

        if (rules.enum && !rules.enum.includes(value)) {
          throw new AppError(
            'Field ' + key + ' must be one of ' + rules.enum.join(', '),
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }

        if (rules.validate && !rules.validate(value)) {
          throw new AppError(
            'Field ' + key + ' failed validation',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            '600'
          );
        }
      }
    }
  }
}

export function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    return input
      .replace(/<script>/gi, '')
      .replace(/<\/script>/gi, '')
      .replace(/<[^>]+>/g, '');
  } else if (Array.isArray(input)) {
    return input.map((item: unknown) => sanitizeInput(item));
  } else if (input !== null && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    const obj = input as Record<string, unknown>;
    for (const key in obj) {
      result[key] = sanitizeInput(obj[key]);
    }
    return result;
  }
  return input;
}

export function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function escapeString(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function containsDangerousContent(input: string): boolean {
  const dangerousPatterns = [
    /<script>/gi,
    /javascript:/i,
    /SELECT\s+.+\s+FROM/i,
    /bash\s+-c/i,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(input));
}

export function generateEncryptionKey(length: number = 32): Buffer {
  return randomBytes(length);
}

export function encrypt(
  plaintext: string,
  key: Buffer,
  options: {
    algorithm: string;
    keyLength: number;
    ivLength: number;
  } = { algorithm: 'aes-256-cbc', keyLength: 32, ivLength: 16 }
): { ciphertext: string; iv: string; authTag?: string } {
  const iv = randomBytes(options.ivLength);
  const cipher = createCipheriv(options.algorithm, key, iv);

  if (options.algorithm.includes('gcm')) {
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = (cipher as any).getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  } else {
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
    };
  }
}

export function decrypt(
  ciphertext: string,
  key: Buffer,
  iv: string,
  options: {
    algorithm: string;
    keyLength: number;
    ivLength: number;
  } = { algorithm: 'aes-256-cbc', keyLength: 32, ivLength: 16 },
  authTag?: string
): string {
  const ivBuffer = Buffer.from(iv, 'base64');
  const ciphertextBuffer = Buffer.from(ciphertext, 'base64');

  if (options.algorithm.includes('gcm') && authTag) {
    const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
    (decipher as any).setAuthTag(Buffer.from(authTag, 'base64'));
    return (
      decipher.update(ciphertextBuffer).toString('utf8') +
      decipher.final('utf8')
    );
  } else {
    const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
    return (
      decipher.update(ciphertextBuffer).toString('utf8') +
      decipher.final('utf8')
    );
  }
}
