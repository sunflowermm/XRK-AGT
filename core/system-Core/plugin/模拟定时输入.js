import PluginsLoader from '#infrastructure/plugins/loader.js'

export class DailySignIn extends plugin {
    constructor() {
        super({
            name: '每日定时消息模拟',
            dsc: '每天12点模拟发送消息',
            event: 'onebot.message',
            priority: 5,
            rule: []
        })
        this.task = {
            name: '每日12点模拟消息发送',
            cron: '0 0 12 * * *',
            fnc: () => {
                this.sendDailyMessages()
            },
            log : false
        }
    }

    async sendDailyMessages() {
        const messages = ['#你是谁']
        for (const msg of messages) {
            const fakeMsgEvent = this.createMessageEvent(msg)
            await PluginsLoader.deal(fakeMsgEvent)
        }
    }

    createMessageEvent(inputMsg) {
        const user_id = 12345678
        const name = "模拟用户";
        const time = Math.floor(Date.now() / 1000);
        const self_id = Bot.uin.toString();

        return {
            tasker: "stdin",
            message_id: `test_${Date.now()}`,
            message_type: "private",
            post_type: "message",
            sub_type: "friend",
            self_id,
            seq: 888,
            time,
            uin: self_id,
            user_id,
            message: [{ type: "text", text: inputMsg }],
            raw_message: inputMsg,
            msg: inputMsg,
            isMaster: true,
            isStdin: true,
            bot: Bot.stdin || Bot[Bot.uin.toString()],
            toString: () => inputMsg,
            sender: {
                card: name,
                nickname: name,
                role: "master",
                user_id
            },
            member: {
                info: {
                    user_id,
                    nickname: name,
                    last_sent_time: time
                },
                getAvatarUrl: () => `https://q1.qlogo.cn/g?b=qq&s=0&nk=${user_id}`
            },
            reply: async (replyMsg) => {
                logger.info(`模拟回复：${JSON.stringify(replyMsg)}`)
                return { message_id: `test_${Date.now()}`, time }
            }
        }
    }
}