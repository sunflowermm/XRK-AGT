const { arch, platform } = require('os');
const { existsSync, statSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

let skipDownload = false;
let executablePath;

function safeExecSync(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      ...options
    }).toString().trim();
  } catch {
    return null;
  }
}

const currentPlatform = platform();
const currentArch = arch();

function isExecutable(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    if (currentPlatform !== 'win32') {
      const stats = statSync(filePath);
      return !!(stats.mode & parseInt('111', 8));
    }
    return true;
  } catch {
    return false;
  }
}

if (['linux', 'android'].includes(currentPlatform)) {
  const browsers = ['chromium', 'chromium-browser', 'chrome', 'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable', 'microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta'];
  const commands = ['command -v', 'which', 'whereis -b'];

  for (const browser of browsers) {
    for (const cmdPrefix of commands) {
      const cmd = cmdPrefix === 'whereis -b' ? `${cmdPrefix} ${browser} | cut -d' ' -f2` : `${cmdPrefix} ${browser}`;
      const browserPath = safeExecSync(cmd);
      if (browserPath && isExecutable(browserPath)) {
        executablePath = browserPath;
        break;
      }
    }
    if (executablePath) break;
  }

  if (!executablePath) {
    const linuxPaths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/snap/bin/chrome', '/opt/google/chrome/chrome', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'];
    for (const browserPath of linuxPaths) {
      if (isExecutable(browserPath)) {
        executablePath = browserPath;
        break;
      }
    }
  }
}

if (!executablePath) {
  const commonPaths = currentPlatform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.USERPROFILE || '', 'AppData/Local/Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ]
    : currentPlatform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          path.join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
          path.join(process.env.HOME || '', 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
        ]
      : [];

  for (const browserPath of commonPaths) {
    if (browserPath && isExecutable(browserPath)) {
      executablePath = browserPath;
      break;
    }
  }
}

if (executablePath || ['arm64', 'aarch64', 'arm'].includes(currentArch) || (currentPlatform === 'linux' && ['armv7l', 'armv6l'].includes(currentArch))) {
  const logger = global?.logger || (typeof window !== 'undefined' && window.logger) || console;
  logger.info(executablePath ? `[Browser] Found: ${executablePath}` : `[Browser] Skipping download for architecture: ${currentArch}`);
  skipDownload = true;
}

module.exports = {
  skipDownload,
  executablePath,
  platform: currentPlatform,
  architecture: currentArch
};