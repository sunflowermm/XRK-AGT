import WebSocket from 'ws';
import BotUtil from '../../src/utils/botutil.js';
import StreamLoader from '../../src/infrastructure/aistream/loader.js';
import fs from 'fs';
import path from 'path';
import cfg from '../../src/infrastructure/config/config.js';

// ==================== 导入工具函数 ====================
import {
    initializeDirectories,
    validateDeviceRegistration,
    generateCommandId,
    hasCapability,
    getAudioFileList
} from '../../src/utils/deviceutil.js';

// ==================== 导入ASR和TTS工厂 ====================
import ASRFactory from '../../src/factory/asr/ASRFactory.js';
import TTSFactory from '../../src/factory/tts/TTSFactory.js';

const ensureConfig = (value, path) => {
    if (value === undefined || value === null) {
        throw new Error(`设备配置缺失: ${path}`);
    }
    return value;
};

const getAistreamConfig = () => ensureConfig(cfg.aistream, 'aistream');

const getLLMSettings = ({ workflow, persona } = {}) => {
    const section = ensureConfig(getAistreamConfig().llm, 'aistream.llm');
    const models = ensureConfig(section.models, 'aistream.llm.models');
    const key = workflow || section.defaultModel;
    const selected = ensureConfig(models[key], `aistream.llm.models.${key}`);

    return {
        enabled: section.enabled !== false,
        workflowKey: key,
        workflow: key,
        persona: persona ?? section.persona,
        displayDelay: section.displayDelay,
        ...section.defaults,
        ...selected
    };
};

const resolveProvider = (sectionName) => {
    const section = ensureConfig(getAistreamConfig()[sectionName], `aistream.${sectionName}`);
    if (section.enabled === false) {
        return { enabled: false };
    }
    const providers = ensureConfig(section.providers, `aistream.${sectionName}.providers`);
    const key = ensureConfig(section.defaultProvider, `aistream.${sectionName}.defaultProvider`);
    const providerConfig = ensureConfig(providers[key], `aistream.${sectionName}.providers.${key}`);
    return { enabled: true, provider: key, ...providerConfig };
};

const getTtsConfig = () => resolveProvider('tts');
const getAsrConfig = () => resolveProvider('asr');

const getSystemConfig = () =>
    ensureConfig(getAistreamConfig().device, 'aistream.device');

const getEmotionKeywords = () => {
    const emotions = ensureConfig(getAistreamConfig().emotions, 'aistream.emotions');
    return ensureConfig(emotions.keywords, 'aistream.emotions.keywords');
};

const getSupportedEmotions = () => {
    const emotions = ensureConfig(getAistreamConfig().emotions, 'aistream.emotions');
    return ensureConfig(emotions.supported, 'aistream.emotions.supported');
};

// ==================== 全局存储 ====================
const devices = new Map();
const deviceWebSockets = new Map();
const deviceLogs = new Map();
const deviceCommands = new Map();
const commandCallbacks = new Map();
const deviceStats = new Map();
const asrClients = new Map();
const ttsClients = new Map();
const asrSessions = new Map();

// ==================== 设备管理器类 ====================
class DeviceManager {
    constructor() {
        this.cleanupInterval = null;
        const systemConfig = getSystemConfig();
        this.AUDIO_SAVE_DIR = systemConfig.audioSaveDir;
        this.bot = null;
        this.initializeDirectories();
    }

    setBot(botInstance) {
        this.bot = botInstance;
    }

    getBot(override) {
        const runtime = override || this.bot;
        if (!runtime) {
            throw new Error('DeviceManager: Bot 实例未初始化');
        }
        return runtime;
    }

    /**
     * 初始化目录
     */
    initializeDirectories() {
        initializeDirectories([this.AUDIO_SAVE_DIR]);
    }

    /**
     * 获取ASR客户端（懒加载）
     * @param {string} deviceId - 设备ID
     * @returns {Object} ASR客户端
     * @private
     */
    _getASRClient(deviceId, config) {
        let client = asrClients.get(deviceId);
        if (!client || client.__provider !== config.provider) {
            client = ASRFactory.createClient(deviceId, config, this.getBot());
            client.__provider = config.provider;
            asrClients.set(deviceId, client);
        }
        return client;
    }

    /**
     * 获取TTS客户端（懒加载）
     * @param {string} deviceId - 设备ID
     * @returns {Object} TTS客户端
     * @private
     */
    _getTTSClient(deviceId, config) {
        let client = ttsClients.get(deviceId);
        if (!client || client.__provider !== config.provider) {
            client = TTSFactory.createClient(deviceId, config, this.getBot());
            client.__provider = config.provider;
            ttsClients.set(deviceId, client);
        }
        return client;
    }

    // ==================== ASR会话处理（优化版）====================

    /**
     * 处理ASR会话开始
     * @param {string} deviceId - 设备ID
     * @param {Object} data - 会话数据
     * @returns {Promise<Object>} 处理结果
     */
    async handleASRSessionStart(deviceId, data) {
        try {
            const { session_id, sample_rate, bits, channels, session_number } = data;
            const asrConfig = getAsrConfig();

            BotUtil.makeLog('info',
                `⚡ [ASR会话#${session_number}] 开始: ${session_id}`,
                deviceId
            );

            if (!asrConfig.enabled) {
                return { success: false, error: 'ASR未启用' };
            }

            asrSessions.set(session_id, {
                deviceId,
                sample_rate,
                bits,
                channels,
                sessionNumber: session_number,
                startTime: Date.now(),
                lastChunkTime: Date.now(),
                totalChunks: 0,
                totalBytes: 0,
                audioBuffers: [],
                asrStarted: false,
                endingChunks: 0,
                earlyEndSent: false,
                finalText: null,
                finalDuration: 0,
                finalTextSetAt: null
            });

            const client = this._getASRClient(deviceId, asrConfig);
            try {
                await client.beginUtterance(session_id, {
                    sample_rate,
                    bits,
                    channels
                });
                asrSessions.get(session_id).asrStarted = true;
            } catch (e) {
                BotUtil.makeLog('error',
                    `❌ [ASR] 启动utterance失败: ${e.message}`,
                    deviceId
                );
                return { success: false, error: e.message };
            }

            return { success: true, session_id };

        } catch (e) {
            BotUtil.makeLog('error',
                `❌ [ASR会话] 启动失败: ${e.message}`,
                deviceId
            );
            return { success: false, error: e.message };
        }
    }

    /**
     * 处理ASR音频块
     * @param {string} deviceId - 设备ID
     * @param {Object} data - 音频数据
     * @returns {Promise<Object>} 处理结果
     */
    async handleASRAudioChunk(deviceId, data) {
        try {
            const { session_id, chunk_index, data: audioHex, vad_state } = data;
            const asrConfig = getAsrConfig();

            if (!asrConfig.enabled) {
                return { success: false, error: 'ASR未启用' };
            }

            const session = asrSessions.get(session_id);
            if (!session) {
                return { success: false, error: '会话不存在' };
            }

            const audioBuf = Buffer.from(audioHex, 'hex');

            session.totalChunks++;
            session.totalBytes += audioBuf.length;
            session.lastChunkTime = Date.now();
            session.audioBuffers.push(audioBuf);

            if (session.asrStarted && (vad_state === 'active' || vad_state === 'ending')) {
                const client = this._getASRClient(deviceId, asrConfig);
                if (client.connected && client.currentUtterance && !client.currentUtterance.ending) {
                    client.sendAudio(audioBuf);

                    if (vad_state === 'ending') {
                        session.endingChunks = (session.endingChunks || 0) + 1;

                        if (session.endingChunks >= 2 && !session.earlyEndSent) {
                            session.earlyEndSent = true;

                            BotUtil.makeLog('info',
                                `⚡ [ASR] 检测到ending×${session.endingChunks}，提前结束`,
                                deviceId
                            );

                            setTimeout(async () => {
                                try {
                                    await client.endUtterance();
                                } catch (e) {
                                    BotUtil.makeLog('error',
                                        `❌ [ASR] 提前结束失败: ${e.message}`,
                                        deviceId
                                    );
                                }
                            }, 50);
                        }
                    } else {
                        session.endingChunks = 0;
                        session.earlyEndSent = false;
                    }
                }
            }

            return { success: true, received: chunk_index };

        } catch (e) {
            BotUtil.makeLog('error',
                `❌ [ASR] 处理音频块失败: ${e.message}`,
                deviceId
            );
            return { success: false, error: e.message };
        }
    }

    /**
     * 处理ASR会话停止（优化版 - 不等待最终文本）
     * @param {string} deviceId - 设备ID
     * @param {Object} data - 会话数据
     * @returns {Promise<Object>} 处理结果
     */
    async handleASRSessionStop(deviceId, data) {
        try {
            const { session_id, duration, session_number } = data;
            const asrConfig = getAsrConfig();

            BotUtil.makeLog('info',
                `✓ [ASR会话#${session_number}] 停止: ${session_id} (时长=${duration}s)`,
                deviceId
            );

            const session = asrSessions.get(session_id);
            if (!session) {
                return { success: true };
            }

            // 避免重复处理同一会话停止
            if (session.stopped) {
                return { success: true };
            }
            session.stopped = true;

            if (session.asrStarted && asrConfig.enabled) {
                const client = this._getASRClient(deviceId, asrConfig);

                if (!session.earlyEndSent) {
                    try {
                        await client.endUtterance();
                        BotUtil.makeLog('info',
                            `✓ [ASR会话#${session_number}] Utterance已结束`,
                            deviceId
                        );
                    } catch (e) {
                        BotUtil.makeLog('warn',
                            `⚠️ [ASR] 结束utterance失败: ${e.message}`,
                            deviceId
                        );
                    }
                }
            }

            // ⭐ 关键改进：异步等待最终文本，不阻塞流程
            this._waitForFinalTextAsync(deviceId, session);

            return { success: true };

        } catch (e) {
            BotUtil.makeLog('error',
                `❌ [ASR会话] 停止失败: ${e.message}`,
                deviceId
            );
            return { success: false, error: e.message };
        }
    }

    /**
     * 异步等待最终文本并处理AI（新增）
     * @param {string} deviceId - 设备ID
     * @param {Object} session - 会话对象
     * @private
     */
    async _waitForFinalTextAsync(deviceId, session) {
        const maxWaitMs = 3000;  // 最多等待3秒（减少等待时间）
        const checkIntervalMs = 50;
        let waitCount = 0;
        const maxChecks = Math.ceil(maxWaitMs / checkIntervalMs);

        while (!session.finalText && waitCount < maxChecks) {
            await new Promise(r => setTimeout(r, checkIntervalMs));
            waitCount++;
        }

        if (session.finalText) {
            const waitedMs = waitCount * checkIntervalMs;
            BotUtil.makeLog('info',
                `✅ [ASR最终] "${session.finalText}" (等待${waitedMs}ms)`,
                deviceId
            );

            // 将最终识别结果推送给前端设备
            try {
                const ws = deviceWebSockets.get(deviceId);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'asr_final',
                        device_id: deviceId,
                        session_id: session.session_id,
                        text: session.finalText
                    }));
                }
            } catch { }

            // 处理AI响应
            const aiSettings = getLLMSettings({ workflow: 'device' });
            if (aiSettings.enabled && session.finalText.trim()) {
                await this._processAIResponse(
                    deviceId,
                    session.finalText,
                    aiSettings.workflowKey,
                    aiSettings.persona
                );
            }
        } else {
            BotUtil.makeLog('warn',
                `⚠️ [ASR] 等待最终结果超时(${maxWaitMs}ms)`,
                deviceId
            );
            
            // 超时也要通知设备端，避免卡住
            await this._sendAIError(deviceId);
        }

        // 清理会话
        asrSessions.delete(session.session_id);
    }

    // ==================== AI处理 ====================

    /**
     * 处理AI响应
     * @param {string} deviceId - 设备ID
     * @param {string} question - 用户问题
     * @returns {Promise<void>}
     * @private
     */
    async _processAIResponse(deviceId, question, workflowName = 'device', personaOverride) {
        try {
            const startTime = Date.now();

            BotUtil.makeLog('info',
                `⚡ [AI] 开始处理: ${question.substring(0, 50)}${question.length > 50 ? '...' : ''}`,
                deviceId
            );

            const streamName = workflowName || 'device';
            const deviceStream = StreamLoader.getStream(streamName) || StreamLoader.getStream('device');
            if (!deviceStream) {
                BotUtil.makeLog('error', `❌ [AI] 工作流未加载: ${streamName}`, deviceId);
                await this._sendAIError(deviceId);
                return;
            }

            const runtimeBot = this.getBot();
            const deviceInfo = devices.get(deviceId);
            const deviceBot = runtimeBot[deviceId];

            if (!deviceBot) {
                BotUtil.makeLog('error', '❌ [AI] 设备Bot未找到', deviceId);
                await this._sendAIError(deviceId);
                return;
            }

            const streamConfig = getLLMSettings({ workflow: streamName, persona: personaOverride });
            if (!streamConfig.enabled) {
                BotUtil.makeLog('warn', '⚠️ [AI] 工作流已禁用', deviceId);
                await this._sendAIError(deviceId);
                return;
            }

            const aiResult = await deviceStream.execute(
                deviceId,
                question,
                streamConfig,
                deviceInfo || {},
                streamConfig.persona
            );

            if (!aiResult) {
                BotUtil.makeLog('warn', '⚠️ [AI] 工作流返回空结果', deviceId);
                await this._sendAIError(deviceId);
                return;
            }

            const aiTime = Date.now() - startTime;
            BotUtil.makeLog('info', `⚡ [AI性能] [${deviceStream.name}] 耗时: ${aiTime}ms`, deviceId);
            BotUtil.makeLog('info', `✅ [AI] 回复: ${aiResult.text || '(仅表情)'}`, deviceId);

            // 显示表情
            if (aiResult.emotion) {
                try {
                    const emotionKeywords = getEmotionKeywords();
                    const supportedEmotions = getSupportedEmotions();
                    let emotionCode = emotionKeywords[aiResult.emotion] || aiResult.emotion;
                    if (!supportedEmotions.includes(emotionCode)) {
                        throw new Error(`未知表情: ${aiResult.emotion}`);
                    }
                    await deviceBot.emotion(emotionCode);
                    BotUtil.makeLog('info', `✓ [设备] 表情: ${emotionCode}`, deviceId);
                } catch (e) {
                    BotUtil.makeLog('error', `❌ [设备] 表情显示失败: ${e.message}`, deviceId);
                }
                await new Promise(r => setTimeout(r, 500));
            }

            // 播放TTS
            const ttsConfig = getTtsConfig();
            if (aiResult.text && ttsConfig.enabled) {
                try {
                    const ttsClient = this._getTTSClient(deviceId, ttsConfig);
                    const success = await ttsClient.synthesize(aiResult.text);

                    if (success) {
                        BotUtil.makeLog('info', `🔊 [TTS] 语音合成已启动`, deviceId);
                    } else {
                        BotUtil.makeLog('error', `❌ [TTS] 语音合成失败`, deviceId);
                        await this._sendAIError(deviceId);
                    }
                } catch (e) {
                    BotUtil.makeLog('error', `❌ [TTS] 语音合成异常: ${e.message}`, deviceId);
                    await this._sendAIError(deviceId);
                }
            }

            // 显示文字
            if (aiResult.text) {
                try {
                    await deviceBot.display(aiResult.text, {
                        x: 0,
                        y: 0,
                        font_size: 16,
                        wrap: true,
                        spacing: 2
                    });
                    BotUtil.makeLog('info', `✓ [设备] 文字: ${aiResult.text}`, deviceId);
                } catch (e) {
                    BotUtil.makeLog('error', `❌ [设备] 文字显示失败: ${e.message}`, deviceId);
                }
            }

        } catch (e) {
            BotUtil.makeLog('error', `❌ [AI] 处理失败: ${e.message}`, deviceId);
            await this._sendAIError(deviceId);
        }
    }

    /**
     * 发送AI错误通知
     * @param {string} deviceId - 设备ID
     * @private
     */
    async _sendAIError(deviceId) {
        try {
            const runtimeBot = this.getBot();
            const deviceBot = runtimeBot[deviceId];
            if (deviceBot && deviceBot.sendCommand) {
                await deviceBot.sendCommand('ai_error', {}, 1);
            }
        } catch (e) {
            BotUtil.makeLog('error', `❌ [AI] 发送错误通知失败: ${e.message}`, deviceId);
        }
    }

    // ==================== 设备管理 ====================

    /**
     * 初始化设备统计
     * @param {string} deviceId - 设备ID
     * @returns {Object} 统计对象
     */
    initDeviceStats(deviceId) {
        const stats = {
            device_id: deviceId,
            connected_at: Date.now(),
            total_messages: 0,
            total_commands: 0,
            total_errors: 0,
            last_heartbeat: Date.now()
        };
        deviceStats.set(deviceId, stats);
        return stats;
    }

    /**
     * 更新设备统计
     * @param {string} deviceId - 设备ID
     * @param {string} type - 统计类型
     */
    updateDeviceStats(deviceId, type) {
        const stats = deviceStats.get(deviceId);
        if (!stats) return;

        if (type === 'message') stats.total_messages++;
        if (type === 'command') stats.total_commands++;
        if (type === 'error') stats.total_errors++;
        if (type === 'heartbeat') stats.last_heartbeat = Date.now();
    }

    /**
     * 添加设备日志
     * @param {string} deviceId - 设备ID
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Object} data - 附加数据
     * @returns {Object} 日志条目
     */
    addDeviceLog(deviceId, level, message, data = {}) {
        message = String(message).substring(0, 500);
        const systemConfig = getSystemConfig();

        const entry = {
            timestamp: Date.now(),
            level,
            message,
            data
        };

        const logs = deviceLogs.get(deviceId) || [];
        logs.unshift(entry);

        if (logs.length > systemConfig.maxLogsPerDevice) {
            logs.length = systemConfig.maxLogsPerDevice;
        }

        deviceLogs.set(deviceId, logs);

        const device = devices.get(deviceId);
        if (device?.stats && level === 'error') {
            device.stats.errors++;
            this.updateDeviceStats(deviceId, 'error');
        }

        if (level !== 'debug' || systemConfig.enableDetailedLogs) {
            BotUtil.makeLog(level,
                `[${device?.device_name || deviceId}] ${message}`,
                device?.device_name || deviceId
            );
        }

        return entry;
    }

    /**
     * 获取设备日志
     * @param {string} deviceId - 设备ID
     * @param {Object} filter - 过滤条件
     * @returns {Array} 日志列表
     */
    getDeviceLogs(deviceId, filter = {}) {
        let logs = deviceLogs.get(deviceId) || [];

        if (filter.level) {
            logs = logs.filter(l => l.level === filter.level);
        }

        if (filter.since) {
            const timestamp = new Date(filter.since).getTime();
            logs = logs.filter(l => l.timestamp >= timestamp);
        }

        if (filter.limit) {
            logs = logs.slice(0, filter.limit);
        }

        return logs;
    }

    /**
     * 注册设备
     * @param {Object} deviceData - 设备数据
     * @param {Object} Bot - Bot实例
     * @param {WebSocket} ws - WebSocket连接
     * @returns {Promise<Object>} 设备对象
     */
    async registerDevice(deviceData, Bot, ws) {
        const runtimeBot = this.getBot(Bot);
        const {
            device_id,
            device_type,
            device_name,
            capabilities = [],
            metadata = {},
            ip_address,
            firmware_version
        } = deviceData;

        const validation = validateDeviceRegistration(deviceData);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const existedDevice = devices.get(device_id);

        const device = {
            device_id,
            device_type,
            device_name: device_name || `${device_type}_${device_id}`,
            capabilities,
            metadata,
            ip_address,
            firmware_version,
            online: true,
            last_seen: Date.now(),
            registered_at: existedDevice?.registered_at || Date.now(),
            stats: existedDevice?.stats || {
                messages_sent: 0,
                messages_received: 0,
                commands_executed: 0,
                errors: 0,
                reconnects: existedDevice ? existedDevice.stats.reconnects + 1 : 0
            }
        };

        devices.set(device_id, device);

        if (!deviceLogs.has(device_id)) {
            deviceLogs.set(device_id, []);
        }

        if (!deviceStats.has(device_id)) {
            this.initDeviceStats(device_id);
        }

        if (ws) {
            this.setupWebSocket(device_id, ws);
        }

        if (!runtimeBot.uin.includes(device_id)) {
            runtimeBot.uin.push(device_id);
        }

        this.createDeviceBot(device_id, device, ws, runtimeBot);

        BotUtil.makeLog('info',
            `🟢 [设备上线] ${device.device_name} (${device_id}) - IP: ${ip_address}`,
            device.device_name
        );

        runtimeBot.em('device.online', {
            post_type: 'device',
            event_type: 'online',
            device_id,
            device_type,
            device_name: device.device_name,
            capabilities,
            self_id: device_id,
            time: Math.floor(Date.now() / 1000)
        });

        return device;
    }

    /**
     * 设置WebSocket连接
     * @param {string} deviceId - 设备ID
     * @param {WebSocket} ws - WebSocket实例
     */
    setupWebSocket(deviceId, ws) {
        const oldWs = deviceWebSockets.get(deviceId);
        if (oldWs && oldWs !== ws) {
            clearInterval(oldWs.heartbeatTimer);
            try {
                if (oldWs.readyState === 1) {
                    oldWs.close();
                } else {
                    oldWs.terminate();
                }
            } catch (e) {
                // 忽略错误
            }
        }

        ws.device_id = deviceId;
        ws.isAlive = true;
        ws.lastPong = Date.now();
        ws.messageQueue = [];

        const systemConfig = getSystemConfig();
        ws.heartbeatTimer = setInterval(() => {
            if (!ws.isAlive) {
                this.handleDeviceDisconnect(deviceId, ws);
                return;
            }

            ws.isAlive = false;

            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({
                        type: 'heartbeat_request',
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    // 忽略错误
                }
            }
        }, systemConfig.heartbeatInterval * 1000);

        ws.on('pong', () => {
            ws.isAlive = true;
            ws.lastPong = Date.now();
            this.updateDeviceStats(deviceId, 'heartbeat');
        });

        ws.on('error', (error) => {
            BotUtil.makeLog('error',
                `❌ [WebSocket错误] ${error.message}`,
                deviceId
            );
        });

        deviceWebSockets.set(deviceId, ws);
    }

    /**
     * 处理设备断开连接
     * @param {string} deviceId - 设备ID
     * @param {WebSocket} ws - WebSocket实例
     */
    handleDeviceDisconnect(deviceId, ws) {
        clearInterval(ws.heartbeatTimer);

        const device = devices.get(deviceId);
        const runtimeBot = this.bot;
        if (device) {
            device.online = false;

            BotUtil.makeLog('info',
                `🔴 [设备离线] ${device.device_name} (${deviceId})`,
                device.device_name
            );

            if (runtimeBot) {
                runtimeBot.em('device.offline', {
                    post_type: 'device',
                    event_type: 'offline',
                    device_id: deviceId,
                    device_type: device.device_type,
                    device_name: device.device_name,
                    self_id: deviceId,
                    time: Math.floor(Date.now() / 1000)
                });
            }
        }

        deviceWebSockets.delete(deviceId);
    }

    /**
     * 创建设备Bot实例
     * @param {string} deviceId - 设备ID
     * @param {Object} deviceInfo - 设备信息
     * @param {WebSocket} ws - WebSocket实例
     * @returns {Object} Bot实例
     */
    createDeviceBot(deviceId, deviceInfo, ws, botOverride) {
        const runtimeBot = this.getBot(botOverride);
        // 确保设备名称，Web客户端使用友好名称
        const deviceName = deviceInfo.device_type === 'web' 
          ? 'Web客户端' 
          : (deviceInfo.device_name || `${deviceInfo.device_type}_${deviceId}`);
        
        runtimeBot[deviceId] = {
            adapter: this,
            ws,
            uin: deviceId,
            nickname: deviceName,
            avatar: null,
            info: {
                ...deviceInfo,
                device_name: deviceName
            },
            device_type: deviceInfo.device_type,
            capabilities: deviceInfo.capabilities || [],
            metadata: deviceInfo.metadata || {},
            online: true,
            last_seen: Date.now(),
            stats: {
                messages_sent: 0,
                messages_received: 0,
                commands_executed: 0,
                errors: 0,
                reconnects: 0
            },

            addLog: (level, message, data = {}) =>
                this.addDeviceLog(deviceId, level, message, data),

            getLogs: (filter = {}) => this.getDeviceLogs(deviceId, filter),

            clearLogs: () => deviceLogs.set(deviceId, []),

            sendMsg: async (msg) => {
                const emotionKeywords = getEmotionKeywords();
                for (const [keyword, emotion] of Object.entries(emotionKeywords)) {
                    if (msg.includes(keyword)) {
                        return await this.sendCommand(
                            deviceId,
                            'display_emotion',
                            { emotion },
                            1
                        );
                    }
                }

                return await this.sendCommand(
                    deviceId,
                    'display',
                    {
                        text: msg,
                        x: 0,
                        y: 0,
                        font_size: 16,
                        wrap: true,
                        spacing: 2
                    },
                    1
                );
            },

            sendCommand: async (cmd, params = {}, priority = 0) =>
                await this.sendCommand(deviceId, cmd, params, priority),

            sendAudioChunk: (hex) => {
                const ws = deviceWebSockets.get(deviceId);
                if (ws && ws.readyState === WebSocket.OPEN && typeof hex === 'string' && hex.length > 0) {
                    const cmd = {
                        command: 'play_tts_audio',
                        parameters: { audio_data: hex },
                        priority: 1,
                        timestamp: Date.now()
                    };
                    try {
                        ws.send(JSON.stringify({ type: 'command', command: cmd }));
                    } catch (e) { }
                }
            },

            display: async (text, options = {}) =>
                await this.sendCommand(
                    deviceId,
                    'display',
                    {
                        text,
                        x: options.x || 0,
                        y: options.y || 0,
                        font_size: options.font_size || 16,
                        wrap: options.wrap !== false,
                        spacing: options.spacing || 2
                    },
                    1
                ),

            emotion: async (emotionName) => {
                const supportedEmotions = getSupportedEmotions();
                if (!supportedEmotions.includes(emotionName)) {
                    throw new Error(`未知表情: ${emotionName}`);
                }
                return await this.sendCommand(
                    deviceId,
                    'display_emotion',
                    { emotion: emotionName },
                    1
                );
            },

            clear: async () =>
                await this.sendCommand(deviceId, 'display_clear', {}, 1),

            camera: {
                startStream: async (options = {}) =>
                    await this.sendCommand(deviceId, 'camera_start_stream', {
                        fps: options.fps || 10,
                        quality: options.quality || 12,
                        resolution: options.resolution || 'VGA'
                    }, 1),
                stopStream: async () =>
                    await this.sendCommand(deviceId, 'camera_stop_stream', {}, 1),
                capture: async () =>
                    await this.sendCommand(deviceId, 'camera_capture', {}, 1),
            },

            microphone: {
                getStatus: async () =>
                    await this.sendCommand(deviceId, 'microphone_status', {}, 0),
                start: async () =>
                    await this.sendCommand(deviceId, 'microphone_start', {}, 1),
                stop: async () =>
                    await this.sendCommand(deviceId, 'microphone_stop', {}, 1),
            },

            reboot: async () =>
                await this.sendCommand(deviceId, 'reboot', {}, 99),

            hasCapability: (cap) => hasCapability(deviceInfo, cap),

            getStatus: () => {
                const device = devices.get(deviceId);
                return {
                    device_id: deviceId,
                    device_name: deviceInfo.device_name,
                    device_type: deviceInfo.device_type,
                    online: device?.online || false,
                    last_seen: device?.last_seen,
                    capabilities: deviceInfo.capabilities,
                    metadata: deviceInfo.metadata,
                    stats: device?.stats || runtimeBot[deviceId].stats
                };
            },

            getStats: () =>
                deviceStats.get(deviceId) || this.initDeviceStats(deviceId)
        };

        return runtimeBot[deviceId];
    }

    /**
     * 发送命令到设备
     * @param {string} deviceId - 设备ID
     * @param {string} command - 命令名称
     * @param {Object} parameters - 命令参数
     * @param {number} priority - 优先级
     * @returns {Promise<Object>} 命令结果
     */
    async sendCommand(deviceId, command, parameters = {}, priority = 0) {
        const device = devices.get(deviceId);
        if (!device) {
            throw new Error('设备未找到');
        }

        const systemConfig = getSystemConfig();

        const cmd = {
            id: generateCommandId(),
            command,
            parameters,
            priority,
            timestamp: Date.now()
        };

        this.updateDeviceStats(deviceId, 'command');

        const ws = deviceWebSockets.get(deviceId);

        if (ws && ws.readyState === WebSocket.OPEN) {
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    commandCallbacks.delete(cmd.id);
                    resolve({ success: true, command_id: cmd.id, timeout: true });
                }, systemConfig.commandTimeout);

                commandCallbacks.set(cmd.id, (result) => {
                    clearTimeout(timeout);
                    resolve({ success: true, command_id: cmd.id, result });
                });

                try {
                    ws.send(JSON.stringify({ type: 'command', command: cmd }));
                    device.stats.commands_executed++;
                } catch (e) {
                    clearTimeout(timeout);
                    commandCallbacks.delete(cmd.id);
                    resolve({ success: false, command_id: cmd.id, error: e.message });
                }
            });
        }

        const queue = deviceCommands.get(deviceId) || [];
        if (priority > 0) {
            queue.unshift(cmd);
        } else {
            queue.push(cmd);
        }

        if (queue.length > systemConfig.messageQueueSize) {
            queue.length = systemConfig.messageQueueSize;
        }

        deviceCommands.set(deviceId, queue);
        device.stats.commands_executed++;

        return { success: true, command_id: cmd.id, queued: queue.length };
    }

    /**
     * 处理设备事件
     * @param {string} deviceId - 设备ID
     * @param {string} eventType - 事件类型
     * @param {Object} eventData - 事件数据
     * @param {Object} Bot - Bot实例
     * @returns {Promise<Object>} 处理结果
     */
    async processDeviceEvent(deviceId, eventType, eventData = {}, Bot) {
        const runtimeBot = this.getBot(Bot);
        try {
            if (!devices.has(deviceId)) {
                if (eventType === 'register') {
                    return await this.registerDevice(
                        { device_id: deviceId, ...eventData },
                        runtimeBot
                    );
                }
                return { success: false, error: '设备未注册' };
            }

            const device = devices.get(deviceId);
            device.last_seen = Date.now();
            device.online = true;
            device.stats.messages_received++;

            this.updateDeviceStats(deviceId, 'message');

            switch (eventType) {
                case 'log': {
                    const { level = 'info', message, data: logData } = eventData;
                    this.addDeviceLog(deviceId, level, message, logData);
                    break;
                }

                case 'command_result': {
                    const { command_id, result } = eventData;
                    const callback = commandCallbacks.get(command_id);
                    if (callback) {
                        callback(result);
                        commandCallbacks.delete(command_id);
                    }
                    break;
                }

                case 'asr_session_start':
                    return await this.handleASRSessionStart(deviceId, eventData);

                case 'asr_audio_chunk':
                    return await this.handleASRAudioChunk(deviceId, eventData);

                case 'asr_session_stop':
                    return await this.handleASRSessionStop(deviceId, eventData);

                default:
                    runtimeBot.em(`device.${eventType}`, {
                        post_type: 'device',
                        event_type: eventType,
                        device_id: deviceId,
                        device_type: device.device_type,
                        device_name: device.device_name,
                        event_data: eventData,
                        self_id: deviceId,
                        time: Math.floor(Date.now() / 1000)
                    });
            }

            return { success: true };

        } catch (e) {
            this.updateDeviceStats(deviceId, 'error');
            return { success: false, error: e.message };
        }
    }

    /**
     * 处理WebSocket消息
     * @param {WebSocket} ws - WebSocket实例
     * @param {Object} data - 消息数据
     * @param {Object} Bot - Bot实例
     * @returns {Promise<void>}
     */
    async processWebSocketMessage(ws, data, Bot) {
        const runtimeBot = this.getBot(Bot);
        try {
            const { type, device_id, ...payload } = data;
            const deviceId = device_id || ws.device_id || 'unknown';

            if (type !== 'heartbeat' && type !== 'asr_audio_chunk') {
                BotUtil.makeLog('info',
                    `📨 [WebSocket] 收到消息: type="${type}", device_id="${deviceId}"`,
                    deviceId
                );
            }

            if (!type) {
                BotUtil.makeLog('error',
                    `❌ [WebSocket] 消息格式错误，缺少type字段`,
                    deviceId
                );
                ws.send(JSON.stringify({
                    type: 'error',
                    message: '消息格式错误：缺少type字段'
                }));
                return;
            }

            switch (type) {
                case 'register': {
                    BotUtil.makeLog('info', `🔌 [WebSocket] 设备注册请求`, deviceId);
                    const device = await this.registerDevice(
                        { device_id: deviceId, ...payload },
                        runtimeBot,
                        ws
                    );
                    ws.send(JSON.stringify({
                        type: 'register_response',
                        success: true,
                        device
                    }));
                    break;
                }

                case 'event':
                case 'data': {
                    const eventType = payload.data_type || payload.event_type || type;
                    const eventData = payload.data || payload.event_data || payload;
                    await this.processDeviceEvent(deviceId, eventType, eventData, runtimeBot);
                    break;
                }

                case 'asr_session_start':
                case 'asr_audio_chunk':
                case 'asr_session_stop':
                    await this.processDeviceEvent(deviceId, type, payload, runtimeBot);
                    break;

                case 'log': {
                    const { level = 'info', message, data: logData } = payload;
                    this.addDeviceLog(deviceId, level, message, logData);
                    break;
                }

                case 'heartbeat': {
                    ws.isAlive = true;
                    ws.lastPong = Date.now();

                    const device = devices.get(deviceId);
                    if (device) {
                        device.last_seen = Date.now();
                        device.online = true;
                        if (payload.status) {
                            device.status = payload.status;
                        }
                    }

                    this.updateDeviceStats(deviceId, 'heartbeat');

                    const queued = deviceCommands.get(deviceId) || [];
                    const toSend = queued.splice(0, 3);

                    ws.send(JSON.stringify({
                        type: 'heartbeat_response',
                        commands: toSend,
                        timestamp: Date.now()
                    }));
                    break;
                }

                case 'command_result':
                    await this.processDeviceEvent(deviceId, type, payload, runtimeBot);
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `未知消息类型: ${type}`
                    }));
            }
        } catch (e) {
            BotUtil.makeLog('error',
                `❌ [WebSocket] 处理消息失败: ${e.message}`,
                ws.device_id
            );
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: e.message
                }));
            } catch (sendErr) {
                // 忽略发送错误
            }
        }
    }

    /**
     * 检查离线设备
     * @param {Object} Bot - Bot实例
     */
    checkOfflineDevices(Bot) {
        const runtimeBot = this.getBot(Bot);
        const systemConfig = getSystemConfig();
        const timeout = systemConfig.heartbeatTimeout * 1000;
        const now = Date.now();

        for (const [id, device] of devices) {
            if (device.online && now - device.last_seen > timeout) {
                const ws = deviceWebSockets.get(id);

                if (ws) {
                    this.handleDeviceDisconnect(id, ws);
                } else {
                    device.online = false;

                    BotUtil.makeLog('info',
                        `🔴 [设备离线] ${device.device_name} (${id})`,
                        device.device_name
                    );

                    runtimeBot.em('device.offline', {
                        post_type: 'device',
                        event_type: 'offline',
                        device_id: id,
                        device_type: device.device_type,
                        device_name: device.device_name,
                        self_id: id,
                        time: Math.floor(Date.now() / 1000)
                    });
                }
            }
        }
    }

    /**
     * 获取设备列表
     * @returns {Array} 设备列表
     */
    getDeviceList() {
        return Array.from(devices.values()).map(d => ({
            device_id: d.device_id,
            device_name: d.device_name,
            device_type: d.device_type,
            online: d.online,
            last_seen: d.last_seen,
            capabilities: d.capabilities,
            stats: d.stats
        }));
    }

    /**
     * 获取设备信息
     * @param {string} deviceId - 设备ID
     * @returns {Object|null} 设备信息
     */
    getDevice(deviceId) {
        const device = devices.get(deviceId);
        if (!device) return null;

        return {
            ...device,
            device_stats: deviceStats.get(deviceId)
        };
    }
}

// ==================== 创建设备管理器实例 ====================
const deviceManager = new DeviceManager();

// ==================== 导出模块 ====================
export default {
    name: 'device',
    dsc: '设备管理API v31.0 - 连续对话优化版',
    priority: 90,

    routes: [
        {
            method: 'POST',
            path: '/api/device/register',
            handler: async (req, res, Bot) => {
                try {
                    const device = await deviceManager.registerDevice(
                        {
                            ...req.body,
                            ip_address: req.ip || req.socket.remoteAddress
                        },
                        Bot
                    );
                    res.json({ success: true, device_id: device.device_id });
                } catch (e) {
                    res.status(400).json({ success: false, message: e.message });
                }
            }
        },

        {
            method: 'POST',
            path: '/api/device/:deviceId/ai',
            handler: async (req, res, Bot) => {
                try {
                    const deviceId = req.params.deviceId;
                    const { text, workflow, persona } = req.body || {};
                    if (!text || !String(text).trim()) {
                        return res.status(400).json({ success: false, message: '缺少文本内容' });
                    }
                    const device = deviceManager.getDevice(deviceId);
                    if (!device) {
                        return res.status(404).json({ success: false, message: '设备未找到' });
                    }
                    const workflowName = (workflow || 'device').toString().trim() || 'device';
                    const aiSettings = getLLMSettings({ workflow: workflowName, persona });
                    if (!aiSettings.enabled) {
                        return res.status(400).json({ success: false, message: 'AI未启用' });
                    }
                    const personaConfig = persona ?? aiSettings.persona;
                    await deviceManager._processAIResponse(deviceId, String(text), workflowName, personaConfig);
                    return res.json({ success: true });
                } catch (e) {
                    return res.status(500).json({ success: false, message: e.message });
                }
            }
        },

        {
            method: 'GET',
            path: '/api/devices',
            handler: async (req, res) => {
                const list = deviceManager.getDeviceList();
                res.json({ success: true, devices: list, count: list.length });
            }
        },

        {
            method: 'GET',
            path: '/api/device/:deviceId',
            handler: async (req, res) => {
                const device = deviceManager.getDevice(req.params.deviceId);
                if (device) {
                    res.json({ success: true, device });
                } else {
                    res.status(404).json({ success: false, message: '设备未找到' });
                }
            }
        },

        {
            method: 'GET',
            path: '/api/device/:deviceId/asr/sessions',
            handler: async (req, res) => {
                const sessions = Array.from(asrSessions.entries())
                    .filter(([_, s]) => s.deviceId === req.params.deviceId)
                    .map(([sid, s]) => ({
                        session_id: sid,
                        device_id: s.deviceId,
                        session_number: s.sessionNumber,
                        total_chunks: s.totalChunks,
                        total_bytes: s.totalBytes,
                        started_at: s.startTime,
                        elapsed: ((Date.now() - s.startTime) / 1000).toFixed(1),
                    }));

                res.json({ success: true, sessions, count: sessions.length });
            }
        },

        {
            method: 'GET',
            path: '/api/device/:deviceId/asr/recordings',
            handler: async (req, res) => {
                try {
                    const recordings = await getAudioFileList(
                        deviceManager.AUDIO_SAVE_DIR,
                        req.params.deviceId
                    );

                    res.json({
                        success: true,
                        recordings,
                        count: recordings.length,
                        total_size: recordings.reduce((s, r) => s + r.size, 0)
                    });
                } catch (e) {
                    res.status(500).json({ success: false, message: e.message });
                }
            }
        },

        {
            method: 'GET',
            path: '/api/asr/recording/:filename',
            handler: async (req, res) => {
                try {
                    const filename = req.params.filename;

                    if (!filename.endsWith('.wav') || filename.includes('..')) {
                        return res.status(400).json({
                            success: false,
                            message: '无效的文件名'
                        });
                    }

                    const filepath = path.join(deviceManager.AUDIO_SAVE_DIR, filename);

                    if (!fs.existsSync(filepath)) {
                        return res.status(404).json({
                            success: false,
                            message: '文件不存在'
                        });
                    }

                    res.setHeader('Content-Type', 'audio/wav');
                    res.setHeader(
                        'Content-Disposition',
                        `attachment; filename="${filename}"`
                    );

                    fs.createReadStream(filepath).pipe(res);
                } catch (e) {
                    res.status(500).json({ success: false, message: e.message });
                }
            }
        },
    ],

    ws: {
        device: [
            (ws, req, Bot) => {
                BotUtil.makeLog('info',
                    `🔌 [WebSocket] 新连接: ${req.socket.remoteAddress}`,
                    'DeviceManager'
                );

                ws.on('message', msg => {
                    try {
                        const data = JSON.parse(msg);
                        deviceManager.processWebSocketMessage(ws, data, Bot);
                    } catch (e) {
                        BotUtil.makeLog('error',
                            `❌ [WebSocket] 消息解析失败: ${e.message}`,
                            ws.device_id
                        );
                    }
                });

                ws.on('close', () => {
                    if (ws.device_id) {
                        deviceManager.handleDeviceDisconnect(ws.device_id, ws);
                    } else {
                        BotUtil.makeLog('info',
                            `✓ [WebSocket] 连接关闭: ${req.socket.remoteAddress}`,
                            'DeviceManager'
                        );
                    }
                });

                ws.on('error', (e) => {
                    BotUtil.makeLog('error',
                        `❌ [WebSocket] 错误: ${e.message}`,
                        ws.device_id || 'unknown'
                    );
                });
            }
        ]
    },

    init(app, Bot) {
        deviceManager.setBot(Bot);
        StreamLoader.configureEmbedding({
            enabled: false
        });

        deviceManager.cleanupInterval = setInterval(() => {
            deviceManager.checkOfflineDevices();
        }, 30000);

        setInterval(() => {
            const now = Date.now();
            for (const [id, _] of commandCallbacks) {
                const timestamp = parseInt(id.split('_')[0]);
                if (now - timestamp > 60000) {
                    commandCallbacks.delete(id);
                }
            }
        }, 60000);

        setInterval(() => {
            const now = Date.now();
            for (const [sessionId, session] of asrSessions) {
                if (now - session.lastChunkTime > 5 * 60 * 1000) {
                    try {
                        const client = asrClients.get(session.deviceId);
                        if (client) {
                            client.endUtterance().catch(() => { });
                        }
                    } catch (e) {
                        // 忽略错误
                    }
                    asrSessions.delete(sessionId);
                }
            }
        }, 5 * 60 * 1000);

        // 订阅ASR结果事件：更新会话finalText并转发中间结果到前端
        try {
            const runtimeBot = deviceManager.getBot();
            runtimeBot.on('device', (e) => {
                try {
                    if (!e || e.event_type !== 'asr_result') return;
                    const deviceId = e.device_id;
                    const sessionId = e.session_id;
                    const text = e.text || '';
                    const isFinal = !!e.is_final;
                    const duration = e.duration || 0;
                    const session = asrSessions.get(sessionId);
                    if (session && session.deviceId === deviceId) {
                        if (isFinal) {
                            session.finalText = text;
                            session.finalDuration = duration;
                            session.finalTextSetAt = Date.now();
                            // 立即将最终结果推送给前端
                            const ws = deviceWebSockets.get(deviceId);
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'asr_final',
                                    device_id: deviceId,
                                    session_id: sessionId,
                                    text
                                }));
                            }
                        } else if (text) {
                            // 中间结果实时转发到webclient
                            const ws = deviceWebSockets.get(deviceId);
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'asr_interim',
                                    device_id: deviceId,
                                    session_id: sessionId,
                                    text
                                }));
                            }
                        }
                    }
                } catch { }
            });
        } catch { }
    },

    destroy() {
        if (deviceManager.cleanupInterval) {
            clearInterval(deviceManager.cleanupInterval);
        }

        for (const [id, ws] of deviceWebSockets) {
            try {
                clearInterval(ws.heartbeatTimer);
                if (ws.readyState === 1) {
                    ws.close();
                } else {
                    ws.terminate();
                }
            } catch (e) {
                // 忽略错误
            }
        }

        for (const [deviceId, client] of asrClients) {
            try {
                client.destroy();
            } catch (e) {
                // 忽略错误
            }
        }

        for (const [deviceId, client] of ttsClients) {
            try {
                client.destroy();
            } catch (e) {
                // 忽略错误
            }
        }

        asrSessions.clear();
    }
};