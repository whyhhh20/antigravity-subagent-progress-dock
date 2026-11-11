import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Prefer $PYTHON, then `python`, then `python3` (many Linux/macOS systems only ship python3).
const PYTHON_BIN = process.env.PYTHON || (spawnSync('python', ['--version'], { stdio: 'ignore' }).status === 0 ? 'python' : 'python3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_PATH = path.join(ROOT_DIR, 'core', 'runtime.js');
const THEME_PATH = path.join(ROOT_DIR, 'core', 'theme.css');

function generateAttachedTrayRunnerPythonCode(runtimePath, themePath, outJsonPath) {
  return `
import json, pathlib, sys, time
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from playwright.sync_api import sync_playwright

root_id = '12345678-1234-4123-8123-123456789abc'
now = int(time.time() * 1000)

def node(i, **extra):
    n = dict(
        id=f'22222222-2222-4222-8222-{i:012d}',
        role=['系统架构', '业务审计', '测试验证'][i % 3],
        type='DeepCoder',
        depth=1,
        parentId=root_id,
        hasActiveChild=False,
        isRunning=True,
        isCompleted=False,
        isFailed=False,
        status='running',
        health='running',
        actionText='正在分析模块依赖与布局约束',
        steps=6,
        toolSteps=2,
        elapsedSec=15,
        progressPercent=None,
        startedAtMs=now - 15000,
        lastActivityAtMs=now,
        timeSinceLastUpdate=0
    )
    n.update(extra)
    return n

def payload(turn=1, tree=None, **extra):
    if tree is None:
        tree = [
            node(0),
            node(1, health='thinking', status='thinking', actionText='评估高并发渲染')
        ]
    p = dict(
        rootId=root_id,
        turnId=f'{root_id}:{turn}',
        turnEnded=False,
        tree=tree,
        hasRunning=any(not n.get('isCompleted') and not n.get('isFailed') for n in tree),
        activeCount=sum(not n.get('isCompleted') and not n.get('isFailed') for n in tree),
        totalCount=len(tree),
        completedCount=sum(bool(n.get('isCompleted')) for n in tree),
        failedCount=sum(bool(n.get('isFailed')) for n in tree),
        overallPercent=None,
        overallElapsedSec=15,
        startedAtMs=now - 15000,
        updatedAtMs=now
    )
    p.update(extra)
    return p

runtime_file = pathlib.Path(${JSON.stringify(runtimePath)})
theme_file = pathlib.Path(${JSON.stringify(themePath)})
out_json = pathlib.Path(${JSON.stringify(outJsonPath)})

boot = dict(
    version='attached-tray-runner',
    enabled=True,
    preset='high-contrast',
    cssText=theme_file.read_text(encoding='utf8'),
    i18nDict={},
    modules=dict(i18n=False, metrics=True, subagentProgress=True, deadlockHealer=False, customJs=False)
)
raw_script = runtime_file.read_text(encoding='utf8')
script = raw_script.replace('})(__AG_BOOT_PAYLOAD__);', '})(' + json.dumps(boot, ensure_ascii=False) + ');')

html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 100vw; height: 100vh; overflow: hidden; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafafa; }
.conversation-view { flex: 1 1 0%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.autoscroll-viewport { flex: 1 1 0%; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #fafafa; }
.msg { padding: 10px 14px; border-radius: 8px; background: #ffffff; border: 1px solid #e5e5e5; max-width: 75%; line-height: 1.5; font-size: 14px; }
.msg.user { align-self: flex-end; background: #e3f2fd; border-color: #bbdefb; color: #0d47a1; }
#chat-footer { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding: 10px 16px 14px; background: #ffffff; border-top: 1px solid #e5e5e5; position: relative; }
#antigravity\\\\.agentSidePanelInputBox { width: 100%; max-width: 840px; min-height: 80px; border: 1px solid #d1d5db; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; background: #ffffff; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
#composer-textarea { width: 100%; height: 42px; border: none; outline: none; resize: none; font-size: 14px; font-family: inherit; }
#composer-toolbar { display: flex; justify-content: space-between; align-items: center; height: 32px; }
.toolbar-left { display: flex; gap: 8px; }
.toolbar-btn { padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; font-size: 12px; cursor: pointer; }
#send-btn { padding: 6px 14px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
</style>
</head>
<body>
<div class="conversation-view" data-testid="conversation-view">
  <div class="autoscroll-viewport" data-testid="autoscroll-viewport" id="chat-messages">
    <div class="msg user">用户提问：请开启子 Agent 执行全栈代码审查</div>
    <div class="msg">消息行 1：准备分析上下文与调用堆栈...</div>
    <div class="msg" id="last-msg">消息行 2：底部内容，验证托盘贴合及视口无遮挡。</div>
  </div>
  <div id="chat-footer">
    <div id="antigravity.agentSidePanelInputBox">
      <textarea id="composer-textarea" placeholder="输入对话..."></textarea>
      <div id="composer-toolbar">
        <div class="toolbar-left">
          <button id="attach-btn" class="toolbar-btn" type="button">附件</button>
          <button id="model-btn" class="toolbar-btn" type="button">模型</button>
        </div>
        <button id="send-btn" type="button">发送</button>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""

def rect_intersection(r1, r2):
    if not r1 or not r2: return 0.0
    x_overlap = max(0.0, min(r1['x'] + r1['width'], r2['x'] + r2['width']) - max(r1['x'], r2['x']))
    y_overlap = max(0.0, min(r1['y'] + r1['height'], r2['y'] + r2['height']) - max(r1['y'], r2['y']))
    return float(x_overlap * y_overlap)

results = {}

def record(name, passed, detail=None):
    results[name] = dict(passed=bool(passed), detail=str(detail) if detail is not None else None)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1426, height=920))
    page.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
    page.goto('http://fixture.test/c/' + root_id)

    page.evaluate("localStorage.setItem('ag_subagent_dock_collapsed', 'false')")
    page.evaluate(script)

    def wait_raf():
        page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        page.wait_for_timeout(60)

    composer = page.locator('#antigravity\\\\.agentSidePanelInputBox')
    initial_comp_box = composer.bounding_box()
    initial_comp_bottom = initial_comp_box['y'] + initial_comp_box['height']

    # 1. 每个新 turn 总是收起，不读取上轮展开偏好
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1))
    wait_raf()

    dock = page.locator('#ag-subagent-dock')
    host = page.locator('#ag-subagent-dock-host')
    toggle_btn = page.locator('#ag-subagent-toggle-btn')

    is_collapsed_t1 = page.evaluate('() => document.getElementById("ag-subagent-dock")?.classList.contains("ag-collapsed")')
    aria_expanded_t1 = toggle_btn.get_attribute('aria-expanded')
    record('new_turn_always_collapsed_by_default', bool(is_collapsed_t1 and aria_expanded_t1 == 'false'))

    toggle_btn.click()
    page.wait_for_timeout(250)
    is_expanded_t1 = page.evaluate('() => document.getElementById("ag-subagent-dock")?.classList.contains("ag-expanded")')
    record('user_click_toggle_expands_dock', bool(is_expanded_t1))

    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=2))
    wait_raf()
    is_collapsed_t2 = page.evaluate('() => document.getElementById("ag-subagent-dock")?.classList.contains("ag-collapsed")')
    aria_expanded_t2 = toggle_btn.get_attribute('aria-expanded')
    record('next_turn_does_not_inherit_expansion_preference', bool(is_collapsed_t2 and aria_expanded_t2 == 'false'))

    # 2. 同轮只有用户点击箭头才展开，普通推送不得自动展开
    for step in range(3):
        active_payload = payload(turn=2, tree=[
            node(0, steps=8 + step, elapsedSec=20 + step),
            node(1, steps=10 + step, elapsedSec=20 + step)
        ])
        page.evaluate('(p) => window.__ag_render_subagents(p)', active_payload)
        wait_raf()

    is_still_collapsed = page.evaluate('() => document.getElementById("ag-subagent-dock")?.classList.contains("ag-collapsed")')
    record('stream_pushes_within_turn_do_not_auto_expand', bool(is_still_collapsed))

    toggle_btn.click()
    page.wait_for_timeout(250)
    inline_summary = page.locator('.ag-dock-inline-summary').inner_text()
    record('inline_summary_shows_calls_and_duration', '次调用' in inline_summary and '秒' in inline_summary, inline_summary)

    toggle_btn.click()
    page.wait_for_timeout(250)

    # 3. 同轮暂时空树保留最近任务条并标等待更新
    empty_interim_payload = dict(
        rootId=root_id,
        turnId=f'{root_id}:2',
        turnEnded=False,
        tree=[]
    )
    page.evaluate('(p) => window.__ag_render_subagents(p)', empty_interim_payload)
    wait_raf()

    dock_exists_on_interim_empty = page.locator('#ag-subagent-dock').count() == 1
    badge_text = page.locator('#ag-subagent-dock .ag-dock-badge').inner_text()
    record('interim_empty_tree_retains_dock', dock_exists_on_interim_empty)
    record('interim_empty_tree_shows_waiting_notice', '等待' in badge_text or '保留上次' in badge_text, badge_text)

    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=2))
    wait_raf()
    badge_resumed = page.locator('#ag-subagent-dock .ag-dock-badge').inner_text()
    record('stream_recovery_clears_interim_waiting', '协作中' in badge_resumed, badge_resumed)

    # 4. 完成后收回小条而不是几秒清除，直到新 turn/route 改变
    finished_tree = [
        node(0, isCompleted=True, isRunning=False, status='completed', health='completed'),
        node(1, isCompleted=True, isRunning=False, status='completed', health='completed')
    ]
    completion_payload = payload(turn=2, tree=finished_tree, turnEnded=True)

    toggle_btn.click()
    page.wait_for_timeout(250)
    page.evaluate('(p) => window.__ag_render_subagents(p)', completion_payload)
    page.wait_for_timeout(250)

    completed_dock = page.locator('#ag-subagent-dock')
    is_collapsed_on_finish = page.evaluate('() => document.getElementById("ag-subagent-dock")?.classList.contains("ag-collapsed")')
    record('completion_collapses_to_compact_strip', bool(completed_dock.count() == 1 and is_collapsed_on_finish))

    page.wait_for_timeout(5500)
    record('completed_strip_persists_not_cleared_after_timeout', completed_dock.count() == 1 and completed_dock.is_visible())

    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=3))
    wait_raf()
    turn3_badge = page.locator('#ag-subagent-dock .ag-dock-badge').inner_text()
    record('new_turn_resets_completion_state_cleanly', '0/2' in turn3_badge or '协作中' in turn3_badge, turn3_badge)

    # 5. 宿主与 composer 相接、接缝≤1px、输入框底边稳定、窄窗与多行零遮挡
    seam_check = page.evaluate('''() => {
        const h = document.getElementById("ag-subagent-dock-host");
        const c = document.getElementById("antigravity.agentSidePanelInputBox");
        if (!h || !c) return null;
        const hr = h.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const seamGap = Math.abs(cr.top - hr.bottom);
        return {
            isPreviousSibling: h.nextElementSibling === c,
            parentMatches: h.parentElement === c.parentElement,
            seamGap: seamGap,
            widthDiff: Math.abs(hr.width - cr.width)
        };
    }''')
    record('host_is_composer_previous_sibling', bool(seam_check and seam_check['isPreviousSibling'] and seam_check['parentMatches']))
    record('host_seam_under_1px', bool(seam_check and seam_check['seamGap'] <= 1.0), str(seam_check))
    record('host_width_matches_composer', bool(seam_check and seam_check['widthDiff'] <= 1.5), str(seam_check))

    current_comp_box = composer.bounding_box()
    current_comp_bottom = current_comp_box['y'] + current_comp_box['height']
    comp_bottom_shift = abs(current_comp_bottom - initial_comp_bottom)
    record('composer_bottom_edge_stays_stable', comp_bottom_shift <= 2.0, f'shift={comp_bottom_shift:.2f}px')

    page.evaluate('''() => {
        const ta = document.getElementById("composer-textarea");
        ta.style.height = "160px";
        if (window.__ag_position_subagent_dock) window.__ag_position_subagent_dock();
    }''')
    wait_raf()

    dock_box_grown = page.locator('#ag-subagent-dock').bounding_box()
    comp_box_grown = composer.bounding_box()
    send_box_grown = page.locator('#send-btn').bounding_box()
    attach_box_grown = page.locator('#attach-btn').bounding_box()
    ta_box_grown = page.locator('#composer-textarea').bounding_box()

    record('multiline_composer_zero_overlap_dock_composer', rect_intersection(dock_box_grown, comp_box_grown) == 0)
    record('multiline_composer_zero_overlap_dock_send_btn', rect_intersection(dock_box_grown, send_box_grown) == 0)
    record('multiline_composer_zero_overlap_dock_attach_btn', rect_intersection(dock_box_grown, attach_box_grown) == 0)
    record('multiline_composer_zero_overlap_dock_textarea', rect_intersection(dock_box_grown, ta_box_grown) == 0)

    page.evaluate('''() => {
        const ta = document.getElementById("composer-textarea");
        ta.style.height = "42px";
        if (window.__ag_position_subagent_dock) window.__ag_position_subagent_dock();
    }''')
    wait_raf()

    page.set_viewport_size(dict(width=390, height=740))
    wait_raf()

    dock_narrow = page.locator('#ag-subagent-dock').bounding_box()
    comp_narrow = composer.bounding_box()
    send_narrow = page.locator('#send-btn').bounding_box()

    record('narrow_viewport_zero_overlap_composer', rect_intersection(dock_narrow, comp_narrow) == 0)
    record('narrow_viewport_zero_overlap_send_btn', rect_intersection(dock_narrow, send_narrow) == 0)
    record('narrow_viewport_within_bounds', dock_narrow['x'] >= 0 and dock_narrow['x'] + dock_narrow['width'] <= 391)

    browser.close()

out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print('SUCCESS_ATTACHED_TRAY_RUNNER')
`;
}

let suiteResults = {};
let suiteError = null;

try {
  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpPy = path.join(os.tmpdir(), `ag_attached_tray_test_${tmpId}.py`);
  const tmpOutJson = path.join(os.tmpdir(), `ag_attached_tray_test_${tmpId}.json`);
  const pyCode = generateAttachedTrayRunnerPythonCode(RUNTIME_PATH, THEME_PATH, tmpOutJson);
  fs.writeFileSync(tmpPy, pyCode, 'utf8');

  try {
    const res = spawnSync(PYTHON_BIN, [tmpPy], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    if (res.error) {
      suiteError = res.error;
    } else if (res.status !== 0 || !fs.existsSync(tmpOutJson)) {
      suiteError = new Error(`Python attached-tray runner exited with code ${res.status}:\n${res.stderr}\n${res.stdout}`);
    } else {
      const jsonContent = fs.readFileSync(tmpOutJson, 'utf8');
      suiteResults = JSON.parse(jsonContent);
    }
  } finally {
    try { fs.unlinkSync(tmpPy); } catch {}
    try { fs.unlinkSync(tmpOutJson); } catch {}
  }
} catch (e) {
  suiteError = e;
}

function expectPass(testName) {
  if (suiteError) throw suiteError;
  const item = suiteResults[testName];
  assert.ok(item, `未在测试运行器中找到指标 [${testName}]`);
  assert.strictEqual(item.passed, true, `[${testName}] 验证失败: ${JSON.stringify(item.detail)}`);
}

describe('Antigravity Attached-Tray 新架构与状态机 Playwright 测试 (attached-tray.test.mjs)', () => {

  describe('1. 新 Turn 独立收起与偏好隔离 (Always Collapsed by Default)', () => {
    it('new_turn_always_collapsed_by_default: 每个新 turn 总是收起，不读取 localStorage 展开偏好', () => {
      expectPass('new_turn_always_collapsed_by_default');
    });

    it('user_click_toggle_expands_dock: 同轮仅在用户显式点击折叠按钮后才展开', () => {
      expectPass('user_click_toggle_expands_dock');
    });

    it('next_turn_does_not_inherit_expansion_preference: 换轮到新 turn 自动重置为收起态，不继承上轮展开', () => {
      expectPass('next_turn_does_not_inherit_expansion_preference');
    });
  });

  describe('2. 同轮推送不自动弹出与信息指示 (Stream Push Retention)', () => {
    it('stream_pushes_within_turn_do_not_auto_expand: 同轮普通推送与状态刷新不得自动展开大卡', () => {
      expectPass('stream_pushes_within_turn_do_not_auto_expand');
    });

    it('inline_summary_shows_calls_and_duration: 小条头部内联展示工具调用次数与耗时简报', () => {
      expectPass('inline_summary_shows_calls_and_duration');
    });
  });

  describe('3. 同轮空树容错与等待更新 (Interim Empty Tree Retention)', () => {
    it('interim_empty_tree_retains_dock: 同轮暂时空树保留最近任务条，不突兀清除 DOM', () => {
      expectPass('interim_empty_tree_retains_dock');
    });

    it('interim_empty_tree_shows_waiting_notice: 暂时空树明确提示“等待进度更新 · 保留上次任务记录”', () => {
      expectPass('interim_empty_tree_shows_waiting_notice');
    });

    it('stream_recovery_clears_interim_waiting: 后续数据恢复推送后自动撤销等待标记恢复协作状态', () => {
      expectPass('stream_recovery_clears_interim_waiting');
    });
  });

  describe('4. 任务完成常驻收拢小条 (Completion Strip Persistence)', () => {
    it('completion_collapses_to_compact_strip: 任务完成立即强制收回紧凑小条', () => {
      expectPass('completion_collapses_to_compact_strip');
    });

    it('completed_strip_persists_not_cleared_after_timeout: 完成后收回小条而不是几秒清除，超 5 秒持续常驻', () => {
      expectPass('completed_strip_persists_not_cleared_after_timeout');
    });

    it('new_turn_resets_completion_state_cleanly: 直到新 turn/route 变更才干净重置为新任务状态', () => {
      expectPass('new_turn_resets_completion_state_cleanly');
    });
  });

  describe('5. 宿主紧密相接与输入框底边绝对稳定 (Geometry & Stability)', () => {
    it('host_is_composer_previous_sibling: 宿主作为输入框直接前置兄弟节点同层排布', () => {
      expectPass('host_is_composer_previous_sibling');
    });

    it('host_seam_under_1px: 宿主与输入框接缝 gap ≤ 1px 紧密相接', () => {
      expectPass('host_seam_under_1px');
    });

    it('host_width_matches_composer: 托盘宽度与输入框严格同宽', () => {
      expectPass('host_width_matches_composer');
    });

    it('composer_bottom_edge_stays_stable: 托盘挂载及切换过程中输入框底边位置保持绝对稳定', () => {
      expectPass('composer_bottom_edge_stays_stable');
    });

    it('multiline_composer_zero_overlap: 多行文本增长时托盘向上自适应推升，全部控件零重叠', () => {
      expectPass('multiline_composer_zero_overlap_dock_composer');
      expectPass('multiline_composer_zero_overlap_dock_send_btn');
      expectPass('multiline_composer_zero_overlap_dock_attach_btn');
      expectPass('multiline_composer_zero_overlap_dock_textarea');
    });

    it('narrow_viewport_within_bounds_and_zero_overlap: 窄视口 (390px) 保持在视口内且零重叠', () => {
      expectPass('narrow_viewport_zero_overlap_composer');
      expectPass('narrow_viewport_zero_overlap_send_btn');
      expectPass('narrow_viewport_within_bounds');
    });
  });

});
