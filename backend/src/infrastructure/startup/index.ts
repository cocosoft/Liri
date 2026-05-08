//
/**
 * 启动优化模块统一导出
 */

export { startMdmPrefetch, getMdmPrefetchPromise, ensureMdmPrefetchCompleted, type MdmRawReadResult } from './MdmPrefetch.js';
export { startKeychainPrefetch, ensureKeychainPrefetchCompleted, getLegacyApiKeyPrefetchResult, clearLegacyApiKeyPrefetch } from './KeychainPrefetch.js';

export interface StartupPrefetch {
  mdm?: MdmRawReadResult | null;
}

export async function startAllPrefetches(): Promise<StartupPrefetch> {
  startMdmPrefetch();

  const mdm = await ensureMdmPrefetchCompleted();

  return {
    mdm: mdm || undefined,
  };
}
