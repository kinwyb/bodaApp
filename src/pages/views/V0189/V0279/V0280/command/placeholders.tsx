import {
    SafetyCertificateOutlined,
    TagOutlined,
} from '@ant-design/icons';
import type {ReactNode} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {YupaiOrderCommandContext, YupaiOrderCommandFactory} from './types';

/** 生成一个演示占位命令：点击只弹一句提示 */
function demo(
    message: YupaiOrderCommandContext['message'],
    key: string,
    label: string,
    icon: ReactNode,
    extra?: Partial<CommandItem>,
): CommandItem {
    return {
        key,
        label,
        icon,
        onClick: () => message.info(`${label}（演示）`),
        ...extra,
    };
}

/** 演示占位（发布按钮之后）：只剩「已下单」。
 *  「分批」「预订的阶段」「工段产地」「计划部设定」均已接入业务，见 ./batch.tsx 与 ./settings.tsx */
export const workflowPlaceholderCommands: YupaiOrderCommandFactory = ({message}) => [
    demo(message, 'ordered', '已下单', <TagOutlined/>),
];

/** 演示占位（命令条末尾）：权限 */
export const authPlaceholderCommand: YupaiOrderCommandFactory = ({message}) =>
    demo(message, 'auth', '权限', <SafetyCertificateOutlined/>, {dividerBefore: true, permission: '权限管理'});
