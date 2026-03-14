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
      // 注意：区分大小写，只有小写 "x" 才触发
      // 不再使用全局 permission 拦截，内部自行静默判断权限
      rule: [{ reg: /^x\s*/, fnc: 'triggerWorkflow' }]
    });
  }

  async triggerWorkflow() {
    // 仅主人可用：非主人静默返回，不回复“暂无权限”
    if (!this.e?.isMaster) return false;

    const msg = (this.e?.msg ?? '').trim();
    const questionText = msg.replace(/^x\s*/, '').trim();
    if (!questionText) return this.reply('请输入要询问的内容，例如：x表情回应一下');

    const stream = this.getStream('chat');
    if (!stream) return this.reply('工作流未加载');

    // 仅挂载 chat + desktop 工作流工具，不选远程 MCP（与接口一致：仅传声明的 streams）
    await stream.process(this.e, { content: questionText, persona }, {
      mergeStreams: ['desktop'],
      enableMemory: true,
      enableDatabase: true,
      enableTools: true
    });
    return true;
  }
}
