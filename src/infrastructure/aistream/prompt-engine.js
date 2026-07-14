/**
 * Prompt Engine — 轻量兼容面（可选模板）。
 * 业务主路径由各 stream.buildSystemPrompt / agent-workspace 负责；本模块无强制注册入口。
 */

export class PromptEngine {
  templates = new Map();

  /** @returns {object|null} */
  getTemplate(name) {
    return this.templates.get(name) || null;
  }

  /**
   * 简单 {{var}} 替换；无模板时抛错（调用方应先 getTemplate）
   */
  render(name, variables = {}) {
    const template = this.getTemplate(name);
    if (!template) {
      throw new Error(`Prompt模板 ${name} 不存在`);
    }
    let content = template.content || '';
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
    return content;
  }

  /** 可选：运行时注册（一般不需要） */
  registerTemplate(name, template = {}) {
    this.templates.set(name, {
      name,
      content: template.content || '',
      version: template.version || '1.0.0',
      metadata: template.metadata || {}
    });
  }
}

export default new PromptEngine();
