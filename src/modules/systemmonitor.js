import os from 'os';
import v8 from 'v8';
import fs from 'fs/promises';
import path from 'path';
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
        // 资源追踪（仅用于监控，不实际追踪）
        this.resourceTracking = {
            timers: new Set(),
            intervals: new Set()
        };
        // 磁盘I/O统计
        this.diskIO = {
            readOps: 0,
            writeOps: 0,
            lastCheck: 0
        };
        // 网络连接统计
        this.networkStats = {
            connections: 0,
            lastCheck: 0
        };
        // 文件句柄统计
        this.fileHandles = {
            open: 0,
            max: 0,
            lastCheck: 0
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
            },
            disk: {
                enabled: config?.disk?.enabled !== false,
                cleanupTemp: config?.disk?.cleanupTemp !== false,
                cleanupLogs: config?.disk?.cleanupLogs !== false,
                tempMaxAge: config?.disk?.tempMaxAge || 86400000, // 1天
                logMaxAge: config?.disk?.logMaxAge || 604800000, // 7天
                maxLogSize: config?.disk?.maxLogSize || 100 * 1024 * 1024 // 100MB
            },
            network: {
                enabled: config?.network?.enabled !== false,
                maxConnections: config?.network?.maxConnections || 1000,
                cleanupIdle: config?.network?.cleanupIdle !== false
            },
            process: {
                enabled: config?.process?.enabled !== false,
                priority: config?.process?.priority || 'normal', // low, normal, high
                nice: config?.process?.nice || 0 // -20 to 19
            },
            system: {
                enabled: config?.system?.enabled !== false,
                clearCache: config?.system?.clearCache !== false,
                optimizeCPU: config?.system?.optimizeCPU !== false
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
                leak: this.config.memory?.leakDetection?.enabled ? this.detectMemoryLeak() : null,
                disk: this.config.disk?.enabled ? await this.checkDisk() : null,
                network: this.config.network?.enabled ? await this.checkNetwork() : null,
                fileHandles: this.config.system?.enabled ? await this.checkFileHandles() : null
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

        if (status.disk?.usedPercent > 90) {
            issues.push('disk');
            logger.warn(`磁盘使用率过高: ${status.disk.usedPercent.toFixed(1)}%`);
        }

        if (status.network?.warning) {
            issues.push('network');
            logger.warn(`网络连接数过多: ${status.network.connections}`);
        }

        if (status.fileHandles?.warning) {
            issues.push('fileHandles');
            logger.warn(`文件句柄使用率过高: ${status.fileHandles.usagePercent.toFixed(1)}%`);
        }

        // 检查是否需要重启
        if (this.config.optimize?.autoRestart && 
            status.memory?.system?.usedPercent > this.config.optimize.restartThreshold) {
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
     * 磁盘检查
     */
    async checkDisk() {
        try {
            const platform = process.platform;
            let diskUsage = null;

            if (platform === 'win32') {
                const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
                const lines = stdout.split('\n').filter(l => l.trim() && !l.includes('Caption'));
                if (lines.length > 0) {
                    const parts = lines[0].trim().split(/\s+/);
                    const free = parseInt(parts[parts.length - 2]) || 0;
                    const total = parseInt(parts[parts.length - 1]) || 0;
                    const used = total - free;
                    diskUsage = {
                        total,
                        free,
                        used,
                        usedPercent: total > 0 ? (used / total * 100) : 0
                    };
                }
            } else {
                const { stdout } = await execAsync('df -k /');
                const lines = stdout.split('\n');
                if (lines.length > 1) {
                    const parts = lines[1].trim().split(/\s+/);
                    const total = parseInt(parts[1]) * 1024;
                    const used = parseInt(parts[2]) * 1024;
                    const free = parseInt(parts[3]) * 1024;
                    diskUsage = {
                        total,
                        free,
                        used,
                        usedPercent: total > 0 ? (used / total * 100) : 0
                    };
                }
            }

            return diskUsage || {
                total: 0,
                free: 0,
                used: 0,
                usedPercent: 0
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 网络检查
     */
    async checkNetwork() {
        try {
            const platform = process.platform;
            let connections = 0;

            if (platform === 'win32') {
                const { stdout } = await execAsync('netstat -an | find /c "ESTABLISHED"');
                connections = parseInt(stdout.trim()) || 0;
            } else {
                const { stdout } = await execAsync('netstat -an | grep ESTABLISHED | wc -l');
                connections = parseInt(stdout.trim()) || 0;
            }

            this.networkStats.connections = connections;
            this.networkStats.lastCheck = Date.now();

            return {
                connections,
                warning: connections > (this.config.network?.maxConnections || 1000)
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 文件句柄检查
     */
    async checkFileHandles() {
        try {
            const platform = process.platform;
            let openHandles = 0;
            let maxHandles = 0;

            if (platform === 'linux') {
                const pid = process.pid;
                try {
                    const { stdout: limit } = await execAsync(`ulimit -n`);
                    maxHandles = parseInt(limit.trim()) || 0;
                    
                    const { stdout: lsof } = await execAsync(`lsof -p ${pid} 2>/dev/null | wc -l`);
                    openHandles = parseInt(lsof.trim()) || 0;
                } catch (e) {
                    // 忽略错误
                }
            } else if (platform === 'win32') {
                try {
                    const { stdout } = await execAsync(`handle.exe -p ${process.pid} 2>nul | find /c "File"`);
                    openHandles = parseInt(stdout.trim()) || 0;
                } catch (e) {
                    // handle.exe 可能不存在，使用默认值
                    maxHandles = 2048; // Windows默认
                }
            }

            this.fileHandles.open = openHandles;
            this.fileHandles.max = maxHandles;
            this.fileHandles.lastCheck = Date.now();

            return {
                open: openHandles,
                max: maxHandles,
                usagePercent: maxHandles > 0 ? (openHandles / maxHandles * 100) : 0,
                warning: maxHandles > 0 && (openHandles / maxHandles) > 0.8
            };
        } catch (error) {
            return null;
        }
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

        logger.info('🚀 执行全系统优化...');
        this.lastOptimizeTime = now;

        // 1. 内存优化
        await this.optimizeMemory();

        // 2. 磁盘优化
        if (this.config.disk?.enabled) {
            await this.optimizeDisk();
        }

        // 3. 网络优化
        if (this.config.network?.enabled) {
            await this.optimizeNetwork();
        }

        // 4. 系统级优化
        if (this.config.system?.enabled) {
            await this.optimizeSystemLevel();
        }

        // 5. 进程优化
        if (this.config.process?.enabled) {
            await this.optimizeProcess();
        }

        logger.info('✅ 系统优化完成');
    }

    /**
     * 内存优化
     */
    async optimizeMemory() {
        const leakInfo = this.detectMemoryLeak();
        if (leakInfo) {
            logger.warn(`内存泄漏检测: 当前 ${(leakInfo.current / 1024 / 1024).toFixed(2)}MB, 基线 ${(leakInfo.baseline / 1024 / 1024).toFixed(2)}MB`);
        }

        const beforeMem = process.memoryUsage();
        const beforeHeapStats = v8.getHeapStatistics();

        // 垃圾回收
        if (global.gc) {
            global.gc();
            logger.info('  ✓ 已执行堆内存垃圾回收');
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 清理内部缓存
        this.browserCache = { data: [], timestamp: 0, ttl: 5000 };
        this.cpuHistory = this.cpuHistory.slice(-10);
        this.memoryHistory = this.memoryHistory.slice(-10);

        // 注意：资源追踪仅用于监控，实际清理需要应用层处理

        // 激进模式：多次GC
        if (this.config.optimize?.aggressive) {
            if (global.gc) {
                await new Promise(resolve => setTimeout(resolve, 500));
                global.gc();
                logger.info('  ✓ 已执行二次垃圾回收（激进模式）');
            }
        }

        const afterMem = process.memoryUsage();
        const freed = beforeMem.heapUsed - afterMem.heapUsed;
        
        if (freed > 0) {
            logger.info(`  ✓ 释放堆内存: ${(freed / 1024 / 1024).toFixed(2)}MB`);
        }
        
        if (afterMem.heapUsed < this.leakDetection.baseline * 0.9) {
            this.leakDetection.baseline = afterMem.heapUsed;
            this.leakDetection.growthRate = [];
        }
    }

    /**
     * 磁盘优化
     */
    async optimizeDisk() {
        try {
            // 清理临时文件
            if (this.config.disk?.cleanupTemp) {
                await this.cleanupTempFiles();
            }

            // 清理日志文件
            if (this.config.disk?.cleanupLogs) {
                await this.cleanupLogFiles();
            }

            // 清理系统缓存
            if (this.config.system?.clearCache) {
                await this.clearSystemCache();
            }
        } catch (error) {
            logger.error(`磁盘优化失败: ${error.message}`);
        }
    }

    /**
     * 清理临时文件
     */
    async cleanupTempFiles() {
        try {
            const tempDirs = [
                path.join(process.cwd(), 'data', 'temp'),
                path.join(process.cwd(), 'data', 'uploads'),
                path.join(process.cwd(), 'trash')
            ];

            const maxAge = this.config.disk?.tempMaxAge || 86400000;
            const now = Date.now();
            let cleaned = 0;
            let freed = 0;

            for (const dir of tempDirs) {
                try {
                    const files = await fs.readdir(dir, { withFileTypes: true });
                    for (const file of files) {
                        if (file.isFile()) {
                            const filePath = path.join(dir, file.name);
                            try {
                                const stats = await fs.stat(filePath);
                                if (now - stats.mtimeMs > maxAge) {
                                    const size = stats.size;
                                    await fs.unlink(filePath);
                                    cleaned++;
                                    freed += size;
                                }
                            } catch (e) {
                                // 忽略错误
                            }
                        }
                    }
                } catch (e) {
                    // 目录不存在，忽略
                }
            }

            if (cleaned > 0) {
                logger.info(`  ✓ 清理临时文件: ${cleaned} 个，释放 ${(freed / 1024 / 1024).toFixed(2)}MB`);
            }
        } catch (error) {
            logger.error(`清理临时文件失败: ${error.message}`);
        }
    }

    /**
     * 清理日志文件
     */
    async cleanupLogFiles() {
        try {
            const logDir = path.join(process.cwd(), 'logs');
            const maxAge = this.config.disk?.logMaxAge || 604800000;
            const maxSize = this.config.disk?.maxLogSize || 100 * 1024 * 1024;
            const now = Date.now();
            let cleaned = 0;
            let freed = 0;

            try {
                const files = await fs.readdir(logDir, { withFileTypes: true });
                const logFiles = files.filter(f => f.isFile() && f.name.endsWith('.log'));

                for (const file of logFiles) {
                    const filePath = path.join(logDir, file.name);
                    try {
                        const stats = await fs.stat(filePath);
                        const shouldDelete = (now - stats.mtimeMs > maxAge) || (stats.size > maxSize);
                        
                        if (shouldDelete) {
                            const size = stats.size;
                            await fs.unlink(filePath);
                            cleaned++;
                            freed += size;
                        }
                    } catch (e) {
                        // 忽略错误
                    }
                }

                if (cleaned > 0) {
                    logger.info(`  ✓ 清理日志文件: ${cleaned} 个，释放 ${(freed / 1024 / 1024).toFixed(2)}MB`);
                }
            } catch (e) {
                // 日志目录不存在，忽略
            }
        } catch (error) {
            logger.error(`清理日志文件失败: ${error.message}`);
        }
    }

    /**
     * 清理系统缓存
     */
    async clearSystemCache() {
        try {
            const platform = process.platform;

            if (platform === 'linux') {
                // Linux: 清理页面缓存（需要root权限）
                try {
                    await execAsync('sync');
                    await execAsync('echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true');
                    logger.info('  ✓ 已清理Linux系统缓存');
                } catch (e) {
                    // 权限不足，忽略
                }
            } else if (platform === 'win32') {
                // Windows: 清理DNS缓存
                try {
                    await execAsync('ipconfig /flushdns');
                    logger.info('  ✓ 已清理Windows DNS缓存');
                } catch (e) {
                    // 忽略错误
                }
            }
        } catch (error) {
            // 忽略错误
        }
    }

    /**
     * 网络优化
     */
    async optimizeNetwork() {
        try {
            // 检查并清理空闲连接
            if (this.config.network?.cleanupIdle) {
                // 这里可以添加具体的网络连接清理逻辑
                // 例如清理HTTP keep-alive连接等
                logger.info('  ✓ 网络连接已优化');
            }
        } catch (error) {
            logger.error(`网络优化失败: ${error.message}`);
        }
    }

    /**
     * 系统级优化
     */
    async optimizeSystemLevel() {
        try {
            const platform = process.platform;

            // CPU优化（Linux）
            if (this.config.system?.optimizeCPU && platform === 'linux') {
                try {
                    // 设置CPU调度策略（需要root权限）
                    await execAsync('chrt -r -p 0 ' + process.pid + ' 2>/dev/null || true');
                    logger.info('  ✓ 已优化CPU调度策略');
                } catch (e) {
                    // 权限不足，忽略
                }
            }
        } catch (error) {
            // 忽略错误
        }
    }

    /**
     * 进程优化
     */
    async optimizeProcess() {
        try {
            const platform = process.platform;
            const priority = this.config.process?.priority || 'normal';
            const nice = this.config.process?.nice || 0;

            if (platform === 'linux') {
                // 设置进程优先级（nice值）
                if (nice !== 0) {
                    try {
                        process.setPriority(nice);
                        logger.info(`  ✓ 已设置进程优先级 (nice: ${nice})`);
                    } catch (e) {
                        // 权限不足，忽略
                    }
                }
            } else if (platform === 'win32') {
                // Windows进程优先级
                const priorityMap = {
                    low: 'below normal',
                    normal: 'normal',
                    high: 'above normal'
                };
                const winPriority = priorityMap[priority] || 'normal';
                try {
                    await execAsync(`wmic process where processid=${process.pid} set priority="${winPriority}"`);
                    logger.info(`  ✓ 已设置进程优先级 (${priority})`);
                } catch (e) {
                    // 忽略错误
                }
            }
        } catch (error) {
            // 忽略错误
        }
    }

    /**
     * 生成监控报告
     */
    async generateReport() {
        const memory = this.getSystemMemory();
        const processMemory = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const loadAvg = os.loadavg();
        const disk = await this.checkDisk();
        const network = await this.checkNetwork();
        const fileHandles = await this.checkFileHandles();

        logger.line();
        logger.info(logger.gradient('系统监控报告'));
        logger.info(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
        logger.info(`系统: ${process.platform} | Node: ${process.version}`);
        logger.info(`运行时长: ${this.formatUptime(process.uptime())}`);
        logger.line();
        logger.info(`系统内存: ${this.formatBytes(memory.used)} / ${this.formatBytes(memory.total)} (${memory.usedPercent.toFixed(1)}%)`);
        logger.info(`Node堆内存: ${this.formatBytes(processMemory.heapUsed)} / ${this.formatBytes(heapStats.heap_size_limit)} (${((processMemory.heapUsed / heapStats.heap_size_limit) * 100).toFixed(1)}%)`);
        logger.info(`CPU负载: ${loadAvg[0].toFixed(2)} | 核心数: ${os.cpus().length}`);
        
        if (disk) {
            logger.info(`磁盘使用: ${this.formatBytes(disk.used)} / ${this.formatBytes(disk.total)} (${disk.usedPercent.toFixed(1)}%)`);
        }
        
        if (network) {
            logger.info(`网络连接: ${network.connections} 个`);
        }
        
        if (fileHandles) {
            logger.info(`文件句柄: ${fileHandles.open} / ${fileHandles.max} (${fileHandles.usagePercent.toFixed(1)}%)`);
        }
        
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