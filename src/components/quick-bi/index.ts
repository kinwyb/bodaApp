/**
 * QuickBI 共用层入口（对应 C# Views/Dialog/QuickBI.cs 基类）。
 *
 * 与 grid-table / charts 的约定一致：**barrel 只导出组件与类型**，
 * 桥工厂 / 列生成器 / 命令 hook 走子路径（./bridge、./columns、./command），
 * 避免 Fast Refresh 边界被普通函数破坏。
 *
 * 页面用法：index.tsx 里一份模块级 QuickBIConfig + <QuickBIPage config={CONFIG}/>；
 * 页面目录再留一份 bridged.ts 转导出 ./bridge 的工厂（接桥标记按文件存在判定）。
 */
export {QuickBIPage} from './QuickBIPage';
export type {QuickBIPageProps} from './QuickBIPage';
export type {
    BiViewConfig,
    DetailTabData,
    DetailTarget,
    KpiRecord,
    QuickBIConfig,
    QuickBIDetailProfile,
} from './types';
