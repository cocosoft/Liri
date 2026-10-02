/**
 * 工具定义
 * 定义工具的元数据和配置信息
 */
import { ToolParam } from './Tool';

/**
 * 工具模式
 * 用于描述工具的输入/输出模式
 */
export interface ToolSchema {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具输入模式 */
  input_schema: {
    /** 输入类型 */
    type: 'object';
    /** 输入属性 */
    properties: Record<
      string,
      {
        /** 属性类型 */
        type: string;
        /** 属性描述 */
        description: string;
        /** 是否必填 */
        required?: boolean;
        /** 默认值 */
        default?: unknown;
        /** 示例值 */
        example?: unknown;
      }
    >;
    /** 必填属性 */
    required?: string[];
  };
  /** 工具输出模式 */
  output_schema: {
    /** 输出类型 */
    type: 'object';
    /** 输出属性 */
    properties: Record<
      string,
      {
        /** 属性类型 */
        type: string;
        /** 属性描述 */
        description: string;
      }
    >;
  };
  /** 工具别名 */
  aliases?: string[];
  /** 搜索提示 */
  searchTips?: string[];
}
