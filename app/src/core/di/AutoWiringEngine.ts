/**
 * 自动装配引擎
 * 通过构造函数参数名自动解析依赖
 *
 * 使用 IContainer 接口而非 DIContainer 类型，避免循环依赖。
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core\di\AutoWiringEngine', level: LogLevel.INFO });

/**
 * 容器最小接口，供 AutoWiringEngine 安全使用
 */
interface IContainer {
  resolve<T>(name: string): T;
}

export class AutoWiringEngine {
  /**
   * 获取构造函数的参数名列表
   */
  getParameterNames<T>(target: new (...args: unknown[]) => T): string[] {
    const fnStr = target.toString();
    const parenOpen = fnStr.indexOf('(');
    const parenClose = fnStr.indexOf(')');
    if (parenOpen === -1 || parenClose === -1 || parenClose <= parenOpen + 1) {
      return [];
    }

    const params = fnStr.slice(parenOpen + 1, parenClose);
    return params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  /**
   * 自动解析构造函数参数并实例化
   */
  resolveConstructor<T>(
    target: new (...args: unknown[]) => T,
    container: IContainer
  ): T {
    const paramNames = this.getParameterNames(target);
    const resolvedParams = paramNames.map((name) => {
      try {
        return container.resolve(name);
      } catch {
        throw new AppError(
          `AutoWiring: cannot resolve parameter "${name}" for ${target.name}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DI_AUTOWIRE_FAILED',
          { targetName: target.name, parameterName: name }
        );
      }
    });
    return new target(...resolvedParams);
  }
}
