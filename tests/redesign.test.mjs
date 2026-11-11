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
// Playwright Redesign 回归测试运行器代码生成 (复用 layout.test.mjs fixture)
// ============================================================================
function generateRedesignRunnerPythonCode(runtimePath, themePath, outJsonPath) {
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
        role=['系统架构师与跨模块核心调度器 🛡️', '超长名称测试：前端无障碍组件交互与渲染性能优化分析工程师 🚀', '深度安全审计与依赖漏洞检测专家 🔍'][i % 3],
        type='DeepCoder',
        depth=1,
        parentId=root_id,
        hasActiveChild=False,
        isRunning=True,
        isCompleted=False,
        isFailed=False,
        status='running',
        health='running',
        actionText='正在分析布局结构与渲染流水线 ⚙️ 处理中...',
        steps=12,
        toolSteps=5,
        elapsedSec=42,
        progressPercent=None,
        startedAtMs=now - 42000,
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
        overallElapsedSec=42,
        startedAtMs=now - 42000,
        updatedAtMs=now
    )
    p.update(extra)
    return p

runtime_file = pathlib.Path(${JSON.stringify(runtimePath)})
theme_file = pathlib.Path(${JSON.stringify(themePath)})
out_json = pathlib.Path(${JSON.stringify(outJsonPath)})

boot = dict(
    version='redesign-test-runner',
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
body { width: 100vw; height: 100vh; overflow: hidden; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif; background: #fafafa; }
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
    <div class="msg user">用户提问：请审查全部子模块并输出重构方案</div>
    <div class="msg" style="height:100px">系统段落 1：初始化工程运行环境...</div>
    <div class="msg" style="height:100px">系统段落 2：分析符号表与拓扑图...</div>
    <div class="msg" id="last-msg">消息内容 3：底端最后一条消息，验证无重叠与正常滚动。</div>
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
    page.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
    page.goto('http://fixture.test/c/' + root_id)
    page.evaluate(script)

    def wait_raf():
        page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        page.wait_for_timeout(60)

    # ------------------------------------------------------------------------
    # 1. 默认收起行为与 localStorage 偏好验证 (默认收起，localStorage='false' 时展开)
    # ------------------------------------------------------------------------
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()

    dock = page.locator('#ag-subagent-dock')
    host = page.locator('#ag-subagent-dock-host')
    composer = page.locator('#antigravity\\\\.agentSidePanelInputBox')

    # 1.1 默认无 localStorage 偏好时，为收起状态
    default_collapsed = page.evaluate('''() => {
        const d = document.getElementById("ag-subagent-dock");
        return d ? d.classList.contains("ag-collapsed") : false;
    }''')
    record('default_dock_is_collapsed', default_collapsed)

    # 1.2 验证当 localStorage 明确设为 "false" 时，新 turn 依然坚决默认收起，显式点击后才展开
    page.evaluate('''() => {
        localStorage.setItem("ag_subagent_dock_collapsed", "false");
    }''')
    page.reload()
    page.evaluate(script)
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()
    collapsed_by_default = page.evaluate('''() => {
        const d = document.getElementById("ag-subagent-dock");
        return d ? d.classList.contains("ag-collapsed") : false;
    }''')
    toggle_btn = page.locator('#ag-subagent-toggle-btn')
    if toggle_btn.count():
        toggle_btn.click()
        wait_raf()
    expanded_after_click = page.evaluate('''() => {
        const d = document.getElementById("ag-subagent-dock");
        return d ? !d.classList.contains("ag-collapsed") : false;
    }''')
    record('localStorage_false_still_starts_collapsed', bool(collapsed_by_default and expanded_after_click))

    # 清除偏好恢复默认收起
    page.evaluate('() => localStorage.removeItem("ag_subagent_dock_collapsed")')
    page.evaluate('(p) => window.__ag_render_subagents(p)', payload(turn=1, count=3))
    wait_raf()

    # ------------------------------------------------------------------------
    # 2. SVG 按钮图标与缺字消除验证 (消除方框/乱码，使用纯 SVG)
    # ------------------------------------------------------------------------
    svg_buttons_ok = page.evaluate('''() => {
        const toggleBtn = document.getElementById("ag-subagent-toggle-btn");
        const closeBtn = document.getElementById("ag-subagent-close-btn");
        if (!toggleBtn || !closeBtn) return false;
        const toggleSvg = toggleBtn.querySelector("svg");
        const closeSvg = closeBtn.querySelector("svg");
        const noRawText = toggleBtn.textContent.trim() === "" && closeBtn.textContent.trim() === "";
        return !!(toggleSvg && closeSvg && noRawText);
    }''')
    record('action_buttons_use_pure_svg_no_missing_glyphs', svg_buttons_ok)

    # ------------------------------------------------------------------------
    # 3. 中文超长角色名称与 emoji 完整保留验证 (无截断丢失、无转义破损)
    # ------------------------------------------------------------------------
    # 展开以渲染卡片列表
    page.evaluate('''() => {
        const d = document.getElementById("ag-subagent-dock");
        if (d && d.classList.contains("ag-collapsed")) {
            d.classList.remove("ag-collapsed");
            d.classList.add("ag-expanded");
        }
    }''')
    wait_raf()

    roles_check = page.evaluate('''() => {
        const roles = Array.from(document.querySelectorAll(".ag-subagent-role")).map(e => e.textContent.trim());
        const hasEmoji1 = roles.some(r => r.includes("🛡️") && r.includes("系统架构师"));
        const hasLongRole = roles.some(r => r.includes("超长名称测试") && r.includes("前端无障碍组件交互与渲染性能优化分析工程师") && r.includes("🚀"));
        const hasEmoji2 = roles.some(r => r.includes("🔍") && r.includes("深度安全审计"));
        return { count: roles.length, hasEmoji1, hasLongRole, hasEmoji2, roles };
    }''')
    record('chinese_long_roles_and_emoji_preserved', roles_check['hasEmoji1'] and roles_check['hasLongRole'] and roles_check['hasEmoji2'], str(roles_check))

    # ------------------------------------------------------------------------
    # 4. Host 在输入框前同宽正常文档流与零遮挡验证
    # ------------------------------------------------------------------------
    flow_and_width = page.evaluate('''() => {
        const h = document.getElementById("ag-subagent-dock-host");
        const c = document.getElementById("antigravity.agentSidePanelInputBox");
        const d = document.getElementById("ag-subagent-dock");
        if (!h || !c || !d) return null;
        const hr = h.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const dr = d.getBoundingClientRect();
        const seamGap = Math.abs(cr.top - hr.bottom);
        return {
            isPreviousSibling: h.nextElementSibling === c,
            parentMatches: h.parentElement === c.parentElement,
            hostWidth: hr.width,
            composerWidth: cr.width,
            dockWidth: dr.width,
            seamGap: seamGap,
            widthDiff: Math.abs(hr.width - cr.width),
            dockZeroOverlapWithComposer: (dr.bottom <= cr.top + 0.5) || (dr.top >= cr.bottom - 0.5)
        };
    }''')
    record('host_is_normal_flow_previous_sibling', bool(flow_and_width and flow_and_width['isPreviousSibling'] and flow_and_width['parentMatches']))
    record('host_matches_composer_width', bool(flow_and_width and flow_and_width['widthDiff'] <= 2 and flow_and_width['seamGap'] <= 1.0), str(flow_and_width))

    dock_box = page.locator('#ag-subagent-dock').bounding_box()
    composer_box = page.locator('#antigravity\\\\.agentSidePanelInputBox').bounding_box()
    send_box = page.locator('#send-btn').bounding_box()
    attach_box = page.locator('#attach-btn').bounding_box()
    textarea_box = page.locator('#composer-textarea').bounding_box()

    record('dock_zero_overlap_with_composer', rect_intersection(dock_box, composer_box) == 0)
    record('dock_zero_overlap_with_send_btn', rect_intersection(dock_box, send_box) == 0)
    record('dock_zero_overlap_with_attach_btn', rect_intersection(dock_box, attach_box) == 0)
    record('dock_zero_overlap_with_textarea', rect_intersection(dock_box, textarea_box) == 0)

    # ------------------------------------------------------------------------
    # 5. 多行输入框高度动态增长响应 (Composer growth dynamically repositions/resizes)
    # ------------------------------------------------------------------------
    page.evaluate('''() => {
        const ta = document.getElementById("composer-textarea");
        ta.style.height = "150px";
        if (window.__ag_position_subagent_dock) window.__ag_position_subagent_dock();
    }''')
    wait_raf()

    dock_box_after = page.locator('#ag-subagent-dock').bounding_box()
    composer_box_after = page.locator('#antigravity\\\\.agentSidePanelInputBox').bounding_box()
    overlap_multiline = rect_intersection(dock_box_after, composer_box_after)

    record('multiline_composer_growth_zero_overlap', overlap_multiline == 0, f'overlap={overlap_multiline}')
    # 恢复 textarea 高度
    page.evaluate('''() => {
        document.getElementById("composer-textarea").style.height = "42px";
        if (window.__ag_position_subagent_dock) window.__ag_position_subagent_dock();
    }''')
    wait_raf()

    # ------------------------------------------------------------------------
    # 6. 消息滚动区不受右侧强制 padding 影响验证
    # ------------------------------------------------------------------------
    padding_check = page.evaluate('''() => {
        const vp = document.getElementById("chat-messages");
        if (!vp) return null;
        return {
            paddingRight: getComputedStyle(vp).paddingRight,
            hasAgPadAttr: vp.hasAttribute("data-ag-dock-pad")
        };
    }''')
    pr_val = float(padding_check['paddingRight'].replace('px', '')) if padding_check else 999
    record('message_viewport_not_polluted_by_dock_padding', pr_val <= 20 and not padding_check['hasAgPadAttr'], str(padding_check))

    # ------------------------------------------------------------------------
    # 7. DOM 节点替换与空树生命周期清理
    # ------------------------------------------------------------------------
    page.evaluate('''() => {
        const oldBox = document.getElementById("antigravity.agentSidePanelInputBox");
        const newBox = document.createElement("div");
        newBox.id = "antigravity.agentSidePanelInputBox";
        newBox.style.minHeight = "80px";
        newBox.innerHTML = '<textarea id="composer-textarea"></textarea>';
        oldBox.replaceWith(newBox);
        if (window.__ag_position_subagent_dock) window.__ag_position_subagent_dock();
    }''')
    wait_raf()
    replacement_ok = page.evaluate('''() => {
        const h = document.getElementById("ag-subagent-dock-host");
        const c = document.getElementById("antigravity.agentSidePanelInputBox");
        return !!(h && c && h.nextElementSibling === c);
    }''')
    record('composer_dom_replacement_replaces_cleanly', replacement_ok)

    # 7.2 空树彻底销毁面板与宿主 DOM
    page.evaluate('(p) => window.__ag_render_subagents(p)', dict(rootId=root_id, turnId=f'{root_id}:empty', tree=[]))
    page.wait_for_timeout(100)
    record('empty_tree_destroys_dock_and_host', page.locator('#ag-subagent-dock-host').count() == 0 and page.locator('#ag-subagent-dock').count() == 0)

    browser.close()

out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print('SUCCESS_REDESIGN_RUNNER')
`;
}

// ============================================================================
// 执行真实 Chromium Playwright 测试并解析 JSON 结果
// ============================================================================
let suiteResults = {};
let suiteError = null;

try {
  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpPy = path.join(os.tmpdir(), `ag_redesign_test_${tmpId}.py`);
  const tmpOutJson = path.join(os.tmpdir(), `ag_redesign_test_${tmpId}.json`);
  const pyCode = generateRedesignRunnerPythonCode(RUNTIME_PATH, THEME_PATH, tmpOutJson);
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
      suiteError = new Error(`Python redesign runner exited with code ${res.status}:\n${res.stderr}\n${res.stdout}`);
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
describe('Antigravity 子 Agent 重设计真实 Playwright 回归测试 (redesign.test.mjs)', () => {

  describe('1. 默认收起与用户偏好持久化 (Default Collapsed & Preference)', () => {
    it('default_dock_is_collapsed: 首次或新任务未存偏好时，默认挂载为收起状态 (ag-collapsed)', () => {
      expectPass('default_dock_is_collapsed');
    });

    it('localStorage_false_still_starts_collapsed: 即使旧偏好为展开，新轮仍先收起，需明确点击', () => {
      expectPass('localStorage_false_still_starts_collapsed');
    });
  });

  describe('2. SVG 图标无缺字与中文/Emoji 角色文本完整性', () => {
    it('action_buttons_use_pure_svg_no_missing_glyphs: 展开/收起/关闭按钮纯 SVG 呈现，消除乱码/缺字方框', () => {
      expectPass('action_buttons_use_pure_svg_no_missing_glyphs');
    });

    it('chinese_long_roles_and_emoji_preserved: 中文超长角色名称及 Emoji 完整保留不丢损', () => {
      expectPass('chinese_long_roles_and_emoji_preserved');
    });
  });

  describe('3. 文档流兄弟挂载、同宽匹配与零遮挡约束', () => {
    it('host_is_normal_flow_previous_sibling: 宿主作为输入框直接前置兄弟节点就位文档流', () => {
      expectPass('host_is_normal_flow_previous_sibling');
    });

    it('host_matches_composer_width: 宿主与任务托盘宽度同输入框保持一致', () => {
      expectPass('host_matches_composer_width');
    });

    it('dock_zero_overlap_with_composer_controls: 面板与输入框、发送按钮、附件按钮及文本框绝对零交集', () => {
      expectPass('dock_zero_overlap_with_composer');
      expectPass('dock_zero_overlap_with_send_btn');
      expectPass('dock_zero_overlap_with_attach_btn');
      expectPass('dock_zero_overlap_with_textarea');
    });
  });

  describe('4. 动态多行输入自适应与消息滚动视口纯净性', () => {
    it('multiline_composer_growth_zero_overlap: 多行输入文本框膨胀时托盘自适应腾挪且绝不遮挡', () => {
      expectPass('multiline_composer_growth_zero_overlap');
    });

    it('message_viewport_not_polluted_by_dock_padding: 消息滚动区不受右侧强制 padding 污染', () => {
      expectPass('message_viewport_not_polluted_by_dock_padding');
    });
  });

  describe('5. DOM 节点替换与空树生命周期清理', () => {
    it('composer_dom_replacement_replaces_cleanly: SPA 重新渲染或输入框节点被替换时干净接驳', () => {
      expectPass('composer_dom_replacement_replaces_cleanly');
    });

    it('empty_tree_destroys_dock_and_host: 空任务树时彻底销毁面板与宿主 DOM', () => {
      expectPass('empty_tree_destroys_dock_and_host');
    });
  });

});
