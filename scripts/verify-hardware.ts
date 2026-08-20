// 快速验证 HardwareDetector 检测结果
// 使用方法：cd app && bun run ../scripts/verify-hardware.ts

const { HardwareDetector } = require('./src/ai/local/llama/HardwareDetector');

async function main() {
  const detector = new HardwareDetector();
  const info = await detector.detect({ forceRefresh: true });

  console.log('=== 硬件检测结果 ===');
  console.log(`平台: ${info.platform}`);
  console.log(`CPU 核心: ${info.cpuCores}`);
  console.log(`系统内存: ${info.systemMemoryGB} GB`);
  console.log(`GPU: ${info.gpu.name}`);
  console.log(`GPU 显存: ${info.gpu.memoryGB} GB`);
  console.log(`GPU 后端: ${info.gpu.backend}`);
  console.log(`llama.cpp 后端: ${info.llamaCppBackend}`);

  // 对比实际值
  console.log('\n=== 预期实际值 ===');
  console.log('CPU: Intel Core Ultra 9 285H (16 核)');
  console.log('内存: ~64 GB');
  console.log('GPU: Intel Arc 140T (32GB)');
  console.log('后端: Vulkan');

  // 验证
  const issues: string[] = [];
  if (info.cpuCores !== 16) issues.push(`CPU 核心数不匹配: 预期 16, 实际 ${info.cpuCores}`);
  if (info.systemMemoryGB < 60) issues.push(`内存检测过低: 预期 64GB, 实际 ${info.systemMemoryGB}GB`);
  if (!info.gpu.name?.includes('Arc')) issues.push(`GPU 名称不匹配: 应包含 "Arc"`);
  if (info.gpu.memoryGB < 16) issues.push(`GPU 显存检测过低: 预期 32GB, 实际 ${info.gpu.memoryGB}GB`);
  if (info.llamaCppBackend !== 'vulkan') issues.push(`后端不正确: 预期 vulkan, 实际 ${info.llamaCppBackend}`);

  if (issues.length > 0) {
    console.log('\n❌ 检测异常:');
    issues.forEach((i) => console.log(`  - ${i}`));
    process.exit(1);
  } else {
    console.log('\n✅ 检测结果与实际匹配！');
  }
}

main().catch(console.error);
