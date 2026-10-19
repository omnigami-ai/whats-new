// Find a local Chrome, Chromium, Edge or Brave for puppeteer-core.
// CHROME_PATH wins. Returns null when none is found.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    win32: [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    ],
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  }[process.platform] || [];
  for (const c of candidates) {
    if (path.isAbsolute(c)) { if (existsSync(c)) return c; continue; }
    try { return execFileSync('which', [c], { encoding: 'utf8' }).trim() || null; } catch { /* next */ }
  }
  return null;
}

// Chrome's sandbox needs kernel features that a Linux container or a root user
// usually lacks. There, and only there, Chrome runs without it.
export function chromeArgs() {
  const contained = process.platform === 'linux' && (process.getuid?.() === 0 || existsSync('/.dockerenv') || existsSync('/run/.containerenv') || Boolean(process.env.container));
  return contained ? ['--no-sandbox'] : [];
}

export function requireChrome() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome found. Install Google Chrome, or run\n  npx @puppeteer/browsers install chrome-headless-shell@stable\nand set CHROME_PATH to the path it prints.');
    process.exit(2);
  }
  return chrome;
}
