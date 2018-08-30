/// <reference types="node" />
import BigNumber from 'bignumber.js';
import { STREAM } from '..';
export declare class Invoice {
    private expectedAmount;
    private ilpAddress;
    private sharedSecret;
    private connectionTag;
    private receivedData;
    private paymentPromise;
    private dataPromise;
    private timer?;
    private streamConnection?;
    constructor(amount: BigNumber.Value, streamServer: STREAM.Server);
    readonly address: string;
    readonly secret: Buffer;
    readonly data: Promise<Buffer>;
    receivePayment(timeout?: number): Promise<BigNumber>;
    private _complete;
    private _timeout;
}
