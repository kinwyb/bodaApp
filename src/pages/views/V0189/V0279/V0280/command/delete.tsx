import {CloseOutlined, ExclamationCircleOutlined} from '@ant-design/icons';
import {Input} from 'antd';
import {ApiError, yupaiOrderService} from '@/services';
import type {PreorderCommandFactory} from './types';

/** 取消（删除）订单：支持批量，确认时必须填写删除原因 */
export const deleteCommand: PreorderCommandFactory = ({message, modal, getSelectedRows, hasSelection, reload}) => ({
    key: 'cancel',
    label: '取消',
    icon: <CloseOutlined/>,
    disabled: !hasSelection,
    onClick: () => {
        const targets = getSelectedRows();
        if (targets.length < 1) {
            message.warning('请选择至少一条数据').then();
            return;
        }
        const title = targets.length > 1
            ? '确定删除选中的订单'
            : `确认删除订单: ${targets[0].OrderCode} 款式: ${targets[0].StyleCode} ？`;
        // 删除原因：confirm 是命令式调用，外部拿不到输入框的 state，用闭包变量带出提交值
        let memo = '';
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title,
            content: (
                <div className="delete-confirm-reason">
                    <Input.TextArea
                        rows={4}
                        autoFocus
                        maxLength={200}
                        showCount
                        placeholder="请填写删除原因"
                        onChange={(event) => {
                            memo = event.target.value;
                        }}
                    />
                </div>
            ),
            okText: '确认删除',
            okButtonProps: {danger: true},
            mask: {blur: true},
            onOk: async () => {
                const value = memo.trim();
                if (!value) {
                    void message.warning('请填写删除原因');
                    // 返回 rejected promise，弹窗保持打开，不丢已填内容
                    return Promise.reject();
                }
                try {
                    await yupaiOrderService.delete({ID: targets.map((order) => order.ID), Memo: value});
                    void message.success('已删除');
                    await reload();
                } catch (error) {
                    void message.error(error instanceof ApiError ? error.message : '删除失败');
                    // 失败同样保留弹窗，方便改完原因重试
                    return Promise.reject();
                }
            },
        });
    },
});
