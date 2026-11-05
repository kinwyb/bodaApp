import {DeleteOutlined, ExclamationCircleOutlined} from '@ant-design/icons';
import {Descriptions} from 'antd';
import type {PackBomMatrix} from '@/api/schemas/nc/bomMatrix.ts';
import {toStringOrEmpty} from '@/utils';
import {packBomMatrixApi} from '@/api/modules/nc/bomMatrix.ts';
import {ErrorMessage} from '@/api/request.ts';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import {PACK_BOM_MATRIX_DEL_MENU_CODE, type PackBomMatrixCommandFactory} from './types';

/**
 * 空值统一显示成「—」：确认框里留白会让人以为那一项没存，
 * 而「这一份确实没填包装数量」是有用的信息。
 */
function orDash(value: unknown): string {
    return toStringOrEmpty(value).trim() || '—';
}

/**
 * 摘要一行 → 确认框里的四条主信息（项目 / 物料 / 包装方法 / 包装数量）。
 *
 * 为什么不用一句话串起来：原来那行 `[ 项目 ] [ 物料 ] [ 方法 ] [ 数量 ]` 全靠中括号分隔，
 * 四段值一长就挤在一起，删的是哪一份全凭用户自己数括号。改成「标签 - 值」逐行摆开，
 * 每一项对应屏幕上的哪一列一目了然（列定义见 `../columns.ts`）。
 */
function summaryItems(row: PackBomMatrix) {
    const code = toStringOrEmpty(row.PackMaterialCode).trim();
    const name = toStringOrEmpty(row.PackMaterialName).trim();
    return [
        {key: 'project', label: '项目', children: orDash(row.ProjectCode)},
        // 物料给「编码 + 名称」：编码是唯一标识，名称才是人认得出来的那个
        {key: 'material', label: '物料', children: code && name ? `${code} ${name}` : orDash(code || name)},
        {key: 'method', label: '包装方式', children: orDash(row.PackMethod)},
        {key: 'num', label: '包装方法', children: orDash(row.PackNum)},
    ];
}

/**
 * 删除：删掉选中的那一份矩阵。
 *
 * 确认框里先把四条主信息摆出来，用户点「确认删除」之前得清楚删的是哪一份 ——
 * 删除不可撤销，所以**先看主键**：没有 `PackBomMatrixID` 就报错，别让它打完接口再静默什么都不发生。
 *
 * 删除结果（成功 / 失败）都**不留在弹窗里**：弹窗只认打开那一刻选中的那一行，
 * 用户想换一条得回列表重新选，所以一律关掉，原因交给 message。
 *
 * 确认框用 context 里的 `modal`，不要用 antd 的静态方法（拿不到 App 的主题与上下文）。
 */
export const deleteCommand: PackBomMatrixCommandFactory = ({modal, message, activeRow, hasSelection, reload}) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    danger: true,
    /**
     * 点下去只是弹确认框，删除在 `onOk` 里做。
     *
     * agent 没有「点确认」的动作，所以桥的回执会改成「已触发、等用户确认」而不是「已执行」——
     * 不标这个，模型会以为删完了（见 `../bridged.ts` 里包装命令 handler 的那段）。
     */
    waitConfirm: true,
    disabled: !hasSelection,
    menuCode: PACK_BOM_MATRIX_DEL_MENU_CODE,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一行矩阵');
            return;
        }
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: '确认删除这份包装 BOM 矩阵？',
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
                    {/* 靠右：不抢上面四条主信息的视线，又能紧贴「确认删除」按钮一侧 */}
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
                    targetIds: [activeRow.PackBomMatrixID],
                });
            },
            onOk: async () => {
                const matrixID = toStringOrEmpty(activeRow.PackBomMatrixID).trim();
                if (!matrixID) {
                    void message.error('这一行没有主键（PackBomMatrixID），无法删除');
                    return;
                }
                try {
                    await packBomMatrixApi.delete(matrixID);
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
                     * 留着它等于让用户对着一个点不动的框重试。原因用 message 说清楚，
                     * 要重试就从列表里重新选一行再来。
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
