/**
 * 设备工具函数模块
 * 提供设备管理相关的通用工具函数
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import BotUtil from './botutil.js';

/**
 * 初始化目录
 * @param {string[]} directories - 需要创建的目录列表
 * @returns {Promise<void>}
 */
export async function initializeDirectories(directories) {
  if (!Array.isArray(directories) || directories.length === 0) return
  await Promise.all(
    [...new Set(directories.filter(Boolean))].map(dir => BotUtil.mkdir(dir))
  )
}

/**
 * 验证设备注册数据
 * @param {Object} deviceData - 设备注册数据
 * @returns {Object} 验证结果 { valid: boolean, error?: string }
 */
export function validateDeviceRegistration(deviceData) {
  if (!deviceData?.device_id) {
    return { valid: false, error: '缺少device_id' };
  }

  if (!deviceData.device_type) {
    return { valid: false, error: '缺少device_type' };
  }

  return { valid: true };
}

/**
 * 生成唯一的命令ID
 * @returns {string} 命令ID
 */
export function generateCommandId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 检查设备是否具有某个能力
 * @param {Object} device - 设备对象
 * @param {string} capability - 能力名称
 * @returns {boolean} 是否具有该能力
 */
export function hasCapability(device, capability) {
  return Boolean(device?.capabilities?.includes(capability));
}

/**
 * 获取音频文件列表
 * @param {string} directory - 目录路径
 * @param {string|null} [deviceId=null] - 设备ID（可选）
 * @returns {Promise<Array>} 音频文件列表
 */
export async function getAudioFileList(directory, deviceId = null) {
  try {
    const files = await fs.readdir(directory);
    const recordings = await Promise.all(
      files
        .filter(filename => filename.endsWith('.wav') && (!deviceId || filename.startsWith(deviceId)))
        .map(async (filename) => {
          const filepath = path.join(directory, filename);
          const stats = await fs.stat(filepath).catch(() => null);
          if (!stats) return null;

          const parts = filename.replace('.wav', '').split('_');
          return {
            filename,
            session_id: parts[1] || 'unknown',
            device_id: parts[0],
            size: stats.size,
            created_at: stats.birthtime,
            path: filepath
          };
        })
    );

    return recordings
      .filter(Boolean)
      .sort((a, b) => b.created_at - a.created_at);
  } catch {
    return [];
  }
}