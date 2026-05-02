/**
 * 状态选择器
 *
 * 提供高效的状态选择和派生功能
 */

/**
 * 创建简单选择器
 * @param selector 选择器函数
 */
export function createSelector<T, R>(
  selector: (state: T) => R
): (state: T) => R {
  return selector;
}

/**
 * 创建带依赖的选择器
 * @param selectors 依赖选择器数组
 * @param combiner 组合函数
 */
export function createStructuredSelector<T, R>(
  selectors: Record<string, (state: T) => any>,
  combiner: (results: Record<string, any>) => R
): (state: T) => R {
  return (state: T) => {
    const results: Record<string, any> = {};
    for (const [key, selector] of Object.entries(selectors)) {
      results[key] = selector(state);
    }
    return combiner(results);
  };
}

/**
 * 创建记忆化选择器
 * @param selector 选择器函数
 * @param equalityFn 相等性比较函数
 */
export function createMemoizedSelector<T, R>(
  selector: (state: T) => R,
  equalityFn: (a: R, b: R) => boolean = Object.is
): (state: T) => R {
  let lastState: T | undefined;
  let lastResult: R | undefined;

  return (state: T) => {
    if (lastState !== undefined && state === lastState) {
      return lastResult!;
    }

    const result = selector(state);
    if (lastResult !== undefined && equalityFn(lastResult, result)) {
      return lastResult!;
    }

    lastState = state;
    lastResult = result;
    return result;
  };
}

/**
 * 创建输出选择器
 * @param selector 选择器函数
 * @param projector 投影函数
 */
export function createOutputSelector<T, R, D>(
  selector: (state: T) => R,
  projector: (result: R) => D
): (state: T) => D {
  let lastState: T | undefined;
  let lastResult: D | undefined;

  return (state: T) => {
    if (lastState !== undefined && state === lastState) {
      return lastResult!;
    }

    const intermediate = selector(state);
    const result = projector(intermediate);

    lastState = state;
    lastResult = result;
    return result;
  };
}

/**
 * 创建数组选择器
 * @param selector 选择器函数
 */
export function createArraySelector<T, R>(
  selector: (state: T) => R[]
): (state: T) => R[] {
  let lastState: T | undefined;
  let lastResult: R[] | undefined;

  return (state: T) => {
    if (lastState !== undefined && state === lastState) {
      return lastResult!;
    }

    lastState = state;
    lastResult = selector(state);
    return lastResult!;
  };
}

/**
 * 创建过滤器选择器
 * @param selector 选择器函数
 * @param filter 过滤器函数
 */
export function createFilteredSelector<T, R>(
  selector: (state: T) => R[],
  filter: (item: R) => boolean
): (state: T) => R[] {
  let lastState: T | undefined;
  let lastResult: R[] | undefined;

  return (state: T) => {
    if (lastState !== undefined && state === lastState) {
      return lastResult!;
    }

    const items = selector(state);
    lastResult = items.filter(filter);

    lastState = state;
    return lastResult!;
  };
}

/**
 * 创建映射选择器
 * @param selector 选择器函数
 * @param mapper 映射函数
 */
export function createMappedSelector<T, R, M>(
  selector: (state: T) => R[],
  mapper: (item: R, index: number) => M
): (state: T) => M[] {
  let lastState: T | undefined;
  let lastResult: M[] | undefined;

  return (state: T) => {
    if (lastState !== undefined && state === lastState) {
      return lastResult!;
    }

    const items = selector(state);
    lastResult = items.map(mapper);

    lastState = state;
    return lastResult!;
  };
}

/**
 * 创建分页选择器
 * @param selector 选择器函数
 */
export function createPagingSelector<T, R>(
  selector: (state: T) => R[]
): (state: T, page: number, pageSize: number) => R[] {
  let lastState: T | undefined;
  let lastItems: R[] | undefined;
  let lastPage: number = 0;
  let lastPageSize: number = 0;
  let lastResult: R[] | undefined;

  return (state: T, page: number, pageSize: number) => {
    const stateChanged = lastState !== undefined && state !== lastState;
    const pageChanged = page !== lastPage || pageSize !== lastPageSize;

    if (!stateChanged && !pageChanged && lastResult !== undefined) {
      return lastResult;
    }

    if (stateChanged || lastItems === undefined) {
      lastItems = selector(state);
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    lastResult = lastItems.slice(startIndex, endIndex);

    lastState = state;
    lastPage = page;
    lastPageSize = pageSize;
    return lastResult;
  };
}

/**
 * 创建统计选择器
 * @param selector 选择器函数
 */
export function createStatisticsSelector<T, R extends Record<string, number>>(
  selector: (state: T) => R[]
): (state: T) => {
  total: number;
  sum: Record<string, number>;
  average: Record<string, number>;
  min: Record<string, number>;
  max: Record<string, number>;
} {
  return (state: T) => {
    const items = selector(state);
    if (items.length === 0) {
      return {
        total: 0,
        sum: {},
        average: {},
        min: {},
        max: {},
      };
    }

    const keys = Object.keys(items[0]);
    const sum: Record<string, number> = {};
    const min: Record<string, number> = {};
    const max: Record<string, number> = {};

    for (const key of keys) {
      let sumValue = 0;
      let minValue = Infinity;
      let maxValue = -Infinity;

      for (const item of items) {
        const value = item[key] ?? 0;
        sumValue += value;
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }

      sum[key] = sumValue;
      min[key] = minValue;
      max[key] = maxValue;
    }

    const average: Record<string, number> = {};
    for (const key of keys) {
      average[key] = sum[key] / items.length;
    }

    return {
      total: items.length,
      sum,
      average,
      min,
      max,
    };
  };
}
