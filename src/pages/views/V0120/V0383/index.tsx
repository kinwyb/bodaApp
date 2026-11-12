import React from 'react';
import {misReportApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {EfficiencyReportPage} from '../efficiencyReport';
import {createSpinnerEfficiencyBridge} from './bridged';

const SpinnerEfficiencyPage: React.FC<ViewPageProps> = (props) => (
    <EfficiencyReportPage
        {...props}
        title="MIS > 挡车效率"
        exportName="挡车效率"
        loadReport={misReportApi.spinnerRate}
        createBridge={createSpinnerEfficiencyBridge}
    />
);

export default SpinnerEfficiencyPage;
