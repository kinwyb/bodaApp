import React from 'react';
import ViewPage from './ViewPage';
import type { ViewComponent } from './types';

/**
 * 页面按 View 层级建目录，注册全自动：
 *
 *   V0189_V0279_V0280  ->  src/pages/views/V0189/V0279/V0280/index.tsx
 *   V0005_V0010        ->  src/pages/views/V0005/V0010/index.tsx
 *
 * 建好文件夹放一个 index.tsx 即可，无需再手工登记。
 */
const loaders = import.meta.glob<{ default: ViewComponent }>('./views/**/index.tsx');

function viewFromPath(path: string): string {
  return path
    .replace(/^\.\/views\//, '')
    .replace(/\/index\.tsx$/, '')
    .split('/')
    .join('_');
}

/** View 路径 -> 页面组件（懒加载，按需分包） */
const viewRegistry = new Map<string, ViewComponent>();
Object.entries(loaders).forEach(([path, loader]) => {
  viewRegistry.set(viewFromPath(path), React.lazy(loader));
});

/** 手工注册，用于覆盖约定或注册非目录形式的页面 */
export function registerView(view: string, component: ViewComponent): void {
  viewRegistry.set(view, component);
}

/** 已登记的 View 列表 */
export function registeredViews(): string[] {
  return [...viewRegistry.keys()].sort();
}

/**
 * 解析 View 会落到哪个**已登记**的路径上（没有登记则为 null）：
 * 1. 完整 View 精确命中
 * 2. 逐级向上取最近注册的祖先 View
 *
 * 单独暴露它，是因为「这个 view 由哪个组件渲染」与「它接没接界面桥」必须用同一条解析链 ——
 * 否则给父目录接了桥，子目录自己没接也会被算成已接入（见 agent/ui-bridge/bridged.ts）。
 */
export function resolveViewPath(view: string): string | null {
  if (viewRegistry.has(view)) return view;
  const segments = view.split('_');
  for (let i = segments.length - 1; i > 0; i -= 1) {
    const ancestor = segments.slice(0, i).join('_');
    if (viewRegistry.has(ancestor)) return ancestor;
  }
  return null;
}

/**
 * 解析 View 对应的页面组件：
 * 1. 完整 View 精确命中
 * 2. 逐级向上取最近注册的祖先 View
 * 3. 回退到通用列表页 ViewPage
 */
export function resolveView(view: string): ViewComponent {
  const path = resolveViewPath(view);
  return (path && viewRegistry.get(path)) || ViewPage;
}
