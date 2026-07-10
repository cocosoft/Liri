/**
 * 检查视频模块 DB 配置
 */
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const db = new Database(join(homedir(), '.pyapp', 'data', 'app.db'), { readonly: true });

console.log('=== 视频生成模型 ===');
const models = db.query(`
  SELECT m.model_id, m.display_name, m.capabilities, m.provider_id, m.enabled,
         p.name as provider_name, p.provider_type, p.base_url, p.is_active,
         CASE WHEN p.api_key IS NOT NULL AND p.api_key != '' THEN 'YES' ELSE 'NO' END as has_api_key
  FROM model_registry m
  LEFT JOIN ai_providers p ON m.provider_id = p.id
  WHERE m.capabilities LIKE '%video_generation%'
`).all();
console.log(JSON.stringify(models, null, 2));

console.log('\n=== 所有供应商 ===');
const providers = db.query(`
  SELECT id, name, provider_type, base_url, is_active,
         CASE WHEN api_key IS NOT NULL AND api_key != '' THEN 'YES' ELSE 'NO' END as has_api_key
  FROM ai_providers
`).all();
console.log(JSON.stringify(providers, null, 2));

console.log('\n=== 环境变量 ===');
console.log('FAL_KEY:', process.env.FAL_KEY ? 'YES' : 'NO');
console.log('FAL_API_KEY:', process.env.FAL_API_KEY ? 'YES' : 'NO');
console.log('SILICONFLOW_API_KEY:', process.env.SILICONFLOW_API_KEY ? 'YES' : 'NO');

db.close();