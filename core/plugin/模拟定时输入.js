import PluginsLoader from '../../lib/plugins/loader.js';

export class DailySignIn extends plugin {
    constructor() {
        super({
            name: '每日定时消息模拟',
            dsc: '每天12点模拟发送消息',
            event: 'message',
            priority: 5,
            rule: []
        });
        this.task = {
            name: '每日12点模拟消息发送',
            cron: '0 0 12 * * *',
            fnc: () => {
                this.sendDailyMessages();
            },
            log : false
        };
    }

    // 发送每日签到消息
    async sendDailyMessages() {
        const messages = ['#你是谁' ];
        for (const msg of messages) {
            const fakeMsgEvent = this.createMessageEvent(msg);
            await PluginsLoader.deal(fakeMsgEvent); // 处理模拟消息
        }
    }

    // 创建模拟消息事件对象
    createMessageEvent(inputMsg) {
        const user_id = 12345678 // 固定的发送者QQ号
        const name = "模拟用户";
        const time = Math.floor(Date.now() / 1000);
        const self_id = Bot.uin; // 接收者为Bot的QQ号

        return {
            adapter: "cmd",
            message_id: `test_${Date.now()}`,
            message_type: "private", // 模拟私聊消息
            post_type: "message",
            sub_type: "friend",
            self_id,
            seq: 888,
            time,
            uin: self_id,
            user_id, // 发送者QQ号
            message: [{ type: "text", text: inputMsg }],
            raw_message: inputMsg,
            isMaster: true,
            toString: () => inputMsg,
            sender: {
                card: name,
                nickname: name,
                role: "",
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
                try {
                    logger.info(`模拟回复：${JSON.stringify(replyMsg)}`);
                    return true;
                } catch (error) {
                    logger.error(`回复出错！: ${error.message}`);
                    return false;
                }
            }
        };
    }
}