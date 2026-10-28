/**
 * 底部输入区：Sender + 附件。
 *
 * 输入框内容与附件是纯 UI 状态，放在本组件内部；提交后清空自己，再回调 onSend。
 *
 * 附件是**选完就开始上传**的（不等到发送）：几十 MB 的文件传起来要几秒，
 * 等用户按下回车才动会让整个过程看起来像卡住了。发送时只带 fileID，
 * 文件本体与服务端的对应关系见 files/client.ts。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntdApp, Button, Tooltip } from 'antd';
import type { UploadFile } from 'antd';
import { PaperClipOutlined, ReloadOutlined } from '@ant-design/icons';
import { Attachments, Sender } from '@ant-design/x';
import type { AgentAttachment, AgentConnectionStatus, AgentTokenUsage } from '../types';
import { CONNECTION_META } from '../constants';
import { deleteAgentFile, fileErrorMessage, uploadAgentFile } from '../files';
import { AgentTokenMeter } from './AgentTokenMeter';

/** 附件项：在 antd 的 UploadFile 上补上传结果（fileID / 可访问地址 / 失败文案） */
type ComposerFile = UploadFile & {
  fileId?: string;
  fileUrl?: string;
  errorText?: string;
};

/** 附件卡片的状态说明：上传中显示进度，失败显示原因 */
function descriptionOf(file: ComposerFile): string | undefined {
  if (file.status === 'uploading') {
    return file.percent !== undefined ? `上传中 ${file.percent}%` : '上传中…';
  }
  if (file.status === 'error') return file.errorText ?? '上传失败';
  return undefined;
}

export const AgentComposer: React.FC<{
  streaming: boolean;
  mode: 'mock' | 'websocket';
  connection: AgentConnectionStatus;
  latency?: number;
  /** 紧凑形态（嵌在工作台左栏时）：面板窄，占位文案要短一档才不会折行 */
  compact?: boolean;
  /**
   * 当前会话的 token 用量（服务端 token_usage 帧 / 历史与列表的累计值）。
   * 没有用量记录（新对话、老数据）时不传，底部就不显示这一项。
   */
  usage?: AgentTokenUsage;
  onSend: (text: string, attachments?: AgentAttachment[]) => void;
  onAbort: () => void;
}> = ({ streaming, mode, connection, latency, compact = false, usage, onSend, onAbort }) => {
  const { message } = AntdApp.useApp();
  const [inputValue, setInputValue] = useState('');
  const [fileList, setFileList] = useState<ComposerFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 上传中的请求：移除附件时要能中断，否则删了列表请求还在跑 */
  const uploadsRef = useRef(new Map<string, AbortController>());

  // 卸载时中断所有在途上传：组件都没了，传完也没人接
  useEffect(() => {
    const uploads = uploadsRef.current;
    return () => {
      uploads.forEach((controller) => controller.abort());
      uploads.clear();
    };
  }, []);

  const startUpload = useCallback(async (uid: string, file: File) => {
    const controller = new AbortController();
    uploadsRef.current.set(uid, controller);
    setFileList((prev) =>
      prev.map((item) =>
        item.uid === uid
          ? { ...item, status: 'uploading', percent: 0, errorText: undefined }
          : item,
      ),
    );

    try {
      const info = await uploadAgentFile(file, {
        signal: controller.signal,
        onProgress: (percent) =>
          setFileList((prev) =>
            prev.map((item) => (item.uid === uid ? { ...item, percent } : item)),
          ),
      });
      setFileList((prev) =>
        prev.map((item) =>
          item.uid === uid
            ? {
                ...item,
                status: 'done',
                percent: 100,
                fileId: info.id,
                fileUrl: info.url,
                errorText: undefined,
              }
            : item,
        ),
      );
    } catch (error) {
      // 用户移除附件导致的中断不算失败：那一项已经不在列表里了
      if (controller.signal.aborted) return;
      setFileList((prev) =>
        prev.map((item) =>
          item.uid === uid
            ? { ...item, status: 'error', percent: 0, errorText: fileErrorMessage(error) }
            : item,
        ),
      );
    } finally {
      uploadsRef.current.delete(uid);
    }
  }, []);

  /** 丢弃附件：中断上传，已传成的顺手删掉（还占着服务端磁盘，不用等到过期） */
  const discard = useCallback((items: ComposerFile[]) => {
    items.forEach((item) => {
      uploadsRef.current.get(item.uid)?.abort();
      if (item.fileId) void deleteAgentFile(item.fileId).catch(() => undefined);
    });
  }, []);

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();

      const uploading = fileList.filter((file) => file.status === 'uploading').length;
      if (uploading > 0) {
        message.warning(`还有 ${uploading} 个文件正在上传，完成后会自动带上`);
        return;
      }
      const failed = fileList.filter((file) => file.status === 'error').length;
      if (failed > 0) {
        message.error(`有 ${failed} 个文件上传失败，请重试或移除后再发送`);
        return;
      }
      if (!text) {
        message.info(fileList.length > 0 ? '请补充一句说明再发送' : '请先输入内容');
        return;
      }

      const attachments: AgentAttachment[] = fileList.map((file) => ({
        uid: file.uid,
        name: file.name,
        size: file.size ?? 0,
        type: file.type,
        fileId: file.fileId,
        url: file.fileUrl,
        status: 'done',
      }));
      onSend(text, attachments.length > 0 ? attachments : undefined);
      setInputValue('');
      // 发送成功不清服务端文件：它已经被这条消息引用（服务端会移到 agent 工作区）
      setFileList([]);
    },
    [fileList, message, onSend],
  );

  const handleFilesPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files;
      if (!picked || picked.length === 0) return;

      const next: ComposerFile[] = Array.from(picked).map((file) => ({
        uid: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        // 演示模式没有文件服务：直接标完成，附件只作为本地展示
        status: mode === 'mock' ? 'done' : 'uploading',
        percent: 0,
        originFileObj: file as unknown as UploadFile['originFileObj'],
      }));
      setFileList((prev) => [...prev, ...next]);
      if (mode !== 'mock') {
        next.forEach((item) => {
          const file = item.originFileObj as unknown as File | undefined;
          if (file) void startUpload(item.uid, file);
        });
      }
      // 允许再次选择同名文件
      event.target.value = '';
    },
    [mode, startUpload],
  );

  /** 重传失败项（重新上传同一个 File 对象，不要求用户重选） */
  const retryFailed = useCallback(() => {
    fileList
      .filter((file) => file.status === 'error')
      .forEach((item) => {
        const file = item.originFileObj as unknown as File | undefined;
        if (file) void startUpload(item.uid, file);
      });
  }, [fileList, startUpload]);

  const handleAttachmentsChange = useCallback(
    ({ fileList: next }: { fileList: UploadFile[] }) => {
      const keep = new Set(next.map((item) => item.uid));
      const removed = fileList.filter((item) => !keep.has(item.uid));
      if (removed.length > 0) discard(removed);
      // 以旧项为底合并：x 传回来的 UploadFile 可能丢掉我们附加的 fileId / errorText
      setFileList((prev) =>
        next.map((item) => {
          const known = prev.find((old) => old.uid === item.uid);
          return known ? { ...known, ...item } : (item as ComposerFile);
        }),
      );
    },
    [discard, fileList],
  );

  const clearFiles = useCallback(() => {
    discard(fileList);
    setFileList([]);
  }, [discard, fileList]);

  const failedCount = fileList.filter((file) => file.status === 'error').length;
  const uploadingCount = fileList.filter((file) => file.status === 'uploading').length;

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
        allowSpeech={true}
        autoSize={{ minRows: 2, maxRows: 6 }}
        header={
          fileList.length > 0 ? (
            <Sender.Header
              title={`已添加 ${fileList.length} 个附件`}
              open
              onOpenChange={(open) => {
                if (!open) clearFiles();
              }}
            >
              <Attachments
                items={fileList.map((file) => ({
                  ...file,
                  // 卡片上用 description 表达「在传 / 传失败了」，byte 是字节数（卡片自己格式化）
                  description: descriptionOf(file),
                  byte: file.size,
                  loading: file.status === 'uploading',
                }))}
                onChange={handleAttachmentsChange}
                overflow="scrollX"
                beforeUpload={() => false}
              />
              {failedCount > 0 ? (
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<ReloadOutlined />}
                  onClick={retryFailed}
                >
                  重试失败项（{failedCount}）
                </Button>
              ) : null}
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
            <span className="agent-sender-conn">{footerText}</span>
            <span className="agent-sender-meta">
              {/* token 用量：服务端从来没给过数（新对话 / 老数据）就不占位 */}
              {usage ? <AgentTokenMeter usage={usage} /> : null}
              <span className="agent-sender-hint">
                {uploadingCount > 0
                  ? `${uploadingCount} 个附件上传中`
                  : failedCount > 0
                    ? `${failedCount} 个附件上传失败`
                    : inputValue.length > 0
                      ? `${inputValue.length} 字`
                      : 'Shift + Enter 换行'}
              </span>
            </span>
          </div>
        }
      />
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesPicked} />
    </div>
  );
};
