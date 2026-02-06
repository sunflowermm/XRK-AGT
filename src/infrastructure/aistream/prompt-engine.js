/**
 * Prompt Engine - Prompt管理系统
 * 负责Prompt模板管理、变量替换、Few-shot管理、版本控制等
 */
import BotUtil from '#utils/botutil.js';
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';

export class PromptEngine extends EventEmitter {
  constructor() {
    super();
    this.templates = new Map(); // templateName -> Template定义
    this.fewShotExamples = new Map(); // category -> Example列表
    this.promptVersions = new Map(); // templateName -> Version列表
    this.activeVersions = new Map(); // templateName -> 当前版本
  }

  /**
   * 注册Prompt模板
   * @param {string} name - 模板名称
   * @param {Object} template - 模板定义
   * @param {string} template.content - 模板内容
   * @param {Array} template.variables - 变量列表
   * @param {string} template.version - 版本号
   * @param {Object} template.metadata - 元数据
   */
  registerTemplate(name, template) {
    const templateDef = {
      name,
      content: template.content || '',
      variables: template.variables || [],
      version: template.version || '1.0.0',
      metadata: template.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.templates.set(name, templateDef);

    // 版本管理
    if (!this.promptVersions.has(name)) {
      this.promptVersions.set(name, []);
    }
    this.promptVersions.get(name).push(templateDef);
    this.activeVersions.set(name, templateDef.version);

    this.emit('template:registered', { name, template: templateDef });
    BotUtil.makeLog('info', `Prompt模板注册: ${name} v${templateDef.version}`, 'PromptEngine');
  }

  /**
   * 渲染Prompt
   * @param {string} name - 模板名称
   * @param {Object} variables - 变量值
   * @param {Object} options - 选项
   * @param {string} options.version - 指定版本（可选）
   * @returns {string}
   */
  render(name, variables = {}, options = {}) {
    const template = this.getTemplate(name, options.version);
    if (!template) {
      throw new Error(`Prompt模板 ${name} 不存在`);
    }

    let content = template.content;

    // 变量替换
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      content = content.replace(regex, String(value));
    }

    // 条件分支处理
    content = this.processConditionals(content, variables);

    // 循环处理
    content = this.processLoops(content, variables);

    return content;
  }

  /**
   * 获取模板
   * @param {string} name - 模板名称
   * @param {string} version - 版本号（可选）
   * @returns {Object|null}
   */
  getTemplate(name, version = null) {
    if (version) {
      const versions = this.promptVersions.get(name) || [];
      return versions.find(v => v.version === version) || null;
    }

    const activeVersion = this.activeVersions.get(name);
    if (activeVersion) {
      const versions = this.promptVersions.get(name) || [];
      return versions.find(v => v.version === activeVersion) || null;
    }

    return this.templates.get(name) || null;
  }

  /**
   * 添加Few-shot示例
   * @param {string} category - 分类
   * @param {Object} example - 示例
   * @param {string} example.input - 输入
   * @param {string} example.output - 输出
   */
  addFewShotExample(category, example) {
    if (!this.fewShotExamples.has(category)) {
      this.fewShotExamples.set(category, []);
    }

    this.fewShotExamples.get(category).push({
      ...example,
      createdAt: Date.now()
    });

    this.emit('fewshot:added', { category, example });
  }

  /**
   * 获取Few-shot示例
   * @param {string} category - 分类
   * @param {number} limit - 限制条数
   * @returns {Array}
   */
  getFewShotExamples(category, limit = 3) {
    const examples = this.fewShotExamples.get(category) || [];
    return examples.slice(0, limit);
  }

  /**
   * 构建完整Prompt（模板 + Few-shot + 上下文）
   * @param {string} templateName - 模板名称
   * @param {Object} variables - 变量
   * @param {Object} options - 选项
   * @param {string} options.fewShotCategory - Few-shot分类
   * @param {number} options.fewShotCount - Few-shot数量
   * @returns {string}
   */
  buildPrompt(templateName, variables = {}, options = {}) {
    let prompt = this.render(templateName, variables, options);

    // 添加Few-shot示例
    if (options.fewShotCategory) {
      const examples = this.getFewShotExamples(
        options.fewShotCategory,
        options.fewShotCount || 3
      );
      
      if (examples.length > 0) {
        const fewShotText = examples.map((ex, i) => 
          `示例 ${i + 1}:\n输入: ${ex.input}\n输出: ${ex.output}`
        ).join('\n\n');
        
        prompt = `${prompt}\n\n${fewShotText}`;
      }
    }

    return prompt;
  }

  /**
   * 设置模板版本
   * @param {string} name - 模板名称
   * @param {string} version - 版本号
   */
  setTemplateVersion(name, version) {
    const versions = this.promptVersions.get(name);
    if (!versions || !versions.find(v => v.version === version)) {
      throw new Error(`模板 ${name} 版本 ${version} 不存在`);
    }

    this.activeVersions.set(name, version);
    this.emit('template:version_changed', { name, version });
    BotUtil.makeLog('info', `Prompt模板版本切换: ${name} -> v${version}`, 'PromptEngine');
  }

  /**
   * 处理条件分支
   * @param {string} content - 内容
   * @param {Object} variables - 变量
   * @returns {string}
   */
  processConditionals(content, variables) {
    // 简单的条件处理：{{#if var}}content{{/if}}
    const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    return content.replace(ifRegex, (match, varName, content) => {
      return variables[varName] ? content : '';
    });
  }

  /**
   * 处理循环
   * @param {string} content - 内容
   * @param {Object} variables - 变量
   * @returns {string}
   */
  processLoops(content, variables) {
    // 简单的循环处理：{{#each array}}content{{/each}}
    const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return content.replace(eachRegex, (match, arrayName, template) => {
      const array = variables[arrayName];
      if (!Array.isArray(array)) return '';
      
      return array.map(item => {
        let result = template;
        for (const [key, value] of Object.entries(item)) {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
        }
        return result;
      }).join('\n');
    });
  }

  /**
   * 从文件加载模板
   * @param {string} filePath - 文件路径
   */
  async loadTemplateFromFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const name = path.basename(filePath, path.extname(filePath));
      
      // 简单的YAML格式解析
      const lines = content.split('\n');
      let templateContent = '';
      let variables = [];
      let version = '1.0.0';
      const metadata = {};

      let inContent = false;
      for (const line of lines) {
        if (line.startsWith('version:')) {
          version = line.split(':')[1].trim();
        } else if (line.startsWith('variables:')) {
          variables = line.split(':')[1].trim().split(',').map(v => v.trim());
        } else if (line.startsWith('---')) {
          inContent = !inContent;
        } else if (inContent) {
          templateContent += line + '\n';
        }
      }

      this.registerTemplate(name, {
        content: templateContent.trim(),
        variables,
        version,
        metadata: { source: filePath, ...metadata }
      });
    } catch (error) {
      BotUtil.makeLog('error', `加载Prompt模板失败: ${filePath} - ${error.message}`, 'PromptEngine');
    }
  }

  /**
   * 获取所有模板
   * @returns {Array}
   */
  getAllTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      templates: this.templates.size,
      versions: Array.from(this.promptVersions.values())
        .reduce((sum, versions) => sum + versions.length, 0),
      fewShotExamples: Array.from(this.fewShotExamples.values())
        .reduce((sum, examples) => sum + examples.length, 0)
    };
  }
}

export default new PromptEngine();
