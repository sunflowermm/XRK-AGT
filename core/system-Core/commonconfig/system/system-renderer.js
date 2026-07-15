import { getPort } from './system-schema-helpers.js';
import path from 'path';
import paths from '#utils/paths.js';
import runtimeConfig from '#infrastructure/config/config.js';
export const rendererConfig = {
      name: 'renderer',
      displayName: '渲染器配置',
      description: 'Puppeteer/Playwright 截图配置，路径: data/server_bots/{port}/renderers/{type}/config.yaml',
      filePath: (runtimeConfig) => {
        const port = getPort(runtimeConfig);
        if (!port) throw new Error('SystemConfig: 渲染器配置需要端口号');
        return `data/server_bots/${port}/renderers/{type}/config.yaml`;
      },
      fileType: 'yaml',
      multiFile: {
        keys: ['puppeteer', 'playwright'],
        getFilePath: (key) => {
          const port = getPort(runtimeConfig);
          if (!port) throw new Error('SystemConfig: 渲染器配置需要端口号');
          return path.join(paths.root, `data/server_bots/${port}/renderers/${key}/config.yaml`);
        },
        getDefaultFilePath: (key) => path.join(paths.renderers, key, 'config_default.yaml')
      },
      schema: {
        fields: {
          puppeteer: {
            type: 'object',
            label: 'Puppeteer',
            component: 'SubForm',
            fields: {
              headless: { type: 'string', label: '无头模式', enum: ['new', 'old', 'false'], default: 'new', component: 'Select' },
              chromiumPath: { type: 'string', label: 'Chromium 路径', default: '', component: 'Input' },
              wsEndpoint: { type: 'string', label: '远程 WS 地址', default: '', component: 'Input' },
              args: { type: 'array', label: '启动参数', itemType: 'string', default: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'], component: 'Tags' },
              puppeteerTimeout: { type: 'number', label: '截图超时(ms)', min: 1000, default: 120000, component: 'InputNumber' },
              restartNum: { type: 'number', label: 'N 次后重启', min: 1, default: 150, component: 'InputNumber' },
              viewport: {
                type: 'object',
                label: '视口',
                component: 'SubForm',
                fields: {
                  width: { type: 'number', label: '宽', min: 1, default: 1280, component: 'InputNumber' },
                  height: { type: 'number', label: '高', min: 1, default: 720, component: 'InputNumber' },
                  deviceScaleFactor: { type: 'number', label: '缩放', min: 0.1, max: 5, default: 1, component: 'InputNumber' }
                }
              }
            }
          },
          playwright: {
            type: 'object',
            label: 'Playwright',
            component: 'SubForm',
            fields: {
              browserType: { type: 'string', label: '浏览器', enum: ['chromium', 'firefox', 'webkit'], default: 'chromium', component: 'Select' },
              headless: { type: 'boolean', label: '无头', default: true, component: 'Switch' },
              chromiumPath: { type: 'string', label: 'Chromium 路径', default: '', component: 'Input' },
              wsEndpoint: { type: 'string', label: '远程 WS 地址', default: '', component: 'Input' },
              args: { type: 'array', label: '启动参数', itemType: 'string', default: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'], component: 'Tags' },
              playwrightTimeout: { type: 'number', label: '截图超时(ms)', min: 1000, default: 120000, component: 'InputNumber' },
              healthCheckInterval: { type: 'number', label: '健康检查(ms)', min: 1000, default: 60000, component: 'InputNumber' },
              maxRetries: { type: 'number', label: '重试次数', min: 0, default: 3, component: 'InputNumber' },
              retryDelay: { type: 'number', label: '重试延迟(ms)', min: 100, default: 2000, component: 'InputNumber' },
              restartNum: { type: 'number', label: 'N 次后重启', min: 1, default: 150, component: 'InputNumber' },
              viewport: {
                type: 'object',
                label: '视口',
                component: 'SubForm',
                fields: {
                  width: { type: 'number', label: '宽', min: 1, default: 1280, component: 'InputNumber' },
                  height: { type: 'number', label: '高', min: 1, default: 720, component: 'InputNumber' },
                  deviceScaleFactor: { type: 'number', label: '缩放', min: 0.1, max: 5, default: 1, component: 'InputNumber' }
                }
              },
              contextOptions: {
                type: 'object',
                label: '上下文',
                component: 'SubForm',
                fields: {
                  bypassCSP: { type: 'boolean', label: '绕过 CSP', default: true, component: 'Switch' },
                  reducedMotion: { type: 'string', label: '减少动画', enum: ['reduce', 'no-preference'], default: 'reduce', component: 'Select' }
                }
              }
            }
          }
        }
      }
    }
