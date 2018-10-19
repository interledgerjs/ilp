import BigNumber from 'bignumber.js';
import * as ILDCP from 'ilp-protocol-ildcp';
import * as SPSP from './lib/spsp';
import * as STREAM from 'ilp-protocol-stream';
import * as express from './extensions/express';
import { JsonInvoice, InvoiceReceiver, Invoice } from './lib/invoice';
import * as PluginApi from './lib/plugin';
import { Receipt } from './lib/receipt';
declare const createLogger: any;
export declare const DEFAULT_PLUGIN_MODULE = "ilp-plugin-btp";
declare function createPlugin(pluginOptions?: any, pluginModuleName?: string): PluginApi.PluginV2;
declare function fetchConfig(plugin: PluginApi.PluginV2): Promise<ILDCP.IldcpResponse>;
declare function receive(amount: BigNumber.Value, reference: string, pluginOrServer?: PluginApi.PluginV2 | STREAM.Server): Promise<InvoiceReceiver>;
declare type PaymentPointerAndAmount = {
    amount: BigNumber.Value;
    paymentPointer: string;
};
declare function pay(payee: PaymentPointerAndAmount | Invoice, plugin?: PluginApi.PluginV2): Promise<Receipt>;
export { ILDCP, STREAM, SPSP, PluginApi, express, InvoiceReceiver, JsonInvoice, Receipt, createLogger, createPlugin, fetchConfig, receive, pay };
