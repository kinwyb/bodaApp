/**
 * 底部输入区：Sender + 附件。
 *
 * 输入框内容与附件是纯 UI 状态，放在本组件内部；
 * 提交后清空自己，再回调 onSend —— 页面不需要关心这些细节。
 */

import React, { useCallback, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import type { UploadFile } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import { Attachments, Sender } from '@ant-design/x';
import type { AgentAttachment, AgentConnectionStatus } from '../types';
import { CONNECTION_META } from '../constants';

export const AgentComposer: React.FC<{
  streaming: boolean;
  mode: 'mock' | 'websocket';
  connection: AgentConnectionStatus;
  latency?: number;
  /** 紧凑形态（嵌在工作台左栏时）：面板窄，占位文案要短一档才不会折行 */
  compact?: boolean;
  onSend: (text: string, attachments?: AgentAttachment[]) => void;
  onAbort: () => void;
}> = ({ streaming, mode, connection, latency, compact = false, onSend, onAbort }) => {
  const [inputValue, setInputValue] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;

      const attachments: AgentAttachment[] = fileList.map((file) => ({
        uid: file.uid,
        name: file.name,
        size: file.size ?? 0,
        type: file.type,
      }));
      onSend(text, attachments.length > 0 ? attachments : undefined);
      setInputValue('');
      setFileList([]);
    },
    [fileList, onSend],
  );

  const handleFilesPicked = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files;
    if (!picked || picked.length === 0) return;

    const next: UploadFile[] = Array.from(picked).map((file) => ({
      uid: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'done',
      originFileObj: file as unknown as UploadFile['originFileObj'],
    }));
    setFileList((prev) => [...prev, ...next]);
    // 允许再次选择同名文件
    event.target.value = '';
  }, []);

  const footerText =
    mode === 'mock'
      ? '演示模式：配置 VITE_AGENT_WS_URL（默认 ws://127.0.0.1:8765/ws）后连接真实服务'
      : `ws · ${CONNECTION_META[connection].text}${latency !== undefined ? ` · ${latency}ms` : ''}`;

  return (
    <div className="agent-composer">
      <Sender
        className="agent-sender"
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        onCancel={onAbort}
        loading={streaming}
        placeholder={
          compact ? '想让助手做什么？Enter 发送' : '描述你想让助手做的事，Enter 发送，Shift + Enter 换行'
        }
        autoSize={{ minRows: 2, maxRows: 6 }}
        header={
          fileList.length > 0 ? (
            <Sender.Header
              title={`已添加 ${fileList.length} 个附件`}
              open
              onOpenChange={(open) => {
                if (!open) setFileList([]);
              }}
            >
              <Attachments
                items={fileList}
                onChange={({ fileList: next }) => setFileList(next)}
                overflow="scrollX"
                beforeUpload={() => false}
              />
            </Sender.Header>
          ) : undefined
        }
        prefix={
          <Tooltip title="添加附件">
            <Button
              type="text"
              icon={<PaperClipOutlined />}
              onClick={() => fileInputRef.current?.click()}
            />
          </Tooltip>
        }
        footer={
          <div className="agent-sender-footer">
            <span>{footerText}</span>
            <span>{inputValue.length > 0 ? `${inputValue.length} 字` : 'Shift + Enter 换行'}</span>
          </div>
        }
      />
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesPicked} />
    </div>
  );
};
