const { findSystemBrowser, currentArch, currentPlatform } = require('./src/utils/system-browser.cjs');

const executablePath = findSystemBrowser();
const skipDownload = !!(
  executablePath
  || ['arm64', 'aarch64', 'arm'].includes(currentArch)
  || (currentPlatform === 'linux' && ['armv7l', 'armv6l'].includes(currentArch))
);

module.exports = {
  skipDownload,
  executablePath,
  platform: currentPlatform,
  architecture: currentArch
};
