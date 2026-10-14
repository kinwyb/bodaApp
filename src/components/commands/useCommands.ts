import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {CommandFactory} from './types';

/**
 * 组装命令条：按 factories 顺序逐个执行工厂，展开成 CommandItem[]。
 *
 * 页面接入标准三步（参照 V0280 预订单页）：
 * 1. 页面目录下建 command/ 文件夹，每个功能一个文件，导出 CommandFactory 常量
 * 2. `command/types.ts` 声明本页的命令上下文：`CommandContext<本页业务依赖>`（通用层只提供
 *    message / modal / tableRef 这些框架能力，业务字段由页面自己声明，见 CommandBaseContext）
 * 3. command/index.ts 列好工厂数组（模块级常量，保住引用稳定），再包一个 useXxxCommands() hook；
 *    页面 useMemo 组装 context 传入 —— 业务动作全在 command/ 里，页面只管状态与渲染
 *
 * 需要「某几个命令用别的依赖」或「顺序与分组不一致」时改用 useCommandGroups。
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
