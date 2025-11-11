const { arch, platform } = require("os")
const { existsSync } = require("fs")
const { execSync } = require("child_process")
const path = require("path")

let skipDownload = false
let executablePath

// 安全的命令执行函数
function safeExecSync(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      ...options 
    }).toString().trim()
  } catch (err) {
    return null
  }
}

function isExecutable(filePath) {
  try {
    if (!existsSync(filePath)) return false
    if (platform() !== 'win32') {
      const stats = require('fs').statSync(filePath)
      return !!(stats.mode & parseInt('111', 8))
    }
    return true
  } catch (err) {
    return false
  }
}

// Linux/Android 浏览器检测
if (["linux", "android"].includes(platform())) {
  const browsers = [
    "chromium",
    "chromium-browser", 
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "google-chrome-beta",
    "google-chrome-unstable",
    "microsoft-edge",
    "microsoft-edge-stable",
    "microsoft-edge-beta"
  ]
  
  for (const browser of browsers) {
    const commands = [
      `command -v ${browser}`,
      `which ${browser}`,
      `whereis -b ${browser} | cut -d' ' -f2`
    ]
    
    for (const cmd of commands) {
      const browserPath = safeExecSync(cmd)
      if (browserPath && isExecutable(browserPath)) {
        executablePath = browserPath
        break
      }
    }
    
    if (executablePath) break
  }
  
  // 检查常见的Linux安装路径
  if (!executablePath) {
    const linuxPaths = [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
      "/snap/bin/chrome",
      "/opt/google/chrome/chrome",
      "/usr/bin/microsoft-edge",
      "/opt/microsoft/msedge/msedge"
    ]
    
    for (const browserPath of linuxPaths) {
      if (isExecutable(browserPath)) {
        executablePath = browserPath
        break
      }
    }
  }
}

// Windows/macOS/其他平台的路径检测
if (!executablePath) {
  let commonPaths = []
  
  if (platform() === 'win32') {
    const programFiles = process.env['ProgramFiles'] || "C:/Program Files"
    const programFilesX86 = process.env['ProgramFiles(x86)'] || "C:/Program Files (x86)"
    const localAppData = process.env['LOCALAPPDATA'] || ""
    const userProfile = process.env['USERPROFILE'] || ""
    
    commonPaths = [
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
      path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
      path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
      path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
      path.join(userProfile, "AppData/Local/Google/Chrome/Application/chrome.exe"),
      path.join(localAppData, "Microsoft/Edge/Application/msedge.exe"),
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    ]
  } else if (platform() === 'darwin') {
    commonPaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      path.join(process.env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      path.join(process.env.HOME || "", "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
    ]
  }
  
  for (const browserPath of commonPaths) {
    if (browserPath && isExecutable(browserPath)) {
      executablePath = browserPath
      break
    }
  }
}

// 检查是否应该跳过下载
const currentArch = arch()
if (executablePath || 
    ["arm64", "aarch64", "arm"].includes(currentArch) ||
    (platform() === 'linux' && ["armv7l", "armv6l"].includes(currentArch))) {
  
  const logger = (typeof global !== 'undefined' && global.logger) || 
                 (typeof window !== 'undefined' && window.logger) || 
                 console
  
  if (executablePath) {
    logger.info(`[Browser] Found: ${executablePath}`)
  } else {
    logger.info(`[Browser] Skipping download for architecture: ${currentArch}`)
  }
  
  skipDownload = true
}

module.exports = { 
  skipDownload, 
  executablePath,
  platform: platform(),
  architecture: currentArch
}