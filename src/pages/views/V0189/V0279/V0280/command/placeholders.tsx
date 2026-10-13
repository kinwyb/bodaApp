import {
    ApartmentOutlined,
    CalendarOutlined,
    CopyOutlined,
    FieldTimeOutlined,
    SafetyCertificateOutlined,
    SettingOutlined,
    ShopOutlined,
    TagOutlined,
} from '@ant-design/icons';
import type {ReactNode} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {PreorderCommandContext, PreorderCommandFactory} from './types';

/** 生成一个演示占位命令：点击只弹一句提示 */
function demo(
    message: PreorderCommandContext['message'],
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

/** 演示占位（发布按钮之前）：复制 / 变更日志，接入业务时拆出去单独成文件即可。
 *  「已下订单复制」已接入业务，见 ./copyOrdered.tsx */
export const copyPlaceholderCommand: PreorderCommandFactory = ({message}) =>
    demo(message, 'copy', '复制', <CopyOutlined/>, {dividerBefore: true});

export const changeDatePlaceholderCommand: PreorderCommandFactory = ({message}) =>
    demo(message, 'changeDate', '变更日志', <CalendarOutlined/>, {dividerBefore: true});

/** 演示占位（发布按钮之后）：已下单 / 分批 / 预订的阶段 / 工段产地 / 计划部设定 */
export const workflowPlaceholderCommands: PreorderCommandFactory = ({message}) => [
    demo(message, 'ordered', '已下单', <TagOutlined/>),
    demo(message, 'assign', '分批', <ApartmentOutlined/>, {dividerBefore: true}),
    demo(message, 'stage', '预订的阶段', <FieldTimeOutlined/>),
    demo(message, 'origin', '工段产地', <ShopOutlined/>, {permission: '产地设置'}),
    demo(message, 'plan', '计划部设定', <SettingOutlined/>, {permission: 'PMC设置'}),
];

/** 演示占位（命令条末尾）：权限 */
export const authPlaceholderCommand: PreorderCommandFactory = ({message}) =>
    demo(message, 'auth', '权限', <SafetyCertificateOutlined/>, {dividerBefore: true, permission: '权限管理'});
