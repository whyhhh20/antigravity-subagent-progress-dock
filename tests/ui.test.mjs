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
// Python Playwright 测试宿主驱动脚本生成器
// ============================================================================
function generateRunnerPythonCode(runtimePath, themePath, outJsonPath) {
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
        role=['代码实现', '独立审核', '验证测试'][i % 3],
        type='DeepCoder',
        depth=1,
        parentId=root_id,
        hasActiveChild=False,
        isRunning=True,
        isCompleted=False,
        isFailed=False,
        status='running',
        health='running',
        actionText='正在读取项目文件',
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

def payload(turn=1, tree=None, **extra):
    tree = tree if tree is not None else [
        node(0),
        node(1, health='thinking', status='thinking', actionText='正在分析实现方案')
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
    version='test-runner',
    enabled=True,
    preset='high-contrast',
    cssText=theme_file.read_text(encoding='utf8'),
    i18nDict={},
    modules=dict(i18n=False, metrics=True, subagentProgress=True, deadlockHealer=False, customJs=False)
)
raw_script = runtime_file.read_text(encoding='utf8')
script = raw_script.replace('})(__AG_BOOT_PAYLOAD__);', '})(' + json.dumps(boot, ensure_ascii=False) + ');')

results = {}

def record(name, passed, detail=None):
    results[name] = dict(passed=bool(passed), detail=str(detail) if detail is not None else None)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1426, height=920))
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body='<!DOCTYPE html><html><head></head><body style="margin:0"><main style="padding:20px"><h1>TEST SUITE</h1></main><div id="antigravity.agentSidePanelInputBox"></div></body></html>'))
    page.goto('http://fixture.test/c/' + root_id)
    page.evaluate("localStorage.setItem('ag_subagent_dock_collapsed','false')")
    page.evaluate(script)

    def render(p):
        page.evaluate('(p) => window.__ag_render_subagents(p)', p)

    def ensure_expanded():
        d = page.locator('#ag-subagent-dock')
        if d.count() and 'ag-collapsed' in (d.get_attribute('class') or ''):
            btn = page.locator('#ag-subagent-toggle-btn')
            if btn.count():
                btn.click()
                page.wait_for_timeout(100)

    # 1. 初始空闲无子 Agent 面板
    record('no_agent_no_dock', page.locator('#ag-subagent-dock').count() == 0)

    # 2. 正常运行推送
    render(payload())
    page.wait_for_timeout(300)
    dock = page.locator('#ag-subagent-dock')
    text = dock.inner_text()
    record('running_dock_visible', dock.is_visible())
    record('running_percent_not_fabricated', '%' not in text, text)
    record('tool_call_and_duration_visible', '6 次调用' in text and '秒' in text, text)

    # 3. 尺寸与视口约束
    box = dock.bounding_box()
    record('desktop_viewport_containment', box and abs(box['width'] - page.evaluate('document.getElementById("antigravity.agentSidePanelInputBox").getBoundingClientRect().width')) < 1 and box['x'] >= 0 and box['x'] + box['width'] <= 1427 and box['y'] + box['height'] <= 921, box)

    # 4. 鼠标折叠与展开 (初始为收起态小条，点击展开，再次点击收起)
    toggle_btn = page.locator('#ag-subagent-toggle-btn')
    toggle_btn.click()
    page.wait_for_timeout(250)
    record('mouse_expand_works', 'ag-expanded' in (dock.get_attribute('class') or ''))
    toggle_btn.click()
    page.wait_for_timeout(250)
    record('mouse_collapse_works', 'ag-collapsed' in (dock.get_attribute('class') or ''))

    # 5. 键盘 Esc 收起与二次 Esc 隐藏 (需先展开再测收起与二次隐藏)
    toggle_btn.click()
    page.wait_for_timeout(250)
    dock.focus()
    page.keyboard.press('Escape')
    page.wait_for_timeout(250)
    record('keyboard_esc_collapses_dock', 'ag-collapsed' in (dock.get_attribute('class') or ''))

    page.keyboard.press('Escape')
    page.wait_for_timeout(250)
    record('keyboard_esc_second_dismisses_turn', page.locator('#ag-subagent-dock').count() == 0)

    # 6. 恢复显示并测试数据错误 (dataError=True) 保留面板
    render(payload(turn=2))
    page.wait_for_timeout(200)
    record('re_render_turn2_visible', page.locator('#ag-subagent-dock').is_visible())

    # 注入 dataError 载荷 (空树且 turnId 带有 :none)
    render(dict(rootId=root_id, turnId=f'{root_id}:none', turnEnded=False, tree=[], dataError=True, treeSig='read-error'))
    page.wait_for_timeout(100)
    dock_after_err = page.locator('#ag-subagent-dock')
    record('data_error_retains_dock', dock_after_err.count() == 1 and dock_after_err.is_visible())
    ensure_expanded()
    notice = dock_after_err.locator('.ag-dock-notice')
    record('data_error_shows_notice', notice.is_visible() and ('暂时无法读取进度' in notice.inner_text() or '中断' in notice.inner_text()), notice.inner_text() if notice.count() else 'not found')

    # 7. 活跃任务超时断流检测 (模拟 25 秒无更新)
    page.evaluate('() => { window.__ag_subagent_state.receivedAt = Date.now() - 25000; window.__ag_subagent_state.dataError = false; }')
    page.wait_for_timeout(1200)
    ensure_expanded()
    notice_text = notice.inner_text() if notice.is_visible() else ''
    record('stream_timeout_interruption_notice', notice.is_visible() and '数据更新中断' in notice_text, notice_text)

    # 正常推送后清除断流提示
    render(payload(turn=2))
    page.wait_for_timeout(200)
    record('stream_recovery_clears_notice', not notice.is_visible())

    # 确保面板展开状态以检查卡片正文
    ensure_expanded()

    # 8. 等待更新不等于卡死，部分完成不冒充“全部完成”
    done_node = node(0, isRunning=False, isCompleted=True, status='completed', health='completed')
    wait_node = node(1, isRunning=False, status='waiting', health='waiting', actionText='等待更新', timeSinceLastUpdate=120)
    render(payload(turn=2, tree=[done_node, wait_node]))
    page.wait_for_timeout(200)
    ensure_expanded()
    t_text = dock.inner_text()
    record('partial_completion_not_all_done', '全部完成' not in t_text and '已完成 1/2' in t_text, t_text)
    record('waiting_node_shows_waiting_status', '等待更新' in t_text and '疑似停滞' not in t_text, t_text)

    # 9. 单次工具异常 (health=error) 不谎报最终失败 (isFailed=false)
    err_node = node(0, isRunning=True, isCompleted=False, isFailed=False, status='error', health='error', actionText='网络连接重试中')
    render(payload(turn=2, tree=[err_node]))
    page.wait_for_timeout(200)
    ensure_expanded()
    err_text = dock.inner_text()
    record('tool_error_not_agent_failure', '失败' not in err_text and ('调用异常' in err_text or '重试' in err_text), err_text)

    # 10. XSS 严格安全转义
    render(payload(turn=2, tree=[node(0, role='<img src=x onerror="window.XSS_INJECTED=1">')]))
    page.wait_for_timeout(100)
    record('agent_role_escaped', page.evaluate('window.XSS_INJECTED !== 1') and dock.locator('img').count() == 0)

    # 11. 稳定 turnId 隐藏记忆：隐藏后追加新成员依然保持隐藏
    close_btn = page.locator('#ag-subagent-close-btn')
    close_btn.click()
    page.wait_for_timeout(250)
    render(payload(turn=2, tree=[node(0), node(1), node(2)]))
    page.wait_for_timeout(150)
    record('hidden_turn_stays_hidden_with_new_members', page.locator('#ag-subagent-dock').count() == 0)

    # 12. 换轮恢复与空树清理
    render(payload(turn=3))
    page.wait_for_timeout(200)
    record('next_turn_resets_hide', page.locator('#ag-subagent-dock').is_visible())

    render(payload(turn=4, tree=[]))
    page.wait_for_timeout(150)
    record('empty_tree_clears_dock', page.locator('#ag-subagent-dock').count() == 0)

    # 13. 完成后保持收拢小条常驻，不自动清除
    render(payload(turn=5, tree=[done_node], hasRunning=False, activeCount=0, turnEnded=True))
    page.wait_for_timeout(200)
    record('completed_dock_initially_visible', page.locator('#ag-subagent-dock').is_visible())
    
    for _ in range(3):
        render(payload(turn=5, tree=[done_node], hasRunning=False, activeCount=0, turnEnded=True))
        page.wait_for_timeout(400)
    record('repeated_completion_updates_do_not_postpone_hide', page.locator('#ag-subagent-dock').count() == 1 and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''))

    # 14. 减弱动画 prefers-reduced-motion
    render(payload(turn=6))
    page.wait_for_timeout(200)
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(100)
    anim_count = page.locator('#ag-subagent-dock').evaluate('(e) => [e, ...e.querySelectorAll("*")].filter(x => getComputedStyle(x).animationName !== "none" && getComputedStyle(x).animationDuration !== "0s").length')
    record('reduced_motion_no_animation', anim_count == 0, f'found {anim_count} animated elements')

    # 15. 回归 1: 直接 __ag_destroy_subagent_dock(false) 后同轮立即 render 活动 payload，250ms 后 dock 仍在
    page.emulate_media(reduced_motion='no-preference')
    act_p = payload(turn=7)
    render(act_p)
    page.wait_for_timeout(100)
    page.evaluate('() => window.__ag_destroy_subagent_dock(false)')
    render(act_p)
    page.wait_for_timeout(250)
    re_dock = page.locator('#ag-subagent-dock')
    record('anim_timer_cancelled_on_immediate_re_render', re_dock.count() == 1 and re_dock.is_visible())

    # 16. 回归 2: payload.rootId 大写与当前小写路由匹配仍正常显示
    upper_payload = dict(
        rootId=root_id.upper(),
        turnId=f'{root_id.upper()}:8',
        turnEnded=False,
        tree=[node(0)],
        hasRunning=True,
        activeCount=1,
        totalCount=1,
        completedCount=0,
        failedCount=0,
        overallPercent=None,
        overallElapsedSec=10,
        startedAtMs=now - 10000,
        updatedAtMs=now
    )
    render(upper_payload)
    page.wait_for_timeout(200)
    record('case_insensitive_root_id_matches', page.locator('#ag-subagent-dock').count() == 1 and page.locator('#ag-subagent-dock').is_visible())

    # 17. 回归 3: 同轮第一批完成退场后新增一名已完成 agent，可显示新批完成结果但重复同批不再弹
    turn9_active = dict(
        rootId=root_id,
        turnId=f'{root_id}:9',
        turnEnded=False,
        tree=[node(0, isCompleted=False, isRunning=True)],
        hasRunning=True,
        activeCount=1,
        totalCount=1,
        completedCount=0,
        failedCount=0
    )
    render(turn9_active)
    page.wait_for_timeout(80)

    turn9_batch1 = dict(
        rootId=root_id,
        turnId=f'{root_id}:9',
        turnEnded=True,
        tree=[node(0, isCompleted=True, isRunning=False, status='completed')],
        hasRunning=False,
        activeCount=0,
        totalCount=1,
        completedCount=1,
        failedCount=0
    )
    render(turn9_batch1)
    page.wait_for_timeout(250)
    record('batch1_dismissed_after_deadline', page.locator('#ag-subagent-dock').count() == 1 and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''))

    turn9_batch2 = dict(
        rootId=root_id,
        turnId=f'{root_id}:9',
        turnEnded=True,
        tree=[
            node(0, isCompleted=True, isRunning=False, status='completed'),
            node(1, isCompleted=True, isRunning=False, status='completed')
        ],
        hasRunning=False,
        activeCount=0,
        totalCount=2,
        completedCount=2,
        failedCount=0
    )
    render(turn9_batch2)
    page.wait_for_timeout(200)
    record('same_turn_second_batch_completion_shows_briefly', page.locator('#ag-subagent-dock').count() == 1 and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''))

    page.wait_for_timeout(250)
    record('batch2_dismissed_after_deadline', page.locator('#ag-subagent-dock').count() == 1 and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''))

    render(turn9_batch2) # 重复推送批次 2，不再弹大卡
    page.wait_for_timeout(150)
    record('repeat_same_batch_does_not_pop_up', page.locator('#ag-subagent-dock').count() == 1 and 'ag-collapsed' in (page.locator('#ag-subagent-dock').get_attribute('class') or ''))

    # 18. 无 uncaught 运行时异常
    record('no_uncaught_runtime_errors', len(errors) == 0, errors)

    browser.close()

out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print('SUCCESS_RUNNER')
`;
}

// ============================================================================
// 执行真实 Chromium Playwright 测试并解析 JSON 结果
// ============================================================================
let suiteResults = {};
let suiteError = null;

try {
  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpPy = path.join(os.tmpdir(), `ag_ui_test_${tmpId}.py`);
  const tmpOutJson = path.join(os.tmpdir(), `ag_ui_test_${tmpId}.json`);
  const pyCode = generateRunnerPythonCode(RUNTIME_PATH, THEME_PATH, tmpOutJson);
  fs.writeFileSync(tmpPy, pyCode, 'utf8');

  try {
    const res = spawnSync(PYTHON_BIN, [tmpPy], {
      encoding: 'utf8',
      timeout: 55000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    if (res.error) {
      suiteError = res.error;
    } else if (res.status !== 0 || !fs.existsSync(tmpOutJson)) {
      suiteError = new Error(`Python runner exited with code ${res.status}:\n${res.stderr}\n${res.stdout}`);
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
describe('Antigravity 子 Agent 真实 DOM 与生命周期测试 (Playwright Chromium)', () => {

  describe('1. 基础挂载与紧凑协调视口约束', () => {
    it('no_agent_no_dock: 初始未启动或空闲时不挂载 DOM 面板', () => {
      expectPass('no_agent_no_dock');
    });

    it('running_dock_visible: 活跃任务推送后正常弹出看板', () => {
      expectPass('running_dock_visible');
    });

    it('running_percent_not_fabricated: 严禁伪造百分比，“%”绝不出在文本中', () => {
      expectPass('running_percent_not_fabricated');
    });

    it('tool_call_and_duration_visible: 动作、累计工具调用次数与耗时明确展示', () => {
      expectPass('tool_call_and_duration_visible');
    });

    it('desktop_viewport_containment: 面板与输入框同宽且不溢出视口', () => {
      expectPass('desktop_viewport_containment');
    });
  });

  describe('2. 鼠标与键盘无障碍交互', () => {
    it('mouse_collapse_and_expand: 鼠标点击收起/展开按钮流畅切换', () => {
      expectPass('mouse_collapse_works');
      expectPass('mouse_expand_works');
    });

    it('keyboard_esc_collapses_dock: 展开状态按 Escape 键平滑收起为胶囊模式', () => {
      expectPass('keyboard_esc_collapses_dock');
    });

    it('keyboard_esc_second_dismisses_turn: 胶囊模式再次按 Escape 键隐藏本轮', () => {
      expectPass('keyboard_esc_second_dismisses_turn');
    });

    it('agent_role_escaped: 严格转义 role 与 actionText 内注入的 HTML/XSS', () => {
      expectPass('agent_role_escaped');
    });
  });

  describe('3. 断流探测与数据异常边界 (dataError)', () => {
    it('data_error_retains_dock: 后端读取失败 (dataError=true) 提前拦截，绝不作为空树清空面板', () => {
      expectPass('data_error_retains_dock');
    });

    it('data_error_shows_notice: 后端数据异常时展示“暂时无法读取进度”中断提示', () => {
      expectPass('data_error_shows_notice');
    });

    it('stream_timeout_interruption_notice: 活跃子 Agent 超过 20 秒无更新展示“数据更新中断”', () => {
      expectPass('stream_timeout_interruption_notice');
    });

    it('stream_recovery_clears_notice: 数据恢复正常推送后自动撤销断流警告', () => {
      expectPass('stream_recovery_clears_notice');
    });
  });

  describe('4. 真实状态机：等待更新与错误分流', () => {
    it('partial_completion_not_all_done: 一名完成一名待更新时显示“已完成 1/2”，不冒充“全部完成”', () => {
      expectPass('partial_completion_not_all_done');
    });

    it('waiting_node_shows_waiting_status: 等待更新不等于卡死，不标记为疑似停滞', () => {
      expectPass('waiting_node_shows_waiting_status');
    });

    it('tool_error_not_agent_failure: 单次工具异常 (health=error) 不谎报整个 Agent 最终失败', () => {
      expectPass('tool_error_not_agent_failure');
    });
  });

  describe('5. 轮次隔离、退场定时器与无动画无障碍', () => {
    it('hidden_turn_stays_hidden_with_new_members: 用户隐藏本轮后，即使追加新派生 Agent 依然保持隐藏', () => {
      expectPass('hidden_turn_stays_hidden_with_new_members');
    });

    it('next_turn_resets_hide: 换轮到新任务时自动解除隐藏记忆', () => {
      expectPass('next_turn_resets_hide');
    });

    it('empty_tree_clears_dock: 接收到纯空树 (tree=[]) 彻底清理销毁面板 DOM', () => {
      expectPass('empty_tree_clears_dock');
    });

    it('repeated_completion_updates_do_not_postpone_hide: 任务完成保持收起小条常驻，不自动清除', () => {
      expectPass('repeated_completion_updates_do_not_postpone_hide');
    });

    it('reduced_motion_no_animation: prefers-reduced-motion 下强制清零所有动画', () => {
      expectPass('reduced_motion_no_animation');
    });

    it('no_uncaught_runtime_errors: 整个生命周期测试过程中零未捕获运行时错误', () => {
      expectPass('no_uncaught_runtime_errors');
    });
  });

  describe('6. 补充真实 DOM 回归边界 (Edge Regressions)', () => {
    it('anim_timer_cancelled_on_immediate_re_render: 直接 __ag_destroy_subagent_dock(false) 后同轮立即 render 活动 payload，250ms 后 dock 依然留存', () => {
      expectPass('anim_timer_cancelled_on_immediate_re_render');
    });

    it('case_insensitive_root_id_matches: payload.rootId 大写与当前小写路由匹配仍正常显示', () => {
      expectPass('case_insensitive_root_id_matches');
    });

    it('same_turn_second_batch_completion_shows_briefly_and_does_not_repeat: 同轮新增已完成成员不再弹大卡，持续常驻小条', () => {
      expectPass('batch1_dismissed_after_deadline');
      expectPass('same_turn_second_batch_completion_shows_briefly');
      expectPass('batch2_dismissed_after_deadline');
      expectPass('repeat_same_batch_does_not_pop_up');
    });
  });

});
