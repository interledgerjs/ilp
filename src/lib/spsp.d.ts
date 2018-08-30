/// <reference types="node" />
import { PluginV2 } from './plugin';
import BigNumber from 'bignumber.js';
export declare const CONTENT_TYPE = "application/spsp4+json";
export interface JsonSpspResponse {
    destination_account: string;
    shared_secret: string;
    balance?: {
        maximum: string;
        current: string;
    };
    asset_info?: {
        code: string;
        scale: number;
    };
    receiver_info?: {
        name?: string;
        image_url?: string;
    };
}
export interface SpspResponse {
    destinationAccount: string;
    sharedSecret: Buffer;
    balance?: {
        maximum: string;
        current: string;
    };
    assetInfo?: {
        code: string;
        scale: number;
    };
    receiverInfo?: {
        name?: string;
        imageUrl?: string;
    };
    contentType: string;
}
export declare function query(receiver: string): Promise<SpspResponse>;
export interface PayOptions {
    receiver: string;
    sourceAmount: BigNumber.Value;
    data?: Buffer;
}
export interface PayResult {
    sent: BigNumber.Value;
    received: BigNumber.Value;
    requested?: BigNumber.Value;
}
export declare function pay(plugin: PluginV2, options: PayOptions): Promise<PayResult>;
