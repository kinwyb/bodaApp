/**
 * 结构化提问的时间线记录。
 *
 * pending：每题一组单选（附自由输入项），底部「提交 / 跳过」；
 * answered / skipped / expired：只读回显，不再出现可点的操作。
 * 上游带 autoResolutionMs 时显示倒计时，到期本地先收起按钮，
 * 真正的失效以 request_resolved 事件为准。
 */

import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Radio, Space, Tag } from 'antd';
import { CheckOutlined, ForwardOutlined } from '@ant-design/icons';
import type { AgentUserInput, AgentUserInputStatus } from '../types';

type RespondFn = (requestId: string, answers: Record<string, string[]>) => void;

/** 「其他」单选项的哨兵值：选中后改用自由文本作答 */
const OTHER = '__other__';

const STATUS_META: Record<AgentUserInputStatus, { alert: 'info' | 'success'; title: string }> = {
  pending: { alert: 'info', title: '需要你的回答' },
  answered: { alert: 'success', title: '已回答' },
  skipped: { alert: 'info', title: '已跳过提问' },
  expired: { alert: 'info', title: '提问已失效' },
};

const STATUS_HINT: Record<Exclude<AgentUserInputStatus, 'pending'>, string> = {
  answered: '答案已回传，agent 将继续本轮对话。',
  skipped: '已跳过，agent 会按自己的判断继续。',
  expired: '这一轮已结束或提问超时，不再可作答。',
};

export const AgentUserInputCard: React.FC<{
  userInput: AgentUserInput;
  onRespond?: RespondFn;
}> = ({ userInput, onRespond }) => {
  const status = userInput.status ?? 'pending';
  const meta = STATUS_META[status];

  // 每题的选中项（选项 label 或 OTHER）与自由文本
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customs, setCustoms] = useState<Record<string, string>>({});

  // 倒计时：期限在 effect 里取当前时间算定，每秒异步刷新剩余秒数；
  // null 表示还没到第一次 tick，展示用上游给的总时长兜底
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'pending' || !userInput.autoResolutionMs) return;
    const end = Date.now() + userInput.autoResolutionMs;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [status, userInput.autoResolutionMs]);
  const autoExpired = remaining === 0;
  const interactive = status === 'pending' && Boolean(onRespond) && !autoExpired;

  const answersOf = (): Record<string, string[]> => {
    const answers: Record<string, string[]> = {};
    for (const question of userInput.questions) {
      const custom = (customs[question.id] ?? '').trim();
      if (!question.options || question.options.length === 0) {
        if (custom) answers[question.id] = [custom];
        continue;
      }
      const selection = selections[question.id];
      if (selection === OTHER) {
        if (custom) answers[question.id] = [custom];
      } else if (selection) {
        answers[question.id] = [selection];
      }
    }
    return answers;
  };

  const submit = () => {
    const answers = answersOf();
    if (Object.keys(answers).length > 0) onRespond?.(userInput.id, answers);
  };

  return (
    <Alert
      className={`agent-user-input agent-user-input-${status}`}
      type={meta.alert}
      showIcon
      title={meta.title}
      description={
        <div className="agent-user-input-body">
          {userInput.questions.map((question) => (
            <div key={question.id} className="agent-user-input-question">
              <div className="agent-user-input-question-text">
                {question.header ? <Tag className="agent-user-input-header">{question.header}</Tag> : null}
                {question.question}
              </div>
              {interactive ? (
                question.options && question.options.length > 0 ? (
                  <div className="agent-user-input-control">
                    <Radio.Group
                      orientation="vertical"
                      value={selections[question.id]}
                      onChange={(event) =>
                        setSelections((prev) => ({ ...prev, [question.id]: event.target.value }))
                      }
                      options={[
                        ...question.options.map((option) => ({
                          value: option.label,
                          label: (
                            <span className="agent-user-input-option">
                              <span>{option.label}</span>
                              {option.description ? (
                                <span className="agent-user-input-option-desc">{option.description}</span>
                              ) : null}
                            </span>
                          ),
                        })),
                        { value: OTHER, label: '其他（自由输入）' },
                      ]}
                    />
                    {selections[question.id] === OTHER ? (
                      <Input.TextArea
                        className="agent-user-input-custom"
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        variant="filled"
                        placeholder="输入你的回答"
                        value={customs[question.id] ?? ''}
                        onChange={(event) =>
                          setCustoms((prev) => ({ ...prev, [question.id]: event.target.value }))
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <Input.TextArea
                    className="agent-user-input-custom"
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    variant="filled"
                    placeholder="输入你的回答"
                    value={customs[question.id] ?? ''}
                    onChange={(event) =>
                      setCustoms((prev) => ({ ...prev, [question.id]: event.target.value }))
                    }
                  />
                )
              ) : (
                <div className="agent-user-input-answer">
                  {(userInput.answers?.[question.id] ?? []).join('、') || '未作答'}
                </div>
              )}
            </div>
          ))}
          {interactive ? (
            <Space size={8} className="agent-user-input-actions">
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                disabled={Object.keys(answersOf()).length === 0}
                onClick={submit}
              >
                提交
              </Button>
              <Button size="small" icon={<ForwardOutlined />} onClick={() => onRespond?.(userInput.id, {})}>
                跳过
              </Button>
              {userInput.autoResolutionMs ? (
                <span className="agent-user-input-countdown">
                  {remaining ?? Math.ceil(userInput.autoResolutionMs / 1000)} 秒后自动跳过
                </span>
              ) : null}
            </Space>
          ) : (
            <div className="agent-user-input-hint">
              {status === 'pending' ? '提问已超时，等待服务端确认。' : STATUS_HINT[status]}
            </div>
          )}
        </div>
      }
    />
  );
};
