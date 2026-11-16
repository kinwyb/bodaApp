import {DeleteOutlined, ExclamationCircleOutlined} from '@ant-design/icons';
import {Descriptions} from 'antd';
import {configApi} from '@/api/modules/config';
import {ErrorMessage} from '@/api/request';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import type {DepartmentCommandFactory} from './types';

/**
 * 删除：删掉**树上当前选中的那个部门**（旧客户端 `delBtn_ItemClick`，删的是焦点节点，
 * 不是右侧表单里的草稿）。
 *
 * 确认框先把编码 / 名称 / 上级部门摆出来：部门编码是层层前缀拼出来的，光看名称很容易
 * 把「一车间」和「二车间」下的同名班组弄混，而删除不可撤销。
 *
 * `waitConfirm` 是给界面桥看的：点下去只弹框，agent 没有「点确认」这个动作，
 * 不标它模型会以为已经删完了。真实终态由 `action.outcome` 事件上报。
 */
export const deleteCommand: DepartmentCommandFactory = ({
                                                            modal,
                                                            message,
                                                            activeNode,
                                                            isRootSelected,
                                                            canDelete,
                                                            reload,
                                                        }) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    permission: '删除',
    danger: true,
    waitConfirm: true,
    disabled: !canDelete,
    dividerBefore: true,
    onClick: () => {
        const departmentID = toStringOrEmpty(activeNode?.ID).trim();
        if (!activeNode || isRootSelected || !departmentID) {
            void message.warning('请先在部门树上选中一个要删除的部门');
            return;
        }
        const no = toStringOrEmpty(activeNode.No);
        const name = toStringOrEmpty(activeNode.Name);
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: '确认删除这个部门？',
            width: 420,
            content: (
                <Descriptions
                    size="small"
                    column={1}
                    colon={false}
                    styles={{
                        label: {width: 76, color: 'rgba(0, 0, 0, 0.65)'},
                        content: {color: 'rgba(0, 0, 0, 0.88)', fontWeight: 500},
                    }}
                    items={[
                        {key: 'no', label: '部门编码', children: no || '—'},
                        {key: 'name', label: '部门名称', children: name || '—'},
                        {key: 'parent', label: '上级部门', children: toStringOrEmpty(activeNode.ParentName) || '—'},
                    ]}
                />
            ),
            okText: '确认删除',
            cancelText: '取消',
            okButtonProps: {danger: true},
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'delete',
                    outcome: 'cancelled',
                    targetIds: [departmentID],
                });
            },
            onOk: async () => {
                try {
                    await configApi.deleteDepartment(departmentID);
                    void message.success(`已删除部门 ${no} ${name}`.trim());
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'confirmed',
                        targetIds: [departmentID],
                        message: '已删除',
                    });
                    await reload();
                } catch (error) {
                    const reason = ErrorMessage(error, '部门删除失败');
                    void message.error(reason);
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'failed',
                        targetIds: [departmentID],
                        message: reason,
                    });
                }
            },
        });
    },
});
