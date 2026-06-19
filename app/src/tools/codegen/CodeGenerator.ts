/**
 * 代码生成工具
 * 用于生成常用的代码模板
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 代码生成选项
 */
export interface CodeGenOptions {
  /**
   * 生成的文件路径
   */
  outputPath: string;
  /**
   * 模板类型
   */
  template: 'class' | 'interface' | 'function' | 'enum' | 'type';
  /**
   * 名称
   */
  name: string;
  /**
   * 描述
   */
  description?: string;
  /**
   * 导出类型
   */
  exportType?: 'default' | 'named';
  /**
   * 继承的类或实现的接口
   */
  extends?: string;
  /**
   * 实现的接口
   */
  implements?: string[];
  /**
   * 属性
   */
  properties?: Array<{
    name: string;
    type: string;
    description?: string;
    access?: 'public' | 'private' | 'protected';
    optional?: boolean;
  }>;
  /**
   * 方法
   */
  methods?: Array<{
    name: string;
    description?: string;
    access?: 'public' | 'private' | 'protected';
    returnType: string;
    parameters?: Array<{
      name: string;
      type: string;
      description?: string;
      optional?: boolean;
    }>;
  }>;
  /**
   * 枚举值
   */
  enumValues?: Array<{
    name: string;
    value: string | number;
    description?: string;
  }>;
  /**
   * 类型定义
   */
  typeDefinition?: string;
  /**
   * 是否生成JSDoc注释
   */
  generateJSDoc?: boolean;
}

/**
 * 代码生成器
 */
export class CodeGenerator {
  /**
   * 生成代码
   */
  static generate(options: CodeGenOptions): string {
    let code = '';

    // 生成JSDoc注释
    if (options.generateJSDoc && options.description) {
      code += `/**
 * ${options.description}
 */
`;
    }

    // 生成导出语句
    if (options.exportType === 'default') {
      code += 'export default ';
    } else if (
      options.exportType === 'named' ||
      options.exportType === undefined
    ) {
      code += 'export ';
    }

    // 根据模板类型生成代码
    switch (options.template) {
      case 'class':
        code += this.generateClass(options);
        break;
      case 'interface':
        code += this.generateInterface(options);
        break;
      case 'function':
        code += this.generateFunction(options);
        break;
      case 'enum':
        code += this.generateEnum(options);
        break;
      case 'type':
        code += this.generateType(options);
        break;
    }

    return code;
  }

  /**
   * 生成类
   */
  private static generateClass(options: CodeGenOptions): string {
    let code = `class ${options.name}`;

    // 处理继承
    if (options.extends) {
      code += ` extends ${options.extends}`;
    }

    // 处理实现
    if (options.implements && options.implements.length > 0) {
      code += ` implements ${options.implements.join(', ')}`;
    }

    code += ' {\n';

    // 生成属性
    if (options.properties) {
      for (const prop of options.properties) {
        if (options.generateJSDoc && prop.description) {
          code += `  /**
   * ${prop.description}
   */\n`;
        }
        code += `  ${prop.access || 'public'} ${prop.name}${prop.optional ? '?' : ''}: ${prop.type};\n`;
      }
      code += '\n';
    }

    // 生成构造函数
    if (options.properties) {
      code += '  /**\n   * 构造函数\n   */\n';
      code += `  constructor(${options.properties
        .map((prop) => `${prop.name}${prop.optional ? '?' : ''}: ${prop.type}`)
        .join(', ')}) {\n`;
      for (const prop of options.properties) {
        code += `    this.${prop.name} = ${prop.name};\n`;
      }
      code += '  }\n\n';
    }

    // 生成方法
    if (options.methods) {
      for (const method of options.methods) {
        if (options.generateJSDoc && method.description) {
          code += `  /**
   * ${method.description}
   */\n`;
        }
        code += `  ${method.access || 'public'} ${method.name}(${
          method.parameters
            ? method.parameters
                .map(
                  (param) =>
                    `${param.name}${param.optional ? '?' : ''}: ${param.type}`
                )
                .join(', ')
            : ''
        }): ${method.returnType} {\n`;
        code += '    // 实现逻辑\n';
        code += `    return ${this.getDefaultReturnValue(method.returnType)};\n`;
        code += '  }\n\n';
      }
    }

    code += '}\n';
    return code;
  }

  /**
   * 生成接口
   */
  private static generateInterface(options: CodeGenOptions): string {
    let code = `interface ${options.name}`;

    // 处理继承
    if (options.extends) {
      code += ` extends ${options.extends}`;
    }

    code += ' {\n';

    // 生成属性
    if (options.properties) {
      for (const prop of options.properties) {
        if (options.generateJSDoc && prop.description) {
          code += `  /**
   * ${prop.description}
   */\n`;
        }
        code += `  ${prop.name}${prop.optional ? '?' : ''}: ${prop.type};\n`;
      }
    }

    // 生成方法
    if (options.methods) {
      for (const method of options.methods) {
        if (options.generateJSDoc && method.description) {
          code += `  /**
   * ${method.description}
   */\n`;
        }
        code += `  ${method.name}(${
          method.parameters
            ? method.parameters
                .map(
                  (param) =>
                    `${param.name}${param.optional ? '?' : ''}: ${param.type}`
                )
                .join(', ')
            : ''
        }): ${method.returnType};\n`;
      }
    }

    code += '}\n';
    return code;
  }

  /**
   * 生成函数
   */
  private static generateFunction(options: CodeGenOptions): string {
    let code = '';

    // 生成函数声明
    code += `function ${options.name}(${
      options.methods?.[0]?.parameters
        ? options.methods[0].parameters
            .map(
              (param) =>
                `${param.name}${param.optional ? '?' : ''}: ${param.type}`
            )
            .join(', ')
        : ''
    }): ${options.methods?.[0]?.returnType || 'void'} {\n`;

    // 生成函数体
    code += '  // 实现逻辑\n';
    if (
      options.methods?.[0]?.returnType &&
      options.methods[0].returnType !== 'void'
    ) {
      code += `  return ${this.getDefaultReturnValue(options.methods[0].returnType)};\n`;
    }

    code += '}\n';
    return code;
  }

  /**
   * 生成枚举
   */
  private static generateEnum(options: CodeGenOptions): string {
    let code = `enum ${options.name} {\n`;

    // 生成枚举值
    if (options.enumValues) {
      for (const value of options.enumValues) {
        if (options.generateJSDoc && value.description) {
          code += `  /**
   * ${value.description}
   */\n`;
        }
        code += `  ${value.name} = ${typeof value.value === 'string' ? `'${value.value}'` : value.value},\n`;
      }
    }

    code += '}\n';
    return code;
  }

  /**
   * 生成类型
   */
  private static generateType(options: CodeGenOptions): string {
    let code = `type ${options.name} = ${options.typeDefinition || 'any'};\n`;
    return code;
  }

  /**
   * 获取默认返回值
   */
  private static getDefaultReturnValue(returnType: string): string {
    switch (returnType) {
      case 'string':
        return "''";
      case 'number':
        return '0';
      case 'boolean':
        return 'false';
      case 'object':
        return '{}';
      case 'array':
      case 'any[]':
        return '[]';
      case 'void':
        return '';
      default:
        if (returnType.endsWith('[]')) {
          return '[]';
        } else if (returnType.startsWith('Promise<')) {
          return 'Promise.resolve()';
        } else {
          return 'null';
        }
    }
  }
}

/**
 * 生成代码文件
 */
export async function generateCodeFile(options: CodeGenOptions): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  // 确保目录存在
  const dir = path.dirname(options.outputPath);
  await fs.mkdir(dir, { recursive: true });

  // 生成代码
  const code = CodeGenerator.generate(options);

  // 写入文件
  await fs.writeFile(options.outputPath, code);
  logger.info(`Generated code file: ${options.outputPath}`);
}
