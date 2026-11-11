#!/usr/bin/env node
/**
 * 船板 Antigravity 主题补丁自动维护与定时同步套件
 * 1. 每 10 天自动从 GitHub 拉取最新补丁并重新部署
 * 2. 监测客户端更新（Antigravity.exe 指纹变化），发生更新后自动重新部署并注入
 * 3. 守护进程 (daemon) 存活检测与后台保活
 * 4. 实时窗口注入状态巡检与自愈
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';

const home = os.homedir();
const targetDir = path.join(home, '.gemini', 'antigravity', 'theme-patch');
const repoDir = targetDir;
const stateFile = path.join(targetDir, 'auto-sync-state.json');
const daemonScript = path.join(home, '.gemini', 'antigravity', 'scripts', 'antigravity-font-daemon.mjs');
const vbsLauncher = path.join(targetDir, 'AntigravityThemeDaemon.vbs');
const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const antigravityExe = path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe');
const installScript = path.join(repoDir, 'install.mjs');

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

function readState() {
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch {}
  return {
    lastGitUpdate: 0,
    clientFingerprint: '',
    lastRun: 0
  };
}

function writeState(st) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(st, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[AutoSync] Error writing state file:', err.message);
  }
}

function getClientFingerprint() {
  try {
    if (fs.existsSync(antigravityExe)) {
      const st = fs.statSync(antigravityExe);
      return `${st.size}:${st.mtimeMs}`;
    }
  } catch {}
  return '';
}

function runCommand(cmd, args, cwd = repoDir) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    encoding: 'utf8'
  });
  return res.status === 0;
}

function isDaemonRunning() {
  try {
    const res = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | Select-Object -ExpandProperty CommandLine'
    ], { windowsHide: true, encoding: 'utf8' });
    const output = res.stdout || '';
    return output.includes('antigravity-font-daemon.mjs') || output.includes('theme-patch\\core\\daemon.mjs');
  } catch {
    return false;
  }
}

function ensureDaemonRunning() {
  if (isDaemonRunning()) {
    console.log('[AutoSync] Antigravity Theme Daemon is actively running.');
    return;
  }
  console.log('[AutoSync] Daemon is not running. Starting background daemon...');
  if (fs.existsSync(vbsLauncher)) {
    spawn('wscript.exe', ['//B', '//NoLogo', vbsLauncher], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } else {
    spawn(process.execPath, ['--disable-warning=ExperimentalWarning', daemonScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const forceGit = args.includes('--force-git-update');
  const forceClient = args.includes('--force-client-update');
  const state = readState();
  const now = Date.now();

  console.log(`[AutoSync] Starting sync check at ${new Date().toLocaleString()}...`);

  // 1. 检查客户端更新
  const currentFp = getClientFingerprint();
  let clientChanged = false;
  if (currentFp && state.clientFingerprint && currentFp !== state.clientFingerprint) {
    clientChanged = true;
    console.log('[AutoSync] >> Antigravity client update detected! <<');
  } else if (!state.clientFingerprint && currentFp) {
    state.clientFingerprint = currentFp;
  }

  // 2. 检查 Git 是否达到 10 天
  const timeSinceLastGit = now - (state.lastGitUpdate || 0);
  const gitNeedsUpdate = forceGit || timeSinceLastGit >= TEN_DAYS_MS;

  if (gitNeedsUpdate && !fs.existsSync(path.join(repoDir, ".git"))) {
    console.log("[AutoSync] Keeping the verified local build; upstream changes require merging before deployment.");
    state.lastGitUpdate = now;
  } else if (gitNeedsUpdate) {
    console.log(`[AutoSync] >> 10-day Git update triggered (elapsed: ${(timeSinceLastGit / (1000 * 60 * 60 * 24)).toFixed(1)} days) <<`);
    console.log('[AutoSync] Pulling latest repository from GitHub...');
    const pullOk = runCommand('git', ['pull', '--rebase']);
    if (pullOk) {
      console.log('[AutoSync] Repository updated successfully.');
      state.lastGitUpdate = now;
    } else {
      console.warn('[AutoSync] Warning: git pull failed, will retry next schedule.');
    }
  }

  // 3. 如果客户端更新或 Git 更新，重新部署
  if (clientChanged || forceClient || gitNeedsUpdate) {
    console.log('[AutoSync] Running node install.mjs install...');
    runCommand(process.execPath, ['install.mjs', 'install']);
    if (currentFp) state.clientFingerprint = currentFp;
  }

  // 4. 无论是否更新，确保当前运行的客户端已经注入生效
  console.log('[AutoSync] Running node install.mjs verify...');
  runCommand(process.execPath, ['install.mjs', 'verify']);

  // 5. 保活后台守护进程
  ensureDaemonRunning();

  state.lastRun = now;
  writeState(state);
  console.log('[AutoSync] Sync and health check completed.\n');
}

main().catch((err) => {
  console.error('[AutoSync] Fatal error:', err);
  process.exit(1);
});
