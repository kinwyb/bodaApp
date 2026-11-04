/**
 * 「包装BOM矩阵明细」—— 发布 / 取消发布 / 更新 的弹窗。
 *
 * 两处入口共用同一个弹窗：
 * 1. 页面命令条上的「发布」（对主表选中的那一份矩阵）；
 * 2. 编辑弹窗里的「生成」（对刚保存 / 正在编辑的那一份）—— 原界面上这两个入口
 *    打开的是同一个窗体，所以这里只写一份，谁打开就传给谁 `matrixID`。
 *
 * **三个动作都以规则行（`PackBomMatrixRule`）为目标**：接口收的是规则主键数组，
 * 不是矩阵主键。作用范围是「表格里选中了行就只做选中的，没选中就是全部」——
 * 按钮名字叫「全部」，但用户先在表里点几行再点按钮，那个「全部」显然不是他要的。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {App, Button, Modal, Spin} from "antd";
import {CheckCircleFilled, CloseCircleFilled, SyncOutlined} from "@ant-design/icons";
import PushView, {type PushViewApi} from "@/components/nc/bomMatrix/pushView.tsx";
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";
import type {PackBomMatrixRule} from "@/api/schemas/nc/bomMatrix.ts";
import {ErrorMessage} from "@/api/request.ts";
import {toStringOrEmpty} from "@/utils";
import "./bomMatrixPush.css";

export type BomMatrixPushProps = {
    open: boolean;
    /** 要操作的矩阵（PackBomMatrixID）；空串时弹窗不去请求，只显示空表 */
    matrixID: string;
    /**
     * 标题下面的一句补充（包装物料编码 / 名称）。
     *
     * 用户常常同时开着好几份矩阵，标题只写「包装BOM矩阵明细」看不出是哪一份。
     */
    matrixLabel?: string;
    /**
     * 三个动作成功后通知外面。
     *
     * 页面用它重拉「发布情况」标签页 —— 不通知的话关掉弹窗，第四页还是发布前的样子。
     */
    onChanged?: () => void;
    onClose: () => void;
};

/** 三个动作：接口不同、可用条件不同，其余流程一样 */
type PushAction = 'push' | 'cancel' | 'update';

/** 动作的人话叫法（toast / 确认框共用，别在三个地方各写一份） */
const ACTION_LABEL: Record<PushAction, string> = {
    push: '发布',
    cancel: '取消发布',
    update: '更新',
};

const BomMatrixPush: React.FC<BomMatrixPushProps> = ({open, matrixID, matrixLabel, onChanged, onClose}) => {

    const {message, modal} = App.useApp();
    const pushRef = useRef<PushViewApi | null>(null);

    const [rows, setRows] = useState<PackBomMatrixRule[]>([]);
    /** 规则还在路上：首屏与换矩阵时显示占位，避免先给一张空表再整块重铺 */
    const [loading, setLoading] = useState(false);
    /** 正在跑的动作：既防连点，也给对应按钮一个 loading */
    const [acting, setActing] = useState<PushAction | ''>('');

    /**
     * 请求序号：弹窗关掉 / 换一份矩阵 / 操作完重拉时，让在飞的旧结果作废。
     *
     * 不挡的话「发布完立刻关弹窗」会把结果写进已经卸载的组件；
     * 连着点两次「发布」时两份规则也会互相覆盖。
     */
    const seqRef = useRef(0);

    /**
     * 取发布规则。
     *
     * @param quiet 静默刷新（动作成功后的重拉）：不切加载占位 —— 那时屏幕上已经是好数据，
     *   切过去等于把表格卸掉再装回来，滚动位置和列宽都会跳一下。
     */
    const loadRules = useCallback(async (targetID: string, quiet = false) => {
        const seq = ++seqRef.current;
        if (!targetID) {
            setRows([]);
            return;
        }
        if (!quiet) setLoading(true);
        try {
            const result = await packBomMatrixApi.pushRules(targetID);
            if (seq !== seqRef.current) return;
            setRows(result.data ?? []);
        } catch (err) {
            if (seq !== seqRef.current) return;
            setRows([]);
            void message.error(ErrorMessage(err, '发布情况加载失败'));
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [message]);

    /*
     * 打开就取；关掉就作废在飞的请求（下次打开是新的会话）。
     * 依赖带 matrixID：编辑弹窗里「生成」打开时，主键可能是刚保存回来的那个。
     */
    useEffect(() => {
        if (!open) {
            seqRef.current += 1;
            return;
        }
        void loadRules(matrixID);
    }, [open, matrixID, loadRules]);

    /**
     * 「已发布 / 未发布」各有多少 —— 按钮能不能点、点了有没有事，都看这两个数。
     *
     * 不把判断塞进 `run` 里：界面上也要用它们（按钮 disabled + 提示文案），
     * 两处各算一遍迟早会出现「按钮亮着、点了说没事可做」。
     */
    const pendingCount = useMemo(() => rows.filter((row) => !row.IsPush).length, [rows]);
    const pushedCount = useMemo(() => rows.filter((row) => !!row.IsPush).length, [rows]);

    /**
     * 这次动作要处理哪些行。
     *
     * - 表格里**选中了行**：只在选中范围里挑（发布挑未发布的，取消 / 更新挑已发布的）；
     * - **没选中**：整张表都算 —— 这才对得上按钮上的「全部」。
     *
     * 返回空数组是一个有意义的答案（「你选的那几行里没有能发布的」），
     * 调用方要如实说，而不是偷偷扩大到全部。
     */
    const resolveTargets = useCallback((action: PushAction): PackBomMatrixRule[] => {
        const candidates = rows.filter((row) => (action === 'push' ? !row.IsPush : !!row.IsPush));
        const selected = pushRef.current?.getSelectedRows() ?? [];
        if (selected.length === 0) return candidates;
        const selectedKeys = new Set(
            selected.map((row) => toStringOrEmpty(row.PackBomMatrixRuleID)).filter(Boolean),
        );
        return candidates.filter((row) => selectedKeys.has(toStringOrEmpty(row.PackBomMatrixRuleID)));
    }, [rows]);

    /**
     * 执行一个动作：确认 → 调接口 → 重拉规则。
     *
     * 三个动作都不可撤销（尤其「发布」会把 BOM 推到下游 NC），所以一律先确认一次，
     * 并且把**具体几条**写进确认框 —— 用户点「全部发布」时心里要有数。
     */
    const run = useCallback(async (action: PushAction) => {
        if (acting) return;
        const targets = resolveTargets(action);
        if (targets.length === 0) {
            const scope = (pushRef.current?.getSelectedRows() ?? []).length > 0 ? '选中的行里' : '这张表里';
            void message.warning(
                action === 'push' ? `${scope}没有未发布的规则` : `${scope}没有已发布的规则`,
            );
            return;
        }

        const confirmed = await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: `确认${ACTION_LABEL[action]}？`,
                content: `将对 ${targets.length} 条规则执行「${ACTION_LABEL[action]}」${action === 'cancel' ? '（下游 NC 里对应的 BOM 会被撤下）' : '（会推送到下游 NC）'}，是否继续？`,
                okText: '继续',
                cancelText: '取消',
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
                afterClose: () => resolve(false),
            });
        });
        if (!confirmed) return;

        const ruleIDs = targets
            .map((row) => toStringOrEmpty(row.PackBomMatrixRuleID))
            .filter((id) => id !== '');
        if (ruleIDs.length === 0) {
            void message.error('这些规则没有主键（PackBomMatrixRuleID），无法操作');
            return;
        }

        setActing(action);
        try {
            if (action === 'push') await packBomMatrixApi.push(ruleIDs);
            else if (action === 'cancel') await packBomMatrixApi.cancelPush(ruleIDs);
            else await packBomMatrixApi.updatePush(ruleIDs);
            void message.success(`已${ACTION_LABEL[action]} ${ruleIDs.length} 条规则`);
            // 发布状态 / 发布人 / 发布时间都是后端写的：重拉一遍才看得到真实结果
            pushRef.current?.clearSelection();
            await loadRules(matrixID, true);
            onChanged?.();
        } catch (err) {
            void message.error(ErrorMessage(err, `${ACTION_LABEL[action]}失败`));
        } finally {
            setActing('');
        }
    }, [acting, resolveTargets, message, modal, loadRules, matrixID, onChanged]);

    const busy = acting !== '';

    return (
        <Modal
            open={open}
            title={
                <div className="bom-matrix-push-title">
                    <span>包装BOM矩阵明细</span>
                    {matrixLabel && <span className="bom-matrix-push-subtitle">{matrixLabel}</span>}
                </div>
            }
            width={'80%'}
            onCancel={onClose}
            // 没有底部按钮：三个动作在顶部工具栏（与原界面一致）
            footer={null}
            destroyOnHidden
            className="bom-matrix-push"
        >
            <div className="bom-matrix-push-toolbar">
                <Button type="text" className="bom-matrix-push-action" icon={<CheckCircleFilled/>}
                        loading={acting === 'push'} disabled={busy}
                        title={`发布${pendingCount > 0 ? `（${pendingCount} 条未发布）` : '（没有未发布的规则）'}`}
                        onClick={() => void run('push')}>全部发布</Button>
                <Button type="text" className="bom-matrix-push-action bom-matrix-push-action-cancel"
                        icon={<CloseCircleFilled/>}
                        loading={acting === 'cancel'} disabled={busy}
                        title={`取消发布${pushedCount > 0 ? `（${pushedCount} 条已发布）` : '（没有已发布的规则）'}`}
                        onClick={() => void run('cancel')}>取消发布</Button>
                <Button type="text" className="bom-matrix-push-action bom-matrix-push-action-update"
                        icon={<SyncOutlined/>} loading={acting === 'update'} disabled={busy}
                        title={`更新${pushedCount > 0 ? `（${pushedCount} 条已发布）` : '（没有已发布的规则）'}：把已发布的 BOM 重新推送给下游 NC`}
                        onClick={() => void run('update')}>全部更新</Button>
                {/* 操作范围的一句话说明：「全部」按钮在有选中行时只做选中的行，不说清会让人误操作 */}
                <span className="bom-matrix-push-hint">选中表格行可只对选中行操作</span>
            </div>

            <div className="bom-matrix-push-table">
                {loading ? (
                    <div className="bom-matrix-push-loading">
                        <Spin/>
                        <span>正在加载发布情况…</span>
                    </div>
                ) : (
                    <PushView ref={pushRef} Datas={rows} VersionFieldName={'BOM版本'} VersionField={'BomVersion'}
                              selectable/>
                )}
                {!loading && acting !== '' && (
                    <div className="bom-matrix-push-busy">
                        <Spin size="small"/>
                        <span>正在{ACTION_LABEL[acting]}…</span>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default BomMatrixPush;
