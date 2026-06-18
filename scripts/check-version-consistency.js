/**
 * 版本一致性检查脚本 (Version Consistency Check)
 *
 * 在 CI 中运行: node scripts/check-version-consistency.js
 * 比对 app/package.json、native/package.json、Cargo.toml、client/package.json
 * 等文件的 version 字段是否一致。
 *
 * 对应 .trae/rules/versioning.md §三
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// 需要检查的文件配置: [文件路径, 版本提取方式]
const CHECKS = [
    // JSON 文件: 读取 version 字段
    { file: 'app/package.json', type: 'json' },
    { file: 'app/native/package.json', type: 'json' },
    { file: 'client/package.json', type: 'json' },
    { file: 'client/src-tauri/tauri.conf.json', type: 'json' },
    // Cargo.toml: 正则提取 version = "x.x.x"
    { file: 'app/native/Cargo.toml', type: 'cargo' },
    { file: 'client/src-tauri/Cargo.toml', type: 'cargo' },
];

function getVersion(filePath, type) {
    const fullPath = path.join(ROOT, filePath);
    if (!fs.existsSync(fullPath)) {
        return { file: filePath, version: null, error: '文件不存在' };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    try {
        if (type === 'json') {
            const data = JSON.parse(content);
            return { file: filePath, version: data.version, error: null };
        } else if (type === 'cargo') {
            const match = content.match(/^version\s*=\s*"([^"]+)"/m);
            if (match) {
                return { file: filePath, version: match[1], error: null };
            }
            return { file: filePath, version: null, error: '未找到 version 字段' };
        }
    } catch (err) {
        return { file: filePath, version: null, error: err.message };
    }

    return { file: filePath, version: null, error: '未知类型' };
}

function main() {
    console.log('=== 版本一致性检查 ===\n');

    const results = CHECKS.map(c => getVersion(c.file, c.type));

    // 列出所有版本
    console.log('文件版本对照:');
    console.log('-'.repeat(60));

    let reference = null;
    let allConsistent = true;

    for (const r of results) {
        const marker = r.version ? `v${r.version}` : `❌ ${r.error}`;
        const icon = r.version ? '✓' : '✗';
        console.log(`  ${icon} ${r.file.padEnd(40)} ${marker}`);

        if (r.version) {
            if (reference === null) {
                reference = r.version;
            } else if (r.version !== reference) {
                allConsistent = false;
            }
        } else {
            allConsistent = false;
        }
    }

    console.log('-'.repeat(60));

    if (allConsistent) {
        console.log(`\n✅ 所有版本一致: v${reference}`);
        process.exit(0);
    } else {
        const nonNullVersions = results.filter(r => r.version).map(r => r.version);
        const uniqueVersions = [...new Set(nonNullVersions)];
        console.log(`\n❌ 版本不一致! 发现 ${uniqueVersions.length} 个不同版本: v${uniqueVersions.join(', v')}`);
        process.exit(1);
    }
}

main();
