# 升级指南

## 检查当前版本

```bash
# 查看版本信息
bun run src/index.ts --version

# 查看 package.json 中的版本
cat package.json | grep version
```

## 升级步骤

### 使用 Git

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
bun install

# 运行迁移（如有需要）
bun run migrate
```

### 手动升级

```bash
# 备份配置
cp .env .env.backup

# 更新依赖
bun update

# 重新构建
bun run build
```

## 版本迁移

### 从 v1.x 升级到 v2.x

- 配置文件格式变更，请参考新的 `.env.example`
- 数据库结构自动迁移
- API 端点有少量变更，请查看 API 文档

### 回滚

```bash
# 恢复之前的版本
git reset --hard <previous_tag>
bun install
bun run build
```

## 注意事项

- 升级前请备份数据和配置
- 大版本升级请查看 CHANGELOG
- 升级后运行测试确认功能正常
