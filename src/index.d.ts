/// <reference types="node" />
import BigNumber from 'bignumber.js';
import * as ILDCP from 'ilp-protocol-ildcp';
import * as SPSP from './lib/spsp';
import * as STREAM from 'ilp-protocol-stream';
import { Invoice } from './lib/invoice';
import { PluginV2 } from './lib/plugin';
declare const createLogger: any;
export declare const DEFAULT_PLUGIN_MODULE = "ilp-plugin-btp";
declare function createPlugin(pluginOptions?: any, pluginModuleName?: string): PluginV2;
declare function receive(amount: BigNumber.Value, pluginOrServer?: PluginV2 | STREAM.Server): Promise<Invoice>;
declare function pay(amount: BigNumber.Value, payee: string | {
    destinationAccount: string;
    sharedSecret: Buffer;
}, plugin?: PluginV2): Promise<BigNumber | SPSP.PayResult>;
export { ILDCP, STREAM, SPSP, PluginV2, Invoice, createLogger, createPlugin, receive, pay };
