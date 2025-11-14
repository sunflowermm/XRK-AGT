/**
 * 设备管理器配置文件
 * 集中管理所有配置项，便于维护和扩展
 */

import cfg from '../../lib/config/config.js';

// ==================== AI配置 ====================
export const AI_CONFIG = {
    enabled: true,
    baseUrl: 'https://api.gptgod.online/v1',
    apiKey: 'sk-kXTC6vIMUnNrYIJhSmOpZMPZHDQuDYWCCIOHdh1qZmxpvqKC',
    chatModel: 'deepseek-r1-0528',
    temperature: 0.8,
    max_tokens: 2000,
    top_p: 0.9,
    presence_penalty: 0.6,
    frequency_penalty: 0.6,
    timeout: 30000,
    displayDelay: 1500,
    persona: '我是一个智能语音助手，可以听懂你说的话并做出回应。我会用简短的话语和表情与你交流。'
};

// ==================== 火山TTS配置（V3双向流式） ====================
export const VOLCENGINE_TTS_CONFIG = {
    enabled: true,
    provider: 'volcengine', // 服务提供商标识
    wsUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    appKey: '5231143210',
    accessKey: 'hSkG2n1yavXry2N3DtQeoTohvWp3qTrR',
    resourceId: 'seed-tts-2.0',
    voiceType: 'zh_female_vv_uranus_bigtts',
    encoding: 'pcm',
    sampleRate: 16000,
    speechRate: 5,
    loudnessRate: 0,
    emotion: 'happy',
    chunkMs: 128,
    chunkDelayMs: 5
};

// ==================== 火山ASR配置 ====================
export const VOLCENGINE_ASR_CONFIG = {
    enabled: true,
    provider: 'volcengine', // 服务提供商标识
    wsUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
    appKey: '5231143210',
    accessKey: 'hSkG2n1yavXry2N3DtQeoTohvWp3qTrR',
    resourceId: 'volc.bigasr.sauc.duration',
    enableItn: true,
    enablePunc: true,
    enableDdc: false,
    showUtterances: true,
    resultType: 'full',
    enableAccelerateText: true,
    accelerateScore: 15,
    persistentWs: true,
    idleCloseMs: 6000,
    endWindowSize: 350,
    forceToSpeechTime: 500,
    maxAudioBufferSize: 30,
    asrFinalTextWaitMs: 1200,
};

// ==================== 系统配置 ====================
export const SYSTEM_CONFIG = {
    heartbeatInterval: cfg.device?.heartbeat_interval || 30,
    heartbeatTimeout: cfg.device?.heartbeat_timeout || 180,
    commandTimeout: cfg.device?.command_timeout || 10000,
    maxDevices: cfg.device?.max_devices || 100,
    maxLogsPerDevice: cfg.device?.max_logs_per_device || 100,
    messageQueueSize: cfg.device?.message_queue_size || 100,
    wsPingIntervalMs: 30000,
    wsPongTimeoutMs: 10000,
    wsReconnectDelayMs: 2000,
    wsMaxReconnectAttempts: 5,
    enableDetailedLogs: true,
    enablePerformanceLogs: true,
    audioSaveDir: './data/wav'
};

// ==================== TTS事件定义 ====================
export const TTS_EVENTS = {
    START_CONNECTION: 1,
    FINISH_CONNECTION: 2,
    CONNECTION_STARTED: 50,
    CONNECTION_FAILED: 51,
    CONNECTION_FINISHED: 52,
    START_SESSION: 100,
    CANCEL_SESSION: 101,
    FINISH_SESSION: 102,
    SESSION_STARTED: 150,
    SESSION_CANCELED: 151,
    SESSION_FINISHED: 152,
    SESSION_FAILED: 153,
    TASK_REQUEST: 200,
    TTS_SENTENCE_START: 350,
    TTS_SENTENCE_END: 351,
    TTS_RESPONSE: 352
};

// ==================== 表情关键词映射 ====================
export const EMOTION_KEYWORDS = {
    '开心': 'happy',
    '伤心': 'sad',
    '生气': 'angry',
    '惊讶': 'surprise',
    '爱': 'love',
    '酷': 'cool',
    '睡觉': 'sleep',
    '思考': 'think',
    '眨眼': 'wink',
    '大笑': 'laugh'
};

// ==================== 支持的表情列表 ====================
export const SUPPORTED_EMOTIONS = [
    'happy', 'sad', 'angry', 'surprise', 'love',
    'cool', 'sleep', 'think', 'wink', 'laugh'
];