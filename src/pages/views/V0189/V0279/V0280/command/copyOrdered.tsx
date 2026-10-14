import {CopyOutlined} from '@ant-design/icons';
import {Input} from 'antd';
import {ApiError, type YupaiOrder} from '@/api';
import {yupaiService} from '@/services/yupai';
import type {PreorderCommandFactory} from './types';

/**
 * 已下订单复制：先按订单号把订单查出来，再打开一份「复制」表单。
 *
 * 与「新增」的分工：新增是用户自己点「检测」把订单号查一遍（那条路还要查重、带默认业务员），
 * 这里由按钮先把订单号查出来，回答的只是一个问题 —— **这个号到底有没有单**：
 * - 没查到：提示「订单不存在」，弹窗保持打开让用户改完重试，表单不必打开；
 * - 查到了：不管它是否已下单都允许复制（业务上就是要拿已下单的单再来一份），
 *   把它当底稿打开表单 —— 订单号不复制（新单必须换新号），明细带出原单全部款式。
 *
 * 表单自己还会按订单号再查一次（要的是**全部**款式），这里的查询只做存在性校验：
 * 查到的数据不带走，避免把「命令层查到的快照」和「表单打开时的实时数据」两份混着用。
 */
export const copyOrderedCommand: PreorderCommandFactory = ({message, modal, openForm}) => ({
    key: 'copyOrdered',
    label: '已下订单复制',
    icon: <CopyOutlined/>,
    onClick: () => {
        // confirm 是命令式弹窗，外部拿不到输入框的 state，用闭包变量带出输入值（同 delete 的删除原因）
        let orderCode = '';
        /**
         * 校验通过的订单。
         *
         * 不在 onOk 里直接开表单，而是等确认弹窗**完全关闭**（afterClose）再开：
         * 两个弹窗叠在一起的瞬间会有两层遮罩，而且新弹窗的滚动锁（scrollLock）与
         * 正在关闭的旧弹窗互相计数，容易把 body 的 overflow 留在错误的状态上。
         */
        let pending: YupaiOrder | null = null;
        modal.confirm({
            title: '已下订单复制',
            icon: <CopyOutlined/>,
            content: (
                <div className="copy-order-confirm">
                    <Input
                        autoFocus
                        allowClear
                        placeholder="请输入要复制的订单号"
                        onChange={(event) => {
                            orderCode = event.target.value;
                        }}
                    />
                </div>
            ),
            okText: '查询',
            mask: {blur: true},
            afterClose: () => {
                const target = pending;
                pending = null;
                if (target) {
                    openForm('copy', target);
                }
            },
            onOk: async () => {
                const code = orderCode.trim();
                if (!code) {
                    void message.warning('请输入订单号');
                    // 返回 rejected promise，弹窗保持打开，不丢已输入的内容
                    return Promise.reject();
                }
                try {
                    const res = await yupaiService.queryOrder(code);
                    if (!res.data || res.data.length === 0) {
                        void message.error(`订单号 ${code} 不存在`);
                        return Promise.reject();
                    }
                    // 同一订单号可能有多条款式，取一条当代表即可 ——
                    // 表单会按订单号把全部款式取回来，这里带哪一条都不影响结果
                    pending = res.data[0];
                } catch (error) {
                    void message.error(error instanceof ApiError ? error.message : '订单查询失败');
                    // 失败同样保留弹窗，方便改完重试
                    return Promise.reject();
                }
            },
        });
    },
});

/** 演示占位（发布按钮之前）：复制 / 变更日志，接入业务时拆出去单独成文件即可。
 *  「已下订单复制」已接入业务，见 ./copyOrdered.tsx */
export const copyCommand: PreorderCommandFactory = ({message, getSelectedRows, hasSelection, openForm}) => ({
    key: 'copy',
    label: '复制',
    icon: <CopyOutlined/>,
    disabled: !hasSelection,
    dividerBefore: true,
    onClick: () => {
        const targets = getSelectedRows();
        if (targets.length < 1) {
            void message.warning('请选择一条数据');
            return;
        }
        const orderCode = targets[0].OrderCode;
        if (!orderCode) {
            void message.warning("目标数据订单号空,无法复制")
            return;
        }
        openForm('copy', targets[0]);
    }
})