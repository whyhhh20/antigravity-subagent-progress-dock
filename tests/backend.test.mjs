import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DAEMON_PATH = path.join(ROOT_DIR, 'core', 'daemon.mjs');

// ============================================================================
// 1. VM 加载 core/daemon.mjs 后端实现区段
// ============================================================================
function loadDaemonVM() {
  const source = fs.readFileSync(DAEMON_PATH, 'utf8');
  const start = source.indexOf('function parseProto(');
  const end = source.indexOf('const attachedTargets = new Map();');
  if (start === -1 || end === -1) {
    throw new Error('无法在 core/daemon.mjs 中定位 VM 抽取区段 [parseProto -> attachedTargets]');
  }
  const slice = source.slice(start, end);
  const ctx = vm.createContext({
    fs,
    path,
    DatabaseSync,
    Buffer,
    Date,
    console,
    activeConfig: { contextLimit: 256000 },
    metricsCache: new Map(),
    setMetricsCache() {}
  });
  vm.runInContext(slice, ctx);
  return ctx;
}

const daemon = loadDaemonVM();

// ============================================================================
// 2. Protobuf 合成序列化辅助函数
// ============================================================================
function encodeVarint(val) {
  const bytes = [];
  let n = val;
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function encodeField(fn, wt, data) {
  const tag = encodeVarint((fn << 3) | wt);
  if (wt === 0) {
    return Buffer.concat([tag, encodeVarint(data)]);
  } else if (wt === 2) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return Buffer.concat([tag, encodeVarint(buf.length), buf]);
  }
  throw new Error('Unsupported wire type: ' + wt);
}

function encodeToolMetadata(toolName, argsObj = {}, timestampSec = Math.floor(Date.now() / 1000), callId = 'call_test_1') {
  const f4Inner = Buffer.concat([
    encodeField(1, 2, callId),
    encodeField(2, 2, toolName),
    encodeField(3, 2, JSON.stringify(argsObj))
  ]);
  const f1Inner = encodeField(1, 0, timestampSec);
  return Buffer.concat([
    encodeField(1, 2, f1Inner),
    encodeField(4, 2, f4Inner)
  ]);
}

function encodePlannerPayload({ toolCalls = null, finalReply = null }) {
  const f20Fields = [];
  if (toolCalls) {
    f20Fields.push(encodeField(7, 2, Buffer.isBuffer(toolCalls) ? toolCalls : Buffer.from(toolCalls)));
  }
  if (finalReply) {
    f20Fields.push(encodeField(1, 2, finalReply));
    f20Fields.push(encodeField(8, 2, finalReply));
  }
  const f20 = Buffer.concat(f20Fields);
  return encodeField(20, 2, f20);
}

function encodeRenderInfo(subagentId, role = 'Sub Agent', type = 'subagent') {
  return Buffer.concat([
    encodeField(1, 2, subagentId),
    encodeField(2, 2, role),
    encodeField(3, 2, type)
  ]);
}

// ============================================================================
// 3. 测试用例集
// ============================================================================
describe('Antigravity 子 Agent 后端核心逻辑单元测试', () => {
  let tmpDir = '';

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-backend-test-'));
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  let lastTestDbMtimeMs = 0;
  function createTestDb(dbPath, rows = []) {
    if (fs.existsSync(dbPath)) { try { fs.unlinkSync(dbPath); } catch {} }
    for (const ext of ['-wal', '-shm']) { if (fs.existsSync(dbPath + ext)) { try { fs.unlinkSync(dbPath + ext); } catch {} } }
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER,
      status INTEGER,
      metadata BLOB,
      render_info BLOB,
      step_payload BLOB,
      error_details BLOB,
      task_details BLOB
    )`);
    const insert = db.prepare(`INSERT INTO steps
      (idx, step_type, status, metadata, render_info, step_payload, error_details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) {
      insert.run(
        r.idx,
        r.step_type,
        r.status,
        r.metadata || null,
        r.render_info || null,
        r.step_payload || null,
        r.error_details || null
      );
    }
    db.close();
    // Coarse filesystem clocks can give a rewritten same-size DB the same mtime,
    // which the daemon's mtime+size cache would treat as unchanged. Keep mtimes unique.
    lastTestDbMtimeMs = Math.max(Date.now(), lastTestDbMtimeMs + 10);
    fs.utimesSync(dbPath, new Date(lastTestDbMtimeMs), new Date(lastTestDbMtimeMs));
  }

  it('1. readAgentProto / agentProtoValue 基础 Protobuf 编解码正确', () => {
    const meta = encodeToolMetadata('read_file', { Path: 'src/main.rs' }, 1794373100);
    const tool = daemon.agentProtoValue(meta, 4);
    assert.ok(Buffer.isBuffer(tool), 'metadata field 4 存在');
    const name = daemon.agentProtoValue(tool, 2);
    assert.equal(name.toString('utf8'), 'read_file');

    const toolName = daemon.extractToolInfo(meta);
    assert.equal(toolName, 'read_file');

    const args = daemon.extractJsonFromMetadata(meta);
    assert.deepEqual({ ...args }, { Path: 'src/main.rs' });

    const ts = daemon.extractTimestampFromMetadata(meta);
    assert.equal(ts, 1794373100 * 1000);
  });

  it('2. agentHasFinalResponse: 严格区分规划中工具调用与真正最终答复', () => {
    // 规划步包含 tool_calls (field 7) 以及中间文本：不是最终答复！
    const intermediatePayload = encodePlannerPayload({
      toolCalls: Buffer.from([0x01, 0x02]),
      finalReply: '我准备调用工具...'
    });
    const intermediateRow = {
      step_type: 15,
      status: 3,
      step_payload: intermediatePayload
    };
    assert.equal(daemon.agentHasFinalResponse(intermediateRow), false, '含有 tool_calls 的规划步绝不能判定为 final');

    // 真正最终答复：无 field 7 (tool_calls)，且含有 field 1/8 文本
    const finalPayload = encodePlannerPayload({
      finalReply: '任务已全部完成！这是最终报告。'
    });
    const finalRow = {
      step_type: 15,
      status: 3,
      step_payload: finalPayload
    };
    assert.equal(daemon.agentHasFinalResponse(finalRow), true, '无 tool_calls 且有正文的 status=3 step=15 为 final');

    // status = 2 (进行中) 或 step_type != 15：绝非 final
    assert.equal(daemon.agentHasFinalResponse({ ...finalRow, status: 2 }), false);
    assert.equal(daemon.agentHasFinalResponse({ ...finalRow, step_type: 132 }), false);
  });

  it('3. 未定量进度：运行中 progressPercent 为 null，确知 final 时为 100', () => {
    const subId = '22222222-2222-4222-8222-222222222222';
    const dbPath = path.join(tmpDir, `${subId}.db`);

    // 状态为 2 (运行中 read_file)
    createTestDb(dbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('init') },
      { idx: 1, step_type: 132, status: 2, metadata: encodeToolMetadata('read_file', { Path: 'core/daemon.mjs' }) }
    ]);

    const runningDetails = daemon.getSubagentDetails(subId, tmpDir);
    assert.equal(runningDetails.isRunning, true);
    assert.equal(runningDetails.isCompleted, false);
    assert.equal(runningDetails.progressPercent, null, '运行中未定量的进度必须为 null，绝不伪造百分比');
    assert.equal(runningDetails.status, 'running');
    assert.ok(runningDetails.actionText.includes('read_file') || runningDetails.actionText.includes('读取文件'));

    // 覆盖更新为已完成状态
    const finalPayload = encodePlannerPayload({ finalReply: '已交付完成' });
    createTestDb(dbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('init') },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata('read_file', { Path: 'core/daemon.mjs' }) },
      { idx: 2, step_type: 15, status: 3, step_payload: finalPayload }
    ]);

    const completedDetails = daemon.getSubagentDetails(subId, tmpDir);
    assert.equal(completedDetails.isRunning, false);
    assert.equal(completedDetails.isCompleted, true);
    assert.equal(completedDetails.progressPercent, 100, '仅确知 final 时 node.progressPercent 为 100');
    assert.equal(completedDetails.status, 'completed');
  });

  it('4. 单次工具失败 (status=7 / error_details) 标记为 error 但不谎报整个 agent 失败 (isFailed=false)', () => {
    const subId = '33333333-3333-4333-8333-333333333333';
    const dbPath = path.join(tmpDir, `${subId}.db`);

    createTestDb(dbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('init') },
      {
        idx: 1,
        step_type: 132,
        status: 7,
        metadata: encodeToolMetadata('run_command', { CommandLine: 'invalid-cmd' }),
        error_details: Buffer.from('command not found')
      }
    ]);

    const details = daemon.getSubagentDetails(subId, tmpDir);
    assert.equal(details.health, 'error');
    assert.equal(details.isFailed, false, '单步工具错误不等于整个 Agent 失败崩溃');
    assert.equal(details.isCompleted, false);
    assert.equal(details.progressPercent, null);
    assert.ok(details.actionText.includes('错误') || details.actionText.includes('失败'));
  });

  it('5. 按最新用户轮次隔离 (Latest User Turn Isolation)：历史轮次子 Agent 绝不混入', () => {
    const rootId = '44444444-4444-4444-8444-444444444444';
    const oldSubId = '55555555-5555-4555-8555-555555555555';
    const newSubId = '66666666-6666-4666-8666-666666666666';

    const rootDbPath = path.join(tmpDir, `${rootId}.db`);
    const oldSubDb = path.join(tmpDir, `${oldSubId}.db`);
    const newSubDb = path.join(tmpDir, `${newSubId}.db`);

    createTestDb(oldSubDb, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 15, status: 3, step_payload: encodePlannerPayload({ finalReply: '历史完成' }) }
    ]);
    createTestDb(newSubDb, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 132, status: 2, metadata: encodeToolMetadata('write_file', { Path: 'test.js' }) }
    ]);

    // Root 包含两轮用户提问：idx 0 (旧轮次派发 oldSubId)；idx 10 (新轮次派发 newSubId)
    createTestDb(rootDbPath, [
      { idx: 0, step_type: 14, status: 3 }, // 用户第1轮
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata('invoke_subagent'), render_info: encodeRenderInfo(oldSubId, '历史Agent') },
      { idx: 2, step_type: 15, status: 3, step_payload: encodePlannerPayload({ finalReply: '第1轮完成' }) },
      { idx: 10, step_type: 14, status: 3 }, // 用户最新轮次
      { idx: 11, step_type: 132, status: 3, metadata: encodeToolMetadata('invoke_subagent'), render_info: encodeRenderInfo(newSubId, '本轮Agent') }
    ]);

    const result = daemon.resolveFullSubagentTree(rootId, tmpDir);
    assert.equal(result.turnId, `${rootId}:10`, 'turnId 必须锁定最新用户提问 idx');
    assert.equal(result.totalCount, 1, '只应提取最新用户轮次派生的子 Agent');
    assert.equal(result.tree[0].id, newSubId, '只能是本轮子 Agent，历史子 Agent 绝不能混入');
    assert.equal(result.tree[0].role, '本轮Agent');
    assert.equal(result.turnEnded, false, '新轮次根会话尚未结束');
  });

  it('6. Recipient 复用既有子 Agent：按本次派发时间戳截断，防止历史完成误当本次完成', () => {
    const rootId = '77777777-7777-4777-8777-777777777777';
    const subId = '88888888-8888-4888-8888-888888888888';
    const rootDbPath = path.join(tmpDir, `${rootId}.db`);
    const subDbPath = path.join(tmpDir, `${subId}.db`);

    const T1 = 1794370000; // 第1轮时间
    const T2 = 1794375000; // 第2轮时间

    // 子 Agent 在 T1 已经产生过最终答复
    createTestDb(subDbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('msg', {}, T1) },
      { idx: 1, step_type: 15, status: 3, metadata: encodeToolMetadata('resp', {}, T1 + 2), step_payload: encodePlannerPayload({ finalReply: 'T1 已完成' }) }
    ]);

    // Root 在 T1 invoke_subagent 创建 subId；在 T2 (最新用户轮次) 通过 send_message 复用 subId
    createTestDb(rootDbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('u1', {}, T1) },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata('invoke_subagent', {}, T1), render_info: encodeRenderInfo(subId, '工作子Agent') },
      { idx: 2, step_type: 15, status: 3, step_payload: encodePlannerPayload({ finalReply: '轮次1完毕' }) },
      { idx: 10, step_type: 14, status: 3, metadata: encodeToolMetadata('u2', {}, T2) },
      { idx: 11, step_type: 132, status: 3, metadata: encodeToolMetadata('send_message', { Recipient: subId, Message: '请继续处理任务' }, T2 + 1) }
    ]);

    // 此时子 Agent 尚未对 T2 的新请求做出响应，getSubagentDetails 传入本次派发时间 T2
    const tree = daemon.resolveFullSubagentTree(rootId, tmpDir);
    assert.equal(tree.totalCount, 1, '必须识别通过 send_message Recipient 复用的子 Agent');
    assert.equal(tree.tree[0].id, subId);
    assert.equal(tree.tree[0].isCompleted, false, '不能把 T1 历史已完成误报为本次完成！');
    assert.equal(tree.tree[0].progressPercent, null);

    // 当子 Agent 在 T2 之后生成了新的 final step，此时才标记完成
    createTestDb(subDbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata('msg', {}, T1) },
      { idx: 1, step_type: 15, status: 3, metadata: encodeToolMetadata('resp', {}, T1 + 2), step_payload: encodePlannerPayload({ finalReply: 'T1 已完成' }) },
      { idx: 2, step_type: 14, status: 3, metadata: encodeToolMetadata('msg2', {}, T2 + 1) },
      { idx: 3, step_type: 15, status: 3, metadata: encodeToolMetadata('resp2', {}, T2 + 5), step_payload: encodePlannerPayload({ finalReply: 'T2 也完成' }) }
    ]);

    const updatedTree = daemon.resolveFullSubagentTree(rootId, tmpDir);
    assert.equal(updatedTree.tree[0].isCompleted, true, '子 Agent 在本次派发之后生成 final response，正确标记完成');
    assert.equal(updatedTree.tree[0].progressPercent, 100);
  });

  it('7. WAL 同尺寸更新探测：mtime 变化导致 dbSignature 及时更新', () => {
    const id = '99999999-9999-4999-8999-999999999999';
    const dbPath = path.join(tmpDir, `${id}.db`);
    createTestDb(dbPath, [{ idx: 0, step_type: 14, status: 3 }]);

    const sig1 = daemon.getDbSignature(id, tmpDir);
    assert.ok(sig1, '应获取到签名');

    const walPath = `${dbPath}-wal`;
    fs.writeFileSync(walPath, Buffer.alloc(1024, 0));
    const sig2 = daemon.getDbSignature(id, tmpDir);
    assert.notEqual(sig1, sig2, 'WAL 创建后签名必须改变');

    // 模拟同尺寸更新（仅 mtime 改变）
    const newTime = new Date(Date.now() + 5000);
    fs.utimesSync(walPath, newTime, newTime);
    const sig3 = daemon.getDbSignature(id, tmpDir);
    assert.notEqual(sig2, sig3, 'WAL 文件同尺寸但 mtime 更新时签名必须改变');
  });

  it("8. root 中间回复不能结束仍有未完成子任务的轮次", () => {
    const rootId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const rootDbPath = path.join(tmpDir, `${rootId}.db`);
    const childDbPath = path.join(tmpDir, `${childId}.db`);

    // Root: 用户提问 -> 派发子 Agent -> Root 产生最终答复
    createTestDb(rootDbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata("init") },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata("invoke_subagent"), render_info: encodeRenderInfo(childId, "子Agent") },
      { idx: 2, step_type: 15, status: 3, step_payload: encodePlannerPayload({ finalReply: "协调完毕，全部就绪" }) }
    ]);

    // Child: 仅有初始步骤，处于 waiting 状态
    createTestDb(childDbPath, [
      { idx: 0, step_type: 14, status: 3, metadata: encodeToolMetadata("init") }
    ]);

    const result = daemon.resolveFullSubagentTree(rootId, tmpDir);
    assert.equal(result.turnEnded, false, "Root 回复时仍有未完成子任务，轮次不能结束");
      assert.equal(result.rootHasFinal, true, "保留主线程已回复的独立事实");
    assert.equal(result.activeCount, 1, "子任务等待更新时仍应在未完成计数中");
    assert.equal(result.tree[0].status, "waiting", "子节点保持自身真实 waiting 状态");
    assert.equal(result.tree[0].isCompleted, false, "子节点未完成不被误报为完成");
  });

  it("9. 两层 Coordinator：有活动 child => hasActiveChild=true；child 完成但 coordinator 无 final 时不能强制完成", () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const coordId = "22222222-2222-4222-8222-222222222222";
    const leafId = "33333333-3333-4333-8333-333333333333";
    const rootDbPath = path.join(tmpDir, `${rootId}.db`);
    const coordDbPath = path.join(tmpDir, `${coordId}.db`);
    const leafDbPath = path.join(tmpDir, `${leafId}.db`);

    createTestDb(rootDbPath, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata("invoke_subagent"), render_info: encodeRenderInfo(coordId, "协调者") }
    ]);

    createTestDb(coordDbPath, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata("invoke_subagent"), render_info: encodeRenderInfo(leafId, "执行子叶") }
    ]);

    // 阶段 A: Leaf 正在运行
    createTestDb(leafDbPath, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 132, status: 2, metadata: encodeToolMetadata("run_command") }
    ]);

    const treeA = daemon.resolveFullSubagentTree(rootId, tmpDir);
    const coordNodeA = treeA.tree.find(n => n.id === coordId);
    assert.equal(coordNodeA.hasActiveChild, true, "子节点活动时 Coordinator 必须感知 hasActiveChild=true");
    assert.equal(coordNodeA.isCompleted, false, "Coordinator 自身未完成");

    // 阶段 B: Leaf 完成，但 Coordinator 自身没有 final response
    createTestDb(leafDbPath, [
      { idx: 0, step_type: 14, status: 3 },
      { idx: 1, step_type: 132, status: 3, metadata: encodeToolMetadata("run_command") },
      { idx: 2, step_type: 15, status: 3, step_payload: encodePlannerPayload({ finalReply: "叶子任务交付" }) }
    ]);

    const treeB = daemon.resolveFullSubagentTree(rootId, tmpDir);
    const coordNodeB = treeB.tree.find(n => n.id === coordId);
    const leafNodeB = treeB.tree.find(n => n.id === leafId);
    assert.equal(leafNodeB.isCompleted, true, "叶子节点标记完成");
    assert.equal(coordNodeB.hasActiveChild, false, "子节点已无活动");
    assert.equal(coordNodeB.isCompleted, false, "Coordinator 绝不能仅因子节点完成而被强制标记完成");
  });

  it("10. readAgentProto 鲁棒性：数值或非 Buffer 输入返回空 Map；正确解码或跳过 10-byte varint 后仍能读后续字段", () => {
    assert.equal(daemon.readAgentProto(12345).size, 0, "数值输入必须优雅返回 empty Map");
    assert.equal(daemon.readAgentProto(null).size, 0, "null 输入必须返回 empty Map");
    assert.equal(daemon.readAgentProto("string").size, 0, "字符串非 Buffer 输入必须返回 empty Map");

    // 构造包含 10 字节 varint 的 field 1，紧跟 field 2 的字符串
    const tag1 = (1 << 3) | 0; // field 1, wt 0
    const varint10 = [tag1, 0x81, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01];
    const str = "subsequent_field_data";
    const tag2 = (2 << 3) | 2; // field 2, wt 2
    const strBuf = Buffer.from(str, "utf8");
    const testBuf = Buffer.from([...varint10, tag2, strBuf.length, ...strBuf]);

    const parsed = daemon.readAgentProto(testBuf);
    assert.ok(parsed.has(1), "应解析出 field 1");
    assert.ok(parsed.has(2), "应跳过 10-byte varint 并成功解析后续 field 2");
    assert.equal(parsed.get(2)[0].toString("utf8"), str);
  });

  it("11. redispatch 时间锚点：历史 latestUser 无 timestamp 不得继承旧 final；找到 fresh anchor 后保留后续无 timestamp 步骤", () => {
    const T2 = 1794375000;
    const T2_ms = T2 * 1000;

    // 历史步骤：latestUser (idx 0) 无 timestamp 元数据，idx 1 为旧 final
    const oldRows = [
      { idx: 0, step_type: 14, status: 3, metadata: null },
      { idx: 1, step_type: 15, status: 3, metadata: null, step_payload: encodePlannerPayload({ finalReply: "Old Turn Final" }) }
    ];

    // 在 T2 重新派发前，子 Agent 绝不能继承旧 final 记录
    const rowsBefore = daemon.currentAgentRows(oldRows, T2_ms);
    assert.equal(rowsBefore.length, 0, "尚未收到新派发步骤时返回空切片，不继承旧 final");

    // 子 Agent 收到新任务并在 T2 写入 anchor 步骤 (idx 2)，紧接着写入无 timestamp 的步骤 3 和 4
    const newRows = [
      ...oldRows,
      { idx: 2, step_type: 90, status: 3, metadata: encodeToolMetadata("init", {}, T2) },
      { idx: 3, step_type: 101, status: 3, metadata: null },
      { idx: 4, step_type: 15, status: 2, metadata: null }
    ];

    const rowsAfter = daemon.currentAgentRows(newRows, T2_ms);
    assert.deepEqual(rowsAfter.map(r => r.idx), [2, 3, 4], "找到 fresh anchor 后，后续无 timestamp 步骤必须完整保留");
  });
});
