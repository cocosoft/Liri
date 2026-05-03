/**
 * SessionManager 桩模块
 * 用于动态导入预加载
 */
export class SessionManager {
  static instance: SessionManager;

  async initialize(): Promise<void> {
    // 桩实现
  }

  async shutdown(): Promise<void> {
    // 桩实现
  }
}

const sessionManager = new SessionManager();
export default sessionManager;
