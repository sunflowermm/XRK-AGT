/**
 * 火山引擎TTS客户端（V3双向流式协议）
 * 实现文本转语音功能，支持实时流式合成
 */

import WebSocket from 'ws';
import zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import BotUtil from '../../lib/common/util.js';
import { TTS_EVENTS } from '../config/deviceConfig.js';

export default class VolcengineTTSClient {
    /**
     * 构造函数
     * @param {string} deviceId - 设备ID
     * @param {Object} config - TTS配置
     * @param {Object} Bot - Bot实例
     */
    constructor(deviceId, config, Bot) {
        this.deviceId = deviceId;
        this.config = config;
        this.Bot = Bot;
        
        // WebSocket相关
        this.ws = null;
        this.connected = false;
        this.connecting = false;
        
        // 连接和会话状态
        this.connectionId = null;
        this.currentSessionId = null;
        this.sessionActive = false;
        
        // 统计信息
        this.totalAudioBytes = 0;
    }

    /**
     * 生成WebSocket连接头部
     * @returns {Object} 请求头对象
     * @private
     */
    _headers() {
        return {
            'X-Api-App-Key': this.config.appKey,
            'X-Api-Access-Key': this.config.accessKey,
            'X-Api-Resource-Id': this.config.resourceId,
            'X-Api-Connect-Id': uuidv4()
        };
    }

    /**
     * 构建协议头部（4字节）
     * @param {number} messageType - 消息类型
     * @param {number} messageFlags - 消息标志
     * @param {number} serialization - 序列化方式
     * @param {number} compression - 压缩方式
     * @returns {Buffer} 协议头Buffer
     * @private
     */
    _protoHeader(messageType, messageFlags, serialization, compression) {
        const header = Buffer.alloc(4);
        header[0] = 0x11;
        header[1] = (messageType << 4) | messageFlags;
        header[2] = (serialization << 4) | compression;
        header[3] = 0x00;
        return header;
    }

    /**
     * 构建事件帧
     * @param {number} event - 事件类型
     * @param {string|null} sessionId - 会话ID（可选）
     * @param {Object} payload - 负载数据
     * @returns {Buffer} 事件帧Buffer
     * @private
     */
    _buildEventFrame(event, sessionId = null, payload = {}) {
        const payloadJson = JSON.stringify(payload);
        const payloadBuf = Buffer.from(payloadJson, 'utf-8');

        const header = this._protoHeader(0x1, 0x4, 0x1, 0x0);

        const eventBuf = Buffer.alloc(4);
        eventBuf.writeInt32BE(event, 0);

        let frame = Buffer.concat([header, eventBuf]);

        if (sessionId) {
            const sessionIdBuf = Buffer.from(sessionId, 'utf-8');
            const sessionIdLen = Buffer.alloc(4);
            sessionIdLen.writeUInt32BE(sessionIdBuf.length, 0);
            frame = Buffer.concat([frame, sessionIdLen, sessionIdBuf]);
        }

        const payloadLen = Buffer.alloc(4);
        payloadLen.writeUInt32BE(payloadBuf.length, 0);
        frame = Buffer.concat([frame, payloadLen, payloadBuf]);

        return frame;
    }

    /**
     * 解析服务器返回的数据帧
     * @param {Buffer} data - 原始数据
     * @returns {Object|null} 解析结果
     * @private
     */
    _parse(data) {
        try {
            if (!data || data.length < 4) return null;

            const messageType = (data[1] >> 4) & 0x0F;
            const messageFlags = data[1] & 0x0F;
            const serialization = (data[2] >> 4) & 0x0F;
            const compression = data[2] & 0x0F;

            let offset = 4;

            // 错误帧
            if (messageType === 0xF) {
                const errCode = data.readInt32BE(offset);
                offset += 4;
                const errLen = data.readUInt32BE(offset);
                offset += 4;
                const errMsg = data.slice(offset, offset + errLen).toString('utf-8');
                return { type: 'error', errorCode: errCode, errorMessage: errMsg };
            }

            // 音频帧
            if (messageType === 0xB) {
                const event = data.readInt32BE(offset);
                offset += 4;

                const sessionIdLen = data.readUInt32BE(offset);
                offset += 4;
                const sessionId = data.slice(offset, offset + sessionIdLen).toString('utf-8');
                offset += sessionIdLen;

                const audioLen = data.readUInt32BE(offset);
                offset += 4;
                const audioBuf = data.slice(offset, offset + audioLen);

                return {
                    type: 'audio',
                    event,
                    sessionId,
                    data: audioBuf
                };
            }

            // 事件帧
            if (messageFlags === 0x4) {
                const event = data.readInt32BE(offset);
                offset += 4;

                let connectionId = null;
                let sessionId = null;

                if (event >= 50 && event < 100) {
                    const connectionIdLen = data.readUInt32BE(offset);
                    offset += 4;
                    connectionId = data.slice(offset, offset + connectionIdLen).toString('utf-8');
                    offset += connectionIdLen;
                } else if ((event >= 100 && event < 200) || (event >= 350 && event < 400)) {
                    const sessionIdLen = data.readUInt32BE(offset);
                    offset += 4;
                    sessionId = data.slice(offset, offset + sessionIdLen).toString('utf-8');
                    offset += sessionIdLen;
                }

                const payloadLen = data.readUInt32BE(offset);
                offset += 4;
                let payload = data.slice(offset, offset + payloadLen);

                if (compression === 0x1 && payload.length > 0) {
                    try {
                        payload = zlib.gunzipSync(payload);
                    } catch (gzipErr) {
                        BotUtil.makeLog('warn', 
                            `[TTS] Gzip解压失败: ${gzipErr.message}`, 
                            this.deviceId
                        );
                    }
                }

                let payloadObj = {};
                if (serialization === 0x1 && payload.length > 0) {
                    try {
                        const payloadStr = payload.toString('utf-8');
                        payloadObj = JSON.parse(payloadStr);
                    } catch (parseErr) {
                        // 忽略解析错误
                    }
                }

                return {
                    type: 'event',
                    event,
                    connectionId,
                    sessionId,
                    payload: payloadObj
                };
            }

            return null;
        } catch (e) {
            BotUtil.makeLog('error', `[TTS] 解析错误: ${e.message}`, this.deviceId);
            return null;
        }
    }

    /**
     * 确保WebSocket已连接
     * @returns {Promise<void>}
     * @private
     */
    async _ensureConnected() {
        if (this.connected) return;

        if (this.connecting) {
            for (let i = 0; i < 100; i++) {
                await new Promise(r => setTimeout(r, 30));
                if (this.connected) return;
            }
            throw new Error('TTS连接超时');
        }

        this.connecting = true;

        try {
            await new Promise((resolve, reject) => {
                const connectTimeout = setTimeout(() => {
                    this.connecting = false;
                    reject(new Error('TTS连接超时'));
                }, 8000);

                try {
                    const ws = new WebSocket(this.config.wsUrl, {
                        headers: this._headers(),
                        handshakeTimeout: 8000
                    });

                    this.ws = ws;

                    ws.on('open', () => {
                        BotUtil.makeLog('info', `⚡ [TTS] WebSocket握手成功`, this.deviceId);

                        const startConnFrame = this._buildEventFrame(TTS_EVENTS.START_CONNECTION, null, {});
                        ws.send(startConnFrame);
                    });

                    ws.on('upgrade', (response) => {
                        const logId = response.headers['x-tt-logid'];
                        if (logId) {
                            BotUtil.makeLog('info', `[TTS] X-Tt-Logid: ${logId}`, this.deviceId);
                        }
                    });

                    ws.on('message', (buf) => {
                        const msg = this._parse(buf);

                        if (!msg) return;

                        if (msg.type === 'error') {
                            BotUtil.makeLog('error',
                                `❌ [TTS错误] ${msg.errorCode}: ${msg.errorMessage}`,
                                this.deviceId
                            );
                            clearTimeout(connectTimeout);
                            this.connecting = false;
                            reject(new Error(msg.errorMessage));
                            return;
                        }

                        if (msg.type === 'event') {
                            this._handleEvent(msg, connectTimeout, resolve, reject);
                        }

                        if (msg.type === 'audio') {
                            this.totalAudioBytes += msg.data.length;
                            this._sendAudioToDevice(msg.data).catch(e => {
                                BotUtil.makeLog('error', `[TTS] 发送音频失败: ${e.message}`, this.deviceId);
                            });
                        }
                    });

                    ws.on('error', (err) => {
                        clearTimeout(connectTimeout);
                        BotUtil.makeLog('error',
                            `❌ [TTS] WebSocket错误: ${err.message}`,
                            this.deviceId
                        );
                        this.connected = false;
                        this.connecting = false;
                        reject(err);
                    });

                    ws.on('close', (code) => {
                        BotUtil.makeLog('info', `✓ [TTS] WebSocket关闭 (code=${code})`, this.deviceId);
                        this.connected = false;
                        this.connecting = false;
                        this.sessionActive = false;
                    });

                } catch (e) {
                    clearTimeout(connectTimeout);
                    this.connecting = false;
                    reject(e);
                }
            });
        } catch (e) {
            this.connecting = false;
            throw e;
        }
    }

    /**
     * 处理服务器事件
     * @param {Object} msg - 消息对象
     * @param {NodeJS.Timeout} connectTimeout - 连接超时定时器
     * @param {Function} resolve - Promise resolve函数
     * @param {Function} reject - Promise reject函数
     * @private
     */
    _handleEvent(msg, connectTimeout, resolve, reject) {
        switch (msg.event) {
            case TTS_EVENTS.CONNECTION_STARTED:
                clearTimeout(connectTimeout);
                this.connected = true;
                this.connecting = false;
                this.connectionId = msg.connectionId || msg.payload.connection_id || 'unknown';
                BotUtil.makeLog('info',
                    `✅ [TTS] 连接已建立 (conn_id=${this.connectionId})`,
                    this.deviceId
                );
                resolve();
                break;

            case TTS_EVENTS.CONNECTION_FAILED:
                clearTimeout(connectTimeout);
                this.connecting = false;
                BotUtil.makeLog('error',
                    `❌ [TTS] 连接失败: ${msg.payload.message}`,
                    this.deviceId
                );
                reject(new Error(msg.payload.message));
                break;

            case TTS_EVENTS.SESSION_STARTED:
                this.sessionActive = true;
                this.totalAudioBytes = 0;
                BotUtil.makeLog('info',
                    `⚡ [TTS] Session已启动 (${msg.sessionId})`,
                    this.deviceId
                );
                break;

            case TTS_EVENTS.SESSION_FINISHED:
                this.sessionActive = false;
                BotUtil.makeLog('info',
                    `✅ [TTS] Session已结束 (${this.totalAudioBytes} bytes)`,
                    this.deviceId
                );
                break;

            case TTS_EVENTS.TTS_SENTENCE_START:
                BotUtil.makeLog('debug',
                    `[TTS] 句子开始: ${msg.payload.res_params?.text || ''}`,
                    this.deviceId
                );
                break;

            case TTS_EVENTS.TTS_SENTENCE_END:
                BotUtil.makeLog('debug', `[TTS] 句子结束`, this.deviceId);
                break;
        }
    }

    /**
     * 发送音频数据到设备
     * @param {Buffer} audioData - 音频数据
     * @returns {Promise<void>}
     * @private
     */
    async _sendAudioToDevice(audioData) {
        const deviceBot = this.Bot[this.deviceId];
        if (!deviceBot) return;

        try {
            const hex = audioData.toString('hex');

            await deviceBot.sendCommand('play_tts_audio', {
                audio_data: hex
            }, 1);
        } catch (e) {
            BotUtil.makeLog('error', `[TTS] 发送音频到设备失败: ${e.message}`, this.deviceId);
        }
    }

    /**
     * 合成语音（公共API）
     * @param {string} text - 要合成的文本
     * @returns {Promise<boolean>} 是否成功
     */
    async synthesize(text) {
        if (!text || text.trim() === '') {
            BotUtil.makeLog('warn', '[TTS] 文本为空', this.deviceId);
            return false;
        }

        try {
            await this._ensureConnected();

            this.currentSessionId = uuidv4();

            const sessionPayload = {
                user: {
                    uid: this.deviceId
                },
                req_params: {
                    speaker: this.config.voiceType,
                    audio_params: {
                        format: this.config.encoding,
                        sample_rate: this.config.sampleRate,
                        speech_rate: this.config.speechRate,
                        loudness_rate: this.config.loudnessRate,
                        emotion: this.config.emotion
                    }
                }
            };

            const startSessionFrame = this._buildEventFrame(
                TTS_EVENTS.START_SESSION,
                this.currentSessionId,
                sessionPayload
            );
            this.ws.send(startSessionFrame);

            await new Promise(resolve => setTimeout(resolve, 100));

            const taskPayload = {
                req_params: {
                    text: text
                }
            };

            const taskFrame = this._buildEventFrame(
                TTS_EVENTS.TASK_REQUEST,
                this.currentSessionId,
                taskPayload
            );
            this.ws.send(taskFrame);

            BotUtil.makeLog('info',
                `⚡ [TTS] 开始合成: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
                this.deviceId
            );

            const finishFrame = this._buildEventFrame(
                TTS_EVENTS.FINISH_SESSION,
                this.currentSessionId,
                {}
            );
            this.ws.send(finishFrame);

            return true;

        } catch (e) {
            BotUtil.makeLog('error', `❌ [TTS] 合成失败: ${e.message}`, this.deviceId);
            return false;
        }
    }

    /**
     * 销毁客户端
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this.ws) {
            try {
                if (this.connected) {
                    const finishConnFrame = this._buildEventFrame(TTS_EVENTS.FINISH_CONNECTION, null, {});
                    this.ws.send(finishConnFrame);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (this.ws.readyState === 1) {
                    this.ws.close(1000, 'client destroy');
                } else {
                    this.ws.terminate();
                }
            } catch (e) {
                // 忽略错误
            }
            this.ws = null;
        }

        this.connected = false;
        this.connecting = false;
        this.sessionActive = false;
    }
}