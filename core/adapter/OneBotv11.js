import path from "node:path"
import { ulid } from "ulid"

Bot.adapter.push(
  new (class OneBotv11Adapter {
    id = "QQ"
    name = "OneBotv11"
    path = this.name
    echo = new Map()
    timeout = 60000

    /**
     * 生成日志消息（隐藏base64内容）
     */
    makeLog(msg) {
      return Bot.String(msg).replace(/base64:\/\/.*?(,|]|")/g, "base64://...$1")
    }

    /**
     * 发送API请求
     */
    sendApi(data, ws, action, params = {}) {
      const echo = ulid()
      const request = { action, params, echo }
      ws.sendMsg(request)
      const cache = Promise.withResolvers()
      this.echo.set(echo, cache)
      const timeout = setTimeout(() => {
        cache.reject(Bot.makeError("请求超时", request, { timeout: this.timeout }))
        Bot.makeLog("error", ["请求超时", request], data.self_id)
        ws.terminate()
      }, this.timeout)

      return cache.promise
        .then(data => {
          if (data.retcode !== 0 && data.retcode !== 1)
            throw Bot.makeError(data.msg || data.wording, request, { error: data })
          return data.data
            ? new Proxy(data, {
              get: (target, prop) => target.data[prop] ?? target[prop],
            })
            : data
        })
        .finally(() => {
          clearTimeout(timeout)
          this.echo.delete(echo)
        })
    }

    /**
     * 转换文件为base64格式
     */
    async makeFile(file, opts) {
      file = await Bot.Buffer(file, {
        http: true,
        size: 10485760,
        ...opts,
      })
      if (Buffer.isBuffer(file)) return `base64://${file.toString("base64")}`
      return file
    }

    /**
     * 处理消息格式
     */
    async makeMsg(msg) {
      if (!Array.isArray(msg)) msg = [msg]
      const msgs = []
      const forward = []
      for (let i of msg) {
        if (typeof i !== "object") i = { type: "text", data: { text: i } }
        else if (!i.data) i = { type: i.type, data: { ...i, type: undefined } }

        switch (i.type) {
          case "at":
            i.data.qq = String(i.data.qq)
            break
          case "reply":
            i.data.id = String(i.data.id)
            break
          case "button":
            continue
          case "node":
            forward.push(...i.data)
            continue
          case "raw":
            i = i.data
            break
        }

        if (i.data.file) i.data.file = await this.makeFile(i.data.file)
        msgs.push(i)
      }
      return [msgs, forward]
    }

    /**
     * 发送消息（支持普通和转发）
     */
    async sendMsg(msg, send, sendForwardMsg) {
      const [message, forward] = await this.makeMsg(msg)
      const ret = []

      if (forward.length) {
        const data = await sendForwardMsg(forward)
        if (Array.isArray(data)) ret.push(...data)
        else ret.push(data)
      }

      if (message.length) ret.push(await send(message))
      if (ret.length === 1) return ret[0]

      const message_id = []
      for (const i of ret) if (i?.message_id) message_id.push(i.message_id)
      return { data: ret, message_id }
    }

    sendFriendMsg(data, msg) {
      return this.sendMsg(
        msg,
        message => {
          Bot.makeLog(
            "info",
            `发送好友消息：${this.makeLog(message)}`,
            `${data.self_id} => ${data.user_id}`,
            true,
          )
          return data.bot.sendApi("send_msg", {
            user_id: data.user_id,
            message,
          })
        },
        msg => this.sendFriendForwardMsg(data, msg),
      )
    }

    sendGroupMsg(data, msg) {
      return this.sendMsg(
        msg,
        message => {
          Bot.makeLog(
            "info",
            `发送群消息：${this.makeLog(message)}`,
            `${data.self_id} => ${data.group_id}`,
            true,
          )
          return data.bot.sendApi("send_msg", {
            group_id: data.group_id,
            message,
          })
        },
        msg => this.sendGroupForwardMsg(data, msg),
      )
    }

    sendGuildMsg(data, msg) {
      return this.sendMsg(
        msg,
        message => {
          Bot.makeLog(
            "info",
            `发送频道消息：${this.makeLog(message)}`,
            `${data.self_id}] => ${data.guild_id}-${data.channel_id}`,
            true,
          )
          return data.bot.sendApi("send_guild_channel_msg", {
            guild_id: data.guild_id,
            channel_id: data.channel_id,
            message,
          })
        },
        msg => Bot.sendForwardMsg(msg => this.sendGuildMsg(data, msg), msg),
      )
    }

    async recallMsg(data, message_id) {
      Bot.makeLog("info", `撤回消息：${message_id}`, data.self_id)
      if (!Array.isArray(message_id)) message_id = [message_id]
      const msgs = []
      for (const i of message_id)
        msgs.push(await data.bot.sendApi("delete_msg", { message_id: i }).catch(i => i))
      return msgs
    }

    /**
     * 解析消息内容
     */
    parseMsg(msg) {
      const array = []
      for (const i of Array.isArray(msg) ? msg : [msg])
        if (typeof i === "object") array.push({ ...i.data, type: i.type })
        else array.push({ type: "text", text: String(i) })
      return array
    }

    async getMsg(data, message_id) {
      const msg = (await data.bot.sendApi("get_msg", { message_id })).data
      if (msg?.message) msg.message = this.parseMsg(msg.message)
      return msg
    }

    async getFriendMsgHistory(data, message_seq, count, reverseOrder = true) {
      const msgs = (
        await data.bot.sendApi("get_friend_msg_history", {
          user_id: data.user_id,
          message_seq,
          count,
          reverseOrder,
        })
      ).data?.messages

      for (const i of Array.isArray(msgs) ? msgs : [msgs])
        if (i?.message) i.message = this.parseMsg(i.message)
      return msgs
    }

    async getGroupMsgHistory(data, message_seq, count, reverseOrder = true) {
      const msgs = (
        await data.bot.sendApi("get_group_msg_history", {
          group_id: data.group_id,
          message_seq,
          count,
          reverseOrder,
        })
      ).data?.messages

      for (const i of Array.isArray(msgs) ? msgs : [msgs])
        if (i?.message) i.message = this.parseMsg(i.message)
      return msgs
    }

    async getForwardMsg(data, message_id) {
      const msgs = (
        await data.bot.sendApi("get_forward_msg", {
          message_id,
        })
      ).data?.messages

      for (const i of Array.isArray(msgs) ? msgs : [msgs])
        if (i?.message) i.message = this.parseMsg(i.message || i.content)
      return msgs
    }

    /**
     * 构建转发消息
     */
    async makeForwardMsg(msg) {
      const msgs = []
      for (const i of msg) {
        const [content, forward] = await this.makeMsg(i.message)
        if (forward.length) msgs.push(...(await this.makeForwardMsg(forward)))
        if (content.length)
          msgs.push({
            type: "node",
            data: {
              name: i.nickname || "匿名消息",
              uin: String(Number(i.user_id) || 80000000),
              content,
              time: i.time,
            },
          })
      }
      return msgs
    }

    async sendFriendForwardMsg(data, msg) {
      Bot.makeLog(
        "info",
        `发送好友转发消息：${this.makeLog(msg)}`,
        `${data.self_id} => ${data.user_id}`,
        true,
      )
      return data.bot.sendApi("send_private_forward_msg", {
        user_id: data.user_id,
        messages: await this.makeForwardMsg(msg),
      })
    }

    async sendGroupForwardMsg(data, msg) {
      Bot.makeLog(
        "info",
        `发送群转发消息：${this.makeLog(msg)}`,
        `${data.self_id} => ${data.group_id}`,
        true,
      )
      return data.bot.sendApi("send_group_forward_msg", {
        group_id: data.group_id,
        messages: await this.makeForwardMsg(msg),
      })
    }

    async getFriendArray(data) {
      try {
        const result = await data.bot.sendApi("get_friend_list");
        return result?.data || [];
      } catch (err) {
        Bot.makeLog("error", `获取好友列表失败: ${err.message}`, data.self_id);
        return [];
      }
    }

    async getFriendList(data) {
      const array = [];
      const friendArray = await this.getFriendArray(data);
      if (Array.isArray(friendArray)) {
        for (const item of friendArray) {
          if (item && item.user_id !== undefined) {
            array.push(item.user_id);
          }
        }
      }
      return array;
    }

    async getFriendMap(data) {
      const map = new Map();
      const friendArray = await this.getFriendArray(data);
      if (Array.isArray(friendArray)) {
        for (const i of friendArray) {
          if (i && i.user_id !== undefined) {
            map.set(i.user_id, i);
          }
        }
      }
      data.bot.fl = map;
      return map;
    }

    async getFriendInfo(data) {
      try {
        const info = (
          await data.bot.sendApi("get_stranger_info", {
            user_id: data.user_id,
          })
        ).data;
        if (info) {
          data.bot.fl.set(data.user_id, info);
        }
        return info;
      } catch (err) {
        Bot.makeLog("error", `获取好友信息失败: ${err.message}`, data.self_id);
        return null;
      }
    }

    async getGroupArray(data) {
      let array = [];
      try {
        const result = await data.bot.sendApi("get_group_list");
        array = result?.data || [];
      } catch (err) {
        Bot.makeLog("error", `获取群列表失败: ${err.message}`, data.self_id);
        array = [];
      }

      try {
        const guildArray = await this.getGuildArray(data);
        if (Array.isArray(guildArray)) {
          for (const guild of guildArray) {
            try {
              const channels = await this.getGuildChannelArray({
                ...data,
                guild_id: guild.guild_id,
              });
              if (Array.isArray(channels)) {
                for (const channel of channels) {
                  array.push({
                    guild,
                    channel,
                    group_id: `${guild.guild_id}-${channel.channel_id}`,
                    group_name: `${guild.guild_name}-${channel.channel_name}`,
                  });
                }
              }
            } catch (err) {
            }
          }
        }
      } catch (err) {
      }

      return array;
    }

    async getGroupList(data) {
      const array = [];
      const groupArray = await this.getGroupArray(data);
      if (Array.isArray(groupArray)) {
        for (const item of groupArray) {
          if (item && item.group_id !== undefined) {
            array.push(item.group_id);
          }
        }
      }
      return array;
    }

    async getGroupMap(data) {
      const map = new Map();
      const groupArray = await this.getGroupArray(data);
      if (Array.isArray(groupArray)) {
        for (const i of groupArray) {
          if (i && i.group_id !== undefined) {
            map.set(i.group_id, i);
          }
        }
      }
      data.bot.gl = map;
      return map;
    }

    async getGroupInfo(data) {
      try {
        const info = (
          await data.bot.sendApi("get_group_info", {
            group_id: data.group_id,
          })
        ).data;
        if (info) {
          data.bot.gl.set(data.group_id, info);
        }
        return info;
      } catch (err) {
        Bot.makeLog("error", `获取群信息失败: ${err.message}`, data.self_id);
        return null;
      }
    }

    async getMemberArray(data) {
      try {
        const result = await data.bot.sendApi("get_group_member_list", {
          group_id: data.group_id,
        });
        return result?.data || [];
      } catch (err) {
        Bot.makeLog("error", `获取群成员列表失败: ${err.message}`, data.self_id);
        return [];
      }
    }

    async getMemberList(data) {
      const array = [];
      const memberArray = await this.getMemberArray(data);
      if (Array.isArray(memberArray)) {
        for (const item of memberArray) {
          if (item && item.user_id !== undefined) {
            array.push(item.user_id);
          }
        }
      }
      return array;
    }

    async getMemberMap(data) {
      const map = new Map();
      const memberArray = await this.getMemberArray(data);
      if (Array.isArray(memberArray)) {
        for (const i of memberArray) {
          if (i && i.user_id !== undefined) {
            map.set(i.user_id, i);
          }
        }
      }
      if (!data.bot.gml) {
        data.bot.gml = new Map();
      }
      data.bot.gml.set(data.group_id, map);
      return map;
    }

    /**
     * 获取所有群的成员映射表
     */
    async getGroupMemberMap(data) {
      await this.getGroupMap(data);

      if (!data.bot.gml) {
        data.bot.gml = new Map();
      }

      for (const [group_id, group] of data.bot.gl) {
        if (group?.guild) continue;
        try {
          await this.getMemberMap({ ...data, group_id });
          Bot.makeLog("debug", `已加载群 ${group_id} 的成员列表`, data.self_id);
        } catch (err) {
          Bot.makeLog("error", `加载群 ${group_id} 成员失败: ${err.message}`, data.self_id);
        }
      }

      return data.bot.gml;
    }

    async getMemberInfo(data) {
      try {
        const info = (
          await data.bot.sendApi("get_group_member_info", {
            group_id: data.group_id,
            user_id: data.user_id,
          })
        ).data;

        if (!data.bot.gml) {
          data.bot.gml = new Map();
        }

        let gml = data.bot.gml.get(data.group_id);
        if (!gml) {
          gml = new Map();
          data.bot.gml.set(data.group_id, gml);
        }

        if (info) {
          gml.set(data.user_id, info);
        }

        return info;
      } catch (err) {
        Bot.makeLog("error", `获取群成员信息失败: ${err.message}`, data.self_id);
        return null;
      }
    }

    async getGuildArray(data) {
      try {
        const result = await data.bot.sendApi("get_guild_list");
        return result?.data || [];
      } catch (err) {
        Bot.makeLog("debug", `获取频道列表失败: ${err.message}`, data.self_id);
        return [];
      }
    }

    getGuildInfo(data) {
      return data.bot.sendApi("get_guild_meta_by_guest", {
        guild_id: data.guild_id,
      });
    }

    async getGuildChannelArray(data) {
      try {
        const result = await data.bot.sendApi("get_guild_channel_list", {
          guild_id: data.guild_id,
        });
        return result?.data || [];
      } catch (err) {
        Bot.makeLog("debug", `获取子频道列表失败: ${err.message}`, data.self_id);
        return [];
      }
    }

    async getGuildChannelMap(data) {
      const map = new Map();
      const channelArray = await this.getGuildChannelArray(data);
      if (Array.isArray(channelArray)) {
        for (const i of channelArray) {
          if (i && i.channel_id !== undefined) {
            map.set(i.channel_id, i);
          }
        }
      }
      return map;
    }

    async getGuildMemberArray(data) {
      const array = [];
      let next_token = "";

      while (true) {
        try {
          const result = await data.bot.sendApi("get_guild_member_list", {
            guild_id: data.guild_id,
            next_token,
          });

          const list = result?.data;
          if (!list) break;

          if (Array.isArray(list.members)) {
            for (const i of list.members) {
              array.push({
                ...i,
                user_id: i.tiny_id,
              });
            }
          }

          if (list.finished) break;
          next_token = list.next_token;
        } catch (err) {
          Bot.makeLog("debug", `获取频道成员列表失败: ${err.message}`, data.self_id);
          break;
        }
      }

      return array;
    }

    async getGuildMemberList(data) {
      const array = [];
      const memberArray = await this.getGuildMemberArray(data);
      if (Array.isArray(memberArray)) {
        for (const item of memberArray) {
          if (item && item.user_id !== undefined) {
            array.push(item.user_id);
          }
        }
      }
      return array;
    }

    async getGuildMemberMap(data) {
      const map = new Map();
      const memberArray = await this.getGuildMemberArray(data);
      if (Array.isArray(memberArray)) {
        for (const i of memberArray) {
          if (i && i.user_id !== undefined) {
            map.set(i.user_id, i);
          }
        }
      }
      if (!data.bot.gml) {
        data.bot.gml = new Map();
      }
      data.bot.gml.set(data.group_id, map);
      return map;
    }

    getGuildMemberInfo(data) {
      return data.bot.sendApi("get_guild_member_profile", {
        guild_id: data.guild_id,
        user_id: data.user_id,
      });
    }

    // ========== 其他方法保持不变 ==========

    setProfile(data, profile) {
      Bot.makeLog("info", `设置资料：${Bot.String(profile)}`, data.self_id)
      return data.bot.sendApi("set_qq_profile", profile)
    }

    async setAvatar(data, file) {
      Bot.makeLog("info", `设置头像：${file}`, data.self_id)
      return data.bot.sendApi("set_qq_avatar", {
        file: await this.makeFile(file),
      })
    }

    sendLike(data, times) {
      Bot.makeLog("info", `点赞：${times}次`, `${data.self_id} => ${data.user_id}`, true)
      return data.bot.sendApi("send_like", {
        user_id: data.user_id,
        times,
      })
    }

    setGroupName(data, group_name) {
      Bot.makeLog("info", `设置群名：${group_name}`, `${data.self_id} => ${data.group_id}`, true)
      return data.bot.sendApi("set_group_name", {
        group_id: data.group_id,
        group_name,
      })
    }

    async setGroupAvatar(data, file) {
      Bot.makeLog("info", `设置群头像：${file}`, `${data.self_id} => ${data.group_id}`, true)
      return data.bot.sendApi("set_group_portrait", {
        group_id: data.group_id,
        file: await this.makeFile(file),
      })
    }

    setGroupAdmin(data, user_id, enable) {
      Bot.makeLog(
        "info",
        `${enable ? "设置" : "取消"}群管理员：${user_id}`,
        `${data.self_id} => ${data.group_id}`,
        true,
      )
      return data.bot.sendApi("set_group_admin", {
        group_id: data.group_id,
        user_id,
        enable,
      })
    }

    setGroupCard(data, user_id, card) {
      Bot.makeLog(
        "info",
        `设置群名片：${card}`,
        `${data.self_id} => ${data.group_id}, ${user_id}`,
        true,
      )
      return data.bot.sendApi("set_group_card", {
        group_id: data.group_id,
        user_id,
        card,
      })
    }

    setGroupTitle(data, user_id, special_title, duration) {
      Bot.makeLog(
        "info",
        `设置群头衔：${special_title} ${duration}`,
        `${data.self_id} => ${data.group_id}, ${user_id}`,
        true,
      )
      return data.bot.sendApi("set_group_special_title", {
        group_id: data.group_id,
        user_id,
        special_title,
        duration,
      })
    }

    sendGroupSign(data) {
      Bot.makeLog("info", "群打卡", `${data.self_id} => ${data.group_id}`, true)
      return data.bot.sendApi("send_group_sign", {
        group_id: data.group_id,
      })
    }

    setGroupBan(data, user_id, duration) {
      Bot.makeLog(
        "info",
        `禁言群成员：${duration}秒`,
        `${data.self_id} => ${data.group_id}, ${user_id}`,
        true,
      )
      return data.bot.sendApi("set_group_ban", {
        group_id: data.group_id,
        user_id,
        duration,
      })
    }

    setGroupWholeKick(data, enable) {
      Bot.makeLog(
        "info",
        `${enable ? "开启" : "关闭"}全员禁言`,
        `${data.self_id} => ${data.group_id}`,
        true,
      )
      return data.bot.sendApi("set_group_whole_ban", {
        group_id: data.group_id,
        enable,
      })
    }

    setGroupKick(data, user_id, reject_add_request) {
      Bot.makeLog(
        "info",
        `踢出群成员${reject_add_request ? "拒绝再次加群" : ""}`,
        `${data.self_id} => ${data.group_id}, ${user_id}`,
        true,
      )
      return data.bot.sendApi("set_group_kick", {
        group_id: data.group_id,
        user_id,
        reject_add_request,
      })
    }

    setGroupLeave(data, is_dismiss) {
      Bot.makeLog("info", is_dismiss ? "解散" : "退群", `${data.self_id} => ${data.group_id}`, true)
      return data.bot.sendApi("set_group_leave", {
        group_id: data.group_id,
        is_dismiss,
      })
    }

    downloadFile(data, url, thread_count, headers) {
      return data.bot.sendApi("download_file", {
        url,
        thread_count,
        headers,
      })
    }

    async sendFriendFile(data, file, name = path.basename(file)) {
      Bot.makeLog(
        "info",
        `发送好友文件：${name}(${file})`,
        `${data.self_id} => ${data.user_id}`,
        true,
      )
      return data.bot.sendApi("upload_private_file", {
        user_id: data.user_id,
        file: (await this.makeFile(file, { file: true })).replace("file://", ""),
        name,
      })
    }

    async sendGroupFile(data, file, folder, name = path.basename(file)) {
      Bot.makeLog(
        "info",
        `发送群文件：${folder || ""}/${name}(${file})`,
        `${data.self_id} => ${data.group_id}`,
        true,
      )
      return data.bot.sendApi("upload_group_file", {
        group_id: data.group_id,
        folder,
        file: (await this.makeFile(file, { file: true })).replace("file://", ""),
        name,
      })
    }

    deleteGroupFile(data, file_id, busid) {
      Bot.makeLog(
        "info",
        `删除群文件：${file_id}(${busid})`,
        `${data.self_id} => ${data.group_id}`,
        true,
      )
      return data.bot.sendApi("delete_group_file", {
        group_id: data.group_id,
        file_id,
        busid,
      })
    }

    createGroupFileFolder(data, name) {
      Bot.makeLog("info", `创建群文件夹：${name}`, `${data.self_id} => ${data.group_id}`, true)
      return data.bot.sendApi("create_group_file_folder", {
        group_id: data.group_id,
        name,
      })
    }

    getGroupFileSystemInfo(data) {
      return data.bot.sendApi("get_group_file_system_info", {
        group_id: data.group_id,
      })
    }

    getGroupFiles(data, folder_id) {
      if (folder_id)
        return data.bot.sendApi("get_group_files_by_folder", {
          group_id: data.group_id,
          folder_id,
        })
      return data.bot.sendApi("get_group_root_files", {
        group_id: data.group_id,
      })
    }

    getGroupFileUrl(data, file_id, busid) {
      return data.bot.sendApi("get_group_file_url", {
        group_id: data.group_id,
        file_id,
        busid,
      })
    }

    getGroupFs(data) {
      return {
        upload: this.sendGroupFile.bind(this, data),
        rm: this.deleteGroupFile.bind(this, data),
        mkdir: this.createGroupFileFolder.bind(this, data),
        df: this.getGroupFileSystemInfo.bind(this, data),
        ls: this.getGroupFiles.bind(this, data),
        download: this.getGroupFileUrl.bind(this, data),
      }
    }

    deleteFriend(data) {
      Bot.makeLog("info", "删除好友", `${data.self_id} => ${data.user_id}`, true)
      return data.bot
        .sendApi("delete_friend", { user_id: data.user_id })
        .finally(this.getFriendMap.bind(this, data))
    }

    setFriendAddRequest(data, flag, approve, remark) {
      return data.bot.sendApi("set_friend_add_request", {
        flag,
        approve,
        remark,
      })
    }

    setGroupAddRequest(data, flag, approve, reason, sub_type = "add") {
      return data.bot.sendApi("set_group_add_request", {
        flag,
        sub_type,
        approve,
        reason,
      })
    }

    getGroupHonorInfo(data) {
      return data.bot.sendApi("get_group_honor_info", { group_id: data.group_id })
    }

    getEssenceMsg(data) {
      return data.bot.sendApi("get_essence_msg_list", { group_id: data.group_id })
    }

    setEssenceMsg(data, message_id) {
      return data.bot.sendApi("set_essence_msg", { message_id })
    }

    deleteEssenceMsg(data, message_id) {
      return data.bot.sendApi("delete_essence_msg", { message_id })
    }

    /**
     * 创建好友对象
     */
    pickFriend(data, user_id) {
      const i = {
        ...data.bot.fl.get(user_id),
        ...data,
        user_id,
      }
      return {
        ...i,
        sendMsg: this.sendFriendMsg.bind(this, i),
        getMsg: this.getMsg.bind(this, i),
        recallMsg: this.recallMsg.bind(this, i),
        getForwardMsg: this.getForwardMsg.bind(this, i),
        sendForwardMsg: this.sendFriendForwardMsg.bind(this, i),
        sendFile: this.sendFriendFile.bind(this, i),
        getInfo: this.getFriendInfo.bind(this, i),
        getAvatarUrl() {
          return this.avatar || `https://q.qlogo.cn/g?b=qq&s=0&nk=${user_id}`
        },
        getChatHistory: this.getFriendMsgHistory.bind(this, i),
        thumbUp: this.sendLike.bind(this, i),
        delete: this.deleteFriend.bind(this, i),
      }
    }

    /**
     * 创建成员对象
     */
    pickMember(data, group_id, user_id) {
      if (typeof group_id === "string" && group_id.match("-")) {
        const guild_id = group_id.split("-")
        const i = {
          ...data,
          guild_id: guild_id[0],
          channel_id: guild_id[1],
          user_id,
        }
        return {
          ...this.pickGroup(i, group_id),
          ...i,
          getInfo: this.getGuildMemberInfo.bind(this, i),
          getAvatarUrl: async () => (await this.getGuildMemberInfo(i)).avatar_url,
        }
      }

      const memberInfo = data.bot.gml?.get(group_id)?.get(user_id) || {}
      const i = {
        ...memberInfo,
        ...data,
        group_id,
        user_id,
      }

      return {
        ...this.pickFriend(i, user_id),
        ...i,
        getInfo: this.getMemberInfo.bind(this, i),
        getAvatarUrl() {
          return this.avatar || `https://q.qlogo.cn/g?b=qq&s=0&nk=${user_id}`
        },
        poke: this.sendGroupMsg.bind(this, i, { type: "poke", qq: user_id }),
        mute: this.setGroupBan.bind(this, i, user_id),
        kick: this.setGroupKick.bind(this, i, user_id),
        get is_friend() {
          return data.bot.fl.has(user_id)
        },
        get is_owner() {
          return memberInfo.role === "owner"
        },
        get is_admin() {
          return memberInfo.role === "admin" || memberInfo.role === "owner"
        },
      }
    }

    /**
     * 创建群对象
     */
    pickGroup(data, group_id) {
      if (typeof group_id === "string" && group_id.match("-")) {
        const guild_id = group_id.split("-")
        const i = {
          ...data.bot.gl.get(group_id),
          ...data,
          guild_id: guild_id[0],
          channel_id: guild_id[1],
        }
        return {
          ...i,
          sendMsg: this.sendGuildMsg.bind(this, i),
          getMsg: this.getMsg.bind(this, i),
          recallMsg: this.recallMsg.bind(this, i),
          getForwardMsg: this.getForwardMsg.bind(this, i),
          getInfo: this.getGuildInfo.bind(this, i),
          getChannelArray: this.getGuildChannelArray.bind(this, i),
          getChannelList: this.getGuildChannelList.bind(this, i),
          getChannelMap: this.getGuildChannelMap.bind(this, i),
          getMemberArray: this.getGuildMemberArray.bind(this, i),
          getMemberList: this.getGuildMemberList.bind(this, i),
          getMemberMap: this.getGuildMemberMap.bind(this, i),
          pickMember: this.pickMember.bind(this, i),
        }
      }

      const i = {
        ...data.bot.gl.get(group_id),
        ...data,
        group_id,
      }

      return {
        ...i,
        sendMsg: this.sendGroupMsg.bind(this, i),
        getMsg: this.getMsg.bind(this, i),
        recallMsg: this.recallMsg.bind(this, i),
        getForwardMsg: this.getForwardMsg.bind(this, i),
        sendForwardMsg: this.sendGroupForwardMsg.bind(this, i),
        sendFile: (file, name) => this.sendGroupFile(i, file, undefined, name),
        getInfo: this.getGroupInfo.bind(this, i),
        getAvatarUrl() {
          return this.avatar || `https://p.qlogo.cn/gh/${group_id}/${group_id}/0`
        },
        getChatHistory: this.getGroupMsgHistory.bind(this, i),
        getHonorInfo: this.getGroupHonorInfo.bind(this, i),
        getEssence: this.getEssenceMsg.bind(this, i),
        getMemberArray: this.getMemberArray.bind(this, i),
        getMemberList: this.getMemberList.bind(this, i),
        getMemberMap: this.getMemberMap.bind(this, i),
        pickMember: this.pickMember.bind(this, i, group_id),
        pokeMember: qq => this.sendGroupMsg(i, { type: "poke", qq }),
        setName: this.setGroupName.bind(this, i),
        setAvatar: this.setGroupAvatar.bind(this, i),
        setAdmin: this.setGroupAdmin.bind(this, i),
        setCard: this.setGroupCard.bind(this, i),
        setTitle: this.setGroupTitle.bind(this, i),
        sign: this.sendGroupSign.bind(this, i),
        muteMember: this.setGroupBan.bind(this, i),
        muteAll: this.setGroupWholeKick.bind(this, i),
        kickMember: this.setGroupKick.bind(this, i),
        quit: this.setGroupLeave.bind(this, i),
        fs: this.getGroupFs(i),
        get is_owner() {
          const botMemberInfo = data.bot.gml?.get(group_id)?.get(data.self_id)
          return botMemberInfo?.role === "owner"
        },
        get is_admin() {
          const botMemberInfo = data.bot.gml?.get(group_id)?.get(data.self_id)
          return botMemberInfo?.role === "admin" || botMemberInfo?.role === "owner"
        },
      }
    }

    /**
     * 建立连接时初始化Bot实例
     * 关键优化：先初始化基础信息并立即触发connect事件，耗时操作异步执行
     */
    async connect(data, ws) {
      const self_id = data.self_id
      
      // 初始化Bot基础结构
      Bot[self_id] = {
        adapter: this,
        ws: ws,
        sendApi: this.sendApi.bind(this, data, ws),
        stat: {
          start_time: data.time,
          stat: {},
          get lost_pkt_cnt() {
            return this.stat.packet_lost
          },
          get lost_times() {
            return this.stat.lost_times
          },
          get recv_msg_cnt() {
            return this.stat.message_received
          },
          get recv_pkt_cnt() {
            return this.stat.packet_received
          },
          get sent_msg_cnt() {
            return this.stat.message_sent
          },
          get sent_pkt_cnt() {
            return this.stat.packet_sent
          },
        },
        model: "XRK Yunzai",

        info: {},
        get uin() {
          return this.info.user_id
        },
        get nickname() {
          return this.info.nickname
        },
        get avatar() {
          return `https://q.qlogo.cn/g?b=qq&s=0&nk=${this.uin}`
        },

        setProfile: this.setProfile.bind(this, data),
        setNickname: nickname => this.setProfile(data, { nickname }),
        setAvatar: this.setAvatar.bind(this, data),

        pickFriend: this.pickFriend.bind(this, data),
        get pickUser() {
          return this.pickFriend
        },
        getFriendArray: this.getFriendArray.bind(this, data),
        getFriendList: this.getFriendList.bind(this, data),
        getFriendMap: this.getFriendMap.bind(this, data),
        fl: new Map(),

        pickMember: this.pickMember.bind(this, data),
        pickGroup: this.pickGroup.bind(this, data),
        getGroupArray: this.getGroupArray.bind(this, data),
        getGroupList: this.getGroupList.bind(this, data),
        getGroupMap: this.getGroupMap.bind(this, data),
        getGroupMemberMap: this.getGroupMemberMap.bind(this, data),
        gl: new Map(),
        gml: new Map(),

        request_list: [],
        getSystemMsg() {
          return this.request_list
        },
        setFriendAddRequest: this.setFriendAddRequest.bind(this, data),
        setGroupAddRequest: this.setGroupAddRequest.bind(this, data),

        setEssenceMessage: this.setEssenceMsg.bind(this, data),
        removeEssenceMessage: this.deleteEssenceMsg.bind(this, data),

        cookies: {},
        getCookies(domain) {
          return this.cookies[domain]
        },
        getCsrfToken() {
          return this.bkn
        },
        
        _ready: false,
        _initializing: false
      }
      
      data.bot = Bot[self_id]

      if (!Bot.uin.includes(self_id)) Bot.uin.push(self_id)

      data.bot.sendApi("_set_model_show", {
        model: data.bot.model,
        model_show: data.bot.model,
      }).catch(() => {})

      try {
        data.bot.info = (await data.bot.sendApi("get_login_info").catch(i => i.error)).data || {}
        data.bot.version = {
          ...(await data.bot.sendApi("get_version_info").catch(i => i.error)).data,
          id: this.id,
          name: this.name,
          get version() {
            return this.app_full_name || `${this.app_name} v${this.app_version}`
          },
        }

        // 立即触发connect事件，让上层应用知道Bot已可用
        Bot.makeLog("mark", `${this.name}(${this.id}) ${data.bot.version.version} 已连接`, self_id)
        Bot.em(`connect.${self_id}`, data)
        
        data.bot._initializing = true
        setImmediate(async () => {
          try {
            data.bot.guild_info = (
              await data.bot.sendApi("get_guild_service_profile").catch(i => i.error)
            ).data
            data.bot.clients = (await data.bot.sendApi("get_online_clients").catch(i => i.error)).clients

            // 获取cookies
            if ((data.bot.cookies["qun.qq.com"] = (
              await data.bot.sendApi("get_cookies", { domain: "qun.qq.com" }).catch(i => i.error)
            ).cookies)) {
              for (const i of [
                "aq", "connect", "docs", "game", "gamecenter", "haoma", "id", "kg", 
                "mail", "mma", "office", "openmobile", "qqweb", "qzone", "ti", "v", "vip", "y",
              ]) {
                const domain = `${i}.qq.com`
                data.bot.cookies[domain] = await data.bot
                  .sendApi("get_cookies", { domain })
                  .then(i => i.cookies)
                  .catch(i => i.error)
              }
            }
            data.bot.bkn = (await data.bot.sendApi("get_csrf_token").catch(i => i.error)).token

            // 加载好友列表
            try {
              await data.bot.getFriendMap()
              Bot.makeLog("debug", `好友列表加载完成`, self_id)
            } catch (err) {
              Bot.makeLog("warn", `获取好友列表失败: ${err.message}`, self_id)
              if (!(data.bot.fl instanceof Map)) {
                data.bot.fl = new Map()
              }
            }

            // 加载群和群成员列表
            try {
              await data.bot.getGroupMemberMap()
              Bot.makeLog("debug", `群列表和成员列表加载完成`, self_id)
            } catch (err) {
              Bot.makeLog("warn", `获取群成员列表失败: ${err.message}`, self_id)
              if (!(data.bot.gml instanceof Map)) {
                data.bot.gml = new Map()
              }
            }

            // 标记Bot完全就绪
            data.bot._ready = true
            data.bot._initializing = false
            
            // 触发ready事件
            Bot.em(`ready.${self_id}`, data)
            
          } catch (err) {
            Bot.makeLog("error", `后台数据加载失败: ${err.message}`, self_id)
            data.bot._ready = true
            data.bot._initializing = false
          }
        })
        
      } catch (err) {
        Bot.makeLog("error", `Bot初始化失败: ${err.message}`, self_id)
        data.bot._ready = true
        data.bot._initializing = false
        Bot.em(`connect.${self_id}`, data)
      }
    }

    /**
     * 处理消息事件
     */
    makeMessage(data) {
      data.message = this.parseMsg(data.message)
      switch (data.message_type) {
        case "private": {
          const name =
            data.sender.card || data.sender.nickname || data.bot.fl.get(data.user_id)?.nickname
          Bot.makeLog(
            "info",
            `好友消息：${name ? `[${name}] ` : ""}${data.raw_message}`,
            `${data.self_id} <= ${data.user_id}`,
            true,
          )
          break
        }
        case "group": {
          const group_name = data.group_name || data.bot.gl.get(data.group_id)?.group_name
          let user_name = data.sender.card || data.sender.nickname
          if (!user_name) {
            const user =
              data.bot.gml?.get(data.group_id)?.get(data.user_id) || data.bot.fl.get(data.user_id)
            if (user) user_name = user?.card || user?.nickname
          }
          Bot.makeLog(
            "info",
            `群消息：${user_name ? `[${group_name ? `${group_name}, ` : ""}${user_name}] ` : ""}${data.raw_message}`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          break
        }
        case "guild":
          data.message_type = "group"
          data.group_id = `${data.guild_id}-${data.channel_id}`
          Bot.makeLog(
            "info",
            `频道消息：[${data.sender.nickname}] ${Bot.String(data.message)}`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          Object.defineProperty(data, "friend", {
            get() {
              return this.member || {}
            },
          })
          break
        default:
          Bot.makeLog("warn", `未知消息：${logger.magenta(data.raw)}`, data.self_id)
      }

      Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
    }

    /**
     * 处理通知事件
     */
    async makeNotice(data) {
      switch (data.notice_type) {
        case "friend_recall":
          Bot.makeLog(
            "info",
            `好友消息撤回：${data.message_id}`,
            `${data.self_id} <= ${data.user_id}`,
            true,
          )
          break
        case "group_recall":
          Bot.makeLog(
            "info",
            `群消息撤回：${data.operator_id} => ${data.user_id} ${data.message_id}`,
            `${data.self_id} <= ${data.group_id}`,
            true,
          )
          break
        case "group_increase": {
          Bot.makeLog(
            "info",
            `群成员增加：${data.operator_id} => ${data.user_id} ${data.sub_type}`,
            `${data.self_id} <= ${data.group_id}`,
            true,
          )
          const group = data.bot.pickGroup(data.group_id)
          group.getInfo()
          // 新成员加入时更新成员列表
          group.pickMember(data.user_id).getInfo()
          break
        }
        case "group_decrease": {
          Bot.makeLog(
            "info",
            `群成员减少：${data.operator_id} => ${data.user_id} ${data.sub_type}`,
            `${data.self_id} <= ${data.group_id}`,
            true,
          )
          if (data.user_id === data.self_id) {
            data.bot.gl.delete(data.group_id)
            data.bot.gml.delete(data.group_id)
          } else {
            data.bot.pickGroup(data.group_id).getInfo()
            data.bot.gml?.get(data.group_id)?.delete(data.user_id)
          }
          break
        }
        case "group_admin":
          Bot.makeLog(
            "info",
            `群管理员变动：${data.sub_type}`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          data.set = data.sub_type === "set"
          data.bot.pickMember(data.group_id, data.user_id).getInfo()
          break
        case "group_upload":
          Bot.makeLog(
            "info",
            `群文件上传：${Bot.String(data.file)}`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          Bot.em("message.group.normal", {
            ...data,
            post_type: "message",
            message_type: "group",
            sub_type: "normal",
            message: [{ ...data.file, type: "file" }],
            raw_message: `[文件：${data.file.name}]`,
          })
          break
        case "group_ban":
          Bot.makeLog(
            "info",
            `群禁言：${data.operator_id} => ${data.user_id} ${data.sub_type} ${data.duration}秒`,
            `${data.self_id} <= ${data.group_id}`,
            true,
          )
          data.bot.pickMember(data.group_id, data.user_id).getInfo()
          break
        case "group_msg_emoji_like":
          Bot.makeLog(
            "info",
            [`群消息回应：${data.message_id}`, data.likes],
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          break
        case "friend_add":
          Bot.makeLog("info", "好友添加", `${data.self_id} <= ${data.user_id}`, true)
          data.bot.pickFriend(data.user_id).getInfo()
          break
        case "notify":
          if (data.group_id) data.notice_type = "group"
          else data.notice_type = "friend"
          data.user_id ??= data.operator_id || data.target_id
          switch (data.sub_type) {
            case "poke":
              data.operator_id = data.user_id
              if (data.group_id)
                Bot.makeLog(
                  "info",
                  `群戳一戳：${data.operator_id} => ${data.target_id}`,
                  `${data.self_id} <= ${data.group_id}`,
                  true,
                )
              else
                Bot.makeLog(
                  "info",
                  `好友戳一戳：${data.operator_id} => ${data.target_id}`,
                  data.self_id,
                )
              break
            case "honor":
              Bot.makeLog(
                "info",
                `群荣誉：${data.honor_type}`,
                `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
                true,
              )
              data.bot.pickMember(data.group_id, data.user_id).getInfo()
              break
            case "title":
              Bot.makeLog(
                "info",
                `群头衔：${data.title}`,
                `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
                true,
              )
              data.bot.pickMember(data.group_id, data.user_id).getInfo()
              break
            case "group_name":
              Bot.makeLog(
                "info",
                `群名更改：${data.name_new}`,
                `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
                true,
              )
              data.bot.pickGroup(data.group_id).getInfo()
              break
            case "input_status":
              data.post_type = "internal"
              data.notice_type = "input"
              data.end ??= data.event_type !== 1
              data.message ||= data.status_text || `对方${data.end ? "结束" : "正在"}输入...`
              Bot.makeLog("info", data.message, `${data.self_id} <= ${data.user_id}`, true)
              break
            case "profile_like":
              Bot.makeLog(
                "info",
                `资料卡点赞：${data.times}次`,
                `${data.self_id} <= ${data.operator_id}`,
                true,
              )
              break
            default:
              Bot.makeLog("warn", `未知通知：${logger.magenta(data.raw)}`, data.self_id)
          }
          break
        case "group_card":
          Bot.makeLog(
            "info",
            `群名片更新：${data.card_old} => ${data.card_new}`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          data.bot.pickMember(data.group_id, data.user_id).getInfo()
          break
        case "offline_file":
          Bot.makeLog(
            "info",
            `离线文件：${Bot.String(data.file)}`,
            `${data.self_id} <= ${data.user_id}`,
            true,
          )
          Bot.em("message.private.friend", {
            ...data,
            post_type: "message",
            message_type: "private",
            sub_type: "friend",
            message: [{ ...data.file, type: "file" }],
            raw_message: `[文件：${data.file.name}]`,
          })
          break
        case "client_status":
          Bot.makeLog(
            "info",
            `客户端${data.online ? "上线" : "下线"}：${Bot.String(data.client)}`,
            data.self_id,
          )
          data.clients = (await data.bot.sendApi("get_online_clients")).clients
          data.bot.clients = data.clients
          break
        case "essence":
          data.notice_type = "group_essence"
          Bot.makeLog(
            "info",
            `群精华消息：${data.operator_id} => ${data.sender_id} ${data.sub_type} ${data.message_id}`,
            `${data.self_id} <= ${data.group_id}`,
            true,
          )
          break
        case "guild_channel_recall":
          Bot.makeLog(
            "info",
            `频道消息撤回：${data.operator_id} => ${data.user_id} ${data.message_id}`,
            `${data.self_id} <= ${data.guild_id}-${data.channel_id}`,
            true,
          )
          break
        case "message_reactions_updated":
          data.notice_type = "guild_message_reactions_updated"
          Bot.makeLog(
            "info",
            `频道消息表情贴：${data.message_id} ${Bot.String(data.current_reactions)}`,
            `${data.self_id} <= ${data.guild_id}-${data.channel_id}, ${data.user_id}`,
            true,
          )
          break
        case "channel_updated":
          data.notice_type = "guild_channel_updated"
          Bot.makeLog(
            "info",
            `子频道更新：${Bot.String(data.old_info)} => ${Bot.String(data.new_info)}`,
            `${data.self_id} <= ${data.guild_id}-${data.channel_id}, ${data.user_id}`,
            true,
          )
          break
        case "channel_created":
          data.notice_type = "guild_channel_created"
          Bot.makeLog(
            "info",
            `子频道创建：${Bot.String(data.channel_info)}`,
            `${data.self_id} <= ${data.guild_id}-${data.channel_id}, ${data.user_id}`,
            true,
          )
          data.bot.getGroupMap()
          break
        case "channel_destroyed":
          data.notice_type = "guild_channel_destroyed"
          Bot.makeLog(
            "info",
            `子频道删除：${Bot.String(data.channel_info)}`,
            `${data.self_id} <= ${data.guild_id}-${data.channel_id}, ${data.user_id}`,
            true,
          )
          data.bot.getGroupMap()
          break
        case "bot_offline":
          data.post_type = "system"
          data.notice_type = "offline"
          Bot.makeLog("info", `${data.tag || "账号下线"}：${data.message}`, data.self_id)
          Bot.sendMasterMsg(`[${data.self_id}] ${data.tag || "账号下线"}：${data.message}`)
          break
        default:
          Bot.makeLog("warn", `未知通知：${logger.magenta(data.raw)}`, data.self_id)
      }

      let notice = data.notice_type.split("_")
      data.notice_type = notice.shift()
      notice = notice.join("_")
      if (notice) data.sub_type = notice

      if (data.guild_id && data.channel_id) {
        data.group_id = `${data.guild_id}-${data.channel_id}`
        Object.defineProperty(data, "friend", {
          get() {
            return this.member || {}
          },
        })
      }

      Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
    }

    /**
     * 处理请求事件
     */
    makeRequest(data) {
      switch (data.request_type) {
        case "friend":
          Bot.makeLog(
            "info",
            `加好友请求：${data.comment}(${data.flag})`,
            `${data.self_id} <= ${data.user_id}`,
            true,
          )
          data.sub_type = "add"
          data.approve = function (approve, remark) {
            return this.bot.setFriendAddRequest(this.flag, approve, remark)
          }
          break
        case "group":
          Bot.makeLog(
            "info",
            `加群请求：${data.sub_type} ${data.comment}(${data.flag})`,
            `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
            true,
          )
          data.approve = function (approve, reason) {
            return this.bot.setGroupAddRequest(this.flag, approve, reason, this.sub_type)
          }
          break
        default:
          Bot.makeLog("warn", `未知请求：${logger.magenta(data.raw)}`, data.self_id)
      }

      data.bot.request_list.push(data)
      Bot.em(`${data.post_type}.${data.request_type}.${data.sub_type}`, data)
    }

    /**
     * 处理心跳
     */
    heartbeat(data) {
      if (data.status) Object.assign(data.bot.stat, data.status)
    }

    /**
     * 处理元事件
     */
    makeMeta(data, ws) {
      switch (data.meta_event_type) {
        case "heartbeat":
          this.heartbeat(data)
          break
        case "lifecycle":
          this.connect(data, ws)
          break
        default:
          Bot.makeLog("warn", `未知消息：${logger.magenta(data.raw)}`, data.self_id)
      }
    }

    /**
     * WebSocket消息处理入口
     */
    message(data, ws) {
      try {
        data = {
          ...JSON.parse(data),
          raw: Bot.String(data),
        }
      } catch (err) {
        return Bot.makeLog("error", ["解码数据失败", data, err])
      }

      if (data.post_type) {
        if (data.meta_event_type !== "lifecycle" && !Bot.uin.includes(data.self_id)) {
          Bot.makeLog("warn", `找不到对应Bot，忽略消息：${logger.magenta(data.raw)}`, data.self_id)
          return false
        }
        data.bot = Bot[data.self_id]

        switch (data.post_type) {
          case "meta_event":
            return this.makeMeta(data, ws)
          case "message":
            return this.makeMessage(data)
          case "notice":
            return this.makeNotice(data)
          case "request":
            return this.makeRequest(data)
          case "message_sent":
            data.post_type = "message"
            return this.makeMessage(data)
        }
      } else if (data.echo) {
        const cache = this.echo.get(data.echo)
        if (cache) return cache.resolve(data)
      }
      Bot.makeLog("warn", `未知消息：${logger.magenta(data.raw)}`, data.self_id)
    }

    /**
     * 加载适配器
     */
    load() {
      if (!Array.isArray(Bot.wsf[this.path])) Bot.wsf[this.path] = []
      Bot.wsf[this.path].push((ws, ...args) =>
        ws.on("message", data => this.message(data, ws, ...args)),
      )
    }
  })(),
)