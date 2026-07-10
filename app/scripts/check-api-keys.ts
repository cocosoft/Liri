import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.pyapp', 'data', 'app.db'), { readonly: true });

console.log('=== 供应商 API Key 状态 ===');
const providers = db.query('SELECT id, name, provider_type, api_key, base_url, is_active FROM ai_providers').all() as any[];
providers.forEach((p: any) => {
  const hasKey = p.api_key && p.api_key.length > 0;
  console.log(`  ${p.name} (${p.provider_type}): apiKey=${hasKey ? '✅ 已配置' : '❌ 未配置'}, active=${!!p.is_active}`);
});

db.close();