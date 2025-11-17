/**
 * 设备工具函数模块
 * 提供设备管理相关的通用工具函数
 */

import fs from 'fs';
import path from 'path';

/**
 * 初始化目录
 * @param {string[]} directories - 需要创建的目录列表
 */
export function initializeDirectories(directories) {
    for (const dir of directories) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

/**
 * 验证设备注册数据
 * @param {Object} deviceData - 设备注册数据
 * @returns {Object} 验证结果 { valid: boolean, error?: string }
 */
export function validateDeviceRegistration(deviceData) {
    if (!deviceData.device_id) {
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
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 检查设备是否具有某个能力
 * @param {Object} device - 设备对象
 * @param {string} capability - 能力名称
 * @returns {boolean} 是否具有该能力
 */
export function hasCapability(device, capability) {
    return device.capabilities?.includes(capability) || false;
}

/**
 * 获取音频文件列表
 * @param {string} directory - 目录路径
 * @param {string} deviceId - 设备ID（可选）
 * @returns {Promise<Array>} 音频文件列表
 */
export async function getAudioFileList(directory, deviceId = null) {
    try {
        const files = await fs.promises.readdir(directory);
        
        let audioFiles = files.filter(f => f.endsWith('.wav'));
        
        if (deviceId) {
            audioFiles = audioFiles.filter(f => f.startsWith(deviceId));
        }
        
        const recordings = await Promise.all(
            audioFiles.map(async (filename) => {
                const filepath = path.join(directory, filename);
                const stats = await fs.promises.stat(filepath);
                const parts = filename.replace('.wav', '').split('_');
                const sessionId = parts.length >= 2 ? parts[1] : 'unknown';
                
                return {
                    filename,
                    session_id: sessionId,
                    device_id: parts[0],
                    size: stats.size,
                    created_at: stats.birthtime,
                    path: filepath
                };
            })
        );
        
        // 按创建时间倒序排序
        recordings.sort((a, b) => b.created_at - a.created_at);
        
        return recordings;
    } catch (e) {
        return [];
    }
}