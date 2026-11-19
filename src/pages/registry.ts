import React from 'react';
import type { ViewComponent } from './types';

/**
 * 通用列表页：没单独实现页面的菜单都落到这里。
 *
 * 懒加载。它静态 import 了 GridTable，那串组件代码只在用户真点进「没单独实现的菜单」时
 * 才需要 —— 挂在首屏纯属浪费模块求值。页面本来就在 MainLayout 的 Suspense 里渲染，
 * 所以改 lazy 不需要额外加 fallback。
 *
 * 注：vtable 那 2.9MB 仍在首屏、这里省不掉 —— 界面桥（`agent/ui-bridge/table.ts`）
 * 静态依赖 `columnBuilder` 读表结构，那条链才是它进首屏的原因。别指望靠这行 lazy
 * 把 vtable 摘出去（试过把 tag 布局改成注册制，代价是隐式时序约定，已回退）。
 */
const ViewPage = React.lazy(() => import('./ViewPage'));

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

/** 菜单导航描述由 scripts/sync-menu-descriptions.mjs 从 bridged.ts 的 guide.summary 生成 */
const descriptions = import.meta.glob<string>('./views/**/description.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const descriptionByView = new Map<string, string>(
  Object.entries(descriptions).map(([path, content]) => [
    path.replace(/^\.\/views\//, '').replace(/\/description\.md$/, '').split('/').join('_'),
    content.trim(),
  ]),
);

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
 * 这个 View 是否有**精确匹配**的页面目录（`views/**\/index.tsx`）。
 *
 * 菜单发布判断必须用它，不能走 `resolveViewPath` —— 后者会向上找祖先页面，
 * 子菜单自己没有实现时会错误命中父目录，最终把没做完的页面放进发布菜单。
 */
export function hasRegisteredView(view: string): boolean {
  return viewRegistry.has(view);
}

/** 菜单导航用的功能描述；只认页面目录自己的 description.md，不向父目录回退 */
export function pageDescription(view: string): string | undefined {
  return descriptionByView.get(view) || undefined;
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
