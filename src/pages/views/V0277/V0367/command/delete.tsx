import {DeleteOutlined, ExclamationCircleOutlined} from '@ant-design/icons';
import {Descriptions} from 'antd';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import {toStringOrEmpty} from '@/utils';
import {processRouteMatrixApi} from '@/api/modules/nc/processRouteMatrix.ts';
import {ErrorMessage} from '@/api/request.ts';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import type {ProcessRouteMatrixCommandFactory} from './types';

/** 空值统一显示成「—」：确认框里留白会让人以为那一项没存 */
function orDash(value: unknown): string {
    return toStringOrEmpty(value).trim() || '—';
}

/**
 * 摘要一行 → 确认框里的四条主信息（项目 / 物料 / 包装方式 / 矩阵版本）。
 *
 * 不用一句话串起来：四段值一长就挤在一起，删的是哪一份全凭用户自己数。
 */
function summaryItems(row: ProcessRouteMatrix) {
    const code = toStringOrEmpty(row.MaterialCode).trim();
    const name = toStringOrEmpty(row.MaterialName).trim();
    return [
        {key: 'project', label: '项目', children: orDash(row.ProjectCode)},
        // 物料给「编码 + 名称」：编码是唯一标识，名称才是人认得出来的那个
        {key: 'material', label: '物料', children: code && name ? `${code} ${name}` : orDash(code || name)},
        {key: 'method', label: '包装方式', children: orDash(row.PackMethod)},
        {key: 'version', label: '矩阵版本', children: orDash(row.MatrixVersion)},
    ];
}

/**
 * 删除：删掉选中的那一份工艺路线矩阵。
 *
 * 确认框里先把主信息摆出来 —— 删除不可撤销，所以**先看主键**：
 * 没有 `ProcessRouteMatrixID` 就报错，别让它打完接口再静默什么都不发生。
 *
 * 删除结果（成功 / 失败）都**不留在弹窗里**：弹窗只认打开那一刻选中的那一行，
 * 用户想换一条得回列表重新选，所以一律关掉，原因交给 message。
 *
 * 确认框用 context 里的 `modal`，不要用 antd 的静态方法（拿不到 App 的主题与上下文）。
 */
export const deleteCommand: ProcessRouteMatrixCommandFactory = ({modal, message, activeRow, hasSelection, reload}) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    danger: true,
    /**
     * 点下去只是弹确认框，删除在 `onOk` 里做。
     *
     * agent 没有「点确认」的动作，所以桥的回执会改成「已触发、等用户确认」而不是「已执行」。
     */
    waitConfirm: true,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一份工艺路线矩阵');
            return;
        }
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: '确认删除这份工艺路线矩阵？',
            width: 440,
            content: (
                <>
                    <Descriptions
                        size="small"
                        column={1}
                        colon={false}
                        // 标签固定宽度、值可换行：物料名再长也不会把标签挤成两行
                        styles={{
                            label: {width: 76, color: 'rgba(0, 0, 0, 0.65)'},
                            content: {color: 'rgba(0, 0, 0, 0.88)', fontWeight: 500},
                        }}
                        items={summaryItems(activeRow)}
                    />
                    {/* 靠右：不抢上面主信息的视线，又能紧贴「确认删除」按钮一侧 */}
                    <div style={{marginTop: 8, fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', textAlign: 'right'}}>
                        删除后不可恢复
                    </div>
                </>
            ),
            okText: '确认删除',
            cancelText: '取消',
            okButtonProps: {danger: true},
            mask: {blur: true},
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'delete',
                    outcome: 'cancelled',
                    targetIds: [activeRow.ProcessRouteMatrixID],
                });
            },
            onOk: async () => {
                const matrixID = toStringOrEmpty(activeRow.ProcessRouteMatrixID).trim();
                if (!matrixID) {
                    void message.error('这一行没有主键（ProcessRouteMatrixID），无法删除');
                    return;
                }
                try {
                    await processRouteMatrixApi.delete(matrixID);
                    void message.success('已删除');
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'confirmed',
                        targetIds: [matrixID],
                        message: '已删除',
                    });
                    // 列表按当前查询条件重拉：删完这一行就不该还留在屏幕上
                    await reload();
                } catch (error) {
                    /*
                     * 失败也**关掉弹窗**：弹窗里只能看到一个名字、换不了目标，
                     * 留着它等于让用户对着一个点不动的框重试。原因用 message 说清楚。
                     */
                    void message.error(ErrorMessage(error, '删除失败'));
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'failed',
                        targetIds: [matrixID],
                        message: ErrorMessage(error, '删除失败'),
                    });
                }
            },
        });
    },
});
