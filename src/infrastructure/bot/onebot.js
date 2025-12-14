import BotUtil from '#utils/botutil.js'

/**
 * OneBot特定功能模块
 * 包含所有OneBot适配器特定的函数，如好友列表、群组列表等
 * 
 * 这些函数只适用于OneBot适配器，不适用于device、stdin等其他适配器
 */
export default class OneBotFunctions {
  /**
   * 注册OneBot特定函数到Bot实例
   * @param {Bot} bot - Bot实例
   */
  static register(bot) {
    // 好友相关函数
    bot.getFriendArray = function() {
      const array = []
      for (const bot_id of this.uin)
        for (const [id, i] of this.bots[bot_id].fl || []) array.push({ ...i, bot_id })
      return array
    }

    bot.getFriendList = function() {
      const array = []
      for (const bot_id of this.uin) array.push(...(this.bots[bot_id].fl?.keys() || []))
      return array
    }

    bot.getFriendMap = function() {
      const map = new Map()
      for (const bot_id of this.uin)
        for (const [id, i] of this.bots[bot_id].fl || []) map.set(id, { ...i, bot_id })
      return map
    }

    Object.defineProperty(bot, 'fl', {
      get() {
        return this.getFriendMap()
      }
    })

    // 群组相关函数
    bot.getGroupArray = function() {
      const array = []
      for (const bot_id of this.uin)
        for (const [id, i] of this.bots[bot_id].gl || []) array.push({ ...i, bot_id })
      return array
    }

    bot.getGroupList = function() {
      const array = []
      for (const bot_id of this.uin) array.push(...(this.bots[bot_id].gl?.keys() || []))
      return array
    }

    bot.getGroupMap = function() {
      const map = new Map()
      for (const bot_id of this.uin)
        for (const [id, i] of this.bots[bot_id].gl || []) map.set(id, { ...i, bot_id })
      return map
    }

    Object.defineProperty(bot, 'gl', {
      get() {
        return this.getGroupMap()
      }
    })

    // 群成员映射
    Object.defineProperty(bot, 'gml', {
      get() {
        const map = new Map()
        for (const bot_id of this.uin)
          for (const [id, i] of this.bots[bot_id].gml || [])
            map.set(id, Object.assign(new Map(i), { bot_id }))
        return map
      }
    })

    // pick函数 - OneBot特定的选择函数
    bot.pickFriend = function(user_id, strict) {
      user_id = Number(user_id) || user_id;
      
      const mainBot = this.bots[this.uin];
      if (mainBot?.fl?.has(user_id)) {
        return mainBot.pickFriend(user_id);
      }
      
      const friend = this.fl.get(user_id);
      if (friend) {
        return this.bots[friend.bot_id].pickFriend(user_id);
      }
      
      if (strict) return false;
      
      BotUtil.makeLog("trace", `用户 ${user_id} 不存在，使用随机Bot ${this.uin.toJSON()}`, '服务器');
      return this.bots[this.uin].pickFriend(user_id);
    }

    Object.defineProperty(bot, 'pickUser', {
      get() {
        return this.pickFriend;
      }
    })

    bot.pickGroup = function(group_id, strict) {
      group_id = Number(group_id) || group_id;
      
      const mainBot = this.bots[this.uin];
      if (mainBot?.gl?.has(group_id)) {
        return mainBot.pickGroup(group_id);
      }
      
      const group = this.gl.get(group_id);
      if (group) {
        return this.bots[group.bot_id].pickGroup(group_id);
      }
      
      if (strict) return false;
      
      BotUtil.makeLog("trace", `群组 ${group_id} 不存在，使用随机Bot ${this.uin.toJSON()}`, '服务器');
      return this.bots[this.uin].pickGroup(group_id);
    }

    bot.pickMember = function(group_id, user_id) {
      return this.pickGroup(group_id).pickMember(user_id);
    }

    // OneBot特定的发送消息函数
    bot.sendFriendMsg = async function(bot_id, user_id, ...args) {
      if (!bot_id) {
        return this.pickFriend(user_id).sendMsg(...args);
      }
      
      if (this.uin.includes(bot_id) && this.bots[bot_id]) {
        return this.bots[bot_id].pickFriend(user_id).sendMsg(...args);
      }
      
      return new Promise((resolve, reject) => {
        const listener = data => {
          resolve(data.bot.pickFriend(user_id).sendMsg(...args));
          clearTimeout(timeout);
        };
        
        const timeout = setTimeout(() => {
          reject(Object.assign(Error("等待Bot上线超时"),
            { bot_id, user_id, args }));
          this.off(`connect.${bot_id}`, listener);
        }, 300000);
        
        this.once(`connect.${bot_id}`, listener);
      });
    }

    bot.sendGroupMsg = async function(bot_id, group_id, ...args) {
      if (!bot_id) {
        return this.pickGroup(group_id).sendMsg(...args);
      }
      
      if (this.uin.includes(bot_id) && this.bots[bot_id]) {
        return this.bots[bot_id].pickGroup(group_id).sendMsg(...args);
      }
      
      return new Promise((resolve, reject) => {
        const listener = data => {
          resolve(data.bot.pickGroup(group_id).sendMsg(...args));
          clearTimeout(timeout);
        };
        
        const timeout = setTimeout(() => {
          reject(Object.assign(Error("等待Bot上线超时"),
            { bot_id, group_id, args }));
          this.off(`connect.${bot_id}`, listener);
        }, 300000);
        
        this.once(`connect.${bot_id}`, listener);
      });
    }
  }
}

