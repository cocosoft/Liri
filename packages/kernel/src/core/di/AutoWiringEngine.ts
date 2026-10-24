/**
 * 自动装配引擎
 * 通过构造函数参数名自动解析依赖
 *
 * 使用 IContainer 接口而非 DIContainer 类型，避免循环依赖。
 */
import { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';

import { getLogger } from '../loggerFacade.js';
const logger = getLogger('core\di\AutoWiringEngine');

/**
 * 容器最小接口，供 AutoWiringEngine 安全使用
 */
interface IContainer {
  resolve<T>(name: string): T;
}

/** 纯标识符（可作服务名）：`foo` / `_x` / `$y`；带修饰符、类型标注、解构、默认值一律不匹配 */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class AutoWiringEngine {
  /**
   * 获取构造参数名。**只接受纯标识符**（评审 #6）：形参带修饰符 / 默认值 / 解构 /
   * 含逗号的默认值都会被原实现当成服务名 ⇒ 静默解析错误；现在直接抛
   * `DI_AUTOWIRE_UNRELIABLE`。⚠️ 打包器改名（`--minify`）不可检测 —— 只能靠显式 token 从根上避免。
   */
  getParameterNames<T>(target: new (...args: unknown[]) => T): string[] {
    const fnStr = target.toString();
    const parenOpen = fnStr.indexOf('(');
    const parenClose = fnStr.indexOf(')');
    if (parenOpen === -1 || parenClose === -1 || parenClose <= parenOpen + 1) {
      return [];
    }

    const params = fnStr.slice(parenOpen + 1, parenClose);
    const names = params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const unreliable = names.filter((name) => !IDENTIFIER_RE.test(name));
    if (unreliable.length > 0) {
      throw new AppError(
        `AutoWiring: ${target.name} 的构造参数不是纯标识符（${unreliable.join(' | ')}）` +
          '⇒ 按参数名解析不可靠；请改用显式 token / 注册表',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DI_AUTOWIRE_UNRELIABLE',
        { targetName: target.name, parameters: unreliable }
      );
    }
    return names;
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
