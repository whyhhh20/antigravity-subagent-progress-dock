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

// ============================================================================
// Python Playwright 测试宿主驱动脚本生成器 (高并发单实例轻量化)
// ============================================================================
function generateLayoutRunnerPythonCode(runtimePath, themePath, outJsonPath) {
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
        role=['代码实现', '独立审核', '验证测试', '性能优化', '质量监控'][i % 5],
        type='DeepCoder',
        depth=1,
        parentId=root_id,
        hasActiveChild=False,
        isRunning=True,
        isCompleted=False,
        isFailed=False,
        status='running',
        health='running',
        actionText='正在分析布局结构与渲染流水线',
        steps=8,
        toolSteps=3,
        elapsedSec=26,
        progressPercent=None,
        startedAtMs=now - 26000,
        lastActivityAtMs=now,
        timeSinceLastUpdate=0
    )
    n.update(extra)
    return n

def payload(turn=1, count=3, **extra):
    tree = [node(i) for i in range(count)]
    p = dict(
        rootId=root_id,
        turnId=f'{root_id}:{turn}',
        turnEnded=False,
        tree=tree,
        hasRunning=True,
        activeCount=count,
        totalCount=count,
        completedCount=0,
        failedCount=0,
        overallPercent=None,
        overallElapsedSec=26,
        startedAtMs=now - 26000,
        updatedAtMs=now
    )
    p.update(extra)
    return p

runtime_file = pathlib.Path(${JSON.stringify(runtimePath)})
theme_file = pathlib.Path(${JSON.stringify(themePath)})
out_json = pathlib.Path(${JSON.stringify(outJsonPath)})

boot = dict(
    version='layout-test-runner',
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
#antigravity\\.agentSidePanelInputBox { width: 100%; max-width: 840px; min-height: 80px; border: 1px solid #d1d5db; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; background: #ffffff; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
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
    <div class="msg user">用户提问：请开启 5 个子 Agent 执行全工程深度审查</div>
    <div class="msg" style="height:140px">消息段落 1：初始化工程结构与依赖...</div>
    <div class="msg" style="height:140px">消息段落 2：加载本地符号表与构建拓扑图...</div>
    <div class="msg" style="height:140px">消息段落 3：启动跨模块边界审计规则...</div>
    <div class="msg" id="last-msg">消息内容 4：这是聊天窗口底部最后一条消息，验证无论面板如何展开，此内容绝不能被遮挡。</div>
  </div>
  <div id="chat-footer">
    <div id="antigravity.agentSidePanelInputBox">
      <textarea id="composer-textarea" placeholder="输入对话..."></textarea>
      <div id="composer-toolbar">
        <div class="toolbar-left">
          <button id="attach-btn" class="toolbar-btn" type="button">附件</button>
          <button id="model-btn" class="toolbar-btn" type="button">模型设置</button>
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
    page.emulate_media(reduced_motion='reduce')
    page.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
    page.goto('http://fixture.test/c/' + root_id)
    page.evaluate("localStorage.setItem('ag_subagent_dock_collapsed','false')")
    page.evaluate(script)

    def wait_raf():
        page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        page.wait_for_timeout(40)

    # ------------------------------------------------------------------------
    # 1. 视口规格零重叠、右对齐与输入控件交互验证 (1426 / 800 / 390)
    # ------------------------------------------------------------------------
    for width, height, label in [
        (1426, 920, 'desktop_1426'),
        (800, 640, 'tablet_800'),
        (390, 740, 'mobile_390')
    ]:
        page.set_viewport_size(dict(width=width, height=height))
        page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
        wait_raf()

        # 显式点击折叠按钮以展开测试详细面板
        toggle_init = page.locator('#ag-subagent-toggle-btn')
        if toggle_init.count() and not toggle_init.is_disabled() and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''):
            # Initialize the expanded geometry fixture; real mouse toggles are covered in attached-tray and ui suites.
            toggle_init.evaluate("e => e.click()")
            wait_raf()

        dock = page.locator('#ag-subagent-dock')
        host = page.locator('#ag-subagent-dock-host')
        composer = page.locator('#antigravity\\\\.agentSidePanelInputBox')
        send_btn = page.locator('#send-btn')
        attach_btn = page.locator('#attach-btn')
        textarea = page.locator('#composer-textarea')

        dock_rect = dock.bounding_box() if dock.count() else None
        composer_rect = composer.bounding_box() if composer.count() else None
        send_rect = send_btn.bounding_box() if send_btn.count() else None
        attach_rect = attach_btn.bounding_box() if attach_btn.count() else None
        textarea_rect = textarea.bounding_box() if textarea.count() else None

        area_composer = rect_intersection(dock_rect, composer_rect)
        area_send = rect_intersection(dock_rect, send_rect)
        area_attach = rect_intersection(dock_rect, attach_rect)
        area_textarea = rect_intersection(dock_rect, textarea_rect)

        # 检查宿主排布在输入框之前，并在文档流内垂直堆叠
        host_is_prev_sibling = page.evaluate('''() => {
            const h = document.getElementById("ag-subagent-dock-host");
            const c = document.getElementById("antigravity.agentSidePanelInputBox");
            return h && c && h.nextElementSibling === c && h.parentElement === c.parentElement;
        }''')

        # 检查展开态右边缘对齐：dock.right 与 composer.right 差 < 1px
        dock_right_exp = (dock_rect['x'] + dock_rect['width']) if dock_rect else 0.0
        comp_right = (composer_rect['x'] + composer_rect['width']) if composer_rect else 0.0
        right_diff_exp = abs(dock_right_exp - comp_right)
        record(f'{label}_right_aligned_under_1px_expanded', right_diff_exp < 1.0, f'diff={right_diff_exp:.2f}px')

        # 检查输入控件点击与对焦
        page.evaluate('''() => {
            window.__send_clicked = false;
            window.__attach_clicked = false;
            document.getElementById("send-btn").onclick = () => { window.__send_clicked = true; };
            document.getElementById("attach-btn").onclick = () => { window.__attach_clicked = true; };
        }''')
        send_btn.click(timeout=3000)
        send_clicked = page.evaluate('() => window.__send_clicked')

        attach_btn.click(timeout=3000)
        attach_clicked = page.evaluate('() => window.__attach_clicked')

        textarea.focus()
        textarea.fill('测试输入内容：多 Agent 协作工作流', timeout=3000)
        textarea_val = textarea.input_value()
        textarea_focused = page.evaluate('() => document.activeElement && document.activeElement.id === "composer-textarea"')

        record(f'{label}_zero_overlap_with_composer', area_composer == 0, f'overlap={area_composer}')
        record(f'{label}_zero_overlap_with_send_btn', area_send == 0, f'overlap={area_send}')
        record(f'{label}_zero_overlap_with_attach_btn', area_attach == 0, f'overlap={area_attach}')
        record(f'{label}_zero_overlap_with_textarea', area_textarea == 0, f'overlap={area_textarea}')
        record(f'{label}_send_btn_clickable', send_clicked)
        record(f'{label}_attach_btn_clickable', attach_clicked)
        record(f'{label}_textarea_input_and_focus', textarea_focused and textarea_val == '测试输入内容：多 Agent 协作工作流')
        record(f'{label}_host_in_document_flow_before_composer', host_is_prev_sibling)

        # 检查收起为胶囊后同样保持零重叠且右对齐 < 1px
        toggle_btn = page.locator('#ag-subagent-toggle-btn')
        if toggle_btn.count() and not toggle_btn.is_disabled():
            toggle_btn.click(timeout=3000)
            wait_raf()
            c_dock_rect = dock.bounding_box()
            c_comp_rect = composer.bounding_box()
            c_area = rect_intersection(c_dock_rect, c_comp_rect)
            c_dock_right = (c_dock_rect['x'] + c_dock_rect['width']) if c_dock_rect else 0.0
            right_diff_col = abs(c_dock_right - comp_right)

            record(f'{label}_collapsed_zero_overlap', c_area == 0, f'collapsed overlap={c_area}')
            record(f'{label}_right_aligned_under_1px_collapsed', right_diff_col < 1.0, f'diff={right_diff_col:.2f}px')
            toggle_btn.click(timeout=3000)
            wait_raf()

    # ------------------------------------------------------------------------
    # 2. 5 个 Agents 大容量卡片内嵌滚动与高度上限
    # ------------------------------------------------------------------------
    page.set_viewport_size(dict(width=1426, height=920))
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=5))
    wait_raf()
    toggle_5 = page.locator('#ag-subagent-toggle-btn')
    if toggle_5.count() and not toggle_5.is_disabled():
        toggle_5.click(timeout=3000)
        wait_raf()

    dock_5 = page.locator('#ag-subagent-dock')
    composer_5 = page.locator('#antigravity\\\\.agentSidePanelInputBox')
    area_5 = rect_intersection(dock_5.bounding_box(), composer_5.bounding_box())
    dock_height_5 = dock_5.bounding_box()['height']
    record('five_agents_zero_overlap', area_5 == 0, f'area={area_5}')
    record('five_agents_height_capped_under_320', dock_height_5 <= 325, f'height={dock_height_5}')

    # ------------------------------------------------------------------------
    # 3. 消息滚动视口底端补偿与历史阅读不强制贴底 (Scroll Retention & Bottom Visibility)
    # ------------------------------------------------------------------------
    # 3.1 贴底状态下自动补偿，保持底端行可见
    page.evaluate('''() => {
        const vp = document.getElementById("chat-messages");
        vp.scrollTop = vp.scrollHeight;
    }''')
    wait_raf()

    last_msg = page.locator('#last-msg')
    messages_vp = page.locator('#chat-messages')
    dock_el = page.locator('#ag-subagent-dock')

    last_msg_rect = last_msg.bounding_box()
    messages_rect = messages_vp.bounding_box()
    dock_rect = dock_el.bounding_box()

    last_msg_in_viewport = (last_msg_rect['y'] >= messages_rect['y'] - 1 and
                            last_msg_rect['y'] + last_msg_rect['height'] <= messages_rect['y'] + messages_rect['height'] + 8)
    last_msg_dock_intersection = rect_intersection(last_msg_rect, dock_rect)

    record('messages_bottom_visible_in_scroll_viewport', last_msg_in_viewport, f'msg={last_msg_rect}, vp={messages_rect}')
    record('messages_bottom_zero_intersection_with_dock', last_msg_dock_intersection == 0, f'intersection={last_msg_dock_intersection}')

    # 3.2 用户向上滚动阅读历史记录时，更新/重排绝不强制把用户卷到底部
    page.evaluate('''() => {
        const vp = document.getElementById("chat-messages");
        vp.scrollTop = 40;
    }''')
    wait_raf()
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3, overallElapsedSec=35))
    wait_raf()
    scroll_top_after_update = page.evaluate('() => document.getElementById("chat-messages").scrollTop')
    record('reading_history_not_forced_to_bottom', scroll_top_after_update < 100, f'scrollTop={scroll_top_after_update}')

    # ------------------------------------------------------------------------
    # 4. 多行输入框高度动态增长响应 (ResizeObserver / Dynamic Composer Growth)
    # ------------------------------------------------------------------------
    dock_before = page.locator('#ag-subagent-dock').bounding_box()

    # 将 textarea 高度拉大到 160px，模拟输入多行长文本
    page.evaluate('''() => {
        const ta = document.getElementById("composer-textarea");
        ta.style.height = "160px";
    }''')
    wait_raf()

    dock_after = page.locator('#ag-subagent-dock').bounding_box()
    composer_after = page.locator('#antigravity\\\\.agentSidePanelInputBox').bounding_box()
    overlap_after_growth = rect_intersection(dock_after, composer_after)

    record('composer_multiline_growth_zero_overlap', overlap_after_growth == 0, f'overlap={overlap_after_growth}')
    record('dock_y_pushed_upwards_on_composer_growth', dock_after['y'] < dock_before['y'], f'before_y={dock_before["y"]}, after_y={dock_after["y"]}')

    # 恢复 textarea 默认高度
    page.evaluate('''() => {
        const ta = document.getElementById("composer-textarea");
        ta.style.height = "42px";
    }''')
    wait_raf()

    # ------------------------------------------------------------------------
    # 5. 矮视口自动 compact (48 <= available < 112) 与 deferred 暂避机制
    # ------------------------------------------------------------------------
    # 5.1 构造 48 <= available < 112：textarea 高度 120px，窗口高度 340px
    page.evaluate('''() => {
        document.getElementById("composer-textarea").style.height = "120px";
    }''')
    page.set_viewport_size(dict(width=800, height=340))
    wait_raf()

    geom = page.evaluate('''() => {
        const box = document.getElementById("antigravity.agentSidePanelInputBox");
        const dock = document.getElementById("ag-subagent-dock");
        const vh = window.innerHeight;
        const boxH = box.getBoundingClientRect().height;
        const available = Math.floor(vh - boxH - 96);
        const maxHeight = Math.max(0, Math.min(300, Math.floor(vh * 0.32), available));
        return { vh, boxH, available, maxHeight, layout: dock.getAttribute("data-layout") };
    }''')

    short_toggle_disabled = page.locator('#ag-subagent-toggle-btn').is_disabled()
    short_overlap = rect_intersection(
        page.locator('#ag-subagent-dock').bounding_box(),
        page.locator('#antigravity\\\\.agentSidePanelInputBox').bounding_box()
    )
    record('short_window_auto_compact', geom['layout'] == 'compact' and 48 <= geom['maxHeight'] < 112, str(geom))
    record('short_window_toggle_btn_disabled', short_toggle_disabled)
    record('short_window_zero_overlap', short_overlap == 0, f'overlap={short_overlap}')

    # 恢复 textarea 高度
    page.evaluate('''() => {
        document.getElementById("composer-textarea").style.height = "42px";
    }''')
    wait_raf()

    # 5.2 窗口极端矮小或空间不足 (<48px)，触发 deferred 暂避 host.hidden = true
    page.set_viewport_size(dict(width=800, height=220))
    wait_raf()
    host_hidden = page.locator('#ag-subagent-dock-host').is_hidden()
    deferred_layout = page.locator('#ag-subagent-dock').get_attribute('data-layout')
    record('extreme_short_window_deferred_hidden', host_hidden and deferred_layout == 'deferred', f'hidden={host_hidden}, layout={deferred_layout}')

    # 恢复窗口高度，验证自动解除暂避
    page.set_viewport_size(dict(width=800, height=640))
    wait_raf()
    host_restored = page.locator('#ag-subagent-dock-host').is_visible()
    record('window_height_restored_unhides_host', host_restored)

    # ------------------------------------------------------------------------
    # 6. DOM 节点替换、初期无 Composer 与生命周期清理
    # ------------------------------------------------------------------------
    page.set_viewport_size(dict(width=1426, height=920))

    # 6.1 重复渲染不累积多个 host
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()
    host_count = page.locator('#ag-subagent-dock-host').count()
    record('repeated_renders_single_host_only', host_count == 1, f'count={host_count}')

    # 6.2 Composer 节点被动态替换 (模拟 SPA 重新渲染)
    page.evaluate('''() => {
        const oldBox = document.getElementById("antigravity.agentSidePanelInputBox");
        const newBox = document.createElement("div");
        newBox.id = "antigravity.agentSidePanelInputBox";
        newBox.style.minHeight = "80px";
        newBox.innerHTML = '<textarea id="composer-textarea"></textarea><button id="send-btn">Send</button>';
        oldBox.replaceWith(newBox);
    }''')
    wait_raf()
    reattached_correctly = page.evaluate('''() => {
        const h = document.getElementById("ag-subagent-dock-host");
        const c = document.getElementById("antigravity.agentSidePanelInputBox");
        return h && c && h.nextElementSibling === c && h.parentElement === c.parentElement;
    }''')
    record('composer_replacement_reattaches_host_before_new_box', reattached_correctly)

    # 6.3 暂无 Composer 保持待挂载，Composer 就位后自动挂载
    page.evaluate('''() => {
        window.__saved_box = document.getElementById("antigravity.agentSidePanelInputBox");
        window.__saved_box.remove();
    }''')
    wait_raf()
    page.evaluate('() => window.__ag_position_subagent_dock()')
    wait_raf()
    host_when_no_box = page.locator('#ag-subagent-dock-host').count()
    record('initially_absent_composer_dock_pending_without_floating', host_when_no_box == 0, f'count={host_when_no_box}')

    # 将 Composer 重新插入
    page.evaluate('''() => {
        document.getElementById("chat-footer").appendChild(window.__saved_box);
    }''')
    wait_raf()
    host_when_box_returned = page.locator('#ag-subagent-dock-host').count()
    record('composer_reappearance_mounts_host_cleanly', host_when_box_returned == 1, f'count={host_when_box_returned}')

    # 6.4 关闭面板清理 host
    close_btn = page.locator('#ag-subagent-close-btn')
    close_btn.click(timeout=3000)
    page.wait_for_timeout(250)
    host_after_close = page.locator('#ag-subagent-dock-host').count()
    record('close_btn_removes_host_and_dock', host_after_close == 0, f'count={host_after_close}')

    # 6.5 换新轮次重新挂载，空树彻底清理
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=2, count=3))
    wait_raf()
    record('new_turn_remounts_host', page.locator('#ag-subagent-dock-host').count() == 1)

    page.evaluate('(p) => window.__ag_render_subagents(p)', dict(rootId=root_id, turnId=f'{root_id}:3', tree=[]))
    page.wait_for_timeout(100)
    record('empty_tree_cleans_up_host', page.locator('#ag-subagent-dock-host').count() == 0)

    # 6.6 显式 API __ag_position_subagent_dock() 可正常调用
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=4, count=2))
    wait_raf()
    api_works = page.evaluate('''() => {
        if (typeof window.__ag_position_subagent_dock !== "function") return false;
        window.__ag_position_subagent_dock();
        return true;
    }''')
    record('ag_position_subagent_dock_api_callable', api_works)

    browser.close()

out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print('SUCCESS_LAYOUT_RUNNER')
`;
}

// ============================================================================
// 执行真实 Chromium Playwright 测试并解析 JSON 结果
// ============================================================================
let suiteResults = {};
let suiteError = null;

try {
  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpPy = path.join(os.tmpdir(), `ag_layout_test_${tmpId}.py`);
  const tmpOutJson = path.join(os.tmpdir(), `ag_layout_test_${tmpId}.json`);
  const pyCode = generateLayoutRunnerPythonCode(RUNTIME_PATH, THEME_PATH, tmpOutJson);
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
      suiteError = new Error(`Python layout runner exited with code ${res.status}:\n${res.stderr}\n${res.stdout}`);
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

// ============================================================================
// Node 原生测试声明
// ============================================================================
describe('Antigravity 子 Agent 真实 Flex 聊天布局与输入框零遮挡回归 (layout.test.mjs)', () => {

  describe('1. 视口规格零重叠、严格右对齐与输入控件无阻碍交互 (1426 / 800 / 390)', () => {
    it('desktop_1426: 宽屏视口下 Dock 与 Composer 零重叠，展开与收起右边缘差值均小于 1px', () => {
      expectPass('desktop_1426_zero_overlap_with_composer');
      expectPass('desktop_1426_zero_overlap_with_send_btn');
      expectPass('desktop_1426_zero_overlap_with_attach_btn');
      expectPass('desktop_1426_zero_overlap_with_textarea');
      expectPass('desktop_1426_right_aligned_under_1px_expanded');
      expectPass('desktop_1426_right_aligned_under_1px_collapsed');
      expectPass('desktop_1426_send_btn_clickable');
      expectPass('desktop_1426_attach_btn_clickable');
      expectPass('desktop_1426_textarea_input_and_focus');
      expectPass('desktop_1426_host_in_document_flow_before_composer');
      expectPass('desktop_1426_collapsed_zero_overlap');
    });

    it('tablet_800: 中屏视口下 Dock 与输入区零重叠，展开与收起右边缘差值均小于 1px', () => {
      expectPass('tablet_800_zero_overlap_with_composer');
      expectPass('tablet_800_zero_overlap_with_send_btn');
      expectPass('tablet_800_zero_overlap_with_attach_btn');
      expectPass('tablet_800_zero_overlap_with_textarea');
      expectPass('tablet_800_right_aligned_under_1px_expanded');
      expectPass('tablet_800_right_aligned_under_1px_collapsed');
      expectPass('tablet_800_send_btn_clickable');
      expectPass('tablet_800_attach_btn_clickable');
      expectPass('tablet_800_textarea_input_and_focus');
      expectPass('tablet_800_host_in_document_flow_before_composer');
      expectPass('tablet_800_collapsed_zero_overlap');
    });

    it('mobile_390: 窄屏移动视口下 Dock 自适应限宽且零遮挡，展开与收起右边缘差值均小于 1px', () => {
      expectPass('mobile_390_zero_overlap_with_composer');
      expectPass('mobile_390_zero_overlap_with_send_btn');
      expectPass('mobile_390_zero_overlap_with_attach_btn');
      expectPass('mobile_390_zero_overlap_with_textarea');
      expectPass('mobile_390_right_aligned_under_1px_expanded');
      expectPass('mobile_390_right_aligned_under_1px_collapsed');
      expectPass('mobile_390_send_btn_clickable');
      expectPass('mobile_390_attach_btn_clickable');
      expectPass('mobile_390_textarea_input_and_focus');
      expectPass('mobile_390_host_in_document_flow_before_composer');
    });
  });

  describe('2. 5 卡片大容量与消息滚动视口底端可见性', () => {
    it('five_agents_zero_overlap: 5 个子 Agent 卡片内嵌自滚动，高度封顶且零遮挡 Composer', () => {
      expectPass('five_agents_zero_overlap');
      expectPass('five_agents_height_capped_under_320');
    });

    it('messages_bottom_visible_and_compensated: 贴底状态下消息列表末行清晰可见，且滚动历史时不强制贴底', () => {
      expectPass('messages_bottom_visible_in_scroll_viewport');
      expectPass('messages_bottom_zero_intersection_with_dock');
      expectPass('reading_history_not_forced_to_bottom');
    });
  });

  describe('3. 多行输入框动态伸缩与视口矮化自适应', () => {
    it('composer_multiline_growth: Composer 多行增长时通过 ResizeObserver 向上腾挪且零重叠', () => {
      expectPass('composer_multiline_growth_zero_overlap');
      expectPass('dock_y_pushed_upwards_on_composer_growth');
    });

    it('short_window_auto_compact: 48<=available<112 时自动切为 compact 并禁用展开按钮', () => {
      expectPass('short_window_auto_compact');
      expectPass('short_window_toggle_btn_disabled');
      expectPass('short_window_zero_overlap');
    });

    it('extreme_short_window_deferred: 视口极端矮小 (<48px) 时自动 deferred 暂避，高度恢复后自动解除', () => {
      expectPass('extreme_short_window_deferred_hidden');
      expectPass('window_height_restored_unhides_host');
    });
  });

  describe('4. DOM 节点替换、初期无 Composer 与宿主生命周期清理', () => {
    it('repeated_renders_single_host_only: 连续推送同一轮次不产生重复 host 累积', () => {
      expectPass('repeated_renders_single_host_only');
    });

    it('composer_replacement_and_initially_absent: Composer 节点替换与初期缺失后出现均能正确就位', () => {
      expectPass('composer_replacement_reattaches_host_before_new_box');
      expectPass('initially_absent_composer_dock_pending_without_floating');
      expectPass('composer_reappearance_mounts_host_cleanly');
    });

    it('close_and_empty_turn_cleans_up_host: 用户隐藏或空树彻底清理 host 与 dock 元素', () => {
      expectPass('close_btn_removes_host_and_dock');
      expectPass('new_turn_remounts_host');
      expectPass('empty_tree_cleans_up_host');
    });

    it('ag_position_subagent_dock_api_callable: window.__ag_position_subagent_dock 接口正常可用', () => {
      expectPass('ag_position_subagent_dock_api_callable');
    });
  });

});
