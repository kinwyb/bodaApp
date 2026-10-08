import {ExclamationCircleOutlined, SendOutlined} from '@ant-design/icons';
import {ApiError, yupaiOrderService} from '@/services';
import type {PreorderCommandFactory} from './types';

/** 发布订单：发布后不能取消，二次确认后批量提交 */
export const publishCommand: PreorderCommandFactory = ({message, modal, getSelectedRows, hasSelection, reload}) => ({
    key: 'publish',
    label: '发布',
    icon: <SendOutlined/>,
    permission: '发布',
    disabled: !hasSelection,
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
                    const succMsg = await yupaiOrderService.submit(targets.map((order) => order.ID));
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
