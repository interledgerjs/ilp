import { JsonInvoice, PluginApi } from '..';
import { RequestHandler } from 'express';
export declare function createMiddleware(responseTemplate?: JsonInvoice, plugin?: PluginApi.PluginV2): Promise<RequestHandler>;
