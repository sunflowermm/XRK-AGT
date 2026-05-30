import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import paths from '#utils/paths.js';
import { GLOBAL_CONFIGS, isServerOrFactoryConfig } from './config-constants.js';

/**
 * 配置落盘统一入口
 */

export function copyFileIfMissingSync(sourcePath, targetPath) {
  if (fsSync.existsSync(targetPath)) return false;
  fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsSync.copyFileSync(sourcePath, targetPath);
  return true;
}

export async function copyFileIfMissing(sourcePath, targetPath) {
  if (fsSync.existsSync(targetPath)) return false;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

/**
 * 端口/工厂配置 seed（server_bots/{port}/）
 */
export async function seedPortConfigs(port, { silent = false, logger = null } = {}) {
  const targetDir = path.join(paths.dataServerBots, String(port));
  await fs.mkdir(targetDir, { recursive: true });

  let defaultFiles;
  try {
    defaultFiles = await fs.readdir(paths.configDefault);
  } catch (error) {
    if (logger?.error) await logger.error(`读取默认配置失败: ${error.message}`);
    return targetDir;
  }

  const copyTasks = [];
  for (const file of defaultFiles) {
    if (!file.endsWith('.yaml') || file === 'qq.yaml') continue;

    const configName = path.basename(file, '.yaml');
    if (GLOBAL_CONFIGS.includes(configName)) continue;
    if (!isServerOrFactoryConfig(configName)) continue;

    const sourcePath = path.join(paths.configDefault, file);
    const targetPath = path.join(targetDir, file);
    copyTasks.push(
      copyFileIfMissing(sourcePath, targetPath).then((copied) => (copied ? file : null))
    );
  }

  const copyResults = await Promise.all(copyTasks);
  const created = copyResults.filter(Boolean);

  if (!silent && logger) {
    if (created.length > 0) {
      await logger.success(`配置文件已就绪: ${targetDir} (新建: ${created.join(', ')})`);
    } else if (!fsSync.existsSync(path.join(targetDir, 'server.yaml'))) {
      await logger.success(`配置文件已就绪: ${targetDir}`);
    }
  }

  return targetDir;
}

/** 构造函数等同步场景：全局配置 seed（server_bots/ 根目录） */
export function seedGlobalConfigsSync() {
  const targetDir = paths.dataServerBots;
  fsSync.mkdirSync(targetDir, { recursive: true });

  try {
    for (const file of fsSync.readdirSync(paths.configDefault)) {
      if (!file.endsWith('.yaml')) continue;
      const configName = path.basename(file, '.yaml');
      if (!GLOBAL_CONFIGS.includes(configName)) continue;

      copyFileIfMissingSync(
        path.join(paths.configDefault, file),
        path.join(targetDir, file)
      );
    }
  } catch {
    // 默认配置目录缺失时不阻断启动
  }
}
