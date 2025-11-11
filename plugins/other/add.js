import cfg from "../../lib/config/config.js"
import fs from "node:fs/promises"
import path from "node:path"
import lodash from "lodash"
import crypto from "crypto"

export const messageMap = {}
export const bannedWordsMap = {}

export class add extends plugin {
  constructor() {
    super({
      name: "添加消息",
      dsc: "添加消息和违禁词管理",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#(全局)?(模糊)?(添加|删除)",
          fnc: "handleAddDel"
        },
        {
          reg: "^#(全局)?(消息|词条)",
          fnc: "list"
        },
        {
          reg: "^#(全局)?(葵葵)?(增加|删除)(模糊)?违禁词",
          fnc: "handleBannedWord",
          permission: "master"
        },
        {
          reg: "^#(全局)?(葵葵)?违禁词(列表|管理)?",
          fnc: "listBannedWords",
          permission: "master"
        },
        {
          reg: "^#(葵葵)?清空(模糊)?违禁词",
          fnc: "clearBannedWords",
          permission: "master"
        },
        {
          reg: "^#(葵葵)?违禁词(开启|关闭|状态)",
          fnc: "toggleBannedWords",
          permission: "master"
        },
        {
          reg: "",
          fnc: "getMessage",
          log: false
        }
      ]
    })

    this.path = "data/messageJson/"
    this.bannedWordsPath = "data/bannedWords/"
    this.bannedImagesPath = "data/bannedWords/images/"
    this.configPath = "data/bannedWords/config/"
  }

  async init() {
    await Promise.all([
      Bot.mkdir(this.path),
      Bot.mkdir(this.bannedWordsPath),
      Bot.mkdir(this.bannedImagesPath),
      Bot.mkdir(this.configPath)
    ])
    await this.initAllBannedWords()
  }

  /** 处理添加删除 */
  async handleAddDel() {
    this.isFuzzy = this.e.msg.includes("模糊")
    return this.e.msg.includes("添加") ? this.add() : this.del()
  }

  /** 处理违禁词增加删除 */
  async handleBannedWord() {
    return this.e.msg.includes("增加") ? this.addBannedWord() : this.delBannedWord()
  }

  /** 初始化所有违禁词 */
  async initAllBannedWords() {
    try {
      const files = await fs.readdir(this.bannedWordsPath)
      await Promise.all(
        files.filter(f => f.endsWith('.json'))
          .map(f => this.initBannedWords(f.replace('.json', '')))
      )
    } catch (err) {
      logger.error(`初始化违禁词失败: ${err}`)
    }
  }

  /** 初始化群组违禁词 */
  async initBannedWords(groupId) {
    if (bannedWordsMap[groupId]) return
    
    bannedWordsMap[groupId] = {
      exact: new Set(),
      fuzzy: new Set(),
      images: new Map(),
      config: {
        enabled: true,
        muteTime: 720,
        warnOnly: false,
        exemptRoles: []
      }
    }

    const filePath = `${this.bannedWordsPath}${groupId}.json`
    if (!await Bot.fsStat(filePath)) return

    try {
      const data = JSON.parse(await fs.readFile(filePath, "utf8"))
      
      data.exact?.forEach(word => bannedWordsMap[groupId].exact.add(word))
      data.fuzzy?.forEach(word => bannedWordsMap[groupId].fuzzy.add(word))
      data.images && Object.entries(data.images).forEach(([hash, info]) => 
        bannedWordsMap[groupId].images.set(hash, info)
      )
      data.config && Object.assign(bannedWordsMap[groupId].config, data.config)
      
      logger.info(`[违禁词] 成功加载群组 ${groupId} 的违禁词配置`)
    } catch (err) {
      logger.error(`加载违禁词失败 ${filePath}: ${err}`)
    }
  }

  /** 保存违禁词到文件 */
  async saveBannedWords(groupId) {
    if (!bannedWordsMap[groupId]) return
    
    const data = {
      exact: Array.from(bannedWordsMap[groupId].exact),
      fuzzy: Array.from(bannedWordsMap[groupId].fuzzy),
      images: Object.fromEntries(bannedWordsMap[groupId].images),
      config: bannedWordsMap[groupId].config
    }
    
    await fs.writeFile(`${this.bannedWordsPath}${groupId}.json`, JSON.stringify(data, null, 2))
  }

  /** 获取身份信息 */
  async getRoleInfo(groupId, userId) {
    try {
      if (!this.e.isGroup) return { role: 'member', roleName: '群员', isAdmin: false }
      
      const member = this.e.group.pickMember(userId)
      const role = member.role || 'member'
      const roleMap = { owner: '群主', admin: '管理员', member: '群员' }
      
      return {
        role,
        roleName: roleMap[role] || '群员',
        isAdmin: ['owner', 'admin'].includes(role)
      }
    } catch {
      return { role: 'member', roleName: '群员', isAdmin: false }
    }
  }

  /** 切换违禁词状态 */
  async toggleBannedWords() {
    await this.getGroupId()
    if (!this.group_id || !this.checkAuth()) return false

    await this.initBannedWords(this.group_id)
    
    const action = this.e.msg.match(/违禁词(开启|关闭|状态)/)?.[1]
    const config = bannedWordsMap[this.group_id].config
    
    if (action === '开启') {
      config.enabled = true
      await this.saveBannedWords(this.group_id)
      return this.reply('✅ 违禁词检测已开启')
    }
    
    if (action === '关闭') {
      config.enabled = false
      await this.saveBannedWords(this.group_id)
      return this.reply('❌ 违禁词检测已关闭')
    }
    
    const { exact, fuzzy, images } = bannedWordsMap[this.group_id]
    return this.reply([
      `违禁词检测状态：${config.enabled ? '开启' : '关闭'}`,
      `禁言时长：${config.muteTime}分钟`,
      `模式：${config.warnOnly ? '仅警告' : '警告+禁言'}`,
      `精确违禁词：${exact.size}个`,
      `模糊违禁词：${fuzzy.size}个`,
      `图片违禁词：${images.size}个`
    ].join('\n'))
  }

  /** 清空违禁词 */
  async clearBannedWords() {
    this.isFuzzy = this.e.msg.includes('模糊')
    this.isGlobal = this.e.msg.includes('全局')
    
    await this.getGroupId()
    if (!this.group_id || !this.checkAuth()) return false
    
    await this.initBannedWords(this.group_id)
    
    const type = this.isFuzzy ? 'fuzzy' : 'exact'
    const typeName = this.isFuzzy ? '模糊' : '精确'
    const groupType = this.isGlobal ? '全局' : '群组'
    const count = bannedWordsMap[this.group_id][type].size
    
    if (!count) return this.reply(`没有${groupType}${typeName}违禁词需要清空`)
    
    bannedWordsMap[this.group_id][type].clear()
    await this.saveBannedWords(this.group_id)
    await this.reply(`✅ 已清空 ${count} 个${groupType}${typeName}违禁词`)
    
    return this.listBannedWords()
  }

  /** 增加违禁词 */
  async addBannedWord() {
    this.isGlobal = this.e.msg.includes('全局')
    this.isFuzzy = this.e.msg.includes('模糊')
    
    await this.getGroupId()
    
    if (!this.group_id && !this.isGlobal) {
      return this.reply("请先在群内触发消息，确定添加的群，或使用 #全局增加违禁词")
    }

    if (!this.checkAuth()) return false
    
    await this.initBannedWords(this.group_id)

    const word = this.e.msg.match(/增加(模糊)?违禁词(.*)/)?.[2]?.trim()
    
    if (!word && !this.e.img?.length) {
      this.e._bannedWordContext = {
        group_id: this.group_id,
        isFuzzy: this.isFuzzy,
        isGlobal: this.isGlobal,
        words: [],
        images: []
      }
      this.setContext("addBannedWordContext")
      const groupType = this.isGlobal ? '全局' : '群组'
      return this.reply(`请发送要添加的${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词或图片，完成后发送#结束添加`, true, { at: true })
    }

    if (word) {
      const type = this.isFuzzy ? 'fuzzy' : 'exact'
      const groupType = this.isGlobal ? '全局' : '群组'
      bannedWordsMap[this.group_id][type].add(word)
      await this.saveBannedWords(this.group_id)
      await this.reply(`✅ 成功添加${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词：${word}`)
      return this.listBannedWords()
    }

    if (this.e.img?.length) {
      const msg = [`正在添加图片违禁词...`]
      for (const img of this.e.img) {
        const result = await this.addImageBannedWord(img, this.group_id)
        msg.push(result.success 
          ? [`✅ 成功添加图片违禁词`, segment.image(result.path)]
          : `❌ 图片处理失败：${result.error}`
        )
      }
      await this.saveBannedWords(this.group_id)
      await this.reply(await Bot.makeForwardArray(msg.flat()))
      return this.listBannedWords()
    }
  }

  /** 添加图片违禁词 */
  async addImageBannedWord(imgUrl, groupId) {
    try {
      const hash = await this.getImageHash(imgUrl)
      if (!hash) return { success: false, error: '获取图片hash失败' }
      
      const groupImgPath = `${this.bannedImagesPath}${groupId}/`
      await Bot.mkdir(groupImgPath)
      
      const response = await fetch(imgUrl)
      if (!response.ok) return { success: false, error: '下载图片失败' }
      
      const buffer = await response.arrayBuffer()
      const ext = imgUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg'
      const filePath = `${groupImgPath}${hash}.${ext}`
      
      await fs.writeFile(filePath, Buffer.from(buffer))
      
      bannedWordsMap[groupId].images.set(hash, {
        path: filePath,
        desc: `图片违禁词_${new Date().toLocaleString()}`,
        addTime: Date.now()
      })
      
      return { success: true, path: filePath, hash }
    } catch (err) {
      logger.error(`添加图片违禁词失败: ${err}`)
      return { success: false, error: err.message }
    }
  }

  /** 添加违禁词上下文 */
  async addBannedWordContext() {
    const context = this.getContext("addBannedWordContext")
    if (!context?._bannedWordContext) return false
    
    const ctx = context._bannedWordContext
    Object.assign(this, { 
      group_id: ctx.group_id, 
      isFuzzy: ctx.isFuzzy, 
      isGlobal: ctx.isGlobal 
    })
    
    await this.initBannedWords(this.group_id)

    if (this.e.msg?.includes("#结束添加")) {
      this.finish("addBannedWordContext")
      
      if (!ctx.words.length && !ctx.images.length) {
        return this.reply("没有添加任何违禁词")
      }
      
      const msg = []
      const type = this.isFuzzy ? 'fuzzy' : 'exact'
      const typeName = this.isFuzzy ? '模糊' : '精确'
      const groupType = this.isGlobal ? '全局' : '群组'
      
      if (ctx.words.length) {
        ctx.words.forEach(word => bannedWordsMap[this.group_id][type].add(word))
        msg.push(`【${groupType}${typeName}违禁词】添加了 ${ctx.words.length} 个：`, 
          ...ctx.words.map(w => `- ${w}`))
      }
      
      if (ctx.images.length) {
        msg.push(`【${groupType}图片违禁词】添加了 ${ctx.images.length} 个：`)
        ctx.images.forEach(img => {
          bannedWordsMap[this.group_id].images.set(img.hash, img.info)
          msg.push(segment.image(img.info.path))
        })
      }
      
      await this.saveBannedWords(this.group_id)
      msg.unshift(`✅ 成功添加 ${ctx.words.length + ctx.images.length} 个${groupType}违禁词`)
      await this.reply(await Bot.makeForwardArray(msg))
      return this.listBannedWords()
    }

    this.e.msg && !this.e.img?.length && ctx.words.push(this.e.msg.trim())
    
    if (this.e.img?.length) {
      for (const img of this.e.img) {
        const result = await this.addImageBannedWord(img, this.group_id)
        result.success && ctx.images.push({
          hash: result.hash,
          info: bannedWordsMap[this.group_id].images.get(result.hash)
        })
      }
    }
    
    this.e._bannedWordContext = ctx
    this.setContext("addBannedWordContext")
    
    const groupType = ctx.isGlobal ? '全局' : '群组'
    const status = [`继续发送要添加的${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词，或发送#结束添加`]
    ctx.words.length && status.push(`已添加文字：${ctx.words.length}个`)
    ctx.images.length && status.push(`已添加图片：${ctx.images.length}个`)
    
    return this.reply(status.join('\n'))
  }

  /** 删除违禁词 */
  async delBannedWord() {
    this.isGlobal = this.e.msg.includes('全局')
    this.isFuzzy = this.e.msg.includes('模糊')
    
    await this.getGroupId()
    
    if (!this.group_id && !this.isGlobal) {
      return this.reply("请先在群内触发消息，确定删除的群，或使用 #全局删除违禁词")
    }

    if (!this.checkAuth()) return false
    
    await this.initBannedWords(this.group_id)

    const param = this.e.msg.match(/删除(模糊)?违禁词(.*)/)?.[2]?.trim()
    if (!param) return this.reply("删除错误：没有指定违禁词或序号")

    const groupType = this.isGlobal ? '全局' : '群组'
    const num = parseInt(param)
    
    if (!isNaN(num) && num > 0) {
      let deleted = false
      let deletedItem = ""
      
      if (this.isFuzzy) {
        const wordsList = Array.from(bannedWordsMap[this.group_id].fuzzy)
        if (num <= wordsList.length) {
          deletedItem = wordsList[num - 1]
          bannedWordsMap[this.group_id].fuzzy.delete(deletedItem)
          deleted = true
        }
      } else {
        const exactList = Array.from(bannedWordsMap[this.group_id].exact)
        const imagesList = Array.from(bannedWordsMap[this.group_id].images.entries())
        const totalList = [...exactList, ...imagesList]
        
        if (num <= totalList.length) {
          if (num <= exactList.length) {
            deletedItem = exactList[num - 1]
            bannedWordsMap[this.group_id].exact.delete(deletedItem)
          } else {
            const [hash, info] = imagesList[num - exactList.length - 1]
            deletedItem = `图片违禁词 (${info.desc})`
            bannedWordsMap[this.group_id].images.delete(hash)
            try { await fs.unlink(info.path) } catch {}
          }
          deleted = true
        }
      }
      
      if (deleted) {
        await this.saveBannedWords(this.group_id)
        await this.reply(`✅ 成功删除${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词：${deletedItem}`)
        return this.listBannedWords()
      }
    }
    
    const type = this.isFuzzy ? 'fuzzy' : 'exact'
    if (bannedWordsMap[this.group_id][type].has(param)) {
      bannedWordsMap[this.group_id][type].delete(param)
      await this.saveBannedWords(this.group_id)
      await this.reply(`✅ 成功删除${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词：${param}`)
      return this.listBannedWords()
    }

    return this.reply(`❌ 删除错误：未找到该${groupType}${this.isFuzzy ? '模糊' : '精确'}违禁词`)
  }

  /** 违禁词列表 */
  async listBannedWords() {
    this.isGlobal = this.e.msg.includes('全局')
    
    await this.getGroupId()
    if (!this.group_id) return this.reply("请先在群内触发消息")

    await Promise.all([
      this.initBannedWords(this.group_id),
      this.initBannedWords('global')
    ])

    const banned = bannedWordsMap[this.group_id]
    const globalBanned = bannedWordsMap['global']
    
    if (!banned && (!globalBanned || this.group_id === 'global')) {
      return this.reply("暂无违禁词")
    }

    const msg = []
    let totalNum = 0
    
    if (banned) {
      msg.push(
        `【违禁词检测状态】${banned.config.enabled ? '✅ 开启' : '❌ 关闭'}`,
        `禁言时长：${banned.config.muteTime}分钟`,
        `模式：${banned.config.warnOnly ? '仅警告' : '警告+禁言'}`,
        '━━━━━━━━━━━━━━━'
      )
      
      if (banned.exact.size) {
        msg.push(`【群组精确违禁词】共${banned.exact.size}个：`)
        for (const word of banned.exact) msg.push(`${++totalNum}. ${word}`)
      }
      
      if (banned.images.size) {
        msg.push(`【群组图片违禁词】共${banned.images.size}个：`)
        for (const [hash, info] of banned.images) {
          msg.push(`${++totalNum}. ${info.desc}`)
          await Bot.fsStat(info.path) && msg.push(segment.image(info.path))
        }
      }
      
      if (banned.fuzzy.size) {
        msg.push('━━━━━━━━━━━━━━━', `【群组模糊违禁词】共${banned.fuzzy.size}个：`)
        let fuzzyNum = 0
        for (const word of banned.fuzzy) msg.push(`${++fuzzyNum}. ${word}`)
      }
    }
    
    if (globalBanned && this.group_id !== 'global') {
      let globalNum = totalNum
      
      if (globalBanned.exact.size) {
        msg.push('━━━━━━━━━━━━━━━', `【全局精确违禁词】共${globalBanned.exact.size}个：`)
        for (const word of globalBanned.exact) msg.push(`G${++globalNum - totalNum}. ${word}`)
      }
      
      if (globalBanned.images.size) {
        msg.push(`【全局图片违禁词】共${globalBanned.images.size}个：`)
        for (const [hash, info] of globalBanned.images) {
          msg.push(`G${++globalNum - totalNum}. ${info.desc}`)
          await Bot.fsStat(info.path) && msg.push(segment.image(info.path))
        }
      }
      
      if (globalBanned.fuzzy.size) {
        msg.push('━━━━━━━━━━━━━━━', `【全局模糊违禁词】共${globalBanned.fuzzy.size}个：`)
        let globalFuzzyNum = 0
        for (const word of globalBanned.fuzzy) msg.push(`GF${++globalFuzzyNum}. ${word}`)
      }
      
      totalNum = globalNum
    }

    if (this.group_id === 'global') {
      totalNum = 0
      if (globalBanned.exact.size) {
        msg.push(`【全局精确违禁词】共${globalBanned.exact.size}个：`)
        for (const word of globalBanned.exact) msg.push(`${++totalNum}. ${word}`)
      }
      
      if (globalBanned.images.size) {
        msg.push(`【全局图片违禁词】共${globalBanned.images.size}个：`)
        for (const [hash, info] of globalBanned.images) {
          msg.push(`${++totalNum}. ${info.desc}`)
          await Bot.fsStat(info.path) && msg.push(segment.image(info.path))
        }
      }
      
      if (globalBanned.fuzzy.size) {
        msg.push('━━━━━━━━━━━━━━━', `【全局模糊违禁词】共${globalBanned.fuzzy.size}个：`)
        let fuzzyNum = 0
        for (const word of globalBanned.fuzzy) msg.push(`${++fuzzyNum}. ${word}`)
      }
    }

    if (!totalNum && (!globalBanned || !globalBanned.exact.size && !globalBanned.fuzzy.size && !globalBanned.images.size)) {
      return this.reply("暂无违禁词")
    }

    msg.push(
      '━━━━━━━━━━━━━━━',
      '【操作提示】',
      '删除群组违禁词：#删除违禁词[序号]',
      '删除全局违禁词：#全局删除违禁词[关键词]',
      '删除模糊违禁词：#删除模糊违禁词[序号]',
      '精确违禁词：消息必须完全等于违禁词才触发',
      '模糊违禁词：消息中按顺序包含违禁词的所有字符即触发',
      '全局违禁词：对所有群生效',
      'G前缀表示全局违禁词，GF前缀表示全局模糊违禁词'
    )

    return this.reply(await Bot.makeForwardArray(msg))
  }

  /** 检查违禁词 */
  async checkBannedWords() {
    if (!this.e.isGroup) return false
    
    const groupId = this.e.group_id
    await Promise.all([this.initBannedWords(groupId), this.initBannedWords('global')])
    
    if (!bannedWordsMap[groupId]?.config?.enabled) return false
    
    let violated = false, violationType = "", violatedWord = "", isGlobal = false
    const text = (this.e.msg || this.e.raw_message || "").trim()

    if (text) {
      for (const gid of [groupId, 'global']) {
        if (!bannedWordsMap[gid]) continue
        
        for (const word of bannedWordsMap[gid].exact) {
          if (text === word) {
            violated = true
            violationType = "精确"
            violatedWord = word
            isGlobal = gid === 'global'
            break
          }
        }
        
        if (!violated) {
          for (const word of bannedWordsMap[gid].fuzzy) {
            if (this.checkFuzzyMatch(text, word)) {
              violated = true
              violationType = "模糊"
              violatedWord = word
              isGlobal = gid === 'global'
              break
            }
          }
        }
        
        if (violated) break
      }
    }

    if (!violated && this.e.img?.length) {
      for (const img of this.e.img) {
        const hash = await this.getImageHash(img)
        if (!hash) continue
        
        for (const gid of [groupId, 'global']) {
          if (bannedWordsMap[gid]?.images.has(hash)) {
            violated = true
            violationType = "图片"
            violatedWord = bannedWordsMap[gid].images.get(hash).desc
            isGlobal = gid === 'global'
            break
          }
        }
        if (violated) break
      }
    }

    return violated && await this.handleViolation(violationType, violatedWord, isGlobal)
  }

  /** 处理违禁词触发 */
  async handleViolation(violationType, violatedWord, isGlobal = false) {
    const { group_id: groupId, user_id: userId } = this.e
    
    const [userRole, botRole] = await Promise.all([
      this.getRoleInfo(groupId, userId),
      this.getRoleInfo(groupId, this.e.self_id)
    ])
    
    logger.info(`[违禁词检测] 用户 ${userId}(${userRole.roleName}) 触发${isGlobal ? '全局' : '群组'}${violationType}违禁词：${violatedWord}`)
    
    await this.notifyMaster(groupId, userId, violationType, violatedWord, isGlobal, userRole)
    
    this.e.recall && await this.e.recall().catch(err => logger.warn(`撤回消息失败: ${err}`))

    const responses = this.getViolationResponse(userRole, botRole, groupId)
    const config = bannedWordsMap[groupId].config
    const warnOnly = config.warnOnly || !botRole.isAdmin
    
    if (!warnOnly && botRole.isAdmin && !userRole.isAdmin) {
      try {
        await this.e.group.muteMember(userId, config.muteTime * 60)
        await this.reply([segment.at(userId), ` ${responses.mute}`])
      } catch (err) {
        logger.error(`执行禁言失败: ${err}`)
        await this.reply([segment.at(userId), ` ${responses.failMute}`])
      }
    } else {
      await this.reply([segment.at(userId), ` ${responses.warn}`])
    }
    
    return true
  }

  /** 通知主人违禁词触发 */
  async notifyMaster(groupId, userId, violationType, violatedWord, isGlobal, userRole) {
    try {
      const member = this.e.group.pickMember(userId)
      const nickname = member.card || member.nickname || `用户${userId}`
      const avatar = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
      
      const groupName = this.e.group.group_name || `群${groupId}`
      const config = bannedWordsMap[groupId]?.config || {}
      const muteTime = config.muteTime || 720
      const triggerContent = this.e.msg || this.e.raw_message || '[图片消息]'
      
      const notifyMsg = [
        `🚨 违禁词触发通知\n`,
        `━━━━━━━━━━━━━━━\n`,
        `群聊：${groupName}(${groupId})\n`,
        `触发人：${nickname}(${userId})\n`,
        `身份：${userRole.roleName}\n`,
        `违禁词类型：${isGlobal ? '全局' : '群组'}${violationType}违禁词\n`,
        `违禁词内容：${violatedWord}\n`,
        `触发内容：${triggerContent}\n`,
        `禁言时长：${muteTime}分钟\n`,
        `触发时间：${new Date().toLocaleString()}\n`,
        `━━━━━━━━━━━━━━━\n`,
        segment.image(avatar)
      ]
      
      await Bot.sendMasterMsg(notifyMsg)
      
    } catch (err) {
      logger.error(`通知主人失败: ${err}`)
    }
  }

  /** 获取违规响应文本 */
  getViolationResponse(userRole, botRole, groupId) {
    const muteTime = bannedWordsMap[groupId]?.config?.muteTime || 720
    
    const responses = {
      botNotAdmin: {
        warn: "检测到违禁词！虽然我不是管理员不能禁言你，但还是请注意言辞哦~ (｡•́︿•̀｡)",
        mute: "",
        failMute: "想禁言你但失败了，看来我权限不够呢... ಥ_ಥ"
      },
      toOwner: {
        warn: "群主大大，您说的话包含违禁词哦！虽然不能把您怎么样，但还是请坐下冷静一下吧~ ٩(๑´3`๑)۶"
      },
      toAdmin: {
        warn: "管理员同僚，您的发言包含违禁词！大家都是管理员，请以身作则哦~ (ㆀ˘･з･˘)"
      },
      toMember: {
        warn: "检测到违禁词！请注意您的言行~ ╰(‵□′)╯",
        mute: `您发送的消息包含违禁词，已被禁言${muteTime}分钟！下次请注意哦~ (╬▔皿▔)╯`,
        failMute: "检测到违禁词，但禁言失败了... 下次注意哦！"
      }
    }

    if (!botRole.isAdmin) return responses.botNotAdmin
    if (userRole.role === 'owner') return responses.toOwner
    if (userRole.role === 'admin') return responses.toAdmin
    return responses.toMember
  }

  /** 模糊匹配检查 */
  checkFuzzyMatch(text, bannedWord) {
    const chars = bannedWord.split('')
    let lastIndex = -1
    
    for (const char of chars) {
      const index = text.indexOf(char, lastIndex + 1)
      if (index === -1) return false
      lastIndex = index
    }
    
    return true
  }

  /** 获取图片hash */
  async getImageHash(imgUrl) {
    try {
      const response = await fetch(imgUrl)
      if (!response.ok) return null
      
      const buffer = await response.arrayBuffer()
      return crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex')
    } catch (err) {
      logger.error(`获取图片hash失败: ${err}`)
      return null
    }
  }

  /** 群号key */
  get grpKey() {
    return `Yz:group_id:${this.e.user_id}`
  }

  /** #添加 */
  async add() {
    this.isGlobal = this.e.msg.includes("全局")
    this.isFuzzy = this.e.msg.includes("模糊")
    await this.getGroupId()

    if (!this.e.msg.replace(/^#(全局)?(模糊)?添加/, "").trim() && this.e.img?.length) {
      return this.reply("请指定一个关键词来添加图片，例如：#添加表情包")
    }

    if (!this.group_id) return this.reply("请先在群内触发消息，确定添加的群")

    await this.initMessageMap()
    if (!this.checkAuth()) return false
    
    this.getKeyWord()
    if (!this.keyWord) return this.reply("添加错误：没有关键词")

    this.e._addContext = {
      keyWord: this.keyWord,
      isGlobal: this.isGlobal,
      isFuzzy: this.isFuzzy,
      group_id: this.group_id,
      messages: []
    }
    
    this.setContext("addContext")
    const groupType = this.isGlobal ? '全局' : '群组'
    const matchType = this.isFuzzy ? '模糊' : '精确'
    return this.reply(`请发送添加内容，完成后发送#结束添加\n当前添加：${groupType}${matchType}词条【${this.keyWord}】`, true, { at: true })
  }

  /** 获取群号 */
  async getGroupId() {
    if (this.isGlobal) {
      this.group_id = "global"
      return
    }

    if (this.e.isGroup) {
      this.group_id = this.e.group_id
      redis.setEx(this.grpKey, 2592000, String(this.group_id))
      return
    }

    this.group_id = await redis.get(this.grpKey)
  }

  /** 权限检查 */
  checkAuth() {
    if (this.e.isMaster) return true
    
    if (this.isGlobal) {
      this.reply("暂无权限，只有主人才能操作")
      return false
    }

    const groupCfg = cfg.getGroup(this.e.self_id, this.group_id)
    
    if (groupCfg.addLimit == 2) {
      this.reply("暂无权限，只有主人才能操作")
      return false
    }
    
    if (groupCfg.addLimit == 1 && !this.e.member?.is_admin) {
      this.reply("暂无权限，只有管理员才能操作")
      return false
    }

    if (groupCfg.addPrivate != 1 && !this.e.isGroup) {
      this.reply("禁止私聊添加")
      return false
    }

    return true
  }

  /** 获取添加关键词 */
  getKeyWord() {
    const msg = this.e.msg || this.e.raw_message || ""
    this.keyWord = this.trimAlias(msg.replace(/^#(全局)?(模糊)?(添加|删除)/, "").trim())
  }

  /** 过滤别名 */
  trimAlias(msg) {
    if (!msg) return msg
    
    const groupCfg = cfg.getGroup(this.e.self_id, this.group_id)
    let alias = groupCfg.botAlias
    if (!alias) return msg
    
    Array.isArray(alias) || (alias = [alias])
    for (const name of alias) msg.startsWith(name) && (msg = lodash.trimStart(msg, name).trim())
    
    return msg
  }

  /** 添加内容 */
  async addContext() {
    const context = this.getContext("addContext")
    if (!context?._addContext) return false
    
    const contextData = context._addContext
    Object.assign(this, {
      isGlobal: contextData.isGlobal,
      isFuzzy: contextData.isFuzzy,
      group_id: contextData.group_id,
      keyWord: contextData.keyWord
    })
    
    await this.initMessageMap()

    if (this.e.msg?.includes("#结束添加")) {
      this.finish("addContext")
      
      if (!contextData.messages?.length) return this.reply("添加错误：没有添加内容")

      messageMap[this.group_id] || (messageMap[this.group_id] = new Map())
      
      const storageKey = this.isFuzzy ? `[模糊]${this.keyWord}` : this.keyWord
      let messages = messageMap[this.group_id].get(storageKey) || []
      messages = messages.concat(contextData.messages)
      messageMap[this.group_id].set(storageKey, messages)
      
      await this.saveJson()
      
      const groupType = this.isGlobal ? '全局' : '群组'
      const matchType = this.isFuzzy ? '模糊' : '精确'
      
      await this.reply([
        `✅ 添加成功！`,
        `类型：${groupType}${matchType}词条`,
        `关键词：${this.keyWord}`,
        `总回复数：${messages.length}`,
        `本次添加：${contextData.messages.length} 条回复`
      ].join('\n'))
      
      return true
    }

    const currentMessage = []
    for (const i of this.e.message) {
      if (i.url) {
        i.file = await this.saveFile(i)
        delete i.url
        delete i.fid
      }
      if (i.type == "at" && i.qq == this.e.self_id) continue
      currentMessage.push(i)
    }
    
    currentMessage.length && contextData.messages.push(currentMessage)
    
    this.e._addContext = contextData
    this.setContext("addContext")
    
    const groupType = contextData.isGlobal ? '全局' : '群组'
    const matchType = contextData.isFuzzy ? '模糊' : '精确'
    const status = [
      `继续发送要添加的内容，或发送#结束添加`,
      `当前添加：${groupType}${matchType}词条【${contextData.keyWord}】`
    ]
    contextData.messages.length && status.push(`已添加 ${contextData.messages.length} 条回复`)
    
    return this.reply(status.join('\n'))
  }

  /** 保存JSON */
  async saveJson() {
    const obj = Object.fromEntries(messageMap[this.group_id])
    await fs.writeFile(`${this.path}${this.group_id}.json`, JSON.stringify(obj, "", "\t"))
  }

  /** 保存文件 */
  async saveFile(data) {
    try {
      const file = await Bot.fileType({ ...data, file: data.url })
      if (Buffer.isBuffer(file.buffer)) {
        file.name = `${this.group_id}/${data.type}/${file.name}`
        file.path = `${this.path}${file.name}`
        await Bot.mkdir(path.dirname(file.path))
        await fs.writeFile(file.path, file.buffer)
        return file.name
      }
    } catch (err) {
      logger.error(`保存文件失败: ${err}`)
    }
    return data.url
  }

  /** 获取关键词消息 */
  getKeyWordMsg(keyWord) {
    const exactMessages = [
      ...(messageMap[this.group_id]?.get(keyWord) || []),
      ...(messageMap.global?.get(keyWord) || [])
    ]
    
    if (exactMessages.length) return exactMessages

    const fuzzyMessages = []
    for (const [key, messages] of [...(messageMap[this.group_id]?.entries() || []), ...(messageMap.global?.entries() || [])]) {
      if (key.startsWith('[模糊]')) {
        const fuzzyKey = key.substring(4)
        if (this.checkFuzzyMatch(keyWord, fuzzyKey)) {
          fuzzyMessages.push(...messages)
        }
      }
    }
    
    return fuzzyMessages
  }

  /** 获取消息 */
  async getMessage() {
    if (!this.e.msg && !this.e.raw_message) return false
    
    if (await this.checkBannedWords()) return true
    
    this.isGlobal = false
    await this.getGroupId()
    if (!this.group_id) return false

    await Promise.all([this.initMessageMap(), this.initGlobalMessageMap()])

    this.keyWord = this.trimAlias((this.e.msg || this.e.raw_message || "").trim())

    let messages = this.getKeyWordMsg(this.keyWord)
    if (!messages.length) {
      const match = this.keyWord.match(/^(.+?)(\d+)$/)
      if (match) {
        const [, baseKey, index] = match
        const allMsg = this.getKeyWordMsg(baseKey)
        const idx = parseInt(index) - 1
        if (allMsg[idx]) {
          messages = [allMsg[idx]]
          this.keyWord = `${baseKey}(${index})`
        }
      }
    }
    
    if (!messages.length) return false

    const msg = messages[lodash.random(0, messages.length - 1)]
    if (lodash.isEmpty(msg)) return false

    const msgToSend = [...msg]
    for (const i in msgToSend) {
      if (msgToSend[i].file && await Bot.fsStat(`${this.path}${msgToSend[i].file}`)) {
        msgToSend[i] = { ...msgToSend[i], file: `${this.path}${msgToSend[i].file}` }
      }
    }

    logger.mark(`[发送消息]${this.e.logText}[${this.keyWord}]`)
    const groupCfg = cfg.getGroup(this.e.self_id, this.group_id)
    return this.reply(msgToSend, Boolean(groupCfg.addReply), {
      at: Boolean(groupCfg.addAt),
      recallMsg: groupCfg.addRecall
    })
  }

  /** 初始化已添加内容 */
  async initMessageMap() {
    if (messageMap[this.group_id]) return
    messageMap[this.group_id] = new Map()

    const filePath = `${this.path}${this.group_id}.json`
    if (!await Bot.fsStat(filePath)) return

    try {
      const message = JSON.parse(await fs.readFile(filePath, "utf8"))
      for (const i in message) messageMap[this.group_id].set(i, message[i])
    } catch (err) {
      logger.error(`JSON 格式错误：${filePath} ${err}`)
    }
  }

  /** 初始化全局已添加内容 */
  async initGlobalMessageMap() {
    if (messageMap.global) return
    messageMap.global = new Map()

    const globalPath = `${this.path}global.json`
    if (!await Bot.fsStat(globalPath)) return

    try {
      const message = JSON.parse(await fs.readFile(globalPath, "utf8"))
      for (const i in message) messageMap.global.set(i, message[i])
    } catch (err) {
      logger.error(`JSON 格式错误：${globalPath} ${err}`)
    }
  }

  /** 删除文件 */
  async delFile(messages) {
    if (!Array.isArray(messages)) return
    
    const files = []
    const collectFiles = msgs => {
      for (const msg of msgs) {
        if (Array.isArray(msg)) {
          for (const item of msg) item.file && files.push(item.file)
        }
      }
    }
    
    Array.isArray(messages[0]) ? collectFiles(messages) : collectFiles([messages])
    
    return Promise.allSettled(files.map(file => fs.rm(`${this.path}${file}`).catch(() => {})))
  }

  /** #删除 */
  async del() {
    this.isGlobal = this.e.msg.includes("全局")
    this.isFuzzy = this.e.msg.includes("模糊")
    await this.getGroupId()
    if (!this.group_id || !this.checkAuth()) return false

    await this.initMessageMap()

    const param = this.e.msg.match(/^#(全局)?(模糊)?删除(.*)/)?.[3]?.trim()
    if (!param) return this.reply("删除错误：没有关键词或序号")

    const num = parseInt(param)
    if (!isNaN(num) && num > 0) {
      const allKeys = Array.from(messageMap[this.group_id].keys()).filter(key => 
        this.isFuzzy ? key.startsWith('[模糊]') : !key.startsWith('[模糊]')
      )
      if (num <= allKeys.length) {
        const keyToDelete = allKeys[num - 1]
        const messages = messageMap[this.group_id].get(keyToDelete)
        await this.delFile(messages)
        messageMap[this.group_id].delete(keyToDelete)
        await this.saveJson()
        const displayKey = keyToDelete.startsWith('[模糊]') ? keyToDelete.substring(4) : keyToDelete
        const groupType = this.isGlobal ? '全局' : '群组'
        const matchType = this.isFuzzy ? '模糊' : '精确'
        await this.reply(`✅ 删除成功：${groupType}${matchType}词条【${displayKey}】`)
        
        const savedMsg = this.e.msg
        this.e.msg = "#词条列表"
        await this.list()
        this.e.msg = savedMsg
        return true
      }
    }

    this.keyWord = this.trimAlias(param)
    const storageKey = this.isFuzzy ? `[模糊]${this.keyWord}` : this.keyWord
    
    if (messageMap[this.group_id].has(storageKey)) {
      const messages = messageMap[this.group_id].get(storageKey)
      await this.delFile(messages)
      messageMap[this.group_id].delete(storageKey)
      await this.saveJson()
      const groupType = this.isGlobal ? '全局' : '群组'
      const matchType = this.isFuzzy ? '模糊' : '精确'
      await this.reply(`✅ 删除成功：${groupType}${matchType}词条【${this.keyWord}】`)
      
      const savedMsg = this.e.msg
      this.e.msg = "#词条列表"
      await this.list()
      this.e.msg = savedMsg
      return true
    }
    
    const indexMatch = this.keyWord.match(/^(.+?)(\d+)$/)
    if (indexMatch) {
      const [, baseKey, index] = indexMatch
      const storageKey = this.isFuzzy ? `[模糊]${baseKey}` : baseKey
      const messages = messageMap[this.group_id].get(storageKey)
      const idx = parseInt(index) - 1
      if (messages?.[idx]) {
        await this.delFile([messages[idx]])
        messages.splice(idx, 1)
        messages.length || messageMap[this.group_id].delete(storageKey)
        await this.saveJson()
        await this.reply(`✅ 删除成功：${baseKey}(${index})`)
        
        const savedMsg = this.e.msg
        this.e.msg = "#词条列表"
        await this.list()
        this.e.msg = savedMsg
        return true
      }
    }
    
    const groupType = this.isGlobal ? '全局' : '群组'
    const matchType = this.isFuzzy ? '模糊' : '精确'
    return this.reply(`❌ 删除错误：没有找到该${groupType}${matchType}词条`)
  }

  /** 消息列表 */
  async list() {
    this.isGlobal = this.e.msg.includes("全局")

    let page = 1
    let pageSize = 50
    let type = "list"

    await this.getGroupId()
    if (!this.group_id) return false

    await this.initMessageMap()

    let search = this.e.msg.replace(/^#(全局)?(消息|词条)/, "").trim()
    
    if (search === "列表") search = ""
    
    if (search.match(/^列表/)) {
      page = parseInt(search.replace(/^列表/, "")) || 1
    } else if (search && !search.includes("列表")) {
      type = "search"
    }

    const list = messageMap[this.group_id]
    if (!list?.size) return this.reply("暂无消息")

    const entries = []
    let num = 0
    
    for (let [k, v] of list) {
      const displayKey = k.startsWith('[模糊]') ? k.substring(4) + '(模糊)' : k
      if (type === "search" && !displayKey.includes(search)) continue
      entries.push({ key: displayKey, originalKey: k, val: v, num: ++num })
    }

    const count = entries.length
    if (!count) return this.reply(type === "search" ? `未找到包含"${search}"的消息` : "暂无消息")

    entries.reverse()

    let displayEntries = type === "list" ? this.pagination(page, pageSize, entries) : entries

    const msg = []
    const title = type === "search" 
      ? `【消息搜索】"${search}"，共${count}条`
      : `【消息列表】第${page}页，共${count}条`
    
    msg.push(title, '━━━━━━━━━━━━━━━')

    for (const entry of displayEntries) {
      msg.push(`${entry.num}. ${entry.key}${entry.val.length > 1 ? `(${entry.val.length}条回复)` : ''}`)
      
      for (let i = 0; i < entry.val.length && i < 3; i++) {
        const content = entry.val[i]
        if (Array.isArray(content)) {
          const preview = []
          for (const item of content) {
            if (item.type === 'text') preview.push(item.text.substring(0, 30) + (item.text.length > 30 ? '...' : ''))
            else if (item.type === 'image') preview.push('[图片]')
            else if (item.type === 'face') preview.push(`[表情:${item.id}]`)
            else preview.push(`[${item.type}]`)
          }
          
          if (preview.length) {
            const prefix = entry.val.length > 1 ? `   └─ 回复${i + 1}: ` : `   └─ `
            msg.push(`${prefix}${preview.join('')}`)
          }
        }
      }
      
      if (entry.val.length > 3) {
        msg.push(`   └─ ...还有 ${entry.val.length - 3} 条回复`)
      }
    }

    msg.push(
      '━━━━━━━━━━━━━━━',
      '【操作提示】',
      '删除词条：#删除[序号/关键词]',
      '删除模糊词条：#模糊删除[序号/关键词]',
      '添加词条：#添加[关键词]',
      '添加模糊词条：#模糊添加[关键词]',
      '搜索词条：#词条[关键词]'
    )
    
    if (type === "list" && count > pageSize) {
      const totalPages = Math.ceil(count / pageSize)
      msg.push(
        '━━━━━━━━━━━━━━━',
        `当前第${page}/${totalPages}页`
      )
      page < totalPages && msg.push(`查看下一页：#词条列表${page + 1}`)
      page > 1 && msg.push(`查看上一页：#词条列表${page - 1}`)
    }

    return this.reply(await Bot.makeForwardArray(msg))
  }

  /** 分页 */
  pagination(pageNo, pageSize, array) {
    const offset = (pageNo - 1) * pageSize
    return array.slice(offset, offset + pageSize)
  }
}