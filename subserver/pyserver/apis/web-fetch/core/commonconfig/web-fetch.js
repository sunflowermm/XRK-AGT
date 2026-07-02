import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class WebFetchConfig extends ConfigBase {
  constructor() {
    super({
      name: 'web-fetch',
      displayName: '网页抓取',
      description: '子服 web-fetch：网页抓取与本地缓存',
      filePath: 'data/web-fetch/config.yaml',
      fileType: 'yaml',
      defaultTemplatePath: 'subserver/pyserver/apis/web-fetch/default_config.yaml',
      schema: {
        fields: {
          timeout_sec: { type: 'number', label: '请求超时 (秒)', min: 5, default: 30, component: 'InputNumber' },
          cache_ttl_sec: { type: 'number', label: '缓存 TTL (秒)', min: 0, default: 3600, component: 'InputNumber' },
          max_body_bytes: { type: 'number', label: '响应体上限 (字节)', min: 1024, default: 2000000, component: 'InputNumber' },
          user_agent: {
            type: 'string',
            label: 'User-Agent',
            component: 'Input',
            default: 'XRK-AGT-subserver/1.1'
          }
        }
      }
    });
  }
}
