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
    }

    /**
     * 启动监控
     */
    async start(config) {
        if (this.isRunning) {
            logger.debug('系统监控已在运行');
            return;
        }

        this.config = config;
        this.isRunning = true;

        await this.checkSystem();
        
        this.monitorInterval = setInterval(() => this.checkSystem(), config.interval);
        
        if (config.report?.enabled) {
            this.reportInterval = setInterval(() => this.generateReport(), config.report.interval);
        }

        logger.info('系统监控已启动');
    }

    /**
     * 停止监控
     */
    stop() {
        if (this.monitorInterval) clearInterval(this.monitorInterval);
        if (this.reportInterval) clearInterval(this.reportInterval);
        this.isRunning = false;
        logger.info('系统监控已停止');
    }

    /**
     * 系统检查主任务
     */
    async checkSystem() {
        const status = {
            timestamp: Date.now(),
            memory: await this.checkMemory(),
            cpu: await this.checkCPU(),
            browser: this.config.browser?.enabled ? await this.checkBrowser() : null
        };

        const needOptimize = this.analyzeStatus(status);
        
        if (needOptimize && this.config.memory?.autoOptimize) {
            await this.optimizeSystem(status);
        }

        this.emit('status', status);
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
        const now = Date.now();
        if (this.browserCache.data.length > 0 && 
            (now - this.browserCache.timestamp) < this.browserCache.ttl) {
            return { processes: this.browserCache.data, fromCache: true };
        }

        const processes = await this.detectBrowserProcesses();
        this.browserCache = { data: processes, timestamp: now, ttl: 5000 };

        const needCleanup = processes.length > this.config.browser?.maxInstances;

        if (needCleanup) {
            await this.cleanupBrowsers(processes);
        }

        return {
            count: processes.length,
            processes,
            needCleanup,
            warning: needCleanup
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
        const toRemove = this.config.browser?.reserveNewest 
            ? processes.slice(maxInstances)
            : processes.slice(0, processes.length - maxInstances);

        let cleaned = 0;
        for (const proc of toRemove) {
            try {
                const cmd = process.platform === 'win32' 
                    ? `taskkill /F /PID ${proc.pid}`
                    : `kill -15 ${proc.pid}`;
                await execAsync(cmd);
                cleaned++;
            } catch (e) {
                continue;
            }
        }

        if (cleaned > 0) {
            logger.warn(`已清理 ${cleaned} 个浏览器进程`);
        }
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

        // 垃圾回收
        if (global.gc) {
            global.gc();
            logger.info('已执行垃圾回收');
        }

        // 清理缓存
        this.browserCache = { data: [], timestamp: 0, ttl: 5000 };
        this.cpuHistory = this.cpuHistory.slice(-10);
        this.memoryHistory = this.memoryHistory.slice(-10);

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

        const afterMem = process.memoryUsage();
        logger.info(`优化完成，当前堆内存: ${(afterMem.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        
        this.emit('optimized', { before: status.memory, after: afterMem });
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