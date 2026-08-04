import {
  resolveToolApproval,
  listPendingApprovals,
  parseApprovalCommand,
  isToolApprovalEnabled
} from '#utils/security/tool-approval.js'

/**
 * 主人审批危险工具。默认关闭（security.approval.enabled=false）。
 * 命令：#批准 / #批准id / #批准 id（空格可选）；拒绝同理。
 */
export class ToolApproval extends PluginBase {
  constructor() {
    super({
      name: '工具审批',
      dsc: '#批准 #拒绝 #待审批（危险指令；默认关）',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#(批准|approve)\\s*[A-Za-z0-9_-]*\\s*$', fnc: 'approve', permission: 'master' },
        { reg: '^#(拒绝|deny)\\s*[A-Za-z0-9_-]*\\s*$', fnc: 'deny', permission: 'master' },
        { reg: '^#待审批$', fnc: 'listPending', permission: 'master' }
      ]
    })
  }

  async approve() {
    if (!isToolApprovalEnabled()) {
      await this.reply('交互审批未开启（ai-workflow.security.approval.enabled，默认关）')
      return true
    }
    const parsed = parseApprovalCommand(this.e.msg, 'allow')
    const result = resolveToolApproval(parsed?.id || '', 'allow')
    if (result.ok) {
      await this.reply(`已批准 ${result.id}`)
    } else {
      await this.reply(result.error || '批准失败')
    }
    return true
  }

  async deny() {
    if (!isToolApprovalEnabled()) {
      await this.reply('交互审批未开启（ai-workflow.security.approval.enabled，默认关）')
      return true
    }
    const parsed = parseApprovalCommand(this.e.msg, 'deny')
    const result = resolveToolApproval(parsed?.id || '', 'deny')
    if (result.ok) {
      await this.reply(`已拒绝 ${result.id}`)
    } else {
      await this.reply(result.error || '拒绝失败')
    }
    return true
  }

  async listPending() {
    if (!isToolApprovalEnabled()) {
      await this.reply('交互审批未开启（默认关）。开启：security.approval.enabled=true')
      return true
    }
    const list = listPendingApprovals()
    if (!list.length) {
      await this.reply('当前无待审批')
      return true
    }
    const lines = list.map((m) => `- ${m.id}: ${m.toolName} — ${m.reason}`)
    await this.reply(
      `待审批（#批准${list[0].id} 或 #批准 ${list[0].id}；仅一条时可直接 #批准）：\n${lines.join('\n')}`
    )
    return true
  }
}
