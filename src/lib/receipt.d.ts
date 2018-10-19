import BigNumber from 'bignumber.js';
export interface AssetAmount {
    amount: BigNumber.Value;
    assetCode?: string;
    assetScale?: number;
}
export interface Receipt {
    destinationAccount: string;
    sourceAccount: string;
    received: AssetAmount;
    sent?: AssetAmount;
    requested?: AssetAmount;
}
