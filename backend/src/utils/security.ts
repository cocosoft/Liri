//
/**
 * 安全工具模块
 * 提供工具执行的安全检查功能
 */

/**
 * 检查是否为危险命令
 * @param command 命令字符串
 * @returns 是否为危险命令
 */
export function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    // 系统命令 - Windows
    /^del\s/i,
    /^erase\s/i,
    /^format\s/i,
    /^rd\s/i,
    /^rmdir\s/i,
    // 系统命令 - Unix/Linux
    /^rm\s/i,
    /^chmod\s/i,
    /^chown\s/i,
    /^kill\s/i,
    /^shutdown\s/i,
    /^reboot\s/i,
    // 网络命令
    /^nc\s/i,
    /^netcat\s/i,
    /^curl\s/i,
    /^wget\s/i,
    // 命令注入模式
    /[;&|]\s*rm\s/i,
    /[;&|]\s*del\s/i,
    /[;&|]\s*format\s/i,
    // 权限提升
    /^sudo\s/i,
    /^su\s/i,
    /^runas\s/i,
    // 文件操作
    /^mv\s/i,
    /^cp\s/i,
    /^move\s/i,
    /^copy\s/i,
    // 环境变量
    /^export\s/i,
    /^set\s/i,
    // 进程操作
    /^taskkill\s/i,
    /^ps\s/i,
    /^pkill\s/i,
  ];

  return dangerousPatterns.some((pattern) => pattern.test(command));
}

/**
 * 检查是否为路径遍历攻击
 * @param path 路径字符串
 * @returns 是否为路径遍历攻击
 */
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

/**
 * 安全清理路径
 * @param path 原始路径
 * @returns 安全的路径
 */
export function sanitizePath(path: string): string {
  // 移除路径遍历字符
  let sanitized = path
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    .replace(/%2e%2e%2f/g, '')
    .replace(/%2e%2e%5c/g, '')
    .replace(/..%2f/g, '')
    .replace(/..%5c/g, '');

  // 确保路径不以 / 或 \ 开头
  if (sanitized.startsWith('/') || sanitized.startsWith('\\')) {
    sanitized = sanitized.slice(1);
  }

  return sanitized;
}

/**
 * 验证命令参数
 * @param args 命令参数
 * @returns 验证结果
 */
export function validateCommandArgs(args: string[]): {
  valid: boolean;
  error?: string;
} {
  for (const arg of args) {
    // 检查路径遍历
    if (isPathTraversal(arg)) {
      return {
        valid: false,
        error: 'Path traversal detected in argument',
      };
    }

    // 检查危险字符
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

/**
 * 安全执行命令前的检查
 * @param command 命令
 * @param args 参数
 * @returns 检查结果
 */
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

  // 检查危险命令
  if (isDangerousCommand(command)) {
    warnings.push('Command "' + command + '" is potentially dangerous');
  }

  // 验证参数
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

/**
 * 清理Unicode字符
 * @param input 输入字符串
 * @returns 清理后的字符串
 */
export function sanitizeUnicode(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽字符
    .replace(/[\u202E\u202D]/g, ''); // 文本控制字符
}

/**
 * 递归清理Unicode字符
 * @param input 输入
 * @returns 清理后的输入
 */
export function recursivelySanitizeUnicode(input: any): any {
  if (typeof input === 'string') {
    return sanitizeUnicode(input);
  } else if (Array.isArray(input)) {
    return input.map((item) => recursivelySanitizeUnicode(item));
  } else if (input !== null && typeof input === 'object') {
    const result: any = {};
    for (const key in input) {
      result[key] = recursivelySanitizeUnicode(input[key]);
    }
    return result;
  }
  return input;
}

/**
 * 输入验证器类
 * 提供全面的输入验证功能
 */
export class InputValidator {
  /**
   * 验证字符串输入
   * @param input 输入字符串
   * @param options 验证选项
   * @returns 验证结果
   */
  static validateString(input: string, options: {
    maxLength?: number;
    minLength?: number;
    pattern?: RegExp;
    allowedChars?: string;
    disallowedChars?: string;
  } = {}): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];
    let sanitized = input;

    // 长度验证
    if (options.maxLength && input.length > options.maxLength) {
      errors.push(`Input exceeds maximum length of ${options.maxLength}`);
    }
    if (options.minLength && input.length < options.minLength) {
      errors.push(`Input is below minimum length of ${options.minLength}`);
    }

    // 正则表达式验证
    if (options.pattern && !options.pattern.test(input)) {
      errors.push('Input does not match required pattern');
    }

    // 允许字符验证
    if (options.allowedChars) {
      const invalidChars = input.split('').filter(char => 
        !options.allowedChars!.includes(char)
      );
      if (invalidChars.length > 0) {
        errors.push(`Input contains disallowed characters: ${invalidChars.join(', ')}`);
      }
    }

    // 禁止字符验证
    if (options.disallowedChars) {
      const invalidChars = input.split('').filter(char => 
        options.disallowedChars!.includes(char)
      );
      if (invalidChars.length > 0) {
        errors.push(`Input contains forbidden characters: ${invalidChars.join(', ')}`);
        // 移除禁止字符
        sanitized = input.split('').filter(char => 
          !options.disallowedChars!.includes(char)
        ).join('');
      }
    }

    // 自动Unicode清理
    sanitized = sanitizeUnicode(sanitized);

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * 验证文件路径
   * @param path 文件路径
   * @returns 验证结果
   */
  static validateFilePath(path: string): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];
    
    // 路径遍历检查
    if (isPathTraversal(path)) {
      errors.push('Path traversal detected');
    }

    // 危险字符检查
    const dangerousChars = [';', '|', '&', '`', '$', '>', '<'];
    const foundChars = dangerousChars.filter(char => path.includes(char));
    if (foundChars.length > 0) {
      errors.push(`Dangerous characters detected: ${foundChars.join(', ')}`);
    }

    // 路径长度检查
    if (path.length > 4096) {
      errors.push('Path is too long');
    }

    // 清理路径
    const sanitized = sanitizePath(path);

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * 验证URL
   * @param url URL字符串
   * @returns 验证结果
   */
  static validateUrl(url: string): {
    valid: boolean;
    errors: string[];
    sanitized?: string;
  } {
    const errors: string[] = [];

    // 首先检查危险协议
    const dangerousProtocols = ['javascript:', 'vbscript:', 'data:'];
    const hasDangerousProtocol = dangerousProtocols.some(protocol => 
      url.toLowerCase().startsWith(protocol)
    );
    
    if (hasDangerousProtocol) {
      errors.push(`Dangerous protocol detected: ${url.split(':')[0]}`);
      return {
        valid: false,
        errors,
        sanitized: ''
      };
    }

    try {
      const parsedUrl = new URL(url);
      
      // 协议验证
      const allowedProtocols = ['http:', 'https:', 'ftp:'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        errors.push(`Protocol not allowed: ${parsedUrl.protocol}`);
      }

      // 主机名验证
      if (!parsedUrl.hostname) {
        errors.push('Invalid hostname');
      }

      // 路径验证
      if (isPathTraversal(parsedUrl.pathname)) {
        errors.push('Path traversal detected in URL');
      }

    } catch (error) {
      errors.push('Invalid URL format');
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized: url
    };
  }

  /**
   * 验证数字输入
   * @param input 输入值
   * @param options 验证选项
   * @returns 验证结果
   */
  static validateNumber(input: number, options: {
    min?: number;
    max?: number;
    integerOnly?: boolean;
  } = {}): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 范围验证
    if (options.min !== undefined && input < options.min) {
      errors.push(`Value is below minimum of ${options.min}`);
    }
    if (options.max !== undefined && input > options.max) {
      errors.push(`Value is above maximum of ${options.max}`);
    }

    // 整数验证
    if (options.integerOnly && !Number.isInteger(input)) {
      errors.push('Value must be an integer');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证对象
   * @param obj 要验证的对象
   * @param schema 验证模式
   * @returns 验证结果
   */
  static validateObject(obj: Record<string, any>, schema: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      required?: boolean;
      pattern?: RegExp;
      min?: number;
      max?: number;
      maxLength?: number;
      minLength?: number;
    };
  }): {
    valid: boolean;
    errors: string[];
    sanitized?: Record<string, any>;
  } {
    const errors: string[] = [];
    const sanitized: Record<string, any> = {};

    for (const [key, rule] of Object.entries(schema)) {
      const value = obj[key];

      // 必填字段检查
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${key}' is required`);
        continue;
      }

      // 类型检查
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

        // 特定类型的验证
        if (rule.type === 'string' && typeof value === 'string') {
          const stringValidation = this.validateString(value, {
            maxLength: rule.maxLength,
            minLength: rule.minLength,
            pattern: rule.pattern
          });
          if (!stringValidation.valid) {
            errors.push(...stringValidation.errors.map(err => `Field '${key}': ${err}`));
          }
          sanitized[key] = stringValidation.sanitized || value;
        } else if (rule.type === 'number' && typeof value === 'number') {
          const numberValidation = this.validateNumber(value, {
            min: rule.min,
            max: rule.max
          });
          if (!numberValidation.valid) {
            errors.push(...numberValidation.errors.map(err => `Field '${key}': ${err}`));
          }
          sanitized[key] = value;
        } else {
          sanitized[key] = value;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * 验证数组
   * @param array 数组
   * @param itemValidator 项目验证器
   * @param options 验证选项
   * @returns 验证结果
   */
  static validateArray<T>(array: T[], itemValidator: (item: T) => {
    valid: boolean;
    errors: string[];
    sanitized?: T;
  }, options: {
    maxLength?: number;
    minLength?: number;
    unique?: boolean;
  } = {}): {
    valid: boolean;
    errors: string[];
    sanitized?: T[];
  } {
    const errors: string[] = [];
    const sanitized: T[] = [];

    // 长度验证
    if (options.maxLength && array.length > options.maxLength) {
      errors.push(`Array exceeds maximum length of ${options.maxLength}`);
    }
    if (options.minLength && array.length < options.minLength) {
      errors.push(`Array is below minimum length of ${options.minLength}`);
    }

    // 唯一性验证
    if (options.unique) {
      const uniqueSet = new Set(array);
      if (uniqueSet.size !== array.length) {
        errors.push('Array contains duplicate items');
      }
    }

    // 项目级验证
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const validation = itemValidator(item);
      
      if (!validation.valid) {
        errors.push(...validation.errors.map(err => `Item ${i}: ${err}`));
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
      sanitized
    };
  }

  /**
   * 批量验证多个输入
   * @param validations 验证配置
   * @returns 总体验证结果
   */
  static validateBatch(validations: Array<{
    name: string;
    value: any;
    validator: (value: any) => { valid: boolean; errors: string[]; sanitized?: any };
  }>): {
    valid: boolean;
    errors: string[];
    sanitized: Record<string, any>;
  } {
    const errors: string[] = [];
    const sanitized: Record<string, any> = {};

    for (const validation of validations) {
      const result = validation.validator(validation.value);
      
      if (!result.valid) {
        errors.push(...result.errors.map(err => `${validation.name}: ${err}`));
      }
      
      sanitized[validation.name] = result.sanitized !== undefined ? result.sanitized : validation.value;
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
}

/**
 * 输出编码器类
 * 提供全面的输出编码功能，防止XSS攻击
 */
export class OutputEncoder {
  /**
   * HTML实体编码
   * @param input 输入字符串
   * @returns 编码后的字符串
   */
  static encodeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * URL编码
   * @param input 输入字符串
   * @returns 编码后的字符串
   */
  static encodeUrl(input: string): string {
    return encodeURIComponent(input);
  }

  /**
   * JavaScript字符串编码
   * @param input 输入字符串
   * @returns 编码后的字符串
   */
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

  /**
   * CSS编码
   * @param input 输入字符串
   * @returns 编码后的字符串
   */
  static encodeCss(input: string): string {
    return input.replace(/[^\w\s]/g, (match) => {
      const charCode = match.charCodeAt(0);
      return '\\' + charCode.toString(16) + ' ';
    });
  }

  /**
   * 属性值编码
   * @param input 输入字符串
   * @returns 编码后的字符串
   */
  static encodeAttribute(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * 安全插入HTML
   * @param html HTML字符串
   * @returns 安全的HTML字符串
   */
  static safeHtml(html: string): string {
    // 移除危险标签和属性
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
      // 移除危险事件属性
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      // 移除危险协议
      .replace(/(href|src|action)=\s*["'](javascript|vbscript|data):[^"']*["']/gi, '');

    return sanitized;
  }

  /**
   * 安全JSON序列化
   * @param obj 要序列化的对象
   * @returns 安全的JSON字符串
   */
  static safeJsonStringify(obj: any): string {
    // 递归清理对象中的危险内容
    const sanitized = this.sanitizeObjectForJson(obj);
    return JSON.stringify(sanitized);
  }

  /**
   * 清理对象用于JSON序列化
   * @param obj 要清理的对象
   * @returns 清理后的对象
   */
  private static sanitizeObjectForJson(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // 清理字符串中的危险内容
      return this.encodeHtml(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObjectForJson(item));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeObjectForJson(value);
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * 安全输出到控制台
   * @param message 消息
   * @param data 数据
   */
  static safeConsoleLog(message: string, data?: any): void {
    const safeMessage = this.encodeJavaScript(message);
    if (data !== undefined) {
      const safeData = this.sanitizeObjectForJson(data);
      console.log(safeMessage, safeData);
    } else {
      console.log(safeMessage);
    }
  }

  /**
   * 安全输出到HTML元素
   * @param elementId 元素ID
   * @param content 内容
   */
  static safeHtmlOutput(elementId: string, content: string): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = this.safeHtml(content);
    }
  }

  /**
   * 安全设置属性
   * @param element 元素
   * @param attribute 属性名
   * @param value 属性值
   */
  static safeSetAttribute(element: Element, attribute: string, value: string): void {
    const safeAttribute = this.encodeAttribute(attribute);
    const safeValue = this.encodeAttribute(value);
    element.setAttribute(safeAttribute, safeValue);
  }

  /**
   * 安全设置文本内容
   * @param element 元素
   * @param text 文本内容
   */
  static safeSetTextContent(element: Element, text: string): void {
    const safeText = this.encodeHtml(text);
    element.textContent = safeText;
  }

  /**
   * 安全设置样式
   * @param element 元素
   * @param property 样式属性
   * @param value 样式值
   */
  static safeSetStyle(element: HTMLElement, property: string, value: string): void {
    const safeProperty = this.encodeCss(property);
    const safeValue = this.encodeCss(value);
    element.style.setProperty(safeProperty, safeValue);
  }
}

/**
 * 验证对象
 * @param obj 要验证的对象
 * @param schema 验证模式
 * @param options 验证选项
 * @returns 验证结果
 */
export function validateObject(obj: any, schema: Record<string, Record<string, unknown>>, options: any = {}): void {
  for (const [key, rules] of Object.entries(schema)) {
    const value = obj[key];

    if (rules.required && (value === undefined || value === null)) {
      throw new Error('Field ' + key + ' is required');
    }

    if (value !== undefined && value !== null) {
      if (rules.type) {
        if (typeof value !== rules.type) {
          throw new Error('Field ' + key + ' must be of type ' + rules.type);
        }

        if (rules.type === 'string') {
          if (rules.minLength !== undefined && value.length < rules.minLength) {
            throw new Error(
              'Field ' +
                key +
                ' must be at least ' +
                rules.minLength +
                ' characters'
            );
          }
          if (rules.maxLength !== undefined && value.length > rules.maxLength) {
            throw new Error(
              'Field ' +
                key +
                ' must be at most ' +
                rules.maxLength +
                ' characters'
            );
          }
        }

        if (rules.type === 'number') {
          if (rules.min !== undefined && value < rules.min) {
            throw new Error('Field ' + key + ' must be at least ' + rules.min);
          }
          if (rules.max !== undefined && value > rules.max) {
            throw new Error('Field ' + key + ' must be at most ' + rules.max);
          }
        }

        if (rules.enum && !rules.enum.includes(value)) {
          throw new Error(
            'Field ' + key + ' must be one of ' + rules.enum.join(', ')
          );
        }

        if (rules.validate && !rules.validate(value)) {
          throw new Error('Field ' + key + ' failed validation');
        }
      }
    }
  }
}

/**
 * 清理输入
 * @param input 输入
 * @returns 清理后的输入
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // 移除危险标签
    return input
      .replace(/<script>/gi, '')
      .replace(/<\/script>/gi, '')
      .replace(/<[^>]+>/g, '');
  } else if (Array.isArray(input)) {
    return input.map((item) => sanitizeInput(item));
  } else if (input !== null && typeof input === 'object') {
    const result: any = {};
    for (const key in input) {
      result[key] = sanitizeInput(input[key]);
    }
    return result;
  }
  return input;
}

/**
 * 安全JSON解析
 * @param json JSON字符串
 * @returns 解析后的对象或null
 */
export function safeJsonParse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * 转义字符串
 * @param input 输入字符串
 * @returns 转义后的字符串
 */
export function escapeString(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 检查是否包含危险内容
 * @param input 输入字符串
 * @returns 是否包含危险内容
 */
export function containsDangerousContent(input: string): boolean {
  const dangerousPatterns = [
    /<script>/gi, // XSS
    /javascript:/i, // JavaScript协议
    /SELECT\s+.+\s+FROM/i, // SQL注入
    /bash\s+-c/i, // 命令注入
  ];
  return dangerousPatterns.some((pattern) => pattern.test(input));
}
