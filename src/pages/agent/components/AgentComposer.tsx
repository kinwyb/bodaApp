/**
 * 底部输入区：Sender + 附件。
 *
 * 输入框内容与附件是纯 UI 状态，放在本组件内部；提交后清空自己，再回调 onSend。
 * 欢迎页快捷指令通过 ref 的 fill 注入正文（只填充不发送）。
 *
 * 附件是**选完就开始上传**的（不等到发送）：几十 MB 的文件传起来要几秒，
 * 等用户按下回车才动会让整个过程看起来像卡住了。发送时只带 fileID，
 * 文件本体与服务端的对应关系见 files/client.ts。
 */

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Button, Switch, Tooltip } from 'antd';
import type { UploadFile } from 'antd';
import {
  AppstoreOutlined,
  PaperClipOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Attachments, Sender, Suggestion } from '@ant-design/x';
import type {
  AgentAttachment,
  AgentComposerApi,
  AgentConnectionStatus,
  AgentSkill,
  AgentTokenUsage,
} from '../types';
import { CONNECTION_META } from '../constants';
import { AGENT_STEER_COMMAND, isSteerMessage, steerGuidanceOf } from '../commands';
import { deleteAgentFile, fileErrorMessage, uploadAgentFile } from '../files';
import { useVoiceInput } from '../hooks/use-voice-input';
import { AgentTokenMeter } from './AgentTokenMeter';
import { useI18n } from '@/i18n/context';

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

/** 切换技能时先去掉正文开头已有的 `$xxx`，避免叠成 `$ui $other` */
function stripSkillToken(text: string): string {
  return text.replace(/^\$[^\s]*\s*/, '').trimStart();
}

type SkillOption = { key: string; token: string; label: string; description: string };

/** 技能建议项：`$` 触发与图标点击共用同一份渲染，两个浮层看起来完全一致 */
function toSkillSuggestionItem(option: SkillOption) {
  return {
    value: option.token,
    label: <span className="agent-suggestion-label">{option.label}</span>,
    description: option.description,
    extra: <code className="agent-suggestion-token">{option.token}</code>,
  };
}

type AgentComposerProps = {
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
  /** 当前 agent 实际加载的技能 */
  skills: AgentSkill[];
  /** 技能列表正在从 agent 读取 */
  skillsLoading: boolean;
  /** 是否已手动开启当前会话的界面联动 */
  uiFollow: boolean;
  /** 当前会话已有真实用户消息后，才允许开启 */
  canFollow: boolean;
  onUIFollowChange: (enabled: boolean) => void;
  onSend: (text: string, attachments?: AgentAttachment[]) => void;
  /** 生成中补充引导；由聊天状态层负责加 `/steer` 前缀且不插入空回答 */
  onSteer: (text: string, attachments?: AgentAttachment[]) => void;
  onAbort: () => void;
};

export const AgentComposer = React.forwardRef<AgentComposerApi, AgentComposerProps>(({
  streaming,
  mode,
  connection,
  latency,
  compact = false,
  usage,
  skills,
  skillsLoading,
  uiFollow,
  canFollow,
  onUIFollowChange,
  onSend,
  onSteer,
  onAbort,
}, ref) => {
  const { message } = AntdApp.useApp();
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [fileList, setFileList] = useState<ComposerFile[]>([]);
  const [suggestionKind, setSuggestionKind] = useState<'command' | 'skill' | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  /** 技能浮层由图标点开：展示全部技能，不按正文过滤 */
  const [suggestionFromIcon, setSuggestionFromIcon] = useState(false);
  /** 技能按钮的 tooltip 只跟随鼠标：弹窗关闭后焦点回到按钮时不该再弹提示 */
  const [skillTipHover, setSkillTipHover] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 上传中的请求：移除附件时要能中断，否则删了列表请求还在跑 */
  const uploadsRef = useRef(new Map<string, AbortController>());
  const skillOptions = useMemo(
    () => {
      const unique = new Map<string, SkillOption>();
      skills.forEach((skill) => {
        const name = skill.name.trim();
        if (!name || unique.has(name)) return;
        unique.set(name, {
          key: name,
          token: `$${name}`,
          label: skill.displayName || name,
          description: skill.shortDescription || skill.description || name,
        });
      });
      return [...unique.values()];
    },
    [skills],
  );

  // 语音输入：点一下开始、再点结束，中途停顿不会自己停（详见 hooks/use-voice-input.ts）
  const handleVoiceTranscript = useCallback((text: string) => {
    setInputValue((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
  }, []);
  const handleVoiceError = useCallback((text: string) => message.warning(text), [message]);
  const voice = useVoiceInput({
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = composerRef.current?.querySelector('textarea');
      if (!textarea) return;
      textarea.focus();
      // 选中命令/技能后把光标放到末尾，接着输入的内容才不会插到 `/steer` 中间
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
  }, []);

  // 快捷指令填充：覆盖正文、收起可能开着的建议浮层，聚焦后把光标放到末尾方便接着改
  useImperativeHandle(
    ref,
    () => ({
      fill(text: string) {
        setInputValue(text);
        setSuggestionOpen(false);
        setSuggestionKind(null);
        setSuggestionFromIcon(false);
        requestAnimationFrame(() => {
          const textarea = composerRef.current?.querySelector('textarea');
          if (!textarea) return;
          textarea.focus();
          textarea.setSelectionRange(text.length, text.length);
        });
      },
    }) satisfies AgentComposerApi,
    [],
  );

  const applySkill = useCallback(
    (token: string) => {
      setInputValue((current) => {
        const trimmed = current.trimStart();
        const steering = isSteerMessage(trimmed);
        const body = stripSkillToken(steering ? steerGuidanceOf(trimmed) : trimmed);
        const next = body ? `${token} ${body}` : `${token} `;
        return steering ? `${AGENT_STEER_COMMAND} ${next}` : next;
      });
      setSuggestionOpen(false);
      setSuggestionKind(null);
      setSuggestionFromIcon(false);
      focusComposer();
    },
    [focusComposer],
  );

  const applySuggestion = useCallback(
    (value: string) => {
      if (value.startsWith('$')) {
        applySkill(value);
        return;
      }
      setInputValue(`${value} `);
      setSuggestionOpen(false);
      setSuggestionKind(null);
      focusComposer();
    },
    [applySkill, focusComposer],
  );

  const suggestionItems = useMemo(
    () => {
      if (suggestionKind === 'skill') {
        // 图标点开时没有 `$` 查询词，直接给全量；空态/加载中用禁用项占位
        if (skillOptions.length === 0) {
          return [
            {
              value: '__skills-empty',
              disabled: true,
              label: (
                <span className="agent-suggestion-label">
                  {skillsLoading ? '正在从 agent 读取技能…' : '当前 agent 没有可用技能'}
                </span>
              ),
            },
          ];
        }
        const query = suggestionFromIcon
          ? ''
          : inputValue.trimStart().replace(/^\$/, '').toLowerCase();
        const matched = query
          ? skillOptions.filter((option) =>
              [option.key, option.label, option.description].some((value) =>
                value.toLowerCase().includes(query),
              ),
            )
          : skillOptions;

        return matched.map(toSkillSuggestionItem);
      }

      return [
        {
          value: AGENT_STEER_COMMAND,
          label: <span className="agent-suggestion-label">{t('引导')}</span>,
          description: '回答生成中补充一条引导',
          extra: <code className="agent-suggestion-token">{AGENT_STEER_COMMAND}</code>,
        },
      ];
    },
    [inputValue, skillOptions, skillsLoading, suggestionFromIcon, suggestionKind, t],
  );

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
      const steerText = steerGuidanceOf(text);

      const uploading = fileList.filter((file) => file.status === 'uploading').length;
      if (uploading > 0) {
        message.warning(t('还有 {count} 个文件正在上传，完成后会自动带上', { vars: { count: uploading } }));
        return;
      }
      const failed = fileList.filter((file) => file.status === 'error').length;
      if (failed > 0) {
        message.error(t('有 {count} 个文件上传失败，请重试或移除后再发送', { vars: { count: failed } }));
        return;
      }
      if (!text) {
        message.info(fileList.length > 0 ? t('请补充一句说明再发送') : t('请先输入内容'));
        return;
      }
      if (streaming && !steerText) {
        message.info(t('请输入要补充的引导内容'));
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
      if (streaming) {
        onSteer(steerText, attachments.length > 0 ? attachments : undefined);
      } else {
        onSend(text, attachments.length > 0 ? attachments : undefined);
      }
      setInputValue('');
      // 发送成功不清服务端文件：它已经被这条消息引用（服务端会移到 agent 工作区）
      setFileList([]);
    },
    [fileList, message, onSend, onSteer, streaming, t],
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
      : `ws · ${t(CONNECTION_META[connection].text)}${latency !== undefined ? ` · ${latency}ms` : ''}`;

  return (
    <div className="agent-composer" ref={composerRef}>
      <Suggestion
        className="agent-suggestion"
        items={suggestionItems}
        open={suggestionOpen}
        styles={{
          popup: {
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
          },
        }}
        onOpenChange={(open) => {
          setSuggestionOpen(open);
          if (!open) {
            setSuggestionKind(null);
            setSuggestionFromIcon(false);
          }
        }}
        onSelect={applySuggestion}
      >
        {({ onTrigger, onKeyDown }) => (
          <Sender
            className="agent-sender"
            value={inputValue}
            onChange={(value) => {
              setInputValue(value);
              const candidate = value.trimStart();
              let nextKind: 'command' | 'skill' | null = null;
              if (/^\$[^\s]*$/.test(candidate) && skillOptions.length > 0) {
                nextKind = 'skill';
              } else if (
                /^\/[^\s]*$/.test(candidate) &&
                AGENT_STEER_COMMAND.startsWith(candidate.toLowerCase())
              ) {
                nextKind = 'command';
              }

              if (nextKind) {
                setSuggestionFromIcon(false);
                if (!suggestionOpen || suggestionKind !== nextKind) {
                  setSuggestionKind(nextKind);
                  onTrigger({ kind: nextKind });
                }
                return;
              }

              if (suggestionOpen) onTrigger(false);
              setSuggestionKind(null);
            }}
            onKeyDown={(event) => {
              // Suggestion 外层是 antd Cascader，其根节点会把空格键 preventDefault 掉
              // （combobox 语义里空格是“打开下拉”），导致这个输入框永远打不出空格，
              // `/steer` 只能和正文紧挨在一起。在空格冒泡到 Cascader 之前拦住它，
              // 让空格正常输入；其余按键仍交给建议浮层（返回值决定是否拦截 Enter 提交）。
              if (event.key === ' ') {
                event.stopPropagation();
              }
              return onKeyDown(event);
            }}
            onSubmit={handleSubmit}
            onCancel={onAbort}
            placeholder={
              streaming
                ? compact
                  ? t('输入引导，Enter 发送 /steer')
                  : t('输入引导，Enter 发送 /steer；输入 / 或 $ 选择命令与技能')
                : compact
                  ? t('想让助手做什么？Enter 发送')
                  : t('描述你想让助手做的事；输入 / 或 $ 选择命令与技能')
            }
            allowSpeech={voice.allowSpeech}
            autoSize={{ minRows: 2, maxRows: 6 }}
            header={
              fileList.length > 0 ? (
                <Sender.Header
                  title={t('已添加 {count} 个附件', { vars: { count: fileList.length } })}
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
                      {t('重试失败项（{count}）', { vars: { count: failedCount } })}
                    </Button>
                  ) : null}
                </Sender.Header>
              ) : undefined
            }
            prefix={
              <span className="agent-composer-tools">
                <Tooltip title={t('添加附件')}>
                  <Button
                    type="text"
                    icon={<PaperClipOutlined />}
                    onClick={() => fileInputRef.current?.click()}
                  />
                </Tooltip>
                <Tooltip
                  title={t('选择技能')}
                  open={
                    skillTipHover &&
                    !(suggestionOpen && suggestionKind === 'skill' && suggestionFromIcon)
                  }
                >
                  <Button
                    type="text"
                    icon={<AppstoreOutlined />}
                    aria-label={t('选择技能')}
                    onKeyDown={onKeyDown}
                    onMouseEnter={() => setSkillTipHover(true)}
                    onMouseLeave={() => setSkillTipHover(false)}
                    onClick={() => {
                      // 与 `$` 共用同一个浮层：位置固定在输入框上方，渲染完全一致
                      if (suggestionOpen && suggestionKind === 'skill' && suggestionFromIcon) {
                        onTrigger(false);
                        return;
                      }
                      setSuggestionKind('skill');
                      setSuggestionFromIcon(true);
                      onTrigger({ kind: 'skill' });
                    }}
                  />
                </Tooltip>
              </span>
            }
            suffix={(_original, { components }) => (
              <span className="agent-sender-actions">
                {voice.allowSpeech ? <components.SpeechButton /> : null}
                {/*
                 * 生成中只保留一个主按钮：输入框为空时发送键原位变成停止键，
                 * 一旦开始输入引导又变回发送（/steer），不再并排多出一个图标。
                 * 注意不能给 Sender 传 loading：那会拦掉 Enter 提交，引导就发不出去了。
                 * LoadingButton 默认随 loading 禁用，这里显式解禁并交给 onCancel 中断。
                 */}
                {streaming && !inputValue.trim() ? (
                  <Tooltip title={t('停止生成')}>
                    <components.LoadingButton disabled={false} aria-label={t('停止生成')} />
                  </Tooltip>
                ) : (
                  <Tooltip title={streaming ? t('发送引导 /steer') : t('发送')}>
                    <components.SendButton />
                  </Tooltip>
                )}
              </span>
            )}
            footer={
              <div className="agent-sender-footer">
                <span className="agent-sender-left">
                  <Tooltip
                    title={
                      canFollow
                        ? uiFollow
                          ? t('界面联动已开启：普通事件会合并，确认终态会立即发送')
                          : t('界面联动已关闭：页面事件不会记录或发送')
                        : t('先发送一条消息开始对话，之后才能开启界面联动')
                    }
                  >
                    <label className="agent-ui-follow">
                      <span>{t('界面联动')}</span>
                      <Switch
                        size="small"
                        checked={uiFollow}
                        disabled={!canFollow}
                        aria-label={t('界面联动')}
                        onChange={onUIFollowChange}
                      />
                    </label>
                  </Tooltip>
                  <span className="agent-sender-conn">{footerText}</span>
                </span>
                <span className="agent-sender-meta">
                  {/* token 用量：服务端从来没给过数（新对话 / 老数据）就不占位 */}
                  {usage ? <AgentTokenMeter usage={usage} /> : null}
                  <span className="agent-sender-hint">
                    {uploadingCount > 0
                      ? t('{count} 个附件上传中', { vars: { count: uploadingCount } })
                      : failedCount > 0
                        ? t('{count} 个附件上传失败', { vars: { count: failedCount } })
                        : voice.transcribing
                          ? t('识别中…')
                          : voice.recording
                            ? t('正在听…说完再点麦克风结束')
                            : inputValue.length > 0
                              ? t('{count} 字', { vars: { count: inputValue.length } })
                              : streaming
                                ? t('Enter 发送 /steer')
                                : t('Shift + Enter 换行')}
                  </span>
                </span>
              </div>
            }
          />
        )}
      </Suggestion>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesPicked} />
    </div>
  );
});

AgentComposer.displayName = 'AgentComposer';
