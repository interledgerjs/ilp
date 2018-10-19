/// <reference types="node" />
import BigNumber from 'bignumber.js';
import { STREAM, Receipt } from '..';
export interface JsonInvoice {
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
export interface Payee {
    destinationAccount: string;
    sharedSecret: Buffer;
}
export interface Invoice extends Payee {
    amount: BigNumber;
    assetScale?: number;
    assetCode?: string;
}
export declare class InvoiceReceiver implements Invoice {
    private _expectedAmount;
    private _assetScale;
    private _assetCode;
    private _destinationAccount;
    private _sharedSecret;
    private _connectionTag;
    private _receivedData;
    private _paymentPromise;
    private _dataPromise;
    private _timer?;
    private _streamConnection?;
    constructor(amount: BigNumber.Value, reference: string | undefined, streamServer: STREAM.Server);
    readonly destinationAccount: string;
    readonly sharedSecret: Buffer;
    readonly amount: BigNumber;
    readonly assetScale: number;
    readonly assetCode: string;
    toJSON(): JsonInvoice;
    receiveData(): Promise<Buffer>;
    receivePayment(timeout?: number): Promise<Receipt>;
    private _complete;
    private _timeout;
}
export declare function serializePayee(receiver: Invoice | Payee): JsonInvoice;
