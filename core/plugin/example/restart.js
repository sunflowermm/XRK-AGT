import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * 重启与关机插件
 * 提供机器人的重启、关机和开机功能
 */
export class Restart extends plugin {
  constructor(e = '') {
    super({
      name: '重启与关机',
      dsc: '#重启 #关机 #停机 #开机',
      event: 'message',
      priority: 10,
      rule: [
        { reg: '^#重启$', fnc: 'restart', permission: 'master' },
        { reg: '^#(停机|关机)$', fnc: 'stop', permission: 'master' },
        { reg: '^#开机$', fnc: 'start', permission: 'master' },
      ],
    });

    if (e) this.e = e;
    this.key = 'Yz:restart';
    this.shutdownKey = 'Yz:shutdown';
    this.isServerMode = process.argv.includes('server');
  }

  /**
   * 执行重启操作
   * 保存当前会话信息并重启进程
   * @returns {Promise<boolean>} 操作是否成功
   */
  async restart() {
    const currentUin = this.e?.self_id || this.e?.bot?.uin || Bot.uin?.[0] || '';

    await this.e.reply('开始执行重启，请稍等...');
    
    // 保存重启信息，使用高精度时间戳
    const data = JSON.stringify({
      uin: currentUin,
      isGroup: !!this.e.isGroup,
      id: this.e.isGroup ? this.e.group_id : this.e.user_id,
      time: Date.now(), // 使用毫秒级时间戳
      user_id: this.e.user_id,
      sender: {
        card: this.e.sender?.card || this.e.sender?.nickname,
        nickname: this.e.sender?.nickname
      }
    });

    // 根据currentUin保存重启信息
    const saveKey = currentUin ? `${this.key}:${currentUin}` : this.key;
    
    // 设置5分钟过期时间，防止重启失败后残留数据
    await redis.set(saveKey, data, { EX: 300 });
    
    logger.mark(`[重启] 保存重启信息到 ${saveKey}`);
    
    // 延迟1秒后退出进程，让消息发送完成
    setTimeout(() => process.exit(1), 1000);
    return true;
  }

  /**
   * 执行关机操作
   * 设置关机标志，阻止机器人响应所有消息
   * @returns {Promise<boolean>} 操作是否成功
   */
  async stop() {
    const currentUin = this.e?.self_id || this.e?.bot?.uin || Bot.uin?.[0] || '';
    
    try {
      // 设置关机标志，不设置过期时间，需要手动开机
      await redis.set(`${this.shutdownKey}:${currentUin}`, 'true');
      await this.e.reply('关机成功，已停止运行。发送"#开机"可恢复运行');
      
      logger.mark(`[关机][${currentUin}] 机器人已关机`);
      return true;
    } catch (error) {
      logger.error(`[关机失败][${currentUin}]: ${error.message}`);
      await this.e.reply(`关机失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 执行开机操作
   * 清除关机标志，恢复机器人正常运行
   * @returns {Promise<boolean>} 操作是否成功
   */
  async start() {
    const currentUin = this.e?.self_id || this.e?.bot?.uin || Bot.uin?.[0] || '';
    
    // 检查是否处于关机状态
    const isShutdown = await redis.get(`${this.shutdownKey}:${currentUin}`);

    if (isShutdown !== 'true') {
      await this.e.reply('机器人已经处于开机状态');
      return false;
    }

    // 删除关机标志
    await redis.del(`${this.shutdownKey}:${currentUin}`);
    await this.e.reply('开机成功，恢复正常运行');
    
    logger.mark(`[开机][${currentUin}] 机器人已开机`);
    return true;
  }
}