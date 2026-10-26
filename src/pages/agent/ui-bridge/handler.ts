/**
 * 处理服务端下发的界面请求（ui.request）。
 *
 * 契约：每条请求恰好调用一次 respond。**失败也要回**——服务端在同步等待回执，
 * 不回答就是超时，模型只会看到「超时」而不知道「为什么不行」。
 * 所以下面所有失败路径都转成带原因的 ok=false，而不是静默返回。
 */

import type { UIRequestPayload, UISnapshot, UISnapshotData } from '../protocol';
import { UI_SNAPSHOT_VERSION } from '../protocol';
import type { AgentUIRequest } from '../transport';
import { bumpRev, currentRev, getUIBridgeHost } from './store';
import type { UIBridgeHost } from './types';

/** 创建请求处理器，交给 transport.onUIRequest 订阅 */
export function createUIRequestHandler(): (request: AgentUIRequest) => void {
  return (request) => {
    void answer(request);
  };
}

async function answer(request: AgentUIRequest): Promise<void> {
  const host = getUIBridgeHost();
  if (!host) {
    request.respond({ ok: false, error: '当前页面没有注册界面桥，无法操作' });
    return;
  }

  try {
    if (request.payload.op === 'observe') {
      request.respond({ ok: true, rev: currentRev(), snapshot: buildSnapshot(host) });
      return;
    }

    const result = await runAction(host, request.payload);
    // 成功操作推进版本：下一次 observe 拿到新 rev，旧快照再拿来操作会被拒
    bumpRev();
    // 等这次操作引起的渲染提交，否则回执里的快照可能还是操作前的视图
    await settleBeforeSnapshot();
    request.respond({
      ok: true,
      rev: currentRev(),
      result: result ?? null,
      snapshot: buildSnapshot(host),
    });
  } catch (error) {
    request.respond({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      rev: currentRev(),
    });
  }
}

/**
 * 让这次操作引起的渲染先落定，再取快照。
 *
 * 尽力而为，不保证 100%：命令可能是异步的（例如改完筛选条件要等接口返回），
 * 只有页面自己知道何时算落定。所以模型要权威状态时，重新 ui_observe 一次总是安全的
 * —— 那是一次独立请求，时序上必然晚于本次操作。
 */
function settleBeforeSnapshot(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 组装下发给模型的快照：页面只描述业务结构，v / rev / ts 由桥补齐 */
function buildSnapshot(host: UIBridgeHost): UISnapshot {
  const data: UISnapshotData = host.snapshot();
  return { v: UI_SNAPSHOT_VERSION, rev: currentRev(), ts: Date.now(), ...data };
}

/** 执行一条命令；任何不满足的前置条件都抛成模型可读的原因 */
async function runAction(host: UIBridgeHost, payload: UIRequestPayload): Promise<unknown> {
  const cmd = payload.cmd ?? '';
  if (!cmd) {
    throw new Error('缺少命令 ID');
  }
  if (payload.rev !== undefined && payload.rev !== currentRev()) {
    throw new Error(
      `页面状态已变化（快照 rev=${payload.rev}，当前 rev=${currentRev()}），请重新 ui_observe`,
    );
  }

  const action = host.snapshot().actions.find((item) => item.id === cmd);
  if (!action) {
    throw new Error(`命令不可用：${cmd}。请以最近一次 ui_observe 返回的 actions[].id 为准`);
  }
  if (action.disabled) {
    throw new Error(`命令 ${cmd} 当前不可执行：${action.disabledReason ?? '页面状态不允许'}`);
  }

  const run = host.handlers?.[cmd];
  if (!run) {
    throw new Error(`命令 ${cmd} 还没有接入处理函数`);
  }
  return await run(payload.params ?? {});
}
