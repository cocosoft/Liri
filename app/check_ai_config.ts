import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.pyapp', 'data', 'app.db'));

// Check AI model configs
const configs = db.query('SELECT * FROM ai_app_model_configs').all();
console.log('=== AI Model Configs ===');
console.log(JSON.stringify(configs, null, 2));

// Check AI providers
const providers = db.query('SELECT * FROM ai_providers').all();
console.log('\n=== AI Providers ===');
// Sanitize API keys
const sanitized = providers.map((p: any) => {
  const copy = { ...p };
  if (copy.apiKey && copy.apiKey.length > 4) {
    copy.apiKey = copy.apiKey.slice(0, 4) + '****' + copy.apiKey.slice(-4);
  }
  return copy;
});
console.log(JSON.stringify(sanitized, null, 2));

db.close();