import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class DocPipelineConfig extends ConfigBase {
  constructor() {
    super({
      name: 'doc-pipeline',
      displayName: '文档流水线',
      description: '子服 doc-pipeline：HTML/文本提取与 Markdown 转换',
      filePath: 'data/doc-pipeline/config.yaml',
      fileType: 'yaml',
      defaultTemplatePath: 'subserver/pyserver/apis/doc-pipeline/default_config.yaml',
      schema: {
        fields: {
          max_chars: { type: 'number', label: '输出最大字符数', min: 1000, default: 500000, component: 'InputNumber' },
          strip_scripts: { type: 'boolean', label: '剥离 script 标签', default: true, component: 'Switch' }
        }
      }
    });
  }
}
