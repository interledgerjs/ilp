import { PluginV2, SPSP } from '..';
import { RequestHandler } from 'express';
export declare function createMiddleware(responseTemplate?: SPSP.JsonSpspResponse, plugin?: PluginV2): Promise<RequestHandler>;
