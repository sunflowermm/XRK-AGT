const { arch, platform } = require('os');
const { existsSync, statSync } = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const currentPlatform = platform();
const currentArch = arch();

const LINUX_BINS = [
  'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
  'microsoft-edge', 'microsoft-edge-stable'
];

const LINUX_PATHS = [
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/opt/google/chrome/chrome',
  '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'
];

const WIN_PATHS = [
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')
];

const DARWIN_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

function isExecutable(filePath) {
  try {
    if (!filePath || !existsSync(filePath)) return false;
    if (currentPlatform !== 'win32') {
      return !!(statSync(filePath).mode & parseInt('111', 8));
    }
    return true;
  } catch {
    return false;
  }
}

function tryWhich(bin) {
  try {
    const found = execFileSync('which', [bin], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
    return isExecutable(found) ? found : null;
  } catch {
    return null;
  }
}

/** @returns {string | null} */
function findSystemBrowser() {
  if (['linux', 'android'].includes(currentPlatform)) {
    for (const bin of LINUX_BINS) {
      const found = tryWhich(bin);
      if (found) return found;
    }
    for (const browserPath of LINUX_PATHS) {
      if (isExecutable(browserPath)) return browserPath;
    }
    return null;
  }

  const paths = currentPlatform === 'win32'
    ? WIN_PATHS
    : currentPlatform === 'darwin'
      ? DARWIN_PATHS
      : [];

  for (const browserPath of paths) {
    if (isExecutable(browserPath)) return browserPath;
  }
  return null;
}

module.exports = {
  findSystemBrowser,
  currentPlatform,
  currentArch
};
