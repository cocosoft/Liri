/**
 * generate-test-images.ts
 * 自动化生成图像工具测试所需的图片资产
 * 使用 Sharp 生成测试图片，提交到 Git 仓库
 *
 * 用法：bun run scripts/generate-test-images.ts
 * 或：  npm run generate-test-images
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures', 'images');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 生成 100x100 纯红色 PNG（用于 resize/crop 校验）
 */
async function generateTestPng(): Promise<void> {
  const buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const filePath = path.join(FIXTURES_DIR, 'test.png');
  fs.writeFileSync(filePath, buffer);
  console.log(`  Created: test.png (100x100, pure red)`);
}

/**
 * 生成 1920x1080 JPEG（模拟真实照片，带渐变色块）
 */
async function generateTestPhoto(): Promise<void> {
  // 生成一个渐变色背景模拟照片
  const svgOverlay = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#4A90D9"/>
        <stop offset="60%" stop-color="#87CEEB"/>
        <stop offset="100%" stop-color="#228B22"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#sky)"/>
    <circle cx="300" cy="200" r="80" fill="#FFD700"/>
    <rect x="0" y="800" width="1920" height="280" fill="#2E7D32"/>
    <rect x="400" y="600" width="120" height="200" fill="#8B4513"/>
    <polygon points="400,500 460,600 340,600" fill="#228B22"/>
    <text x="960" y="1040" text-anchor="middle" font-size="24" fill="#FFFFFF" font-family="sans-serif">Test Photo</text>
  </svg>`;

  const buffer = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 4,
      background: { r: 135, g: 206, b: 235, alpha: 1 },
    },
  })
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const filePath = path.join(FIXTURES_DIR, 'test_photo.jpg');
  fs.writeFileSync(filePath, buffer);
  console.log(`  Created: test_photo.jpg (1920x1080, simulated photo)`);
}

/**
 * 生成 64x64 带 alpha 通道的 PNG（用于格式转换校验）
 */
async function generateTestTransparent(): Promise<void> {
  // 半透明圆形 + 透明背景
  const svgOverlay = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="32" r="30" fill="rgba(74,144,217,0.7)"/>
    <circle cx="32" cy="32" r="20" fill="rgba(34,139,34,0.5)"/>
    <circle cx="32" cy="32" r="10" fill="rgba(215,95,95,0.6)"/>
  </svg>`;

  const buffer = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const filePath = path.join(FIXTURES_DIR, 'test_transparent.png');
  fs.writeFileSync(filePath, buffer);
  console.log(`  Created: test_transparent.png (64x64, with alpha channel)`);
}

/**
 * 生成两张有已知差异的图片（用于 compare 测试）
 * test_diff_a: 蓝色底 + 红色方块
 * test_diff_b: 蓝色底 + 绿色方块（尺寸不同）
 */
async function generateTestDiffImages(): Promise<void> {
  // 图片 A: 蓝色底 + 红色方块
  const svgA = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="200" height="200" fill="#4A90D9"/>
    <rect x="50" y="50" width="100" height="100" fill="#FF0000"/>
  </svg>`;

  const bufA = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 74, g: 144, b: 217, alpha: 1 } },
  })
    .composite([{ input: Buffer.from(svgA), top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(FIXTURES_DIR, 'test_diff_a.png'), bufA);
  console.log(`  Created: test_diff_a.png (200x200, blue bg + red square)`);

  // 图片 B: 蓝色底 + 绿色方块（尺寸 220x220 → 不同尺寸）
  const svgB = `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
    <rect width="220" height="220" fill="#4A90D9"/>
    <rect x="60" y="60" width="100" height="100" fill="#00FF00"/>
  </svg>`;

  const bufB = await sharp({
    create: { width: 220, height: 220, channels: 4, background: { r: 74, g: 144, b: 217, alpha: 1 } },
  })
    .composite([{ input: Buffer.from(svgB), top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(FIXTURES_DIR, 'test_diff_b.png'), bufB);
  console.log(`  Created: test_diff_b.png (220x220, blue bg + green square)`);
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  console.log('Generating test image fixtures...\n');

  ensureDir(FIXTURES_DIR);

  try {
    await generateTestPng();
    await generateTestPhoto();
    await generateTestTransparent();
    await generateTestDiffImages();

    console.log(`\nDone! Generated 5 test images in:`);
    console.log(`  ${FIXTURES_DIR}`);
  } catch (error) {
    console.error('Failed to generate test images:', error);
    process.exit(1);
  }
}

main();
