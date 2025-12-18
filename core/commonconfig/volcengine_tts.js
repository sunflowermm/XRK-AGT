import ConfigBase from '../../src/infrastructure/commonconfig/commonconfig.js';

/**
 * 火山引擎 TTS 工厂配置管理
 * 管理火山引擎语音合成（TTS）相关配置
 * 支持前端编辑，配置文件位于 data/server_bots/{port}/volcengine_tts.yaml
 */
export default class VolcengineTTSConfig extends ConfigBase {
  constructor() {
    super({
      name: 'volcengine_tts',
      displayName: '火山引擎 TTS 工厂配置',
      description: '火山引擎文本转语音（TTS）配置',
      filePath: (cfg) => {
        const port = cfg?._port ?? cfg?.server?.server?.port;
        if (!port) {
          throw new Error(`VolcengineTTSConfig: 未提供端口，无法解析路径`);
        }
        return `data/server_bots/${port}/volcengine_tts.yaml`;
      },
      fileType: 'yaml',
      schema: {
        fields: {
          // WebSocket 连接配置
          wsUrl: {
            type: 'string',
            label: 'WebSocket 地址',
            description: '火山引擎 TTS WebSocket 服务地址',
            default: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
            component: 'Input'
          },
          appKey: {
            type: 'string',
            label: 'App Key',
            description: '火山引擎应用 Key',
            default: '',
            component: 'Input'
          },
          accessKey: {
            type: 'string',
            label: 'Access Key',
            description: '火山引擎访问密钥',
            default: '',
            component: 'InputPassword'
          },
          resourceId: {
            type: 'string',
            label: '资源 ID',
            description: '火山引擎 TTS 资源 ID',
            default: 'seed-tts-2.0',
            component: 'Input'
          },
          
          // 语音参数配置
          voiceType: {
            type: 'string',
            label: '声音类型',
            description: 'TTS 声音类型（如 zh_female_vv_uranus_bigtts）',
            default: 'zh_female_vv_uranus_bigtts',
            component: 'Input'
          },
          encoding: {
            type: 'string',
            label: '音频编码',
            description: '音频编码格式（pcm、mp3 等）',
            enum: ['pcm', 'mp3', 'wav'],
            default: 'pcm',
            component: 'Select'
          },
          sampleRate: {
            type: 'number',
            label: '采样率',
            description: '音频采样率（Hz）',
            enum: [8000, 16000, 24000, 44100, 48000],
            default: 16000,
            component: 'Select'
          },
          
          // 语音效果配置
          speechRate: {
            type: 'number',
            label: '语速',
            description: '语音播放速度（-500 到 500）',
            min: -500,
            max: 500,
            default: 5,
            component: 'InputNumber'
          },
          loudnessRate: {
            type: 'number',
            label: '音量',
            description: '语音音量（-500 到 500）',
            min: -500,
            max: 500,
            default: 0,
            component: 'InputNumber'
          },
          emotion: {
            type: 'string',
            label: '情绪',
            description: '语音情绪类型（如 happy、sad、neutral）',
            enum: ['happy', 'sad', 'neutral', 'angry', 'surprise'],
            default: 'happy',
            component: 'Select'
          },
          
          // 分片配置
          chunkMs: {
            type: 'number',
            label: '分片时长 (ms)',
            description: '音频分片时长（毫秒）',
            min: 1,
            default: 128,
            component: 'InputNumber'
          },
          chunkDelayMs: {
            type: 'number',
            label: '分片延迟 (ms)',
            description: '分片之间的延迟时间（毫秒）',
            min: 0,
            default: 5,
            component: 'InputNumber'
          }
        }
      }
    });
  }
}

