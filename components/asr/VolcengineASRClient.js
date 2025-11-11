/**
 * 火山引擎ASR客户端
 * 实现语音识别功能，支持实时流式识别
 */

import WebSocket from 'ws';
import zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import BotUtil from '../../lib/common/util.js';

export default class VolcengineASRClient {
    /**
     * 构造函数
     * @param {string} deviceId - 设备ID
     * @param {Object} config - ASR配置
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
        this.connectId = uuidv4();
        
        // 会话相关
        this.sequence = 1;
        this.currentUtterance = null;
        
        // 时间戳
        this.lastMessageAt = 0;
        this.lastAudioAt = 0;
        
        // 日志ID
        this.logId = null;
        
        // 定时器
        this._idleTimer = null;
        this._pingTimer = null;
        this._pongTimer = null;
        
        // 重连相关
        this.reconnectAttempts = 0;
        
        // 性能指标
        this.performanceMetrics = {
            firstResultTime: null,
            totalProcessingTime: 0,
            audioStartTime: null
        };
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
            'X-Api-Connect-Id': this.connectId,
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
     * 构建完整客户端请求（带音频配置）
     * @param {Object} audioInfo - 音频信息
     * @returns {Buffer} 请求Buffer
     * @private
     */
    _fullClientRequest(audioInfo) {
        const payload = {
            user: {
                uid: this.deviceId,
                platform: 'ESP32-S3'
            },
            audio: {
                format: 'pcm',
                codec: 'raw',
                rate: audioInfo?.rate || 16000,
                bits: audioInfo?.bits || 16,
                channel: audioInfo?.channel || 1,
            },
            request: {
                model_name: 'bigmodel',
                enable_itn: this.config.enableItn,
                enable_punc: this.config.enablePunc,
                enable_ddc: this.config.enableDdc,
                show_utterances: this.config.showUtterances,
                result_type: this.config.resultType,
                enable_accelerate_text: this.config.enableAccelerateText,
                accelerate_score: this.config.accelerateScore,
                end_window_size: this.config.endWindowSize,
                force_to_speech_time: this.config.forceToSpeechTime,
            }
        };

        const json = JSON.stringify(payload);
        const gz = zlib.gzipSync(Buffer.from(json, 'utf-8'));
        const header = this._protoHeader(0x1, 0x0, 0x1, 0x1);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(gz.length, 0);

        return Buffer.concat([header, size, gz]);
    }

    /**
     * 构建纯音频请求
     * @param {Buffer} audioBuf - 音频数据
     * @param {boolean} isLast - 是否最后一帧
     * @returns {Buffer} 请求Buffer
     * @private
     */
    _audioOnlyRequest(audioBuf, isLast = false) {
        const gz = zlib.gzipSync(audioBuf);
        const flags = isLast ? 0x2 : 0x1;
        const header = this._protoHeader(0x2, flags, 0x0, 0x1);
        const payloadSize = Buffer.alloc(4);
        payloadSize.writeUInt32BE(gz.length, 0);

        if (!isLast) {
            this.sequence++;
            if (this.sequence > 0xFFFFFFFF) {
                this.sequence = 1;
            }
            const seq = Buffer.alloc(4);
            seq.writeUInt32BE(this.sequence, 0);
            return Buffer.concat([header, seq, payloadSize, gz]);
        }

        return Buffer.concat([header, payloadSize, gz]);
    }

    /**
     * 解析服务器返回的数据
     * @param {Buffer} data - 原始数据
     * @returns {Object|null} 解析结果
     * @private
     */
    _parse(data) {
        try {
            if (!data || data.length < 4) return null;

            const messageType = (data[1] >> 4) & 0x0F;
            const messageFlags = data[1] & 0x0F;
            const compression = data[2] & 0x0F;

            // 错误帧
            if (messageType === 0xF) {
                const errCode = data.readUInt32BE(4);
                const errSize = data.readUInt32BE(8);
                const msg = data.slice(12, 12 + errSize).toString('utf-8');
                return { type: 'error', errorCode: errCode, errorMessage: msg };
            }

            // 结果帧
            if (messageType === 0x9) {
                let offset = 4;
                if (messageFlags === 0x1 || messageFlags === 0x3) {
                    offset += 4;
                }
                const size = data.readUInt32BE(offset);
                offset += 4;
                let payload = data.slice(offset, offset + size);
                
                if (compression === 0x1) {
                    payload = zlib.gunzipSync(payload);
                }
                
                const result = JSON.parse(payload.toString('utf-8'));
                const isLast = messageFlags === 0x3 || messageFlags === 0x2;

                return { type: 'result', result, isLast };
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 启动Ping定时器
     * @private
     */
    _startPingTimer() {
        if (!this.config.wsPingIntervalMs) return;
        this._clearPingTimer();

        this._pingTimer = setInterval(() => {
            try {
                if (this.ws && this.connected) {
                    this.ws.ping();
                    this._startPongTimer();
                }
            } catch (e) {
                // 忽略错误
            }
        }, this.config.wsPingIntervalMs || 30000);
    }

    /**
     * 清除Ping定时器
     * @private
     */
    _clearPingTimer() {
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
    }

    /**
     * 启动Pong超时定时器
     * @private
     */
    _startPongTimer() {
        this._clearPongTimer();
        this._pongTimer = setTimeout(() => {
            BotUtil.makeLog('warn', `[ASR] Pong超时，断开连接`, this.deviceId);
            if (this.ws) {
                try {
                    this.ws.terminate();
                } catch (e) {
                    // 忽略错误
                }
            }
        }, this.config.wsPongTimeoutMs || 10000);
    }

    /**
     * 清除Pong超时定时器
     * @private
     */
    _clearPongTimer() {
        if (this._pongTimer) {
            clearTimeout(this._pongTimer);
            this._pongTimer = null;
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
            throw new Error('连接超时');
        }

        this.connecting = true;

        try {
            await new Promise((resolve, reject) => {
                const connectTimeout = setTimeout(() => {
                    this.connecting = false;
                    reject(new Error('连接超时'));
                }, 8000);

                try {
                    const ws = new WebSocket(this.config.wsUrl, {
                        headers: this._headers(),
                        handshakeTimeout: 8000
                    });

                    this.ws = ws;

                    ws.on('open', () => {
                        clearTimeout(connectTimeout);
                        this.connected = true;
                        this.connecting = false;
                        this.lastMessageAt = Date.now();
                        this.reconnectAttempts = 0;

                        BotUtil.makeLog('info', `⚡ [ASR] WebSocket已连接`, this.deviceId);
                        this._startPingTimer();
                        resolve();
                    });

                    ws.on('upgrade', (response) => {
                        this.logId = response.headers['x-tt-logid'];
                    });

                    ws.on('message', (buf) => {
                        this.lastMessageAt = Date.now();
                        const msg = this._parse(buf);

                        if (!msg) return;

                        if (msg.type === 'error') {
                            this._handleError(msg);
                            return;
                        }

                        if (msg.type === 'result') {
                            if (!this.performanceMetrics.firstResultTime && this.performanceMetrics.audioStartTime) {
                                this.performanceMetrics.firstResultTime = Date.now() - this.performanceMetrics.audioStartTime;
                                BotUtil.makeLog('info',
                                    `⚡ [ASR性能] 首字返回: ${this.performanceMetrics.firstResultTime}ms`,
                                    this.deviceId
                                );
                            }

                            this._handleResult(msg.result, msg.isLast);

                            if (msg.isLast) {
                                if (this.currentUtterance) {
                                    const totalTime = Date.now() - this.performanceMetrics.audioStartTime;
                                    BotUtil.makeLog('info',
                                        `⚡ [ASR性能] 总处理时间: ${totalTime}ms`,
                                        this.deviceId
                                    );
                                }
                                this._armIdleTimer();
                            }
                        }
                    });

                    ws.on('pong', () => {
                        this._clearPongTimer();
                    });

                    ws.on('error', (err) => {
                        clearTimeout(connectTimeout);

                        if (err.message.includes('401')) {
                            BotUtil.makeLog('error',
                                `❌ [ASR] 认证失败(401): 请检查appKey和accessKey`,
                                this.deviceId
                            );
                        } else {
                            BotUtil.makeLog('error',
                                `❌ [ASR] WebSocket错误: ${err.message}`,
                                this.deviceId
                            );
                        }

                        this.connected = false;
                        this.connecting = false;
                        this.currentUtterance = null;
                        this._clearIdleTimer();
                        this._clearPingTimer();
                        this._clearPongTimer();
                        reject(err);
                    });

                    ws.on('close', (code) => {
                        BotUtil.makeLog('info', `✓ [ASR] WebSocket关闭 (code=${code})`, this.deviceId);
                        this.connected = false;
                        this.connecting = false;

                        if (this.currentUtterance) {
                            this.currentUtterance = null;
                        }

                        this._clearIdleTimer();
                        this._clearPingTimer();
                        this._clearPongTimer();

                        if (code !== 1000 && this.reconnectAttempts < (this.config.wsMaxReconnectAttempts || 5)) {
                            this._scheduleReconnect();
                        }
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
     * 安排重连
     * @private
     */
    _scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(
            (this.config.wsReconnectDelayMs || 2000) * this.reconnectAttempts,
            10000
        );

        BotUtil.makeLog('info',
            `🔄 [ASR] 将在${delay}ms后重连（第${this.reconnectAttempts}次）`,
            this.deviceId
        );

        setTimeout(() => {
            if (!this.connected && !this.connecting) {
                this._ensureConnected().catch(e => {
                    BotUtil.makeLog('error', `❌ [ASR] 重连失败: ${e.message}`, this.deviceId);
                });
            }
        }, delay);
    }

    /**
     * 处理错误
     * @param {Object} msg - 错误消息
     * @private
     */
    _handleError(msg) {
        const errorCode = msg.errorCode;

        if (errorCode === 45000081) {
            BotUtil.makeLog('warn', `⚠️ [ASR] 服务器超时，清理状态`, this.deviceId);
        } else if (errorCode === 45000000) {
            this.sequence = 1;
        } else {
            BotUtil.makeLog('error',
                `❌ [ASR错误] ${errorCode}: ${msg.errorMessage}`,
                this.deviceId
            );
        }

        if (this.currentUtterance) {
            this.currentUtterance = null;
        }
        this._armIdleTimer();
    }

    /**
     * 处理识别结果
     * @param {Object} result - 识别结果
     * @param {boolean} isLast - 是否最后一个结果
     * @private
     */
    _handleResult(result, isLast) {
        try {
            const text = result?.result?.text || result?.text || '';
            const duration = result?.audio_info?.duration || 0;

            if (text) {
                const sessionId = this.currentUtterance?.sessionId;

                if (isLast) {
                    BotUtil.makeLog('info',
                        `✅ [ASR最终] "${text}" (${duration}ms)`,
                        this.deviceId
                    );
                } else {
                    BotUtil.makeLog('info',
                        `⚡ [ASR中间] "${text}" (${duration}ms)`,
                        this.deviceId
                    );
                }

                // 发送事件
                if (this.Bot[this.deviceId]) {
                    this.Bot.em('device.asr_result', {
                        post_type: 'device',
                        event_type: 'asr_result',
                        device_id: this.deviceId,
                        session_id: sessionId || null,
                        text,
                        is_final: !!isLast,
                        duration,
                        result: result?.result || result,
                        self_id: this.deviceId,
                        time: Math.floor(Date.now() / 1000)
                    });
                }
            }
        } catch (e) {
            BotUtil.makeLog('error',
                `❌ [ASR] 处理结果失败: ${e.message}`,
                this.deviceId
            );
        }
    }

    /**
     * 启动空闲定时器
     * @private
     */
    _armIdleTimer() {
        if (this.config.idleCloseMs > 0) {
            this._clearIdleTimer();
            this._idleTimer = setTimeout(() => {
                if (this.ws && this.connected && !this.currentUtterance) {
                    BotUtil.makeLog('info', `✓ [ASR] 空闲超时，关闭连接`, this.deviceId);
                    this.ws.close();
                }
            }, this.config.idleCloseMs);
        }
    }

    /**
     * 清除空闲定时器
     * @private
     */
    _clearIdleTimer() {
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = null;
        }
    }

    /**
     * 开始一个utterance（公共API）
     * @param {string} sessionId - 会话ID
     * @param {Object} audioInfo - 音频信息
     * @returns {Promise<void>}
     */
    async beginUtterance(sessionId, audioInfo) {
        if (this.currentUtterance) {
            BotUtil.makeLog('info',
                `🔄 [ASR] 切换会话：${this.currentUtterance.sessionId} → ${sessionId}`,
                this.deviceId
            );
            try {
                await this.endUtterance();
            } catch (e) {
                // 忽略错误
            }
            await new Promise(r => setTimeout(r, 50));
        }

        await this._ensureConnected();
        this._clearIdleTimer();

        this.performanceMetrics = {
            firstResultTime: null,
            totalProcessingTime: 0,
            audioStartTime: Date.now()
        };

        this.currentUtterance = {
            sessionId,
            startedAt: Date.now(),
            ending: false
        };

        this.sequence = 1;

        const fullReq = this._fullClientRequest({
            rate: audioInfo?.sample_rate || 16000,
            bits: audioInfo?.bits || 16,
            channel: audioInfo?.channels || 1
        });

        this.ws.send(fullReq);
        BotUtil.makeLog('info', `⚡ [ASR会话] 开始: ${sessionId}`, this.deviceId);
    }

    /**
     * 发送音频数据（公共API）
     * @param {Buffer} audioBuf - 音频数据
     * @returns {boolean} 是否成功
     */
    sendAudio(audioBuf) {
        if (!this.ws || !this.connected) return false;
        if (!this.currentUtterance || this.currentUtterance.ending) return false;

        try {
            const frame = this._audioOnlyRequest(audioBuf, false);
            this.ws.send(frame);
            this.lastAudioAt = Date.now();
            return true;
        } catch (e) {
            BotUtil.makeLog('error', `❌ [ASR] 发送音频失败: ${e.message}`, this.deviceId);
            return false;
        }
    }

    /**
     * 结束utterance（公共API）
     * @returns {Promise<boolean>} 是否成功
     */
    async endUtterance() {
        if (!this.currentUtterance || this.currentUtterance.ending) return false;

        this.currentUtterance.ending = true;

        if (!this.ws || !this.connected) {
            this.currentUtterance = null;
            this._armIdleTimer();
            return false;
        }

        try {
            const last = this._audioOnlyRequest(Buffer.alloc(0), true);
            this.ws.send(last);

            const sessionId = this.currentUtterance.sessionId;
            BotUtil.makeLog('info', `✓ [ASR会话] 结束: ${sessionId}`, this.deviceId);

            setTimeout(() => {
                if (this.currentUtterance && this.currentUtterance.sessionId === sessionId) {
                    this.currentUtterance = null;
                }
            }, 300);

            this._armIdleTimer();
            return true;

        } catch (e) {
            BotUtil.makeLog('error', `❌ [ASR] 结束失败: ${e.message}`, this.deviceId);
            this.currentUtterance = null;
            this._armIdleTimer();
            return false;
        }
    }

    /**
     * 销毁客户端
     * @returns {Promise<void>}
     */
    async destroy() {
        this._clearIdleTimer();
        this._clearPingTimer();
        this._clearPongTimer();

        if (this.currentUtterance && !this.currentUtterance.ending) {
            try {
                await this.endUtterance();
            } catch (e) {
                // 忽略错误
            }
        }

        this.currentUtterance = null;
        this.sequence = 1;

        if (this.ws) {
            try {
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
        this.reconnectAttempts = 0;
    }
}