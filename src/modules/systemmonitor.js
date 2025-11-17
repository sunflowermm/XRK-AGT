import os from 'os';
import v8 from 'v8';
import { exec } from 'child_process';
import { promisify } from 'util';
import EventEmitter from 'events';

const execAsync = promisify(exec);

/**
 * 系统监控器 - 统一管理浏览器、内存、CPU等资源
 */
class SystemMonitor extends EventEmitter {
    static instance = null;

    static getInstance() {
        if (!SystemMonitor.instance) {
            SystemMonitor.instance = new SystemMonitor();
        }
        return SystemMonitor.instance;
    }

    constructor() {
        super();
        this.isRunning = false;
        this.monitorInterval = null;
        this.reportInterval = null;
        this.config = {};
        this.lastGCTime = 0;
        this.lastOptimizeTime = 0;
        this.browserCache = { data: [], timestamp: 0, ttl: 5000 };
        this.cpuHistory = [];
        this.memoryHistory = [];
        // 内存泄漏检测（默认值，启动时从配置更新）
        this.leakDetection = {
            enabled: true, // 默认启用
            threshold: 0.1, // 10%增长视为潜在泄漏
            checkInterval: 300000, // 5分钟检查一次
            lastCheck: 0,
            baseline: null,
            growthRate: []
        };
        // 资源追踪
        this.resourceTracking = {
            timers: new Set(),
            intervals: new Set(),
            eventListeners: new Map(),
            openHandles: new Set()
        };
    }

    /**
     * 启动监控（使用cfg.monitor配置）
     */
    async start(config) {
        if (this.isRunning) {
            return;
        }

        // 合并配置，确保充分利用cfg.monitor
        this.config = {
            enabled: config?.enabled !== false,
            interval: config?.interval || 120000,
            browser: {
                enabled: config?.browser?.enabled !== false,
                maxInstances: config?.browser?.maxInstances || 5,
                memoryThreshold: config?.browser?.memoryThreshold || 90,
                reserveNewest: config?.browser?.reserveNewest !== false
            },
            memory: {
                enabled: config?.memory?.enabled !== false,
                systemThreshold: config?.memory?.systemThreshold || 85,
                nodeThreshold: config?.memory?.nodeThreshold || 85,
                autoOptimize: config?.memory?.autoOptimize !== false,
                gcInterval: config?.memory?.gcInterval || 600000,
                leakDetection: {
                    enabled: config?.memory?.leakDetection?.enabled !== false,
                    threshold: config?.memory?.leakDetection?.threshold || 0.1,
                    checkInterval: config?.memory?.leakDetection?.checkInterval || 300000
                }
            },
            cpu: {
                enabled: config?.cpu?.enabled !== false,
                threshold: config?.cpu?.threshold || 90,
                checkDuration: config?.cpu?.checkDuration || 30000
            },
            optimize: {
                aggressive: config?.optimize?.aggressive === true,
                autoRestart: config?.optimize?.autoRestart === true,
                restartThreshold: config?.optimize?.restartThreshold || 95
            },
            report: {
                enabled: config?.report?.enabled !== false,
                interval: config?.report?.interval || 3600000
            }
        };

        if (!this.config.enabled) {
            return;
        }

        this.isRunning = true;
        
        // 初始化内存泄漏检测配置
        const leakConfig = this.config.memory.leakDetection;
        this.leakDetection.enabled = leakConfig.enabled;
        this.leakDetection.threshold = leakConfig.threshold;
        this.leakDetection.checkInterval = leakConfig.checkInterval;

        // 异步执行首次检查，不阻塞启动
        this.safeRun(async () => {
            await this.checkSystem();
        }, '系统监控首次检查');
        
        // 使用配置的间隔启动监控
        this.monitorInterval = setInterval(() => {
            this.safeRun(async () => {
                await this.checkSystem();
            }, '系统监控检查');
        }, this.config.interval);
        
        // 启动报告（如果启用）
        if (this.config.report.enabled) {
            this.reportInterval = setInterval(() => {
                this.safeRun(async () => {
                    await this.generateReport();
                }, '系统监控报告生成');
            }, this.config.report.interval);
        }
    }

    /**
     * 停止监控
     */
    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
        this.isRunning = false;
        logger.info('系统监控已停止');
    }

    /**
     * 通用安全执行器，避免未定义Promise导致的.catch错误
     */
    async safeRun(task, label = '系统任务') {
        try {
            await task();
        } catch (error) {
            logger.error(`${label}失败: ${error?.stack || error?.message || error}`);
        }
    }

    /**
     * 系统检查主任务（异步执行，不阻塞）
     */
    async checkSystem() {
        if (!this.isRunning || !this.config.enabled) {
            return;
        }

        try {
            const status = {
                timestamp: Date.now(),
                memory: this.config.memory?.enabled ? await this.checkMemory() : null,
                cpu: this.config.cpu?.enabled ? await this.checkCPU() : null,
                browser: this.config.browser?.enabled ? await this.checkBrowser() : null,
                leak: this.config.memory?.leakDetection?.enabled ? this.detectMemoryLeak() : null
            };

            // 如果检测到内存泄漏，立即执行优化
            if (status.leak && this.config.memory?.autoOptimize) {
                logger.warn(`检测到内存泄漏，自动执行优化...`);
                await this.optimizeSystem(status);
            }

            const needOptimize = this.analyzeStatus(status);
            
            if (needOptimize && this.config.memory?.autoOptimize) {
                await this.optimizeSystem(status);
            }

            this.emit('status', status);
        } catch (error) {
            logger.error(`系统检查失败: ${error.message}`);
        }
    }

    /**
     * 内存检查
     */
    async checkMemory() {
        const processMemory = process.memoryUsage();
        const systemMemory = this.getSystemMemory();
        const heapStats = v8.getHeapStatistics();
        
        const heapUsedPercent = (processMemory.heapUsed / heapStats.heap_size_limit) * 100;
        const systemUsedPercent = systemMemory.usedPercent;

        this.memoryHistory.push({
            timestamp: Date.now(),
            heapUsed: processMemory.heapUsed,
            systemUsed: systemMemory.used
        });

        if (this.memoryHistory.length > 50) {
            this.memoryHistory.shift();
        }

        return {
            process: {
                heapUsed: processMemory.heapUsed,
                heapTotal: processMemory.heapTotal,
                rss: processMemory.rss,
                heapUsedPercent
            },
            system: {
                total: systemMemory.total,
                used: systemMemory.used,
                free: systemMemory.free,
                usedPercent: systemUsedPercent
            },
            warning: heapUsedPercent > this.config.memory?.nodeThreshold || 
                    systemUsedPercent > this.config.memory?.systemThreshold
        };
    }

    /**
     * CPU检查
     */
    async checkCPU() {
        if (!this.config.cpu?.enabled) return null;

        const startUsage = process.cpuUsage();
        const startTime = Date.now();
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const endUsage = process.cpuUsage(startUsage);
        const elapsedTime = Date.now() - startTime;
        
        const cpuPercent = ((endUsage.user + endUsage.system) / 1000 / elapsedTime) * 100;
        const loadAvg = os.loadavg();

        this.cpuHistory.push({ timestamp: Date.now(), usage: cpuPercent });
        if (this.cpuHistory.length > 30) this.cpuHistory.shift();

        return {
            usage: cpuPercent,
            loadAvg: loadAvg[0],
            cores: os.cpus().length,
            warning: cpuPercent > this.config.cpu?.threshold
        };
    }

    /**
     * 浏览器进程检查
     */
    async checkBrowser() {
        if (!this.config.browser?.enabled) {
            return null;
        }

        const now = Date.now();
        if (this.browserCache.data.length > 0 && 
            (now - this.browserCache.timestamp) < this.browserCache.ttl) {
            return { processes: this.browserCache.data, fromCache: true };
        }

        const processes = await this.detectBrowserProcesses();
        const maxInstances = this.config.browser?.maxInstances || 5;
        const needCleanup = processes.length > maxInstances;

        // 如果需要清理，立即执行
        if (needCleanup) {
            logger.warn(`检测到浏览器进程过多 (${processes.length}/${maxInstances})，执行清理...`);
            await this.cleanupBrowsers(processes);
            // 清理后重新获取进程列表
            const remainingProcesses = await this.detectBrowserProcesses();
            this.browserCache = { data: remainingProcesses, timestamp: now, ttl: 5000 };
            
            return {
                count: remainingProcesses.length,
                processes: remainingProcesses,
                needCleanup: false,
                warning: false,
                cleaned: processes.length - remainingProcesses.length
            };
        }

        this.browserCache = { data: processes, timestamp: now, ttl: 5000 };

        return {
            count: processes.length,
            processes,
            needCleanup: false,
            warning: false
        };
    }

    /**
     * 检测浏览器进程
     */
    async detectBrowserProcesses() {
        const platform = process.platform;
        let command = '';

        if (platform === 'win32') {
            command = 'wmic process where "name=\'chrome.exe\' or name=\'msedge.exe\'" get processid,creationdate,commandline /format:csv';
        } else if (platform === 'darwin') {
            command = 'ps -ax -o pid,etime,command | grep -E "(Chrome|Edge)" | grep -v grep | grep -v Helper';
        } else {
            command = 'ps -eo pid,etime,cmd | grep -E "(chrome|chromium|msedge)" | grep -v grep | grep -v "type="';
        }

        try {
            const { stdout } = await execAsync(command);
            return this.parseBrowserProcesses(stdout, platform);
        } catch (error) {
            return [];
        }
    }

    /**
     * 解析浏览器进程输出
     */
    parseBrowserProcesses(output, platform) {
        const processes = [];
        const lines = output.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) continue;

                const pid = parseInt(parts[0], 10);
                if (isNaN(pid)) continue;

                // 过滤辅助进程
                if (line.includes('--type=') && !line.includes('--type=browser')) continue;
                if (line.includes('Helper') || line.includes('renderer')) continue;

                processes.push({
                    pid,
                    startTime: this.parseStartTime(parts[1], platform),
                    command: line
                });
            } catch (e) {
                continue;
            }
        }

        return processes.sort((a, b) => b.startTime - a.startTime);
    }

    /**
     * 解析进程启动时间
     */
    parseStartTime(timeStr, platform) {
        if (platform === 'win32') {
            if (!timeStr || timeStr.length < 14) return Date.now();
            try {
                const year = parseInt(timeStr.substring(0, 4));
                const month = parseInt(timeStr.substring(4, 6)) - 1;
                const day = parseInt(timeStr.substring(6, 8));
                const hour = parseInt(timeStr.substring(8, 10));
                const minute = parseInt(timeStr.substring(10, 12));
                return new Date(year, month, day, hour, minute).getTime();
            } catch (e) {
                return Date.now();
            }
        } else {
            // Unix elapsed time
            const now = Date.now();
            const parts = timeStr.split(/[-:]/);
            let totalMs = 0;

            if (parts.length === 2) {
                totalMs = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
            } else if (parts.length === 3) {
                totalMs = (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])) * 1000;
            }

            return now - totalMs;
        }
    }

    /**
     * 清理浏览器进程
     */
    async cleanupBrowsers(processes) {
        const maxInstances = this.config.browser?.maxInstances || 5;
        const reserveNewest = this.config.browser?.reserveNewest !== false;
        
        // 按启动时间排序，最新的在前
        const sortedProcesses = [...processes].sort((a, b) => b.startTime - a.startTime);
        
        // 确定要清理的进程
        const toRemove = reserveNewest 
            ? sortedProcesses.slice(maxInstances)  // 保留最新的，清理旧的
            : sortedProcesses.slice(0, sortedProcesses.length - maxInstances);  // 保留旧的，清理新的

        if (toRemove.length === 0) {
            return 0;
        }

        let cleaned = 0;
        const killPromises = toRemove.map(async (proc) => {
            try {
                const cmd = process.platform === 'win32' 
                    ? `taskkill /F /PID ${proc.pid}`
                    : `kill -15 ${proc.pid}`;
                await execAsync(cmd, { timeout: 3000 });
                cleaned++;
                return true;
            } catch (e) {
                // 如果进程已经不存在，也算清理成功
                if (e.message && (e.message.includes('not found') || e.message.includes('No such process'))) {
                    cleaned++;
                    return true;
                }
                return false;
            }
        });

        await Promise.allSettled(killPromises);

        if (cleaned > 0) {
            logger.info(`已清理 ${cleaned} 个浏览器进程 (保留 ${maxInstances} 个)`);
        }

        return cleaned;
    }

    /**
     * 分析系统状态
     */
    analyzeStatus(status) {
        const issues = [];

        if (status.memory?.warning) {
            issues.push('memory');
        }

        if (status.cpu?.warning) {
            issues.push('cpu');
        }

        if (status.browser?.warning) {
            issues.push('browser');
        }

        // 检查是否需要重启
        if (this.config.optimize?.autoRestart && 
            status.memory.system.usedPercent > this.config.optimize.restartThreshold) {
            logger.error(`系统内存超过 ${this.config.optimize.restartThreshold}%，建议重启`);
            this.emit('critical', { type: 'memory', status });
        }

        return issues.length > 0;
    }

    /**
     * 检测内存泄漏
     */
    detectMemoryLeak() {
        if (!this.leakDetection.enabled) return null;
        
        const now = Date.now();
        if (now - this.leakDetection.lastCheck < this.leakDetection.checkInterval) {
            return null;
        }
        
        const currentMem = process.memoryUsage();
        const heapUsed = currentMem.heapUsed;
        
        // 建立基线
        if (!this.leakDetection.baseline) {
            this.leakDetection.baseline = heapUsed;
            this.leakDetection.lastCheck = now;
            return null;
        }
        
        // 计算增长率
        const growth = (heapUsed - this.leakDetection.baseline) / this.leakDetection.baseline;
        this.leakDetection.growthRate.push({
            timestamp: now,
            growth: growth,
            heapUsed: heapUsed
        });
        
        // 只保留最近10次记录
        if (this.leakDetection.growthRate.length > 10) {
            this.leakDetection.growthRate.shift();
        }
        
        // 检查是否持续增长
        const recentGrowth = this.leakDetection.growthRate.slice(-5);
        const avgGrowth = recentGrowth.reduce((sum, r) => sum + r.growth, 0) / recentGrowth.length;
        
        this.leakDetection.lastCheck = now;
        
        if (avgGrowth > this.leakDetection.threshold) {
            const growthPercent = (avgGrowth * 100).toFixed(2);
            logger.warn(`⚠️ 检测到潜在内存泄漏: 内存增长 ${growthPercent}%`);
            this.emit('leak', {
                growth: avgGrowth,
                baseline: this.leakDetection.baseline,
                current: heapUsed,
                history: this.leakDetection.growthRate
            });
            // 返回泄漏信息，让checkSystem自动触发优化
            return { 
                growth: avgGrowth, 
                current: heapUsed, 
                baseline: this.leakDetection.baseline,
                growthPercent: parseFloat(growthPercent)
            };
        }
        
        return null;
    }

    /**
     * 优化系统
     */
    async optimizeSystem(status) {
        const now = Date.now();
        const gcInterval = this.config.memory?.gcInterval || 600000;

        if (now - this.lastOptimizeTime < gcInterval) {
            return;
        }

        logger.info('执行系统优化...');
        this.lastOptimizeTime = now;

        // 检测内存泄漏
        const leakInfo = this.detectMemoryLeak();
        if (leakInfo) {
            logger.warn(`内存泄漏检测: 当前 ${(leakInfo.current / 1024 / 1024).toFixed(2)}MB, 基线 ${(leakInfo.baseline / 1024 / 1024).toFixed(2)}MB`);
        }

        // 记录优化前内存
        const beforeMem = process.memoryUsage();
        const beforeHeapStats = v8.getHeapStatistics();

        // 垃圾回收
        if (global.gc) {
            global.gc();
            logger.info('已执行垃圾回收');
            
            // 等待GC完成
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 清理缓存
        this.browserCache = { data: [], timestamp: 0, ttl: 5000 };
        this.cpuHistory = this.cpuHistory.slice(-10);
        this.memoryHistory = this.memoryHistory.slice(-10);

        // 清理资源追踪（保留必要的）
        if (this.resourceTracking.timers.size > 100) {
            logger.warn(`检测到大量定时器: ${this.resourceTracking.timers.size} 个`);
        }
        if (this.resourceTracking.intervals.size > 50) {
            logger.warn(`检测到大量间隔器: ${this.resourceTracking.intervals.size} 个`);
        }

        // 激进模式
        if (this.config.optimize?.aggressive) {
            if (global.gc) {
                await new Promise(resolve => setTimeout(resolve, 500));
                global.gc();
            }

            // Linux 系统缓存清理
            if (process.platform === 'linux') {
                try {
                    await execAsync('sync');
                } catch (e) {
                    // 忽略权限错误
                }
            }
        }

        // 记录优化后内存
        const afterMem = process.memoryUsage();
        const afterHeapStats = v8.getHeapStatistics();
        
        const freed = beforeMem.heapUsed - afterMem.heapUsed;
        const freedPercent = (freed / beforeMem.heapUsed * 100).toFixed(2);
        
        logger.info(`优化完成，当前堆内存: ${(afterMem.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        if (freed > 0) {
            logger.info(`释放内存: ${(freed / 1024 / 1024).toFixed(2)}MB (${freedPercent}%)`);
        }
        
        // 更新泄漏检测基线（如果内存确实下降了）
        if (afterMem.heapUsed < this.leakDetection.baseline * 0.9) {
            this.leakDetection.baseline = afterMem.heapUsed;
            this.leakDetection.growthRate = [];
            logger.info('内存泄漏检测基线已更新');
        }
        
        this.emit('optimized', { 
            before: beforeMem, 
            after: afterMem,
            freed: freed,
            heapStats: {
                before: beforeHeapStats,
                after: afterHeapStats
            }
        });
    }

    /**
     * 生成监控报告
     */
    generateReport() {
        const memory = this.getSystemMemory();
        const processMemory = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const loadAvg = os.loadavg();

        logger.line();
        logger.info(logger.gradient('系统监控报告'));
        logger.info(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
        logger.info(`系统: ${process.platform} | Node: ${process.version}`);
        logger.info(`运行时长: ${this.formatUptime(process.uptime())}`);
        logger.line();
        logger.info(`系统内存: ${this.formatBytes(memory.used)} / ${this.formatBytes(memory.total)} (${memory.usedPercent.toFixed(1)}%)`);
        logger.info(`Node堆内存: ${this.formatBytes(processMemory.heapUsed)} / ${this.formatBytes(heapStats.heap_size_limit)} (${((processMemory.heapUsed / heapStats.heap_size_limit) * 100).toFixed(1)}%)`);
        logger.info(`CPU负载: ${loadAvg[0].toFixed(2)} | 核心数: ${os.cpus().length}`);
        
        if (this.config.browser?.enabled && this.browserCache.data.length > 0) {
            logger.info(`浏览器进程: ${this.browserCache.data.length} 个`);
        }
        
        logger.line();
    }

    /**
     * 获取系统内存信息
     */
    getSystemMemory() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        return {
            total,
            free,
            used,
            usedPercent: (used / total) * 100
        };
    }

    /**
     * 格式化字节
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }

    /**
     * 格式化运行时间
     */
    formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(`${d}天`);
        if (h > 0) parts.push(`${h}时`);
        if (m > 0) parts.push(`${m}分`);
        return parts.join('') || '< 1分';
    }
}

export default SystemMonitor;