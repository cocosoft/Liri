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
    // 文档（versioning.md §三 强制同步项；2026-10-05 新增机械校验）
    { file: 'README.md', type: 'readme' },
    { file: 'CHANGELOG.md', type: 'changelog' },
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
        } else if (type === 'readme') {
            // versioning.md §三：README 三处中的 ①②（badge + 「当前版本」）
            // ③「最新版摘要」由 CHANGELOG 条目承担（下方 changelog 校验）
            const badge = content.match(/badge\/version-(\d+\.\d+\.\d+)-blue/);
            const current = content.match(/当前版本：\*\*v(\d+\.\d+\.\d+)\*\*/);
            if (!badge) return { file: filePath, version: null, error: 'README 缺 badge 版本号' };
            if (!current) return { file: filePath, version: null, error: 'README 缺「当前版本」' };
            if (badge[1] !== current[1]) {
                return {
                    file: filePath,
                    version: null,
                    error: `README 内部不一致（badge v${badge[1]} vs 当前版本 v${current[1]}）`,
                };
            }
            return { file: filePath, version: badge[1], error: null };
        } else if (type === 'changelog') {
            // 取**最新一条**（文件内首个 `#### vX.Y.Z (日期)`）作为当前版本
            const match = content.match(/^#### v(\d+\.\d+\.\d+) \(/m);
            if (!match) {
                return {
                    file: filePath,
                    version: null,
                    error: 'CHANGELOG 缺最新版条目（应为 `#### vX.Y.Z (日期)`）',
                };
            }
            return { file: filePath, version: match[1], error: null };
        }
    } catch (err) {
        return { file: filePath, version: null, error: err.message };
    }

    return { file: filePath, version: null, error: '未知类型' };
}

/**
 * 内核独立包（`packages/kernel`）的**版本单源**检查（2026-10-24 评审 #6）。
 *
 * 与主版本（`app/package.json`）**不对齐**：内核有自己的 semver 线（当前 0.1.x）。
 * 但 `packages/kernel/src/index.ts` 的 `KERNEL_PACKAGE_VERSION` 是**手抄常量** ⇒
 * 发版只改 package.json 时，常量会静默漂移。故两者必须相等，且缺失即 fail-closed。
 */
function checkKernelVersionSingleSource() {
    const pkgPath = path.join(ROOT, 'packages/kernel/package.json');
    const srcPath = path.join(ROOT, 'packages/kernel/src/index.ts');
    if (!fs.existsSync(pkgPath) || !fs.existsSync(srcPath)) {
        return { ok: false, message: '内核包缺失（fail-closed，不视为通过）' };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const match = fs
        .readFileSync(srcPath, 'utf-8')
        .match(/KERNEL_PACKAGE_VERSION\s*=\s*'([^']+)'/);
    if (!match) {
        return { ok: false, message: 'src/index.ts 缺 KERNEL_PACKAGE_VERSION（fail-closed）' };
    }
    if (match[1] !== pkg.version) {
        return {
            ok: false,
            message: `内核版本双源漂移：package.json=v${pkg.version} vs KERNEL_PACKAGE_VERSION=v${match[1]}`,
        };
    }
    return { ok: true, message: `packages/kernel: v${pkg.version}（package.json = 常量）` };
}

function main() {
    console.log('=== 版本一致性检查 ===\n');

    const results = CHECKS.map(c => getVersion(c.file, c.type));
    // 严格 semver（禁止前导零）：`0.5.00` 能通过「各处一致」，却会被
    // Cargo（invalid leading zero）/ Tauri（must be a semver string）拒绝，
    // 属于跨工具链的硬失败 ⇒ 在门禁层先拦住。
    const SEMVER_STRICT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
    for (const r of results) {
        if (r.version && !SEMVER_STRICT.test(r.version)) {
            console.log(`\n❌ 非法 semver（禁止前导零）: ${r.file} = v${r.version}`);
            process.exit(1);
        }
    }

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

    // 内核独立包：只校验「包内单源」，不参与主版本对齐（见 checkKernelVersionSingleSource）
    const kernel = checkKernelVersionSingleSource();
    console.log(`  ${kernel.ok ? '✓' : '✗'} ${kernel.message}`);

    if (!kernel.ok) {
        console.log('\n❌ 内核版本单源检查失败（见上）');
        process.exit(1);
    }

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
