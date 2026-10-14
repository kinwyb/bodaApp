import {EditOutlined} from '@ant-design/icons';
import type {YupaiOrderCommandFactory} from './types';

/** 修改：取选中的第一条，打开编辑表单 */
export const editCommand: YupaiOrderCommandFactory = ({message, getSelectedRows, hasSelection, openForm}) => ({
    key: 'edit',
    label: '修改',
    icon: <EditOutlined/>,
    permission: '编辑',
    disabled: !hasSelection,
    menuCode:'A1DEEB48-5BDC-4A2D-8B99-BEF7334E4C19',
    onClick: () => {
        const target = getSelectedRows()[0];
        if (!target) {
            message.warning('请选择一条数据再修改').then();
            return;
        }
        openForm('edit', target);
    },
});
