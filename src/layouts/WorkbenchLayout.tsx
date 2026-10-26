/**
 * 工作台布局：左右两块 —— 左侧 Agent 助手，右侧原本的后台主界面。
 *
 * 为什么不用 antd 的 Splitter：这里只要「一条可拖拽的竖向分隔 + 面板能整块收起」，
 * 而 Splitter 会给两侧都套一层 Panel（自己管尺寸与动画），
 * 与 MainLayout / AgentChatPage 内部的 flex 高度链容易打架（见 index.css 里
 * .splitter-pane-body 那段注释）。所以用一个普通 flex 容器 + 6px 的拖拽条自己算宽度。
 *
 * 宽度与折叠状态记在 localStorage：开合是「用户偏好」，不该每次进主界面都重置。
 *
 * 本文件按项目约定只导出组件。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined } from '@ant-design/icons';

import AgentChatPage from '../pages/agent';
import MainLayout from './MainLayout';
import './workbench.css';

/** 用户偏好：左侧 Agent 面板宽度 / 是否收起 */
const WIDTH_KEY = 'boda_workbench.agent_width';
const COLLAPSED_KEY = 'boda_workbench.agent_collapsed';

/** 首次进入时的默认宽度（够放下气泡与输入框，又不至于把后台压得太窄） */
const DEFAULT_WIDTH = 480;
/** 左侧最小宽度：再窄输入框和顶栏就挤成两行了（实测 360 以内顶栏开始掉行） */
const AGENT_MIN_WIDTH = 360;
/** 右侧后台最小宽度：主界面自带 220px 菜单栏，再窄内容区就没法用了（Dashboard 的卡片会竖排） */
const MAIN_MIN_WIDTH = 720;

/** 把宽度收敛到「两侧都还可用」的区间里（窗口变小时不能把后台挤没） */
function clampWidth(width: number, viewport: number): number {
  const max = Math.max(AGENT_MIN_WIDTH, viewport - MAIN_MIN_WIDTH);
  const safe = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(safe, AGENT_MIN_WIDTH), max));
}

/** 读上次的宽度：本地存的值可能来自更大的屏幕，先按当前视口收敛一次 */
function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const stored = raw === null ? DEFAULT_WIDTH : Number(raw);
    return clampWidth(stored, window.innerWidth);
  } catch {
    // 隐私模式等拿不到 localStorage 的场景：不因此打不开界面
    return clampWidth(DEFAULT_WIDTH, window.innerWidth);
  }
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const WorkbenchLayout: React.FC = () => {
  const [agentWidth, setAgentWidth] = useState<number>(readStoredWidth);
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed);

  // 记住偏好（写失败不影响使用）
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(agentWidth));
    } catch {
      /* 忽略：存不下就每次用默认值 */
    }
  }, [agentWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* 同上 */
    }
  }, [collapsed]);

  // 窗口变小 / 显示器切换后重新收敛，避免右侧后台被压没
  useEffect(() => {
    const handleResize = () => setAgentWidth((current) => clampWidth(current, window.innerWidth));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /**
   * 拖拽分隔条调宽度。
   *
   * 监听挂在 window 上而不是分隔条本身：鼠标划出 6px 的细条也不会中断拖拽。
   * 拖拽期间给 body 加类，统一改光标并禁掉文本选中（否则会把两侧内容刷蓝）。
   */
  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = agentWidth;

      const handleMove = (moveEvent: PointerEvent) => {
        // 分隔条在助手左边：指针往左拖（delta 为负）才是变宽，所以取反
        setAgentWidth(clampWidth(startWidth - (moveEvent.clientX - startX), window.innerWidth));
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        document.body.classList.remove('workbench-resizing');
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      document.body.classList.add('workbench-resizing');
    },
    [agentWidth],
  );

  /** 双击分隔条：宽度回到默认值 */
  const handleResetWidth = useCallback(() => {
    setAgentWidth(clampWidth(DEFAULT_WIDTH, window.innerWidth));
  }, []);

  return (
    // 主界面在左、助手在右；助手收起时只留一条 44px 窄轨（图标 + 竖排文字），点一下展开
    <div className="workbench">
      <div className="workbench-main">
        <MainLayout />
      </div>

      {/* 分隔条在助手左边：向右收、向左扩 */}
      {collapsed ? null : (
        <div
          className="workbench-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整助手面板宽度"
          onPointerDown={handleDragStart}
          onDoubleClick={handleResetWidth}
        >
          <Tooltip title="收起助手" placement="left">
            {/* 收起按钮放在分隔条上：这里已经有「向右收」的视觉语义，不必再占顶栏位置。
                pointerdown 必须拦住，否则按一下就变成开始拖拽。 */}
            <button
              type="button"
              className="workbench-divider-handle"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setCollapsed(true)}
            >
              <MenuUnfoldOutlined />
            </button>
          </Tooltip>
        </div>
      )}

      {/*
        收起时用 display:none 而不是卸载组件：AgentChatPage 一旦卸载，ws 连接会断、
        正在生成的回答和会话列表都会丢，展开后又得重连重拉。
      */}
      <div
        className={`workbench-agent${collapsed ? ' workbench-agent-hidden' : ''}`}
        style={{ width: agentWidth }}
      >
        <AgentChatPage embedded />
      </div>

      {collapsed ? (
        <div className="workbench-rail">
          <Tooltip title="展开智能助手" placement="left">
            <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setCollapsed(false)} />
          </Tooltip>
          <RobotOutlined className="workbench-rail-icon" />
          {/* 竖排文字：图标不能塞进这段里（writing-mode 会把它一起转成竖的） */}
          <span className="workbench-rail-text">智能助手</span>
        </div>
      ) : null}
    </div>
  );
};

export default WorkbenchLayout;
