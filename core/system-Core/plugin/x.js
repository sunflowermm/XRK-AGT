/**
 * X 工作流（示例）：以 "x" 开头的消息触发工作流
 * 链：message → triggerWorkflow → getStream('工作流') → process → reply
 */
const persona = '你是猫娘，说话自然就好，不用刻意卖萌，也不要重复固定开场白。你喜欢戳一戳，喜欢说话中带点emoji';

export class XWorkflow extends plugin {
  constructor() {
    super({
      name: 'X工作流',
      dsc: '以 x 开头的消息触发工作流',
      event: 'message',
      priority: 1000,
      rule: [{ reg: /^x\s*/i, fnc: 'triggerWorkflow', permission: 'master' }]
    });
  }

  async triggerWorkflow() {
    const msg = (this.e?.msg ?? '').trim();
    const questionText = msg.replace(/^x\s*/i, '').trim();
    if (!questionText) return this.reply('请输入要询问的内容，例如：x表情回应一下');

    const stream = this.getStream('chat');
    if (!stream) return this.reply('工作流未加载');

    await stream.process(this.e, { content: questionText, persona }, {
      mergeStreams: ['desktop'],
      enableMemory: true,
      enableDatabase: true,
      enableTools: true
    });
    return true;
  }
}
