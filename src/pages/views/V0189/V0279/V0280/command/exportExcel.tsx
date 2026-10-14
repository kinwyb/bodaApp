import {ExportOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import type {YupaiOrderCommandFactory} from './types';

/** 导出当前页到 Excel：走 VTable 内部的 TableExportPlugin，文件名不用带 .xlsx（插件会补） */
export const exportCommand: YupaiOrderCommandFactory = ({message, tableRef}) => ({
    key: 'export',
    label: '导出',
    icon: <ExportOutlined/>,
    dividerBefore: true,
    onClick: async () => {
        const hide = message.loading('正在导出…', 0);
        try {
            await tableRef.current?.exportExcel(`预订单_${dayjs().format('YYYY-MM-DD')}`);
            void message.success('导出成功');
        } catch (error) {
            void message.error(error instanceof Error ? error.message : '导出失败');
        } finally {
            hide();
        }
    },
});
