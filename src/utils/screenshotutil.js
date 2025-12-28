/**
 * 截图工具模块
 * 
 * 注意：此模块目前未被使用。代码库中使用了其他截图方案（如 desktop.js 中的 screenshot-desktop）。
 * 此模块提供了基于 puppeteer/playwright 的网页截图功能，包含完整的浏览器管理、缓存和错误处理。
 * 
 * 如需使用此模块，请导入 takeScreenshot 函数。
 */

import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cfg from '#infrastructure/config/config.js';
import RendererLoader from '#infrastructure/renderer/loader.js';
import paths from '#utils/paths.js';

const DB_PATH = path.join(paths.trash, 'screenshot/screenshot-manager.db');
const OUTPUT_BASE_PATH = path.join(paths.trash, 'screenshot/output');
const MAX_RENDER_COUNT = 100;
const MAX_IDLE_TIME = 3600000;
const DEFAULT_IMAGE_PATH = path.join(paths.renderers, '截图失败.jpg');

function getRenderer() {
  const rendererName = cfg.renderer?.name || 'puppeteer';
  return RendererLoader.getRenderer(rendererName);
}

class ScreenshotManager {
    constructor() {
        this.browser = null;
        this.browserLock = false;
        this.renderCount = 0;
        this.lastUsedTime = Date.now();
        this.dbInstance = null;
        this.idleTimer = null;
        this.pageQueue = new Set();
        this.isClosing = false;
        this.browserPromise = null;
        
        // 监听进程退出事件
        process.once('exit', () => this.cleanup());
        process.once('SIGINT', () => this.cleanup());
        process.once('SIGTERM', () => this.cleanup());
        process.once('beforeExit', () => this.cleanup());
    }

    // 清理资源
    async cleanup() {
        if (this.isClosing) return;
        this.isClosing = true;
        
        try {
            // 清理定时器
            if (this.idleTimer) {
                clearInterval(this.idleTimer);
                this.idleTimer = null;
            }
            
            // 等待所有页面关闭
            if (this.pageQueue.size > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 关闭浏览器
            if (this.browser) {
                try {
                    const pages = await this.browser.pages();
                    await Promise.all(pages.map(page => page.close().catch(() => {})));
                    await this.browser.close();
                } catch (e) {
                    // 忽略错误
                }
                this.browser = null;
            }
            
            // 关闭数据库
            if (this.dbInstance) {
                await this.dbInstance.close().catch(() => {});
                this.dbInstance = null;
            }
        } catch (e) {
            // 忽略清理错误
        }
    }

    // 初始化数据库
    async initDB() {
        if (!this.dbInstance) {
            try {
                const dbDir = path.dirname(DB_PATH);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }
                
                this.dbInstance = await open({
                    filename: DB_PATH,
                    driver: sqlite3.Database
                });
                
                await this.dbInstance.exec(`
                    CREATE TABLE IF NOT EXISTS screenshot_cache (
                        target TEXT,
                        config TEXT,
                        image_path TEXT,
                        created_at INTEGER,
                        PRIMARY KEY (target, config)
                    );
                    CREATE TABLE IF NOT EXISTS render_stats (
                        date TEXT,
                        total_renders INTEGER DEFAULT 0,
                        PRIMARY KEY (date)
                    );
                    CREATE TABLE IF NOT EXISTS error_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT,
                        time TEXT,
                        error TEXT,
                        stack TEXT,
                        target TEXT
                    );
                `);
            } catch (err) {
                logger.error('[Screenshot] 初始化数据库失败:', err);
                this.dbInstance = { 
                    run: async () => ({ changes: 0 }), 
                    get: async () => null, 
                    all: async () => [], 
                    exec: async () => {}, 
                    close: async () => {} 
                };
            }
        }
        return this.dbInstance;
    }

    // 获取或创建浏览器实例
    async getBrowser() {
        if (this.isClosing) {
            throw new Error('浏览器正在关闭');
        }
        
        this.lastUsedTime = Date.now();
        
        // 如果已有浏览器实例，检查是否可用
        if (this.browser) {
            try {
                await this.browser.version();
                return this.browser;
            } catch (e) {
                logger.warn('[Screenshot] 浏览器实例不可用，重新创建');
                this.browser = null;
                this.browserPromise = null;
            }
        }
        
        // 如果正在创建浏览器，等待创建完成
        if (this.browserPromise) {
            return await this.browserPromise;
        }
        
        // 创建新的浏览器实例
        this.browserPromise = this._createBrowser();
        
        try {
            this.browser = await this.browserPromise;
            return this.browser;
        } finally {
            this.browserPromise = null;
        }
    }

    async _createBrowser() {
        if (this.isClosing) {
            throw new Error('浏览器正在关闭');
        }
        
        try {
            const renderer = getRenderer();
            if (!renderer || !renderer.browserInit) {
                throw new Error('渲染器未初始化或不可用');
            }
            
            const browser = await renderer.browserInit();
            
            if (!browser) {
                throw new Error('浏览器实例创建失败');
            }
            
            this.renderCount = 0;
            
            if (!this.idleTimer && !this.isClosing) {
                this.idleTimer = setInterval(() => this.checkIdle(), 5 * 60 * 1000);
            }
            
            browser.on('disconnected', () => {
                if (this.browser === browser) {
                    this.browser = null;
                    this.browserPromise = null;
                }
            });
            
            return browser;
        } catch (error) {
            logger.error('[Screenshot] 启动浏览器失败:', error);
            throw error;
        }
    }

    // 重置浏览器
    async resetBrowser() {
        if (this.isClosing) return;
        
        const oldBrowser = this.browser;
        this.browser = null;
        this.browserPromise = null;
        
        if (oldBrowser) {
            try {
                // 关闭所有页面
                const pages = await oldBrowser.pages();
                await Promise.all(pages.map(page => page.close().catch(() => {})));
                // 延迟关闭浏览器，让页面有时间清理
                setTimeout(async () => {
                    try {
                        await oldBrowser.close();
                    } catch (e) {
                        // 忽略关闭错误
                    }
                }, 1000);
            } catch (e) {}
        }
        
        try {
            await this.getBrowser();
        } catch (error) {
            logger.error('[Screenshot] 重置浏览器失败:', error);
        }
    }

    // 检查浏览器空闲状态
    checkIdle() {
        if (this.isClosing) return;
        if (Date.now() - this.lastUsedTime > MAX_IDLE_TIME && this.browser) {
            this.resetBrowser();
        }
    }

    // 执行截图
    async executeScreenshot(target, imageName, config) {
        const pageId = Math.random().toString(36).substring(7);
        this.pageQueue.add(pageId);
        
        let page = null;
        
        try {
            const browser = await this.getBrowser();
            
            // 创建新页面，设置超时
            page = await browser.newPage();
            page.setDefaultTimeout(30000);
            page.setDefaultNavigationTimeout(30000);
            
            // 配置页面
            await this.configurePage(page, config);
            
            // 导航到目标
            const isUrl = target.startsWith('http') || target.startsWith('https');
            const targetUrl = isUrl ? target : `file://${target}`;
            
            await page.goto(targetUrl, {
                waitUntil: config.waitUntil,
                timeout: config.timeout - 5000
            });
            
            // 等待页面加载
            await this.waitForPage(page, config);
            
            // 获取内容尺寸
            const contentDimensions = await page.evaluate(() => ({
                width: Math.max(
                    document.body.scrollWidth,
                    document.documentElement.scrollWidth,
                    document.body.offsetWidth,
                    document.documentElement.offsetWidth,
                    document.body.clientWidth,
                    document.documentElement.clientWidth
                ),
                height: Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.offsetHeight,
                    document.body.clientHeight,
                    document.documentElement.clientHeight
                )
            }));
            
            const finalWidth = config.width || contentDimensions.width;
            const finalHeight = config.height || contentDimensions.height;
            
            // 设置视口
            if (!config.fullPage) {
                await page.setViewport({
                    width: finalWidth,
                    height: finalHeight,
                    deviceScaleFactor: config.deviceScaleFactor
                });
            }
            
            // 准备截图选项
            const screenshotOptions = await this.prepareScreenshotOptions(page, {
                ...config,
                width: finalWidth,
                height: finalHeight
            });
            
            // 执行截图
            const imageBuffer = await page.screenshot(screenshotOptions);
            
            // 保存图片
            const imagePath = path.join(OUTPUT_BASE_PATH, `${imageName}.${config.type}`);
            if (typeof imageBuffer === 'string') {
                fs.writeFileSync(imagePath, imageBuffer, 'base64');
            } else {
                fs.writeFileSync(imagePath, imageBuffer);
            }
            
            // 更新计数
            this.renderCount++;
            this.lastUsedTime = Date.now();
            
            if (this.renderCount >= MAX_RENDER_COUNT && this.pageQueue.size === 1) {
                setTimeout(() => this.resetBrowser(), 1000);
            }
            
            return imagePath;
            
        } finally {
            // 清理页面资源
            if (page) {
                try {
                    await page.close();
                } catch (e) {
                    // 忽略关闭错误
                }
            }
            this.pageQueue.delete(pageId);
        }
    }

    // 配置页面
    async configurePage(page, config) {
        if (config.authentication) {
            await page.authenticate(config.authentication);
        }
        
        if (config.cookies) {
            await page.setCookie(...config.cookies);
        }
        
        if (config.userAgent) {
            await page.setUserAgent(config.userAgent);
        }
        
        if (config.emulateDevice) {
            try {
                const renderer = getRenderer();
                if (renderer && renderer.emulateDevice && typeof renderer.emulateDevice === 'function') {
                    await renderer.emulateDevice(page, config.emulateDevice);
                } else {
                    await page.setViewport({
                        width: config.width || 800,
                        height: config.height || 600,
                        deviceScaleFactor: config.deviceScaleFactor
                    });
                }
            } catch (err) {
                await page.setViewport({
                    width: config.width || 800,
                    height: config.height || 600,
                    deviceScaleFactor: config.deviceScaleFactor
                });
            }
        } else {
            await page.setViewport({
                width: config.width || 800,
                height: config.height || 600,
                deviceScaleFactor: config.deviceScaleFactor
            });
        }
        
        await page.setJavaScriptEnabled(config.javascript);
        
        if (config.dark) {
            await page.emulateMediaFeatures([{
                name: 'prefers-color-scheme',
                value: 'dark'
            }]);
        }
        
        // 防止检测自动化
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false
            });
        });
    }

    // 等待页面加载
    async waitForPage(page, config) {
        if (config.waitForSelector) {
            await page.waitForSelector(config.waitForSelector, {
                timeout: 30000
            }).catch(err => logger.warn(`等待选择器失败: ${config.waitForSelector}`, err));
        }
        
        if (config.waitForTimeout) {
            await page.waitForTimeout(config.waitForTimeout);
        }
        
        if (config.scrollToBottom) {
            await page.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight) {
                            clearInterval(timer);
                            window.scrollTo(0, 0);
                            resolve();
                        }
                    }, 100);
                });
            }).catch(err => logger.warn('滚动到底部失败:', err));
        }
        
        if (config.hideScrollbars) {
            await page.evaluate(() => {
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
            }).catch(err => logger.warn('隐藏滚动条失败:', err));
        }
        
        // 等待图片加载
        await page.evaluate(() => {
            return new Promise((resolve) => {
                const timeout = setTimeout(resolve, 3000);
                const images = document.querySelectorAll('img');
                if (images.length === 0) {
                    clearTimeout(timeout);
                    return resolve();
                }
                let loaded = 0;
                const onLoad = () => {
                    loaded++;
                    if (loaded === images.length) {
                        clearTimeout(timeout);
                        resolve();
                    }
                };
                images.forEach((img) => {
                    if (img.complete) {
                        onLoad();
                    } else {
                        img.onload = onLoad;
                        img.onerror = onLoad;
                    }
                });
            });
        }).catch(() => {});
    }

    // 准备截图选项
    async prepareScreenshotOptions(page, config) {
        const options = {
            type: config.type,
            quality: config.type === 'jpeg' ? config.quality : undefined,
            fullPage: config.fullPage,
            omitBackground: config.omitBackground,
            encoding: config.encoding === 'base64' ? 'base64' : 'binary'
        };
        
        if (config.fullPage || (config.clip && typeof config.clip === 'object')) {
            if (config.clip) {
                options.clip = config.clip;
            }
            return options;
        }
        
        const contentDimensions = await page.evaluate(() => ({
            width: Math.max(
                document.body.scrollWidth,
                document.documentElement.scrollWidth,
                document.body.offsetWidth,
                document.documentElement.offsetWidth,
                document.body.clientWidth,
                document.documentElement.clientWidth
            ),
            height: Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight,
                document.body.offsetHeight,
                document.documentElement.offsetHeight,
                document.body.clientHeight,
                document.documentElement.clientHeight
            )
        })).catch(() => ({ width: 800, height: 600 }));
        
        let { width, height } = contentDimensions;
        let x = Math.floor(width * config.leftCutRatio);
        width -= x + Math.floor(width * config.rightCutRatio);
        let y = Math.floor(height * config.topCutRatio);
        height -= y + Math.floor(height * config.bottomCutRatio);
        
        width = Math.max(width, 1);
        height = Math.max(height, 1);
        
        options.clip = { x, y, width, height };
        
        if (config.selector) {
            const elementHandle = await page.$(config.selector);
            if (elementHandle) {
                const box = await elementHandle.boundingBox();
                if (box) {
                    const clipX = Math.max(x, box.x);
                    const clipY = Math.max(y, box.y);
                    const clipWidth = Math.min(width, box.width);
                    const clipHeight = Math.min(height, box.height);
                    if (clipWidth > 0 && clipHeight > 0) {
                        options.clip = {
                            x: clipX,
                            y: clipY,
                            width: clipWidth,
                            height: clipHeight
                        };
                    }
                }
            }
        }
        
        return options;
    }

    // 使用默认图片
    useDefaultImage(imageName, config, outputBasePath) {
        const defaultImagePath = path.join(outputBasePath, `${imageName}.${config.type}`);
        try {
            fs.copyFileSync(DEFAULT_IMAGE_PATH, defaultImagePath);
            return defaultImagePath;
        } catch (error) {
            logger.error('[Screenshot] 复制默认图片失败:', error);
            return DEFAULT_IMAGE_PATH;
        }
    }
}

const DEFAULT_CONFIG = {
    width: null,
    height: null,
    quality: 100,
    type: 'jpeg',
    deviceScaleFactor: cfg.bot?.screen_shot_quality || 1,
    selector: null,
    waitForSelector: null,
    waitForTimeout: null,
    waitUntil: 'networkidle2',
    fullPage: false,
    topCutRatio: 0,
    bottomCutRatio: 0,
    leftCutRatio: 0,
    rightCutRatio: 0,
    cacheTime: 3600,
    emulateDevice: null,
    userAgent: null,
    timeout: 120000,
    scrollToBottom: true,
    cookies: null,
    allowFailure: true,
    authentication: null,
    clip: null,
    omitBackground: false,
    encoding: 'binary',
    hideScrollbars: true,
    javascript: true,
    dark: false,
    retryCount: 2,
    retryDelay: 1000
};

// 创建管理器单例
const manager = new ScreenshotManager();

/**
 * 获取截图
 * @param {string} target - 目标 URL 或文件路径
 * @param {string} imageName - 输出图片名称
 * @param {object} config - 截图配置
 * @returns {Promise<string>} 图片路径
 */
export async function takeScreenshot(target, imageName, config = {}) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    if (!fs.existsSync(OUTPUT_BASE_PATH)) {
        fs.mkdirSync(OUTPUT_BASE_PATH, { recursive: true });
    }
    
    for (let retryAttempt = 0; retryAttempt <= finalConfig.retryCount; retryAttempt++) {
        try {
            const imagePath = await manager.executeScreenshot(target, imageName, finalConfig);
            return imagePath;
            
        } catch (error) {
            logger.error(`[Screenshot] 失败 [${retryAttempt + 1}/${finalConfig.retryCount + 1}]: ${error.message}`);
            
            const db = await manager.initDB();
            const today = new Date().toISOString().split('T')[0];
            const now = new Date().toISOString();
            await db.run(
                `INSERT INTO error_logs (date, time, error, stack, target) VALUES (?, ?, ?, ?, ?)`,
                today, now, error.message, error.stack, target
            ).catch(() => {});
            
            if (retryAttempt < finalConfig.retryCount) {
                if (error.message.includes('浏览器') || error.message.includes('Protocol') || 
                error.message.includes('Target closed') || error.message.includes('Session closed')) {
                await manager.resetBrowser();
            }
                
                await new Promise(resolve => setTimeout(resolve, finalConfig.retryDelay));
                continue;
            }
            
            if (finalConfig.allowFailure) {
                return manager.useDefaultImage(imageName, finalConfig, OUTPUT_BASE_PATH);
            }
            
            throw error;
        }
    }
}