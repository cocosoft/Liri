/**
 * 通用工具函数库
 * 提供字符串处理、日期处理、对象操作等常用工具函数
 */

/**
 * 字符串工具函数命名空间
 */
export namespace StringUtils {
  /**
   * 去除字符串首尾空白
   */
  export function trim(str: string): string {
    return str.trim();
  }

  /**
   * 去除字符串所有空白
   */
  export function removeWhitespace(str: string): string {
    return str.replace(/\s+/g, '');
  }

  /**
   * 将驼峰命名转换为蛇形命名
   */
  export function camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * 将蛇形命名转换为驼峰命名
   */
  export function snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * 将字符串首字母大写
   */
  export function capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * 将字符串首字母小写
   */
  export function lowercaseFirst(str: string): string {
    if (!str) return '';
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * 截断字符串
   */
  export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * 判断字符串是否为空
   */
  export function isEmpty(str: string | null | undefined): boolean {
    return str === null || str === undefined || str.length === 0;
  }

  /**
   * 判断字符串是否为空白
   */
  export function isBlank(str: string | null | undefined): boolean {
    return str === null || str === undefined || str.trim().length === 0;
  }

  /**
   * 重复字符串
   */
  export function repeat(str: string, times: number): string {
    return str.repeat(times);
  }

  /**
   * 替换所有匹配项
   */
  export function replaceAll(str: string, search: string, replacement: string): string {
    return str.split(search).join(replacement);
  }

  /**
   * 转义HTML特殊字符
   */
  export function escapeHtml(str: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, (char) => escapeMap[char]);
  }

  /**
   * 反转义HTML特殊字符
   */
  export function unescapeHtml(str: string): string {
    const unescapeMap: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
    };
    return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => unescapeMap[entity]);
  }

  /**
   * 生成随机字符串
   */
  export function random(length: number, charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }

  /**
   * 将字符串转换为URL安全的slug
   */
  export function slugify(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

/**
 * 数组工具函数命名空间
 */
export namespace ArrayUtils {
  /**
   * 判断数组是否为空
   */
  export function isEmpty<T>(arr: T[] | null | undefined): boolean {
    return arr === null || arr === undefined || arr.length === 0;
  }

  /**
   * 判断数组是否包含指定元素
   */
  export function includes<T>(arr: T[], value: T): boolean {
    return arr.includes(value);
  }

  /**
   * 去重
   */
  export function unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
  }

  /**
   * 扁平化数组
   */
  export function flatten<T>(arr: any[]): T[] {
    return arr.reduce((acc, val) => (Array.isArray(val) ? acc.concat(flatten(val)) : acc.concat(val)), [] as T[]);
  }

  /**
   * 按分组
   */
  export function groupBy<T>(arr: T[], key: keyof T | ((item: T) => string | number)): Record<string, T[]> {
    return arr.reduce((result, item) => {
      const groupKey = typeof key === 'function' ? String(key(item)) : String(item[key]);
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    }, {} as Record<string, T[]>);
  }

  /**
   * 排序
   */
  export function sortBy<T>(arr: T[], key: keyof T | ((item: T) => any)): T[] {
    return [...arr].sort((a, b) => {
      const aVal = typeof key === 'function' ? key(a) : a[key];
      const bVal = typeof key === 'function' ? key(b) : b[key];
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });
  }

  /**
   * 获取唯一值
   */
  export function distinct<T>(arr: T[]): T[] {
    return [...new Set(arr)];
  }

  /**
   * 交集
   */
  export function intersection<T>(arr1: T[], arr2: T[]): T[] {
    const set2 = new Set(arr2);
    return arr1.filter((item) => set2.has(item));
  }

  /**
   * 并集
   */
  export function union<T>(arr1: T[], arr2: T[]): T[] {
    return [...new Set([...arr1, ...arr2])];
  }

  /**
   * 差集
   */
  export function difference<T>(arr1: T[], arr2: T[]): T[] {
    const set2 = new Set(arr2);
    return arr1.filter((item) => !set2.has(item));
  }

  /**
   * 分块
   */
  export function chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  /**
   * 获取第一个元素
   */
  export function first<T>(arr: T[]): T | undefined {
    return arr[0];
  }

  /**
   * 获取最后一个元素
   */
  export function last<T>(arr: T[]): T | undefined {
    return arr[arr.length - 1];
  }
}

/**
 * 对象工具函数命名空间
 */
export namespace ObjectUtils {
  /**
   * 判断对象是否为空
   */
  export function isEmpty(obj: Record<string, any> | null | undefined): boolean {
    if (obj === null || obj === undefined) return true;
    return Object.keys(obj).length === 0;
  }

  /**
   * 浅拷贝
   */
  export function shallowClone<T extends Record<string, any>>(obj: T): T {
    return { ...obj };
  }

  /**
   * 深拷贝
   */
  export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map((item) => deepClone(item)) as any;
    const cloned = {} as T;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * 合并对象
   */
  export function merge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
    return Object.assign({}, target, ...sources);
  }

  /**
   * 获取对象指定路径的值
   */
  export function get(obj: Record<string, any>, path: string, defaultValue?: any): any {
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
      if (result === null || result === undefined) return defaultValue;
      result = result[key];
    }
    return result === undefined ? defaultValue : result;
  }

  /**
   * 设置对象指定路径的值
   */
  export function set(obj: Record<string, any>, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = obj;
    for (const key of keys) {
      if (!(key in current) || current[key] === null || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[lastKey] = value;
  }

  /**
   * 删除对象指定路径的值
   */
  export function del(obj: Record<string, any>, path: string): boolean {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = obj;
    for (const key of keys) {
      if (!(key in current) || current[key] === null || typeof current[key] !== 'object') {
        return false;
      }
      current = current[key];
    }
    if (lastKey in current) {
      delete current[lastKey];
      return true;
    }
    return false;
  }

  /**
   * 获取对象所有键
   */
  export function keys(obj: Record<string, any>): string[] {
    return Object.keys(obj);
  }

  /**
   * 获取对象所有值
   */
  export function values(obj: Record<string, any>): any[] {
    return Object.values(obj);
  }

  /**
   * 获取对象所有条目
   */
  export function entries<T>(obj: Record<string, T>): [string, T][] {
    return Object.entries(obj);
  }

  /**
   * 对象键值映射
   */
  export function mapKeys<T>(obj: Record<string, T>, fn: (key: string, value: T) => string): Record<string, T> {
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[fn(key, value)] = value;
    }
    return result;
  }

  /**
   * 对象值映射
   */
  export function mapValues<T, R>(obj: Record<string, T>, fn: (value: T, key: string) => R): Record<string, R> {
    const result: Record<string, R> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = fn(value, key);
    }
    return result;
  }

  /**
   * 对象过滤
   */
  export function pick<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  /**
   * 对象忽略指定键
   */
  export function omit<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Omit<T, K> {
    const result = { ...obj };
    for (const key of keys) {
      delete result[key];
    }
    return result as Omit<T, K>;
  }
}

/**
 * 日期工具函数命名空间
 */
export namespace DateUtils {
  /**
   * 格式化日期
   */
  export function format(date: Date, formatStr: string): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return formatStr
      .replace('yyyy', date.getFullYear().toString())
      .replace('MM', pad(date.getMonth() + 1))
      .replace('dd', pad(date.getDate()))
      .replace('HH', pad(date.getHours()))
      .replace('mm', pad(date.getMinutes()))
      .replace('ss', pad(date.getSeconds()));
  }

  /**
   * 获取当前时间戳
   */
  export function now(): number {
    return Date.now();
  }

  /**
   * 获取当前日期字符串
   */
  export function today(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  /**
   * 判断是否为同一天
   */
  export function isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  /**
   * 判断是否为今天
   */
  export function isToday(date: Date): boolean {
    return isSameDay(date, new Date());
  }

  /**
   * 添加天数
   */
  export function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * 添加小时
   */
  export function addHours(date: Date, hours: number): Date {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
  }

  /**
   * 添加分钟
   */
  export function addMinutes(date: Date, minutes: number): Date {
    const result = new Date(date);
    result.setMinutes(result.getMinutes() + minutes);
    return result;
  }

  /**
   * 获取相对时间描述
   */
  export function relative(date: Date): string {
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  }

  /**
   * 解析日期字符串
   */
  export function parse(dateStr: string): Date | null {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }
}

/**
 * 数字工具函数命名空间
 */
export namespace NumberUtils {
  /**
   * 限制数字范围
   */
  export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * 判断数字是否在范围内
   */
  export function inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }

  /**
   * 随机整数
   */
  export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 四舍五入
   */
  export function round(value: number, decimals: number = 0): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  /**
   * 向上取整
   */
  export function ceil(value: number, decimals: number = 0): number {
    const multiplier = Math.pow(10, decimals);
    return Math.ceil(value * multiplier) / multiplier;
  }

  /**
   * 向下取整
   */
  export function floor(value: number, decimals: number = 0): number {
    const multiplier = Math.pow(10, decimals);
    return Math.floor(value * multiplier) / multiplier;
  }

  /**
   * 格式化数字（添加千分位）
   */
  export function format(value: number): string {
    return value.toLocaleString();
  }

  /**
   * 数字缩放（如 1000 -> 1K）
   */
  export function abbreviate(value: number): string {
    if (value < 1000) return value.toString();
    if (value < 1000000) return `${(value / 1000).toFixed(1)}K`;
    if (value < 1000000000) return `${(value / 1000000).toFixed(1)}M`;
    return `${(value / 1000000000).toFixed(1)}B`;
  }

  /**
   * 判断是否为偶数
   */
  export function isEven(value: number): boolean {
    return value % 2 === 0;
  }

  /**
   * 判断是否为奇数
   */
  export function isOdd(value: number): boolean {
    return value % 2 !== 0;
  }

  /**
   * 求和
   */
  export function sum(values: number[]): number {
    return values.reduce((acc, val) => acc + val, 0);
  }

  /**
   * 求平均值
   */
  export function average(values: number[]): number {
    if (values.length === 0) return 0;
    return sum(values) / values.length;
  }

  /**
   * 求最小值
   */
  export function min(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.min(...values);
  }

  /**
   * 求最大值
   */
  export function max(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.max(...values);
  }
}

/**
 * 函数工具命名空间
 */
export namespace FunctionUtils {
  /**
   * 节流函数
   */
  export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let lastCall = 0;
    return (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        fn(...args);
      }
    };
  }

  /**
   * 防抖函数
   */
  export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fn(...args);
      }, delay);
    };
  }

  /**
   * 缓存函数结果
   */
  export function memoize<T extends (...args: any[]) => any>(fn: T): T {
    const cache = new Map<string, ReturnType<T>>();
    return ((...args: Parameters<T>) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) {
        return cache.get(key);
      }
      const result = fn(...args);
      cache.set(key, result);
      return result;
    }) as T;
  }

  /**
   * 绑定函数上下文
   */
  export function bind<T extends (...args: any[]) => any>(
    fn: T,
    context: any
  ): T {
    return ((...args: Parameters<T>) => fn.apply(context, args)) as T;
  }

  /**
   * 链式调用
   */
  export function pipe<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {
    return (arg: T) => fns.reduce((acc, fn) => fn(acc), arg);
  }

  /**
   * 组合函数
   */
  export function compose<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {
    return (arg: T) => fns.reduceRight((acc, fn) => fn(acc), arg);
  }
}
