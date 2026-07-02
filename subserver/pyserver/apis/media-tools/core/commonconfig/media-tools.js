import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class MediaToolsConfig extends ConfigBase {
  constructor() {
    super({
      name: 'media-tools',
      displayName: '媒体工具',
      description: '子服 media-tools：图片缩放、格式转换与缩略图',
      filePath: 'data/media-tools/config.yaml',
      fileType: 'yaml',
      defaultTemplatePath: 'subserver/pyserver/apis/media-tools/default_config.yaml',
      schema: {
        fields: {
          max_upload_mb: { type: 'number', label: '最大上传 (MB)', min: 1, default: 20, component: 'InputNumber' },
          jpeg_quality: { type: 'number', label: 'JPEG 质量', min: 1, max: 100, default: 85, component: 'InputNumber' },
          thumbnail_size: { type: 'number', label: '缩略图边长 (px)', min: 32, default: 320, component: 'InputNumber' },
          allowed_formats: {
            type: 'array',
            label: '允许格式',
            itemType: 'string',
            default: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
            component: 'Tags'
          }
        }
      }
    });
  }
}
