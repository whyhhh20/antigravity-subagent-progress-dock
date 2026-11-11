#!/usr/bin/env node
/**
 * chuanban-antigravity-theme-patch · CDP Theme & Live Metrics Daemon (core/daemon.mjs)
 *
 * 架构特性（v5.1.1）：
 * 1. 动态 Node 分级：
 *    - Node >= 22.0：完整启用昼夜双模式独立主题（暖纸浅色 + 官方 onyx 深色）、四层字体、输入框三态、634条汉化、死锁自愈。
 *    - Node >= 22.13：动态 `await import('node:sqlite')` 解锁底部实时会话指标胶囊；低版本优雅降级绝不崩溃。
 * 2. 模块化与热重载：
 *    - 周期性检测 `user/config.json`、`user/custom.css`、`user/i18n.override.json`、`user/custom.js` 的 mtime，
 *      用户或对方 Agent 修改 `user/` 层后 2.5 秒内自动重新构建签名并热更新至所有打开的 Antigravity 窗口。
 * 3. 双通道同进程共生：
 *    - 默认 `channel: "auto"` 同时探测 Stable 与 Insiders 调试端口（亦可通过 `--channel stable|insiders` 锁定单通道）。
 * 4. 安全模式隔离：
 *    - 支持 `--safe-mode` 启动参数，一键绕过 `user/` 改装层，仅加载 `core/` 黄金内核用于故障定界。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const USER_DIR = path.join(ROOT_DIR, 'user');

// ============================================================================
// 0. 动态探测 node:sqlite（Node >= 22.13 自动解锁，低版本优雅降级）
// ============================================================================
let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite').catch(() => null);
  if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
    DatabaseSync = sqliteMod.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

// ============================================================================
// 1. CLI 参数解析（同时兼容 --flag value 与 --flag=value）与跨平台路径探测
// ============================================================================
const args = process.argv.slice(2);
const hasFlag = (f) => args.some((a) => a === f || a.startsWith(f + '='));
function getArg(flag, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return fallback;
}

const SAFE_MODE = hasFlag('--safe-mode');
const RUN_ONCE = hasFlag('--once');
const CLI_CHANNEL = getArg('--channel', null);

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextSafe(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function resolveChannelPaths(singleChannel = 'stable', userCfg = {}) {
  const home = os.homedir();
  const isInsiders = singleChannel === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  const geminiSubDir = isInsiders ? '.gemini/antigravity-insiders' : '.gemini/antigravity';

  let defaultPortFile;
  if (process.platform === 'darwin') {
    defaultPortFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    defaultPortFile = path.join(appData, appDirName, 'DevToolsActivePort');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    defaultPortFile = path.join(xdgConfig, appDirName, 'DevToolsActivePort');
  }

  const defaultConvDir = path.join(home, geminiSubDir, 'conversations');
  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const m = fs.readFileSync(argvPath, 'utf8').match(/"remote-debugging-port"\s*:\s*(\d+)/);
      if (m && parseInt(m[1], 10) > 0) fallbackPort = parseInt(m[1], 10);
    }
  } catch {}

  const portFile = getArg('--port-file', userCfg.portFile || defaultPortFile);
  const channelInstalled =
    fs.existsSync(portFile) || fs.existsSync(path.dirname(defaultPortFile)) || fs.existsSync(dotDir);

  return {
    channel: singleChannel,
    portFile,
    fallbackPort: Number(userCfg.fallbackPort) > 0 ? Number(userCfg.fallbackPort) : fallbackPort,
    channelInstalled,
    conversationsDir: getArg('--conversations-dir', userCfg.conversationsDir || defaultConvDir)
  };
}

function resolveActiveChannelEndpoints(channelMode = 'auto', userCfg = {}) {
  const explicitPortFile = getArg('--port-file', userCfg.portFile || '');
  if (explicitPortFile) {
    const ch = channelMode === 'insiders' ? 'insiders' : 'stable';
    return [resolveChannelPaths(ch, userCfg)];
  }
  if (channelMode === 'stable') {
    return [resolveChannelPaths('stable', userCfg)];
  }
  if (channelMode === 'insiders') {
    return [resolveChannelPaths('insiders', userCfg)];
  }
  // 'auto' 或 'both'：同时轮询 Stable 与 Insiders 两个通道，互不抢占
  return [resolveChannelPaths('stable', userCfg), resolveChannelPaths('insiders', userCfg)];
}

// ============================================================================
// 2. 动态构建注入载荷（支持 core/ + user/ 实时合并与热更新签名）
// ============================================================================
const BASE_VERSION = '20261110-v5.1.1-subagent.1';
let cachedBundleSig = '';
let cachedInjectScript = '';
let cachedPatchVersion = '';
let activeConfig = {
  enabled: true,
  channel: 'auto',
  preset: 'high-contrast',
  contextLimit: 256000,
  modules: {
    i18n: true,
    metrics: true,
    composerWaxSeal: true,
    deadlockHealer: true,
    customCss: true,
    customJs: true
  },
  themeVars: {},
  allowedOrigins: ['http://127.0.0.1', 'https://127.0.0.1', 'http://localhost', 'https://localhost', 'vscode-file://'],
  endpoints: []
};

function getFileMtimeSig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '0:0';
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '0:0';
  }
}

function normalizeOverrideDict(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') return {};
  const source = rawObj.exact && typeof rawObj.exact === 'object' ? rawObj.exact : rawObj;
  const clean = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

function rebuildBundleIfNeeded() {
  const coreFiles = [
    path.join(CORE_DIR, 'theme.css'),
    path.join(CORE_DIR, 'i18n.json'),
    path.join(CORE_DIR, 'runtime.js')
  ];
  const userFiles = SAFE_MODE
    ? []
    : [
        path.join(USER_DIR, 'config.json'),
        path.join(USER_DIR, 'custom.css'),
        path.join(USER_DIR, 'i18n.override.json'),
        path.join(USER_DIR, 'custom.js')
      ];

  const sig = [...coreFiles, ...userFiles].map(getFileMtimeSig).join('|') + `|safe:${SAFE_MODE}|cli:${CLI_CHANNEL || ''}`;
  if (sig === cachedBundleSig && cachedInjectScript) {
    return false;
  }

  const userCfg = SAFE_MODE ? {} : readJsonSafe(path.join(USER_DIR, 'config.json'), {});
  const enabled = SAFE_MODE ? true : userCfg.enabled !== false;
  const channel = CLI_CHANNEL || userCfg.channel || 'auto';
  const preset = userCfg.preset || 'high-contrast';
  const contextLimit = Number(userCfg.contextLimit) > 0 ? Number(userCfg.contextLimit) : 256000;

  const rawModules = Object.assign({}, userCfg.features || {}, userCfg.modules || {});
  if (typeof rawModules.metricsCapsule === 'boolean' && typeof rawModules.metrics !== 'boolean') {
    rawModules.metrics = rawModules.metricsCapsule;
  }
  const modules = Object.assign(
    {
      i18n: true,
      metrics: true,
      subagentProgress: true,
      composerWaxSeal: true,
      deadlockHealer: true,
      customCss: true,
      customJs: true
    },
    rawModules
  );
  if (!DatabaseSync) {
    modules.metrics = false;
    modules.subagentProgress = false;
  }
  modules.metricsCapsule = modules.metrics;

  const themeVars = !SAFE_MODE && userCfg.themeVars && typeof userCfg.themeVars === 'object' ? userCfg.themeVars : {};
  const endpoints = resolveActiveChannelEndpoints(channel, userCfg);

  const normalizedSelectors = Object.assign({}, userCfg.selectors || {});
  if (
    normalizedSelectors.branchPillInBox &&
    !String(normalizedSelectors.branchPillInBox).includes('project-branch-picker')
  ) {
    delete normalizedSelectors.branchPillInBox;
  }
  if (normalizedSelectors.homeGreeting && !String(normalizedSelectors.homeGreeting).includes('home-splash-content')) {
    delete normalizedSelectors.homeGreeting;
  }

  activeConfig = {
    enabled,
    channel,
    preset,
    contextLimit,
    modules,
    themeVars,
    selectors: normalizedSelectors,
    allowedOrigins: Array.isArray(userCfg.allowedOrigins)
      ? userCfg.allowedOrigins
      : ['http://127.0.0.1', 'https://127.0.0.1', 'http://localhost', 'https://localhost', 'vscode-file://'],
    endpoints
  };

  const baseCss = readTextSafe(path.join(CORE_DIR, 'theme.css'), '');
  const customCss = !SAFE_MODE && modules.customCss ? readTextSafe(path.join(USER_DIR, 'custom.css'), '') : '';

  const baseDict = readJsonSafe(path.join(CORE_DIR, 'i18n.json'), {});
  const rawOverrideDict = !SAFE_MODE ? readJsonSafe(path.join(USER_DIR, 'i18n.override.json'), {}) : {};
  const overrideDict = normalizeOverrideDict(rawOverrideDict);
  const mergedDict = Object.assign({}, baseDict, overrideDict);

  const customJs = !SAFE_MODE && modules.customJs ? readTextSafe(path.join(USER_DIR, 'custom.js'), '') : '';
  const runtimeTemplate = readTextSafe(path.join(CORE_DIR, 'runtime.js'), '');

  const hash = crypto
    .createHash('sha256')
    .update(String(enabled))
    .update(runtimeTemplate)
    .update(baseCss)
    .update(customCss)
    .update(JSON.stringify(mergedDict))
    .update(customJs)
    .update(JSON.stringify({ preset, modules, themeVars, selectors: activeConfig.selectors }))
    .digest('hex')
    .slice(0, 8);

  const channelTag = channel === 'insiders' ? 'insiders' : 'stable';
  cachedPatchVersion = `${BASE_VERSION}-${channelTag}-${hash}`;

  const bootPayload = {
    version: cachedPatchVersion,
    platform: process.platform,
    enabled,
    preset,
    cssText: baseCss,
    customCss,
    themeVars,
    i18nDict: mergedDict,
    modules,
    selectors: activeConfig.selectors,
    config: {
      enabled,
      channel,
      preset,
      contextLimit,
      modules,
      themeVars
    },
    customJs
  };

  cachedInjectScript = runtimeTemplate.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(bootPayload)});`);
  cachedBundleSig = sig;
  return true;
}

rebuildBundleIfNeeded();

// ============================================================================
// 3. 单实例 PID 锁（防止重复启动守护进程）
// ============================================================================
const pidKey = CLI_CHANNEL || 'default';
const PID_FILE = path.join(os.tmpdir(), `ag-theme-daemon-${pidKey}.pid`);
if (!RUN_ONCE) {
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          process.kill(oldPid, 'SIGTERM');
        } catch {}
      }
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    const cleanPid = () => {
      try {
        if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(PID_FILE);
        }
      } catch {}
    };
    process.on('exit', cleanPid);
    process.on('SIGINT', () => {
      cleanPid();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanPid();
      process.exit(0);
    });
  } catch {}
}

// ============================================================================
// 4. SQLite + Protobuf 实时会话指标解析器（读取 ~/.gemini/antigravity/conversations/<id>.db）
// ============================================================================
const metricsCache = new Map(); // dbPath -> { sig, payload }
const MAX_METRICS_CACHE_SIZE = 30;

function setMetricsCache(dbPath, entry) {
  if (metricsCache.has(dbPath)) metricsCache.delete(dbPath);
  metricsCache.set(dbPath, entry);
  if (metricsCache.size > MAX_METRICS_CACHE_SIZE) {
    const oldestKey = metricsCache.keys().next().value;
    if (oldestKey) metricsCache.delete(oldestKey);
  }
}

function parseProto(buf) {
  let i = 0;
  const out = new Map();
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    const fn = tag >>> 3;
    const wt = tag & 7;
    if (fn <= 0 || fn > 10000) break;
    if (wt === 0) {
      let val = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        val += (b & 0x7f) * Math.pow(2, s);
        if (!(b & 0x80)) break;
        s += 7;
      }
      out.set(fn, val);
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        len |= (b & 0x7f) << s;
        if (!(b & 0x80)) break;
        s += 7;
      }
      if (len < 0 || i + len > buf.length) break;
      out.set(fn, buf.subarray(i, i + len));
      i += len;
    } else if (wt === 1) {
      if (i + 8 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 8));
      i += 8;
    } else if (wt === 5) {
      if (i + 4 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 4));
      i += 4;
    } else {
      break;
    }
  }
  return out;
}

function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

function getDbSignature(cascadeId, conversationsDir) {
  try {
    const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
    if (!fs.existsSync(dbPath)) return null;
    const st = fs.statSync(dbPath);
    let walSig = '0:0';
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      const wst = fs.statSync(walPath);
      walSig = `${wst.mtimeMs}:${wst.size}`;
    }
    let shmSig = '0:0';
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(shmPath)) {
      const sst = fs.statSync(shmPath);
      shmSig = `${sst.mtimeMs}:${sst.size}`;
    }
    return `${st.mtimeMs}:${st.size}|${walSig}|${shmSig}`;
  } catch {
    return null;
  }
}

function parseConversationMetrics(cascadeId, conversationsDir) {
  if (!DatabaseSync) return null;
  if (!cascadeId || !/^[0-9a-f-]{36}$/i.test(cascadeId)) return null;
  const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
  const sig = getDbSignature(cascadeId, conversationsDir);
  if (!sig) return { cascadeId, hasData: false };

  const cached = metricsCache.get(dbPath);
  if (cached && cached.sig === sig) {
    return cached.payload;
  }

  const contextLimitTokens = activeConfig.contextLimit || 256000;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    if (!rows || rows.length === 0) {
      db.close();
      db = null;
      const emptyPayload = { cascadeId, hasData: false, sig };
      setMetricsCache(dbPath, { sig, payload: emptyPayload });
      return emptyPayload;
    }
    // 利用 idx_steps_step_type 覆盖索引直接在 SQLite C 引擎内完成聚合计数，0 数组分配
    const userStat = db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS lastIdx FROM steps WHERE step_type = 14')
      .get();
    const lastUserStepIdx = userStat?.lastIdx ?? -1;
    const userStepsCount = userStat?.cnt ?? 0;
    const turnStat = db
      .prepare('SELECT COUNT(*) AS cnt FROM steps WHERE step_type = 15 AND idx > ?')
      .get(lastUserStepIdx);
    const rawTurnSteps = turnStat?.cnt ?? 0;
    db.close();
    db = null;

    let totalIn = 0;
    let totalCache = 0;
    let totalOut = 0;
    let totalThink = 0;
    let totalResp = 0;

    const parsed = rows.map((r) => {
      const top = parseProto(r.data);
      const chat = top.has(1) ? parseProto(top.get(1)) : new Map();
      const usage = chat.has(4) ? parseProto(chat.get(4)) : new Map();
      const ttftMap = chat.has(11) ? parseProto(chat.get(11)) : new Map();
      const streamMap = chat.has(12) ? parseProto(chat.get(12)) : new Map();

      const inTok = usage.get(2) || 0;
      const outTok = usage.get(3) || 0;
      const cacheRead = usage.get(5) || 0;
      const thinkTok = usage.get(9) || 0;
      const respTok = usage.get(10) || 0;
      const ttft = (ttftMap.get(1) || 0) + (ttftMap.get(2) || 0) / 1e9;
      const stream = (streamMap.get(1) || 0) + (streamMap.get(2) || 0) / 1e9;

      totalIn += inTok;
      totalCache += cacheRead;
      totalOut += outTok;
      totalThink += thinkTok;
      totalResp += respTok;

      return {
        idx: r.idx,
        inTok,
        outTok,
        cacheRead,
        ctx: inTok + cacheRead,
        thinkTok,
        respTok,
        ttft,
        stream,
        totDur: ttft + stream
      };
    });

    // 过滤尾部或中间出现的 0 用量异常记录（如无 field 2 的元数据快照），防止 Ctx 显示为 0%
    const valid = parsed.filter((p) => p.ctx > 0 || p.outTok > 0);
    if (valid.length === 0) {
      const emptyPayload = { cascadeId, hasData: false, sig };
      setMetricsCache(dbPath, { sig, payload: emptyPayload });
      return emptyPayload;
    }

    // 统计最后一条用户提问之后的模型规划步数，并从有效调用末尾切片汇总，消除按位置对齐的错位风险
    const turnSlice = rawTurnSteps > 0 ? valid.slice(-rawTurnSteps) : [];
    const turnSteps = turnSlice.length;
    let turnOut = 0;
    let turnThink = 0;
    let turnResp = 0;
    let turnDur = 0;
    for (let i = 0; i < turnSlice.length; i++) {
      turnOut += turnSlice[i].outTok;
      turnThink += turnSlice[i].thinkTok;
      turnResp += turnSlice[i].respTok;
      turnDur += turnSlice[i].totDur;
    }

    const last = valid[valid.length - 1];
    const streamTps = last.stream >= 0.25 ? last.outTok / last.stream : 0;
    const e2eTps = last.totDur > 0 ? last.outTok / last.totDur : 0;
    const displayTps = streamTps > 0 && streamTps <= 600 ? streamTps : e2eTps;
    const ctxPct = Math.round((last.ctx / contextLimitTokens) * 100);
    const ctxClass = ctxPct >= 90 ? 'ag-ctx-crit' : ctxPct >= 75 ? 'ag-ctx-warn' : 'ag-ctx-ok';
    const lastCacheRate = last.ctx > 0 ? ((last.cacheRead / last.ctx) * 100).toFixed(1) : '0.0';
    const sessionCacheRate = totalIn + totalCache > 0 ? ((totalCache / (totalIn + totalCache)) * 100).toFixed(1) : '0.0';
    const remainCtx = Math.max(0, contextLimitTokens - last.ctx);
    const limitKStr = Math.round(contextLimitTokens / 1000) + 'k';

    const inlineHtml = [
      `<span>${Math.round(displayTps)} tok/s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>TTFT ${last.ttft.toFixed(1)}s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Ctx ${fmtTok(last.ctx)}/${limitKStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Out ${fmtTok(last.outTok)}</span>`
    ].join('');

    const turnRowHtml =
      turnSteps > 1
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)}) | 耗时 ${turnDur.toFixed(1)}s</span></div>`
        : '';

    const tooltipHtml = [
      `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${streamTps > 0 && streamTps <= 600 ? `流式 ${streamTps.toFixed(1)} tok/s | ` : ''}端到端 ${e2eTps.toFixed(1)} tok/s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">当前上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})</span></div>`,
      turnRowHtml,
      `<div class="ag-tt-hdr ag-tt-sec">当前会话累计 (${userStepsCount} 轮提问 / ${valid.length} 次有效调用)</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">压缩水位线</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitKStr} (${ctxPct}%) · 距压缩余 ${fmtTok(remainCtx)}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输入量</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`
    ].join('');

    const payload = {
      cascadeId,
      hasData: true,
      sig,
      inlineHtml,
      tooltipHtml
    };
    setMetricsCache(dbPath, { sig, payload });
    return payload;
  } catch {
    if (cached && cached.payload) {
      return cached.payload;
    }
    return { cascadeId, hasData: false };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

// ============================================================================
// 4.5. 子 Agent 运行状态解析与实时调用链树形监控
// ============================================================================
// Subagent status is evidence, not a prediction of remaining work.
const AG_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function readAgentProto(buffer) {
  if (!Buffer.isBuffer(buffer) && !ArrayBuffer.isView(buffer)) return new Map();
  const buf = Buffer.from(buffer || []);
  const fields = new Map();
  let offset = 0;
  const varint = () => {
    let value = 0n;
    for (let byteIndex = 0; byteIndex < 10 && offset < buf.length; byteIndex++) {
      const byte = buf[offset++];
      if (byteIndex === 9 && byte > 1) throw new Error('Invalid protobuf varint');
      value |= BigInt(byte & 127) << BigInt(byteIndex * 7);
      if (!(byte & 128)) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    }
    throw new Error('Invalid protobuf varint');
  };
  try {
    while (offset < buf.length) {
      const tag = varint();
      if (typeof tag !== 'number') break;
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (!field) break;
      let value;
      if (wire === 0) value = varint();
      else if (wire === 2) {
        const length = varint();
        if (typeof length !== 'number' || length > buf.length - offset) break;
        value = buf.subarray(offset, offset + length);
        offset += length;
      } else if (wire === 1 || wire === 5) {
        const length = wire === 1 ? 8 : 4;
        if (length > buf.length - offset) break;
        value = buf.subarray(offset, offset + length);
        offset += length;
      } else break;
      if (!fields.has(field)) fields.set(field, []);
      fields.get(field).push(value);
    }
  } catch {}
  return fields;
}

function agentProtoValue(buffer, field) {
  return readAgentProto(buffer).get(field)?.[0];
}

function extractToolInfo(buf) {
  const tool = agentProtoValue(buf, 4);
  const name = agentProtoValue(tool, 2);
  return Buffer.isBuffer(name) ? name.toString('utf8').trim() : null;
}

function extractJsonFromMetadata(buf) {
  try {
    const args = agentProtoValue(agentProtoValue(buf, 4), 3);
    return Buffer.isBuffer(args) ? JSON.parse(args.toString('utf8')) : null;
  } catch { return null; }
}

function extractTimestampFromMetadata(buf) {
  const time = agentProtoValue(buf, 1);
  const seconds = agentProtoValue(time, 1);
  const nanos = agentProtoValue(time, 2) || 0;
  return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 + Math.floor(nanos / 1e6) : null;
}

function agentHasFinalResponse(row) {
  if (!row || row.step_type !== 15 || row.status !== 3) return false;
  const planner = agentProtoValue(row.step_payload, 20);
  if (!Buffer.isBuffer(planner)) return false;
  const fields = readAgentProto(planner);
  if ((fields.get(7) || []).some(b => Buffer.isBuffer(b) && b.length)) return false;
  return [1, 8].some(f => (fields.get(f) || []).some(b => Buffer.isBuffer(b) && b.toString('utf8').trim()));
}

const agentRowsCache = new Map();
const agentFinalTimeCache = new Map();
function readAgentRows(dbPath) {
  let db;
  try {
    const signature = getDbSignature(path.basename(dbPath, '.db'), path.dirname(dbPath));
    const cached = agentRowsCache.get(dbPath);
    if (cached && cached.signature === signature) return cached.rows;
    db = new DatabaseSync(dbPath, { readOnly: true });
    // Only the last row needs the potentially large response payload. Reuse this
    // snapshot for relationship extraction and status calculation during a poll.
    const columns = new Set(db.prepare('PRAGMA table_info(steps)').all().map(row => row.name));
    const payload = columns.has('step_payload') ? 'CASE WHEN idx = (SELECT max(idx) FROM steps) THEN step_payload END' : 'NULL';
    const errors = columns.has('error_details') ? 'error_details' : 'NULL';
    const rows = db.prepare(`SELECT idx, step_type, status, metadata, render_info, ${errors} AS error_details, ${payload} AS step_payload FROM steps ORDER BY idx ASC`).all();
    agentRowsCache.delete(dbPath);
    agentRowsCache.set(dbPath, { signature, rows });
    if (agentRowsCache.size > 128) agentRowsCache.delete(agentRowsCache.keys().next().value);
    return rows;
  } finally { try { db?.close(); } catch {} }
}

function currentAgentRows(rows, dispatchedAtMs = 0) {
  const users = rows.filter(row => row.step_type === 14);
  const latestUser = users[users.length - 1];
  // A new dispatch must not inherit an old final response while its first step is pending.
  if (dispatchedAtMs) {
    const userTime = extractTimestampFromMetadata(latestUser?.metadata);
    if (!userTime || userTime < dispatchedAtMs) {
      const anchor = rows.find(row => {
        const time = extractTimestampFromMetadata(row.metadata);
        return time && time >= dispatchedAtMs;
      });
      return anchor ? rows.filter(row => row.idx >= anchor.idx) : [];
    }
  }
  return latestUser ? rows.filter(row => row.idx >= latestUser.idx) : rows;
}

function findAgentDescriptor(buf, wanted = '', depth = 0) {
  if (depth > 7 || (!Buffer.isBuffer(buf) && !ArrayBuffer.isView(buf))) return null;
  buf = Buffer.from(buf);
  const fields = readAgentProto(buf);
  const idBuf = fields.get(1)?.[0];
  const id = Buffer.isBuffer(idBuf) ? idBuf.toString('utf8') : '';
  if (AG_UUID.test(id) && (!wanted || id === wanted)) {
    const text = f => Buffer.isBuffer(fields.get(f)?.[0]) ? fields.get(f)[0].toString('utf8').trim() : '';
    return { id, role: text(2) || '子 Agent', type: text(3) };
  }
  for (const values of fields.values()) for (const value of values) {
    const found = findAgentDescriptor(value, wanted, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractSubagentsFromDb(dbPath) {
  if (!DatabaseSync || !fs.existsSync(dbPath)) return [];
  try {
    const all = readAgentRows(dbPath);
    const rows = currentAgentRows(all);
    const ownId = path.basename(dbPath, '.db');
    const historical = new Map();
    for (const row of all) {
      if (extractToolInfo(row.metadata) === 'invoke_subagent') {
        const descriptor = findAgentDescriptor(row.render_info);
        if (descriptor) historical.set(descriptor.id, descriptor);
      }
    }
    const agents = new Map();
    for (const row of rows) {
      const tool = extractToolInfo(row.metadata);
      let descriptor;
      if (tool === 'invoke_subagent') descriptor = findAgentDescriptor(row.render_info);
      else if (tool === 'send_message') {
        const recipient = extractJsonFromMetadata(row.metadata)?.Recipient;
        // Only re-dispatch known children. Reports addressed to a parent are not children.
        if (typeof recipient === 'string' && historical.has(recipient)) descriptor = historical.get(recipient);
      }
      if (!descriptor || descriptor.id === ownId) continue;
      const previous = agents.get(descriptor.id);
      agents.set(descriptor.id, { ...descriptor, dispatchedAtMs: extractTimestampFromMetadata(row.metadata) || 0, dispatchIdx: row.idx, firstDispatchedAtMs: previous?.firstDispatchedAtMs || extractTimestampFromMetadata(row.metadata) || 0 });
    }
    return [...agents.values()];
  } catch { return []; }
}

function cleanActionDescription(_render, metadata, isRunning, toolName = '') {
  const tool = toolName || extractToolInfo(metadata) || '';
  const names = { read_file:'读取文件',write_file:'写入文件',edit_file:'修改文件',run_command:'执行终端命令',send_message:'汇报任务结果',search_web:'检索资料',manage_task:'调度后台任务',invoke_subagent:'调用子 Agent',manage_subagents:'管理子 Agent' };
  const action = names[tool] || (tool ? '调用工具' : '处理任务');
  if (tool === 'run_command') {
    const command = extractJsonFromMetadata(metadata)?.CommandLine;
    // Show useful command families without copying arguments, tokens or URLs.
    const safe = typeof command === 'string' && command.trim().match(/^(git\s+(?:status|diff|log)|npm\s+(?:test|run\s+(?:build|lint|test))|node\s+--test|python\s+-m\s+(?:pytest|unittest))(?=\s|$)/i);
    if (safe) return `${isRunning ? '正在执行' : '已执行'} · ${safe[1].replace(/\s+/g, ' ')}`;
  }
  let file = '';
  if (['read_file','write_file','edit_file'].includes(tool)) {
    const args = extractJsonFromMetadata(metadata);
    if (typeof args?.Path === 'string') file = path.basename(args.Path.replace(/\\/g, '/')).slice(0, 70);
  }
  return `${isRunning ? '正在' : '已'}${action}${file ? ' · ' + file : ''}`;
}

function getSubagentDetails(subagentId, conversationsDir, dispatchedAtMs = 0) {
  const dbPath = path.join(conversationsDir, `${subagentId}.db`);
  const now = Date.now();
  const waiting = { id:subagentId,exists:false,isRunning:false,isCompleted:false,isFailed:false,status:'waiting',health:'waiting',actionText:'等待 Agent 启动',actionType:'idle',toolName:'',steps:0,toolSteps:0,progressPercent:null,startedAtMs:dispatchedAtMs,elapsedSec:0,lastActivityAtMs:0,timeSinceLastUpdate:0,dbSig:'missing' };
  if (!AG_UUID.test(subagentId) || !fs.existsSync(dbPath)) return waiting;
  try {
    const rows = currentAgentRows(readAgentRows(dbPath), dispatchedAtMs);
    const last = rows[rows.length - 1];
    const signature = getDbSignature(subagentId, conversationsDir) || 'missing';
    if (!last) return { ...waiting,exists:true,dbSig:signature };
    const st = fs.statSync(dbPath);
    const wal = `${dbPath}-wal`;
    const storageTime = fs.existsSync(wal) ? Math.max(st.mtimeMs, fs.statSync(wal).mtimeMs) : st.mtimeMs;
    const firstTime = extractTimestampFromMetadata(rows[0]?.metadata) || dispatchedAtMs || st.birthtimeMs || st.ctimeMs;
    const lastActivityAtMs = extractTimestampFromMetadata(last.metadata) || storageTime;
    const age = Math.max(0, Math.floor((now - lastActivityAtMs) / 1000));
    const completed = agentHasFinalResponse(last);
    const executing = !completed && last.status === 2;
    const toolName = extractToolInfo(last.metadata) || '';
    const toolError = !completed && last.status === 7 && !!last.error_details?.length;
    const reported = !completed && last.status === 3 && toolName === 'send_message';
    let health = completed ? 'completed' : toolError ? 'error' : reported ? 'reported' : executing ? (last.step_type === 15 ? 'thinking' : 'running') : 'waiting';
    if (!completed && !toolError && !reported && age >= 90) health = 'waiting';
    let actionText = completed ? '已提交最终结果' : toolError ? '工具调用失败，等待后续处理' : executing ? (last.step_type === 15 ? '正在思考与生成响应' : cleanActionDescription('', last.metadata, true, toolName)) : '等待后续步骤';
    if (reported) actionText = '已汇报结果，等待任务确认';
    if (!completed && !toolError && !reported && age >= 90) actionText = '暂未收到新步骤，等待更新';
    return { id:subagentId,exists:true,isRunning:executing,isCompleted:completed,isFailed:false,status:health,health,actionText,actionType:completed ? 'idle' : last.step_type === 15 ? 'thinking' : toolName ? 'tool' : 'idle',toolName,steps:rows.length,toolSteps:rows.filter(row=>row.step_type===132).length,progressPercent:completed ? 100 : null,startedAtMs:firstTime,elapsedSec:Math.max(0,Math.floor(((completed ? lastActivityAtMs : now)-firstTime)/1000)),lastActivityAtMs,timeSinceLastUpdate:age,dbSig:signature };
  } catch {
    return { ...waiting,status:'unavailable',health:'waiting',actionText:'暂时无法读取进度',dataError:true,dbSig:'read-error' };
  }
}

function resolveFullSubagentTree(rootId, conversationsDir) {
  const now = Date.now();
  const empty = {rootId,turnId:`${rootId}:none`,turnEnded:false,tree:[],hasRunning:false,activeCount:0,totalCount:0,completedCount:0,failedCount:0,overallPercent:null,overallElapsedSec:0,startedAtMs:0,updatedAtMs:now,treeSig:'none'};
  if (!DatabaseSync || !AG_UUID.test(rootId || '')) return empty;
  let rootRows;
  try { rootRows = currentAgentRows(readAgentRows(path.join(conversationsDir,`${rootId}.db`))); }
  catch { return {...empty,dataError:true,treeSig:'read-error'}; }
  const turnStart = rootRows.find(row=>row.step_type===14);
  const turnId = `${rootId}:${turnStart?.idx ?? 'none'}`;
  const lastRoot = rootRows[rootRows.length-1];
  const rootHasFinal = agentHasFinalResponse(lastRoot);
  const tree = [];
  const queue = [{id:rootId,depth:0}];
  const visited = new Set([rootId]);
  // Bound corrupt/cyclic graphs without inventing results for unexplored nodes.
  while (queue.length && visited.size <= 128) {
    const current = queue.shift();
    for (const child of extractSubagentsFromDb(path.join(conversationsDir,`${current.id}.db`))) {
      if (visited.size >= 128) break;
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const details = getSubagentDetails(child.id,conversationsDir,child.dispatchedAtMs);
      tree.push({...child,...details,parentId:current.id,depth:current.depth+1,hasActiveChild:false});
      queue.push({id:child.id,depth:current.depth+1});
    }
  }
  const unfinished = node=>!node.isCompleted && !node.isFailed;
  for (let i=tree.length-1;i>=0;i--) {
    const node=tree[i];
    if (unfinished(node) || node.hasActiveChild) {
      const parent=tree.find(n=>n.id===node.parentId);
      if (parent) parent.hasActiveChild=true;
    }
  }
  const completedCount=tree.filter(n=>n.isCompleted).length;
  const failedCount=tree.filter(n=>n.isFailed).length;
  const starts=tree.map(n=>n.firstDispatchedAtMs||n.startedAtMs).filter(n=>n>0);
  const startedAtMs=starts.length ? Math.min(...starts) : 0;
  // A root reply can be an interim report while dispatched children still work.
  const turnEnded=rootHasFinal && !tree.some(unfinished);
  const activeCount=tree.filter(unfinished).length;
  const finalKey=`${turnId}:${lastRoot?.idx}`;
  let endTime=now;
  if(turnEnded){
    endTime=extractTimestampFromMetadata(lastRoot?.metadata)||agentFinalTimeCache.get(finalKey);
    if(!endTime){
      const times=rootRows.map(row=>extractTimestampFromMetadata(row.metadata)).filter(time=>time>0);
      const rootPath=path.join(conversationsDir,`${rootId}.db`);
      endTime=times[times.length-1]||fs.statSync(rootPath).mtimeMs;
    }
    agentFinalTimeCache.set(finalKey,endTime);
    if(agentFinalTimeCache.size>128)agentFinalTimeCache.delete(agentFinalTimeCache.keys().next().value);
  }
  return {...empty,turnId,turnEnded,rootHasFinal,tree,hasRunning:activeCount>0,activeCount,totalCount:tree.length,completedCount,failedCount,overallPercent:tree.length && completedCount===tree.length ? 100 : null,startedAtMs,overallElapsedSec:startedAtMs ? Math.max(0,Math.floor((endTime-startedAtMs)/1000)) : 0,treeSig:[turnId,turnEnded,lastRoot?.idx,lastRoot?.status,...tree.map(n=>`${n.id}:${n.dbSig}:${n.status}:${n.steps}:${n.isCompleted}:${n.role}`)].join('|')};
}

// ============================================================================
// 5. CDP target discovery and delivery
// ============================================================================

const attachedTargets = new Map();

function readPort(portFile) {
  try {
    if (!fs.existsSync(portFile)) return null;
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const lines = raw.split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function fetchTargets(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: 1500 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

function isAllowedOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return activeConfig.allowedOrigins.some((prefix) => urlStr.startsWith(prefix));
}

function attachTarget(target, endpoint) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) return Promise.resolve(false);

  return new Promise((resolveAttach) => {
    let settled = false;
    const finishAttach = (ok) => {
      if (!settled) {
        settled = true;
        resolveAttach(ok);
      }
    };
    const attachTimeout = setTimeout(() => finishAttach(false), 2500);

    try {
      const ws = new WebSocket(wsUrl);
      let msgId = 1;
      let activeCascadeId = '';
      let lastDeliveryAtMs = 0;
      let lastPushedHash = '';
      const pendingCallbacks = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, 2500);
          pendingCallbacks.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const inject = async () => {
        const res = await send('Runtime.evaluate', {
          expression: cachedInjectScript,
          returnByValue: true
        });
        if (res?.error) {
          console.error(`[Daemon] Injection error on ${target.id}:`, res.error.message || res.error);
          return false;
        } else if (res?.result?.exceptionDetails) {
          console.error(
            `[Daemon] Injection failed on ${target.id}: Script Exception:`,
            res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text
          );
          return false;
        } else {
          console.log(`[Daemon] Injected (${cachedPatchVersion}) into target ${target.id} [${endpoint.channel}]`);
          return true;
        }
      };

      const syncMetricsForSession = async (force = false) => {
        if (!DatabaseSync || !activeConfig.enabled || (!activeConfig.modules.metrics && !activeConfig.modules.subagentProgress)) return;

        // Re-read the visible conversation every sync. A stuck id is why a running turn never paints.
        {
          const evalRes = await send('Runtime.evaluate', {
            expression: `(function(){
              if (window.__ag_watched_cascade_id) return window.__ag_watched_cascade_id;
              const m = window.location.pathname.match(/\\/c\\/([0-9a-f-]{36})/i);
              if (m) return m[1];
              const el = document.querySelector('[data-testid=conversation-row-sidebar][data-selected=true]');
              return el ? (el.getAttribute('data-cascade-id') || '') : '';
            })()`,
            returnByValue: true
          });
          const detected = evalRes?.result?.result?.value;
          if (detected && /^[0-9a-f-]{36}$/i.test(detected)) {
            if (String(activeCascadeId || '').toLowerCase() !== detected.toLowerCase()) lastPushedHash = '';
            activeCascadeId = detected;
          }
        }
        if (!activeCascadeId) return;

        // 先在 Node 本地通过 statSync 检查 .db/.db-wal 签名与所有子 Agent 签名，未变化则 0 WebSocket 通信直接返回
        const sig = getDbSignature(activeCascadeId, endpoint.conversationsDir) || 'empty';
        const subagents = activeConfig.modules.subagentProgress
          ? resolveFullSubagentTree(activeCascadeId, endpoint.conversationsDir)
          : { rootId: activeCascadeId, tree: [], hasRunning: false, activeCount: 0, overallPercent: 0, overallElapsedSec: 0, startedAtMs: 0, treeSig: 'none' };
        const subagentsSig = subagents.treeSig || 'none';
        const sessionKey = `${activeCascadeId}@${sig}|${subagentsSig}`;
        if (!force && sessionKey === lastPushedHash && Date.now() - lastDeliveryAtMs < 5000) return;

        const payload = activeConfig.modules.metrics
          ? (parseConversationMetrics(activeCascadeId, endpoint.conversationsDir) || { cascadeId: activeCascadeId, hasData: false })
          : { cascadeId: activeCascadeId, hasData: false };
        payload.subagents = subagents;

        const entry = attachedTargets.get(target.id);
        if (entry) {
          entry.lastHasRunning = subagents.hasRunning;
        }

        const delivery = await send('Runtime.evaluate', {
          expression: `(function(){
            if (window.__ag_render_metrics) window.__ag_render_metrics(${JSON.stringify(payload)});
            if (window.__ag_render_subagents) window.__ag_render_subagents(${JSON.stringify(subagents)});
          })()`,
          returnByValue: false
        });
        if (!delivery || delivery.error || delivery.result?.exceptionDetails) return;
        lastPushedHash = sessionKey;
        lastDeliveryAtMs = Date.now();
      };

      const checkAndInject = async () => {
        try {
          const checkRes = await send('Runtime.evaluate', {
            expression:
              'window.__ag_patch_version === ' +
              JSON.stringify(cachedPatchVersion) +
              ' && (' +
              JSON.stringify(!activeConfig.enabled) +
              ' || !!document.getElementById("ag-custom-fonts"))',
            returnByValue: true
          });
          if (checkRes?.result?.result?.value !== true) {
            await inject();
            await syncMetricsForSession(true);
          }
        } catch {}
      };

      let initialAttachDone = false;
      let navDebounceTimer = null;

      // 毫秒级 DB WAL 文件监听与极速推送通道
      let dirWatcher = null;
      try {
        let debounceTimer = null;
        dirWatcher = fs.watch(endpoint.conversationsDir, (eventType, filename) => {
          if (!filename || (!filename.endsWith('.db') && !filename.endsWith('.db-wal'))) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            syncMetricsForSession(false).catch(() => {});
          }, 40);
        });
        dirWatcher.on('error', () => {});
      } catch {}

      ws.addEventListener('open', async () => {
        console.log(`[Daemon] Attached target: ${target.id} (${target.title || 'Untitled'}) [${endpoint.channel}]`);
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Runtime.addBinding', { name: '__agRequestMetrics' });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: cachedInjectScript });
        const ok = await inject();
        await syncMetricsForSession(true);
        initialAttachDone = true;
        clearTimeout(attachTimeout);
        finishAttach(ok);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            cb(msg);
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agRequestMetrics') {
            const nextId = String(msg.params.payload || '').trim();
            if (/^[0-9a-f-]{36}$/i.test(nextId)) {
              activeCascadeId = nextId;
              lastPushedHash = '';
              syncMetricsForSession(true);
            } else {
              activeCascadeId = '';
              lastPushedHash = '';
              send('Runtime.evaluate', {
                expression: `(function(){
                  if (window.__ag_render_metrics) window.__ag_render_metrics({ cascadeId: '', hasData: false });
                  if (window.__ag_render_subagents) window.__ag_render_subagents({ rootId: '', tree: [], hasRunning: false, activeCount: 0 });
                })()`,
                returnByValue: false
              }).catch(() => {});
            }
            return;
          }
          if (!initialAttachDone) return;
          if (
            msg.method === 'Page.frameNavigated' ||
            msg.method === 'Page.loadEventFired' ||
            msg.method === 'Page.domContentEventFired'
          ) {
            if (!msg.params?.frame || !msg.params.frame.parentId) {
              if (navDebounceTimer) clearTimeout(navDebounceTimer);
              navDebounceTimer = setTimeout(() => {
                navDebounceTimer = null;
                checkAndInject();
              }, 120);
            }
          }
        } catch {}
      });

      const closeHandler = () => {
        clearTimeout(attachTimeout);
        if (dirWatcher) {
          try { dirWatcher.close(); } catch {}
          dirWatcher = null;
        }
        for (const [, cb] of pendingCallbacks) cb(null);
        pendingCallbacks.clear();
        attachedTargets.delete(target.id);
        finishAttach(false);
      };
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', closeHandler);

      attachedTargets.set(target.id, {
        ws,
        send,
        inject,
        checkAndInject,
        syncMetricsForSession,
        endpoint,
        lastHasRunning: false,
        setActiveCascade: (cid) => {
          activeCascadeId = cid;
          lastPushedHash = '';
        }
      });
    } catch {
      clearTimeout(attachTimeout);
      finishAttach(false);
    }
  });
}

let isSyncing = false;
let syncTickCount = 0;
let lastHasAnyRunning = false;
let lastZhPatchSig = '';
let isZhPatchRunning = false;

function ensureZhTitlePatchIfPresent() {
  if (SAFE_MODE || process.platform !== 'darwin' || isZhPatchRunning) return;
  const scriptPath = path.join(os.homedir(), '.gemini/antigravity/scripts/antigravity-zh-title-patch.py');
  if (!fs.existsSync(scriptPath)) return;
  const lsBins = [
    '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
    '/Applications/Antigravity - Insiders.app/Contents/Resources/bin/language_server'
  ];
  const sig = lsBins
    .map((p) => {
      try {
        const st = fs.statSync(p);
        return `${p}:${st.mtimeMs}:${st.size}`;
      } catch {
        return '';
      }
    })
    .join('|');
  if (!sig || sig === lastZhPatchSig) return;
  isZhPatchRunning = true;
  execFile('python3', [scriptPath, 'patch'], { timeout: 25000 }, (err, stdout) => {
    isZhPatchRunning = false;
    lastZhPatchSig = lsBins
      .map((p) => {
        try {
          const st = fs.statSync(p);
          return `${p}:${st.mtimeMs}:${st.size}`;
        } catch {
          return '';
        }
      })
      .join('|');
    if (!err && stdout && stdout.includes('中文标题补丁注入成功')) {
      console.log('[Daemon] Auto-applied zh-title patch:', stdout.trim().split('\n')[0]);
    }
  });
}

async function sync() {
  if (isSyncing) return;
  isSyncing = true;
  syncTickCount = (syncTickCount + 1) % 6000;
  try {
    if (syncTickCount % 12 === 1) ensureZhTitlePatchIfPresent();
    const bundleChanged = rebuildBundleIfNeeded();
    const shouldHeartbeatCheck = bundleChanged || syncTickCount % 6 === 1;

    const activeTargetIds = new Set();
    const attachPromises = [];

    const probedPorts = new Set();
    for (const endpoint of activeConfig.endpoints) {
      let port = readPort(endpoint.portFile);
      let targets = [];
      if (port && !probedPorts.has(port)) {
        probedPorts.add(port);
        targets = await fetchTargets(port);
      }
      if (
        targets.length === 0 &&
        endpoint.channelInstalled !== false &&
        endpoint.fallbackPort &&
        !probedPorts.has(endpoint.fallbackPort)
      ) {
        probedPorts.add(endpoint.fallbackPort);
        targets = await fetchTargets(endpoint.fallbackPort);
      }
      if (targets.length === 0) continue;

      const pages = targets.filter(
        (t) =>
          t.type === 'page' &&
          t.webSocketDebuggerUrl &&
          !String(t.url || '').startsWith('devtools://') &&
          isAllowedOrigin(t.url) &&
          !String(t.title || '').includes('Launchpad')
      );

      for (const page of pages) {
        activeTargetIds.add(page.id);
        if (!attachedTargets.has(page.id)) {
          attachPromises.push(attachTarget(page, endpoint));
        } else {
          const entry = attachedTargets.get(page.id);
          if (bundleChanged && entry.send) {
            await entry.send('Page.addScriptToEvaluateOnNewDocument', { source: cachedInjectScript });
          }
          if (shouldHeartbeatCheck && entry.checkAndInject) await entry.checkAndInject();
          if (entry.syncMetricsForSession) await entry.syncMetricsForSession(bundleChanged);
        }
      }
    }

    if (attachPromises.length > 0) {
      await Promise.allSettled(attachPromises);
    }

    // 清理已关闭的目标连接
    for (const [id, entry] of attachedTargets.entries()) {
      if (!activeTargetIds.has(id)) {
        try {
          entry.ws.close();
        } catch {}
        attachedTargets.delete(id);
      }
    }

    let anyRunning = false;
    for (const entry of attachedTargets.values()) {
      if (entry.lastHasRunning) anyRunning = true;
    }
    lastHasAnyRunning = anyRunning;
  } finally {
    isSyncing = false;
  }
}

console.log(
  `[Antigravity Daemon] Started (${cachedPatchVersion}) | channel=${activeConfig.channel} | sqlite=${!!DatabaseSync} | safeMode=${SAFE_MODE}`
);

await sync();
if (RUN_ONCE) {
  for (const [, entry] of attachedTargets.entries()) {
    try {
      entry.ws.close();
    } catch {}
  }
  process.exit(0);
} else {
  let loopTimer = null;
  const loop = async () => {
    try {
      await sync();
    } catch {}
    const delay = lastHasAnyRunning ? 280 : 1800;
    loopTimer = setTimeout(loop, delay);
  };
  loopTimer = setTimeout(loop, 1800);
}
