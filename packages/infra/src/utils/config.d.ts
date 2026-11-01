/**
 * 配置管理模块类型声明
 */
export interface AppConfig {
  model: {
    default: string;
    temperature: number;
    maxTokens: number;
  };
  plugins: {
    enabled: boolean;
    autoUpdate: boolean;
  };
  skills: {
    enabled: boolean;
    autoLoad: boolean;
  };
  security: {
    sandbox: {
      enabled: boolean;
    };
    permissions: {
      mode: 'auto' | 'manual';
    };
  };
  ui: {
    theme: string;
    color: boolean;
    animations: boolean;
  };
  performance: {
    cache: {
      enabled: boolean;
      size: number;
    };
  };
  [key: string]: any;
}

export declare function enableConfigs(): Promise<void>;
export declare function saveConfig(): void;
export declare function getConfig(key?: string): any;
export declare function getConfigValue(key: string, defaultValue?: any): any;
export declare function setConfigValue(key: string, value: any): void;
export declare function updateConfig(updates: Partial<AppConfig>): void;
export declare function reloadConfig(): AppConfig;
export declare function resetConfig(): void;
