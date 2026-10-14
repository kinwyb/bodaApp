import {ExclamationCircleOutlined, SendOutlined} from '@ant-design/icons';
import {ApiError, yupaiApi, type YupaiOrder} from '@/api';
import type {YupaiOrderCommandFactory} from './types';
import {toNumberOrZero} from "@/utils";

/**
 * 发布只对 Status === 0 的预订单开放 —— 状态一旦推进（非 0）就不再允许发布。
 * 没有激活行时（多选后 Ctrl+A 全选、选中被清空、只点了表头）也返回 false：按钮该是灰的。
 */
function canOpenSubmit(row: YupaiOrder | null): boolean {
    // 必须先挡空值：toNumberOrZero(null/undefined) 得到的就是 0，
    // 直接比较会把「没有激活行」错判成「Status 为 0、可以打开」。
    if (!row) return false;
    // 用 toNumberOrZero 而不是 === 0：Status 可能以字符串 "0" 的形式过来
    return toNumberOrZero(row.Status) === 0;
}

/** 发布订单：发布后不能取消，二次确认后批量提交 */
export const publishCommand: YupaiOrderCommandFactory = ({message, modal, getSelectedRows, activeRow, reload}) => ({
    key: 'publish',
    label: '发布',
    icon: <SendOutlined/>,
    permission: '发布',
    disabled: !canOpenSubmit(activeRow),
    menuCode: '80382851-5467-4E1D-AE1F-ECB532BC2542',
    onClick: () => {
        const targets = getSelectedRows();
        if (targets.length === 0) {
            message.warning('请选择一条数据').then();
            return;
        }
        const content = targets.length > 1
            ? '发布选中的这些订单款式,发布后不能取消'
            : `发布订单:${targets[0].OrderCode} 款号: ${targets[0].StyleCode}`;
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: '发布确认',
            content,
            okText: '确认',
            okButtonProps: {danger: true},
            mask: {blur: true},
            onOk: async () => {
                try {
                    const succMsg = await yupaiApi.submit(targets.map((order) => order.ID));
                    void message.success(succMsg.data);
                    await reload();
                } catch (error) {
                    void message.error(error instanceof ApiError ? error.message : '发布失败');
                    // 失败同样保留弹窗，方便改完重试
                    return Promise.reject();
                }
            },
        });
    },
});
