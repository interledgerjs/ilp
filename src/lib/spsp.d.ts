/// <reference types="node" />
import BigNumber from 'bignumber.js';
import { PluginV2 } from './plugin';
import { Receipt } from './receipt';
export declare const CONTENT_TYPE = "application/spsp4+json";
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
export declare function pay(plugin: PluginV2, options: PayOptions): Promise<Receipt>;
