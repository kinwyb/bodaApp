import React from 'react';
import {misScheduleApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {BonusPerformancePage} from '../bonusPerformancePage';
import {createVnMechanicBonusBridge} from './bridged';

const VnMechanicBonusPage: React.FC<ViewPageProps> = (props) => (
    <BonusPerformancePage
        {...props}
        title="MIS > 机修绩效统计(越南)"
        exportName="绩效奖金明细"
        loadSummary={async (month) => (await misScheduleApi.jxBonusMonth(month)).data ?? []}
        loadDetail={async (month) => (await misScheduleApi.jxBonusMonthDetail(month)).data ?? []}
        loadRate={async (month, employeeNo) => (await misScheduleApi.jxBonusMachRate(month, employeeNo)).data ?? []}
        createBridge={createVnMechanicBonusBridge}
    />
);

export default VnMechanicBonusPage;
