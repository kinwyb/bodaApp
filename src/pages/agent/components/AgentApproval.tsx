/**
 * 审批的两种呈现：
 * - `AgentApprovalCard`：时间线里的一条记录，pending 时给「允许 / 拒绝」快捷按钮；
 * - `AgentApprovalModal`：审批到达时自动弹出的确认框，展示命令细节，是主要操作入口。
 *
 * 两者共用同一份状态（approval.status），点哪个都走同一个 onRespond。
 * 本文件只导出组件，辅助函数保持模块私有（Fast Refresh 约定）。
 */

import React from 'react';
import { Alert, Button, Modal, Space, Tag, Typography } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
} from '@ant-design/icons';
import type { AgentApproval, AgentApprovalStatus } from '../types';

type RespondFn = (approvalId: string, decision: 'accept' | 'decline') => void;

/** 把 argv 拼成可读命令；空数组返回 undefined */
function commandTextOf(approval: AgentApproval): string | undefined {
  const command = approval.extra?.command;
  if (!command || command.length === 0) return undefined;
  return command.join(' ');
}

const STATUS_META: Record<
  AgentApprovalStatus,
  { alert: 'warning' | 'success' | 'info'; title: string }
> = {
  pending: { alert: 'warning', title: '需要审批' },
  accepted: { alert: 'success', title: '已允许执行' },
  declined: { alert: 'info', title: '已拒绝执行' },
  expired: { alert: 'info', title: '审批已失效' },
};

/**
 * 时间线里的审批记录。
 *
 * pending 给快捷按钮（允许 / 拒绝 / 查看详情）；已表态或失效则只留一条说明，
 * 不再出现可点的操作 —— 避免「点了没反应」的假交互。
 */
export const AgentApprovalCard: React.FC<{
  approval: AgentApproval;
  onRespond?: RespondFn;
  onShow?: (approvalId: string) => void;
}> = ({ approval, onRespond, onShow }) => {
  const status = approval.status ?? 'pending';
  const meta = STATUS_META[status];
  const interactive = status === 'pending' && Boolean(onRespond);
  const command = commandTextOf(approval);

  return (
    <Alert
      className={`agent-approval agent-approval-${status}`}
      type={meta.alert}
      showIcon
      title={meta.title}
      description={
        <div className="agent-approval-body">
          <div className="agent-approval-content">
            {approval.content || 'Agent 请求执行一个需要确认的操作。'}
          </div>
          {command ? <code className="agent-approval-command">{command}</code> : null}
          {interactive ? (
            <Space size={8} className="agent-approval-actions">
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => onRespond?.(approval.id, 'accept')}
              >
                允许
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => onRespond?.(approval.id, 'decline')}
              >
                拒绝
              </Button>
              {onShow ? (
                <Button size="small" type="link" onClick={() => onShow(approval.id)}>
                  查看详情
                </Button>
              ) : null}
            </Space>
          ) : (
            <div className="agent-approval-hint">
              {status === 'accepted'
                ? '已允许，agent 将继续执行该操作。'
                : status === 'declined'
                  ? '已拒绝，agent 不会执行该操作。'
                  : '这一轮已结束，审批不再可操作。'}
            </div>
          )}
        </div>
      }
    />
  );
};

/**
 * 审批确认弹窗：审批到达时自动打开，把「要执行什么」讲清楚再让用户表态。
 *
 * 关闭（右上角 X / 遮罩）只是收起弹窗，审批仍是 pending —— agent 还在等，
 * 时间线卡片上的「查看详情」可以随时再把它打开。点「允许 / 拒绝」后由状态层
 * 乐观收尾，弹窗随 pending 消失而自动关闭。
 */
export const AgentApprovalModal: React.FC<{
  approval: AgentApproval | null;
  open: boolean;
  onClose: () => void;
  onRespond: RespondFn;
}> = ({ approval, open, onClose, onRespond }) => {
  if (!approval) return null;
  const command = commandTextOf(approval);
  const cwd = approval.extra?.cwd;
  const reason = approval.extra?.reason;

  const decide = (decision: 'accept' | 'decline') => {
    onRespond(approval.id, decision);
  };

  return (
    <Modal
      className="agent-approval-modal"
      rootClassName="agent-approval-modal-root"
      open={open}
      onCancel={onClose}
      width={520}
      mask={{ closable: false }}
      title={
        <Space size={8}>
          <ExclamationCircleFilled className="agent-approval-modal-icon" />
          <span>操作审批</span>
        </Space>
      }
      footer={
        <Space size={8}>
          <Button icon={<CloseOutlined />} onClick={() => decide('decline')}>
            拒绝
          </Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={() => decide('accept')}>
            允许执行
          </Button>
        </Space>
      }
    >
      <div className="agent-approval-modal-body">
        <Typography.Paragraph className="agent-approval-modal-lede">
          Agent 请求执行以下操作，需要你确认后才会继续。
        </Typography.Paragraph>

        {command ? (
          <div className="agent-approval-modal-section">
            <div className="agent-approval-modal-label">待执行命令</div>
            <pre className="agent-approval-modal-command">{command}</pre>
          </div>
        ) : null}

        {cwd ? (
          <div className="agent-approval-modal-section">
            <div className="agent-approval-modal-label">工作目录</div>
            <div className="agent-approval-modal-cwd">
              <FolderOpenOutlined />
              <span>{cwd}</span>
            </div>
          </div>
        ) : null}

        <div className="agent-approval-modal-section">
          <div className="agent-approval-modal-label">{reason ? '申请理由' : '说明'}</div>
          <div className="agent-approval-modal-reason">
            {reason || approval.content || 'Agent 未提供进一步说明。'}
          </div>
        </div>

        <div className="agent-approval-modal-note">
          <Tag color="warning">有副作用</Tag>
          <span>允许后 agent 将立即执行；拒绝则跳过该操作并继续本轮对话。</span>
        </div>
      </div>
    </Modal>
  );
};
