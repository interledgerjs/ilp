"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const bignumber_js_1 = require("bignumber.js");
const crypto = require("crypto");
const ILDCP = require("ilp-protocol-ildcp");
exports.ILDCP = ILDCP;
const SPSP = require("./lib/spsp");
exports.SPSP = SPSP;
const STREAM = require("ilp-protocol-stream");
exports.STREAM = STREAM;
const express = require("./extensions/express");
exports.express = express;
const invoice_1 = require("./lib/invoice");
exports.Invoice = invoice_1.Invoice;
const createLogger = require('ilp-logger');
exports.createLogger = createLogger;
const log = createLogger('ilp');
exports.DEFAULT_PLUGIN_MODULE = 'ilp-plugin-btp';
function createPlugin(pluginOptions, pluginModuleName = exports.DEFAULT_PLUGIN_MODULE) {
    const envModuleName = process.env.ILP_PLUGIN || exports.DEFAULT_PLUGIN_MODULE;
    const envOptions = process.env.ILP_PLUGIN_OPTIONS || process.env.ILP_CREDENTIALS;
    const moduleName = pluginModuleName || envModuleName;
    let options = envOptions ? JSON.parse(envOptions) : {};
    if (process.env.ILP_CREDENTIALS && !process.env.ILP_PLUGIN_OPTIONS) {
        log.warn(`Loading options from environment var ILP_CREDENTIALS is deprecated, use ILP_PLUGIN_OPTIONS instead.`);
    }
    if (moduleName === 'ilp-plugin-btp') {
        const name = (pluginOptions && pluginOptions.name) || '';
        if (name) {
            log.warn(`'pluginOptions.name' is deprecated. ` +
                `Please provide the correct options for the plugin. ` +
                `Example: '{ "server" : "btp+ws://<name>:<secret>@localhost:7768" }'`);
        }
        else {
            if (pluginOptions) {
                options = pluginOptions;
            }
        }
        if (Object.keys(options).length === 0) {
            options.server = `btp+ws://${name}:${crypto.randomBytes(16).toString('hex')}@localhost:7768`;
        }
    }
    else {
        options = pluginOptions;
    }
    const Plugin = require(moduleName);
    return new Plugin(options);
}
exports.createPlugin = createPlugin;
function receive(amount, pluginOrServer = createPlugin()) {
    return __awaiter(this, void 0, void 0, function* () {
        const server = (pluginOrServer instanceof STREAM.Server)
            ? pluginOrServer
            : yield STREAM.createServer({ plugin: pluginOrServer });
        return new invoice_1.Invoice(amount, server);
    });
}
exports.receive = receive;
function pay(amount, payee, plugin = createPlugin()) {
    return __awaiter(this, void 0, void 0, function* () {
        if (typeof payee === 'string') {
            return SPSP.pay(plugin, { receiver: payee, sourceAmount: amount });
        }
        else {
            const { destinationAccount, sharedSecret } = payee;
            const connection = yield STREAM.createConnection({
                destinationAccount,
                plugin,
                sharedSecret
            });
            const stream = connection.createStream();
            yield stream.sendTotal(amount);
            yield connection.end();
            return new bignumber_js_1.default(connection.totalSent);
        }
    });
}
exports.pay = pay;
//# sourceMappingURL=index.js.map