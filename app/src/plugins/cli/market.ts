/**
 * 插件市场 CLI 命令
 * 提供插件市场的搜索、浏览、安装、更新等功能
 */
import { Command } from 'commander';
import chalk from 'chalk';
import {
  pluginMarketplace,
  PluginMarketplace,
} from '../marketplace/PluginMarketplace.js';
import type {
  MarketplacePlugin,
  MarketPluginVersion,
} from '../marketplace/PluginMarketplace.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'plugins:cli:market', level: LogLevel.INFO });

/**
 * 格式化时间戳为可读日期
 */
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * 显示插件列表（表格格式）
 */
function printPluginTable(plugins: MarketplacePlugin[]): void {
  if (plugins.length === 0) {
    console.log(chalk.yellow('没有找到匹配的插件'));
    return;
  }

  console.log(chalk.cyan('─'.repeat(90)));
  console.log(
    chalk.bold(
      '  ' +
        'ID'.padEnd(30) +
        '名称'.padEnd(20) +
        '版本'.padEnd(10) +
        '评分'.padEnd(8) +
        '下载'.padEnd(10) +
        '更新日期'
    )
  );
  console.log(chalk.cyan('─'.repeat(90)));

  for (const plugin of plugins) {
    const stars =
      '★'.repeat(Math.round(plugin.rating)) +
      '☆'.repeat(5 - Math.round(plugin.rating));
    console.log(
      `  ${chalk.green(plugin.id.padEnd(30))}` +
        `${chalk.white(plugin.name.padEnd(20))}` +
        `${chalk.yellow(plugin.version.padEnd(10))}` +
        `${chalk.magenta(stars.padEnd(8))}` +
        `${chalk.cyan(String(plugin.downloads).padEnd(10))}` +
        `${chalk.gray(formatDate(plugin.updatedAt))}`
    );
  }

  console.log(chalk.cyan('─'.repeat(90)));
  console.log(chalk.gray(`共 ${plugins.length} 个插件`));
}

/**
 * 初始化市场CLI命令
 */
export function initMarketCommand(program: Command): void {
  const marketCommand = program
    .command('market')
    .description('插件市场管理（搜索、浏览、安装、更新）');

  /**
   * market search <query> - 搜索插件
   */
  marketCommand
    .command('search <query>')
    .description('在市场中搜索插件')
    .option('-t, --tags <tags>', '按标签筛选（逗号分隔）')
    .option('-a, --author <author>', '按作者筛选')
    .option(
      '-s, --sort <field>',
      '排序字段 (downloads|rating|updated|name)',
      'downloads'
    )
    .option('-o, --order <order>', '排序方向 (asc|desc)', 'desc')
    .option('-p, --page <page>', '页码', '1')
    .option('-n, --page-size <size>', '每页数量', '20')
    .action((query: string, options: Record<string, string>) => {
      const tags = options.tags
        ? options.tags.split(',').map((t: string) => t.trim())
        : undefined;

      const result = pluginMarketplace.search({
        query,
        tags,
        author: options.author,
        sortBy: options.sort as 'downloads' | 'rating' | 'updated' | 'name',
        sortOrder: options.order as 'asc' | 'desc',
        page: parseInt(options.page, 10),
        pageSize: parseInt(options.pageSize, 10),
      });

      if (result.plugins.length === 0) {
        console.log(chalk.yellow(`未找到匹配 "${query}" 的插件`));
        return;
      }

      console.log(chalk.bold(`\n搜索结果: "${query}"`));
      if (tags) console.log(chalk.gray(`  标签: ${tags.join(', ')}`));
      console.log();

      printPluginTable(result.plugins);

      if (result.hasMore) {
        const remainingPages = Math.ceil(
          (result.total - result.page * result.pageSize) / result.pageSize
        );
        console.log(
          chalk.gray(
            `\n还有约 ${remainingPages} 页结果，使用 --page 参数查看更多`
          )
        );
      }
    });

  /**
   * market browse [category] - 浏览分类
   */
  marketCommand
    .command('browse')
    .description('浏览市场分类')
    .option('-c, --category <category>', '分类名称')
    .option(
      '-s, --sort <field>',
      '排序字段 (downloads|rating|updated|name)',
      'downloads'
    )
    .option('-p, --page <page>', '页码', '1')
    .option('-n, --page-size <size>', '每页数量', '20')
    .action((options: Record<string, string>) => {
      if (options.category) {
        const result = pluginMarketplace.search({
          tags: [options.category],
          sortBy: options.sort as 'downloads' | 'rating' | 'updated' | 'name',
          sortOrder: 'desc',
          page: parseInt(options.page, 10),
          pageSize: parseInt(options.pageSize, 10),
        });

        console.log(chalk.bold(`\n分类: ${options.category}`));
        console.log();
        printPluginTable(result.plugins);
      } else {
        const categories = pluginMarketplace.getCategories();
        console.log(chalk.bold('\n市场分类'));
        console.log(chalk.cyan('─'.repeat(50)));

        for (const cat of categories) {
          console.log(
            `  ${chalk.green(cat.name.padEnd(20))} ${chalk.cyan(String(cat.count).padStart(4))} 个插件`
          );
        }

        console.log(chalk.cyan('─'.repeat(50)));
        console.log(
          chalk.gray('使用 market browse -c <分类名> 查看分类下的插件')
        );
      }
    });

  /**
   * market info <plugin-id> - 查看插件详情
   */
  marketCommand
    .command('info <pluginId>')
    .description('查看插件详细信息')
    .action((pluginId: string) => {
      const plugin = pluginMarketplace.getPlugin(pluginId);
      if (!plugin) {
        console.log(chalk.yellow(`市场中未找到插件: ${pluginId}`));
        return;
      }

      const latestVersion = pluginMarketplace.getLatestVersion(pluginId);
      const versions = pluginMarketplace.getPluginVersions(pluginId);
      const stars =
        '★'.repeat(Math.round(plugin.rating)) +
        '☆'.repeat(5 - Math.round(plugin.rating));

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold(`  ${plugin.name}`));
      console.log(chalk.cyan('═'.repeat(60)));

      console.log(`  ${chalk.gray('ID:')}       ${plugin.id}`);
      console.log(
        `  ${chalk.gray('版本:')}     ${chalk.yellow(plugin.version)}${latestVersion && latestVersion !== plugin.version ? chalk.green(` (最新: ${latestVersion})`) : ''}`
      );
      console.log(`  ${chalk.gray('作者:')}     ${plugin.author}`);
      console.log(`  ${chalk.gray('评分:')}     ${stars} ${plugin.rating}`);
      console.log(
        `  ${chalk.gray('下载:')}     ${plugin.downloads.toLocaleString()}`
      );
      console.log(
        `  ${chalk.gray('更新:')}     ${formatDate(plugin.updatedAt)}`
      );
      console.log(
        `  ${chalk.gray('标签:')}     ${plugin.tags.map((t) => chalk.cyan(t)).join(', ')}`
      );

      if (plugin.repository) {
        console.log(`  ${chalk.gray('仓库:')}     ${plugin.repository}`);
      }
      if (plugin.homepage) {
        console.log(`  ${chalk.gray('主页:')}     ${plugin.homepage}`);
      }
      if (plugin.license) {
        console.log(`  ${chalk.gray('许可:')}     ${plugin.license}`);
      }

      console.log(`  ${chalk.gray('描述:')}     ${plugin.description}`);

      if (versions.length > 0) {
        console.log();
        console.log(chalk.bold('  版本历史:'));
        console.log(chalk.cyan('  ─'.repeat(40)));

        for (const v of versions) {
          const isCurrent = v.version === plugin.version;
          const marker = isCurrent ? chalk.green(' ← 当前') : '';
          console.log(
            `  ${chalk.yellow(v.version.padEnd(10))} ${formatDate(v.publishedAt)}${marker}`
          );
          if (v.releaseNotes) {
            console.log(`    ${chalk.gray(v.releaseNotes)}`);
          }
        }
      }

      console.log(chalk.cyan('═'.repeat(60)));
    });

  /**
   * market install <plugin-id> - 从市场安装插件
   */
  marketCommand
    .command('install <pluginId>')
    .description('从市场安装插件')
    .option('-v, --version <version>', '指定版本')
    .action(async (pluginId: string, options: Record<string, string>) => {
      const plugin = pluginMarketplace.getPlugin(pluginId);
      if (!plugin) {
        console.log(chalk.yellow(`市场中未找到插件: ${pluginId}`));
        console.log(chalk.gray('使用 market search 搜索可用插件'));
        return;
      }

      const targetVersion = options.version || plugin.version;

      console.log(
        chalk.blue(`正在安装插件: ${plugin.name}@${targetVersion}...`)
      );
      console.log(
        chalk.gray(`  来源: ${pluginMarketplace['catalogUrl'] || '本地市场'}`)
      );

      try {
        const { PluginInstallManager } =
          await import('../install/PluginInstallManager.js');
        const { PluginRegistry } = await import('../core/PluginRegistry.js');
        const { NpmDistributor } =
          await import('../distribution/NpmDistributor.js');

        const registry = new PluginRegistry();
        const npmDistributor = new NpmDistributor();
        const installer = new PluginInstallManager(registry, npmDistributor);

        const result = await installer.install({
          source: 'marketplace',
          sourcePath: pluginId,
          version: targetVersion,
        });

        if (result.success) {
          console.log(chalk.green('✓ 插件安装成功!'));
          console.log(chalk.gray(`  名称: ${plugin.name}`));
          console.log(chalk.gray(`  版本: ${result.version}`));
          console.log(chalk.gray(`  路径: ${result.installPath}`));
          if (result.dependencies && result.dependencies.length > 0) {
            console.log(
              chalk.gray(`  依赖: ${result.dependencies.join(', ')}`)
            );
          }
        } else {
          console.log(chalk.red('✗ 安装失败:'), result.error || '未知错误');

          const installed = installer.isInstalled(pluginId);
          if (installed) {
            console.log(
              chalk.yellow('⚠ 插件可能已部分安装，使用 market uninstall 清理')
            );
          }
        }
      } catch (error) {
        console.log(
          chalk.red('✗ 安装过程中出错:'),
          error instanceof Error ? error.message : String(error)
        );
      }
    });

  /**
   * market update [plugin-id] - 检查/应用更新
   */
  marketCommand
    .command('update [pluginId]')
    .description('检查并应用插件更新')
    .option('--apply', '自动应用所有可用更新')
    .action(
      async (pluginId: string | undefined, options: Record<string, string>) => {
        if (pluginId) {
          const plugin = pluginMarketplace.getPlugin(pluginId);
          if (!plugin) {
            console.log(chalk.yellow(`市场中未找到插件: ${pluginId}`));
            return;
          }

          const updateInfo = pluginMarketplace.checkForUpdates(
            pluginId,
            plugin.version
          );
          if (!updateInfo || !updateInfo.updateAvailable) {
            console.log(
              chalk.green(`✓ ${plugin.name} 已是最新版本 (${plugin.version})`)
            );
            return;
          }

          console.log(chalk.yellow(`\n更新可用: ${plugin.name}`));
          console.log(
            `  ${chalk.gray('当前版本:')} ${chalk.red(updateInfo.currentVersion)}`
          );
          console.log(
            `  ${chalk.gray('最新版本:')} ${chalk.green(updateInfo.latestVersion)}`
          );
          if (updateInfo.releaseNotes) {
            console.log(
              `  ${chalk.gray('更新说明:')} ${updateInfo.releaseNotes}`
            );
          }

          if (options.apply) {
            console.log(chalk.blue('\n正在应用更新...'));
            try {
              const { PluginInstallManager } =
                await import('../install/PluginInstallManager.js');
              const { PluginRegistry } =
                await import('../core/PluginRegistry.js');
              const { NpmDistributor } =
                await import('../distribution/NpmDistributor.js');

              const registry = new PluginRegistry();
              const npmDistributor = new NpmDistributor();
              const installer = new PluginInstallManager(
                registry,
                npmDistributor
              );

              const result = await installer.update(
                pluginId,
                updateInfo.latestVersion
              );
              if (result.success) {
                console.log(
                  chalk.green(
                    `✓ ${plugin.name} 已更新至 ${updateInfo.latestVersion}`
                  )
                );
              } else {
                console.log(chalk.red('✗ 更新失败:'), result.error);
              }
            } catch (error) {
              console.log(
                chalk.red('✗ 更新出错:'),
                error instanceof Error ? error.message : String(error)
              );
            }
          }
        } else {
          const installed = pluginMarketplace.getTopPlugins(50);
          const updates = pluginMarketplace
            .checkAllForUpdates(
              installed.map((p) => ({ id: p.id, version: p.version }))
            )
            .filter((u) => u.updateAvailable);

          if (updates.length === 0) {
            console.log(chalk.green('\n所有插件已是最新版本'));
            return;
          }

          console.log(chalk.bold(`\n可用更新 (${updates.length} 个):`));
          console.log(chalk.cyan('─'.repeat(70)));

          for (const update of updates) {
            console.log(
              `  ${chalk.green(update.pluginName.padEnd(25))}` +
                `${chalk.red(update.currentVersion.padEnd(10))} → ` +
                `${chalk.green(update.latestVersion.padEnd(10))}`
            );
            if (update.releaseNotes) {
              console.log(`  ${chalk.gray(update.releaseNotes)}`);
            }
            console.log();
          }

          console.log(
            chalk.gray('使用 market update <plugin-id> --apply 更新指定插件')
          );
        }
      }
    );

  /**
   * market uninstall <plugin-id> - 卸载插件
   */
  marketCommand
    .command('uninstall <pluginId>')
    .description('卸载已安装的插件')
    .action(async (pluginId: string) => {
      console.log(chalk.blue(`正在卸载插件: ${pluginId}...`));

      try {
        const { PluginInstallManager } =
          await import('../install/PluginInstallManager.js');
        const { PluginRegistry } = await import('../core/PluginRegistry.js');
        const { NpmDistributor } =
          await import('../distribution/NpmDistributor.js');

        const registry = new PluginRegistry();
        const npmDistributor = new NpmDistributor();
        const installer = new PluginInstallManager(registry, npmDistributor);

        const success = installer.uninstall(pluginId);
        if (success) {
          console.log(chalk.green(`✓ 插件 ${pluginId} 已卸载`));
        } else {
          console.log(chalk.yellow(`插件 ${pluginId} 未安装或已被移除`));
        }
      } catch (error) {
        console.log(
          chalk.red('✗ 卸载出错:'),
          error instanceof Error ? error.message : String(error)
        );
      }
    });

  /**
   * market installed - 列出已安装插件
   */
  marketCommand
    .command('installed')
    .description('列出已从市场安装的插件')
    .action(async () => {
      try {
        const { PluginInstallManager } =
          await import('../install/PluginInstallManager.js');
        const { PluginRegistry } = await import('../core/PluginRegistry.js');
        const { NpmDistributor } =
          await import('../distribution/NpmDistributor.js');

        const registry = new PluginRegistry();
        const npmDistributor = new NpmDistributor();
        const installer = new PluginInstallManager(registry, npmDistributor);

        const installed = installer.getInstalledPlugins();

        if (installed.length === 0) {
          console.log(chalk.yellow('\n尚未从市场安装任何插件'));
          console.log(
            chalk.gray('使用 market search 搜索，然后 market install 安装')
          );
          return;
        }

        console.log(chalk.bold(`\n已安装插件 (${installed.length} 个):`));
        console.log(chalk.cyan('─'.repeat(80)));

        for (const record of installed) {
          const marketPlugin = pluginMarketplace.getPlugin(record.pluginName);
          const updateInfo = marketPlugin
            ? pluginMarketplace.checkForUpdates(
                record.pluginName,
                record.version
              )
            : undefined;

          const updateMarker = updateInfo?.updateAvailable
            ? chalk.green(` → ${updateInfo.latestVersion} (可更新)`)
            : '';

          console.log(
            `  ${chalk.green(record.pluginName.padEnd(25))} ${chalk.yellow(record.version.padEnd(10))}${updateMarker}`
          );
          console.log(
            `  ${chalk.gray('来源:')} ${record.source.padEnd(12)} ${chalk.gray('安装:')} ${new Date(record.installedAt).toLocaleDateString('zh-CN')}`
          );
          if (record.updatedAt) {
            console.log(
              `  ${chalk.gray('更新:')} ${new Date(record.updatedAt).toLocaleDateString('zh-CN')}`
            );
          }
          console.log();
        }

        console.log(chalk.gray('使用 market update 检查所有已安装插件的更新'));
      } catch (error) {
        console.log(
          chalk.red('✗ 获取已安装插件列表失败:'),
          error instanceof Error ? error.message : String(error)
        );
      }
    });

  /**
   * market sync - 同步市场数据
   */
  marketCommand
    .command('sync')
    .description('从远程同步市场数据')
    .option('-f, --force', '强制重新同步（忽略缓存）')
    .action(async (options: Record<string, string>) => {
      const force = options.force === 'true';

      console.log(chalk.blue(`正在同步市场数据${force ? ' (强制)' : ''}...`));

      const success = await pluginMarketplace.syncFromRemote(force);
      if (success) {
        console.log(chalk.green('✓ 市场数据同步成功'));
      } else {
        console.log(chalk.yellow('⚠ 远程同步失败，使用本地缓存数据'));
      }

      const ttl = pluginMarketplace.getCacheTimeToLive();
      if (ttl > 0) {
        console.log(chalk.gray(`缓存有效期: ${Math.round(ttl / 60000)} 分钟`));
      }
    });

  /**
   * market top - 热门插件
   */
  marketCommand
    .command('top')
    .description('查看热门插件')
    .option('-n, --count <count>', '数量', '10')
    .action((options: Record<string, string>) => {
      const count = parseInt(options.count, 10);
      const top = pluginMarketplace.getTopPlugins(count);

      console.log(chalk.bold(`\n热门插件 Top ${top.length}`));
      console.log();
      printPluginTable(top);
    });

  /**
   * market recommended - 推荐插件
   */
  marketCommand
    .command('recommended')
    .description('查看推荐插件')
    .option('-n, --count <count>', '数量', '5')
    .action((options: Record<string, string>) => {
      const count = parseInt(options.count, 10);
      const recommended = pluginMarketplace.getRecommendedPlugins(count);

      console.log(chalk.bold(`\n推荐插件 (Top ${recommended.length})`));
      console.log();
      printPluginTable(recommended);
    });

  /**
   * market versions <plugin-id> - 查看版本历史
   */
  marketCommand
    .command('versions <pluginId>')
    .description('查看插件的版本历史')
    .action((pluginId: string) => {
      const plugin = pluginMarketplace.getPlugin(pluginId);
      if (!plugin) {
        console.log(chalk.yellow(`市场中未找到插件: ${pluginId}`));
        return;
      }

      const versions = pluginMarketplace.getPluginVersions(pluginId);

      console.log(chalk.bold(`\n${plugin.name} 版本历史`));
      console.log(chalk.cyan('═'.repeat(60)));

      if (versions.length === 0) {
        console.log(
          chalk.gray(`当前版本: ${plugin.version}（无详细版本历史）`)
        );
        return;
      }

      for (const v of versions) {
        const isCurrent = v.version === plugin.version;
        const marker = isCurrent ? chalk.green(' ← 当前版本') : '';
        const deps =
          v.dependencies && v.dependencies.length > 0
            ? v.dependencies.map((d) => `${d.name}@${d.version}`).join(', ')
            : '无';

        console.log(`  ${chalk.yellow(v.version)} ${marker}`);
        console.log(
          `    ${chalk.gray('发布时间:')} ${formatDate(v.publishedAt)}`
        );
        if (v.releaseNotes) {
          console.log(`    ${chalk.gray('更新说明:')} ${v.releaseNotes}`);
        }
        if (v.minimumEngineVersion) {
          console.log(
            `    ${chalk.gray('最低引擎:')} ${v.minimumEngineVersion}`
          );
        }
        console.log(`    ${chalk.gray('依赖:')}     ${deps}`);
        console.log();
      }

      console.log(chalk.cyan('═'.repeat(60)));
    });

  /**
   * 默认 action：显示帮助
   */
  marketCommand.action(() => {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  插件市场命令'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('可用命令:'));
    console.log(
      `  ${chalk.yellow('search <query>')}      ${chalk.gray('在市场中搜索插件')}`
    );
    console.log(
      `  ${chalk.yellow('browse')}              ${chalk.gray('浏览市场分类')}`
    );
    console.log(
      `  ${chalk.yellow('info <id>')}           ${chalk.gray('查看插件详细信息')}`
    );
    console.log(
      `  ${chalk.yellow('install <id>')}        ${chalk.gray('从市场安装插件')}`
    );
    console.log(
      `  ${chalk.yellow('update [id]')}         ${chalk.gray('检查并应用更新')}`
    );
    console.log(
      `  ${chalk.yellow('uninstall <id>')}      ${chalk.gray('卸载插件')}`
    );
    console.log(
      `  ${chalk.yellow('installed')}           ${chalk.gray('列出已安装插件')}`
    );
    console.log(
      `  ${chalk.yellow('sync')}                ${chalk.gray('同步市场数据')}`
    );
    console.log(
      `  ${chalk.yellow('top')}                 ${chalk.gray('热门插件')}`
    );
    console.log(
      `  ${chalk.yellow('recommended')}         ${chalk.gray('推荐插件')}`
    );
    console.log(
      `  ${chalk.yellow('versions <id>')}       ${chalk.gray('版本历史')}`
    );
    console.log();
    console.log(chalk.cyan('═'.repeat(60)));
  });
}
