import { afterEach } from 'vitest';

// jsdom 环境下每个测试后自动清理
afterEach(() => {
  document.body.innerHTML = '';
});
