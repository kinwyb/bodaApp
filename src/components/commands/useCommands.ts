import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {CommandFactory} from './types';

/**
 * 组装命令条：按 factories 顺序逐个执行工厂，展开成 CommandItem[]。
 *
 * 页面接入标准三步（参照 V0280 预订单页）：
 * 1. 页面目录下建 command/ 文件夹，每个功能一个文件，导出 CommandFactory 常量
 * 2. command/index.ts 里按按钮顺序列好工厂数组（放模块级常量，保住引用稳定），
 *    再包一个 useXxxCommands(context) 页面专用 hook
 * 3. 页面 useMemo 组装 CommandContext 传入；业务动作全在 command/ 里，页面只管状态与渲染
 *
 * useMemo 以 [context, factories] 为依赖：工厂数组是模块级常量时，
 * 命令条只在 context 变化时重建。
 */
export function useCommands<TContext extends object>(
    context: TContext,
    factories: CommandFactory<TContext>[],
): CommandItem[] {
    return useMemo(
        () =>
            factories.flatMap((factory) => {
                const created = factory(context);
                return Array.isArray(created) ? created : [created];
            }),
        [context, factories],
    );
}
