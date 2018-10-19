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
const ilp_protocol_stream_1 = require("ilp-protocol-stream");
const url_1 = require("url");
const node_fetch_1 = require("node-fetch");
const bignumber_js_1 = require("bignumber.js");
exports.CONTENT_TYPE = 'application/spsp4+json';
function query(receiver) {
    return __awaiter(this, void 0, void 0, function* () {
        const endpoint = new url_1.URL(receiver.startsWith('$')
            ? 'https://' + receiver.substring(1)
            : receiver);
        endpoint.pathname = (endpoint.pathname === '/')
            ? '/.well-known/pay'
            : endpoint.pathname;
        const response = yield node_fetch_1.default(endpoint.href, {
            headers: { accept: exports.CONTENT_TYPE }
        });
        if (response.status !== 200) {
            throw new Error('Got error response from spsp receiver.' +
                ' endpoint="' + endpoint.href + '"' +
                ' status=' + response.status +
                ' message="' + (yield response.text()) + '"');
        }
        const json = yield response.json();
        return {
            destinationAccount: json.destination_account,
            sharedSecret: Buffer.from(json.shared_secret, 'base64'),
            balance: json.balance,
            assetInfo: json.asset_info,
            receiverInfo: json.receiver_info,
            contentType: response.headers.get('Content-Type')
        };
    });
}
exports.query = query;
function pay(plugin, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { receiver, sourceAmount, data } = options;
        const pluginWasConnected = plugin.isConnected;
        const [response] = yield Promise.all([
            query(receiver),
            plugin.connect()
        ]);
        const { destinationAccount, sharedSecret, contentType, balance } = response;
        if (contentType.indexOf(exports.CONTENT_TYPE) !== -1) {
            const streamConnection = yield ilp_protocol_stream_1.createConnection({
                plugin,
                destinationAccount,
                sharedSecret
            });
            const stream = streamConnection.createStream();
            if (data) {
                stream.write(data);
            }
            yield Promise.race([
                stream.sendTotal(sourceAmount).then(() => stream.end()),
                new Promise(resolve => stream.on('end', resolve))
            ]);
            const requestedAmount = (balance)
                ? new bignumber_js_1.default(balance.maximum).minus(new bignumber_js_1.default(balance.current))
                : undefined;
            yield streamConnection.end();
            if (!pluginWasConnected) {
                yield plugin.disconnect();
            }
            return {
                sourceAccount: streamConnection.sourceAccount,
                destinationAccount,
                sent: {
                    amount: new bignumber_js_1.default(streamConnection.totalSent),
                    assetCode: streamConnection.sourceAssetCode,
                    assetScale: streamConnection.sourceAssetScale
                },
                received: {
                    amount: new bignumber_js_1.default(streamConnection.totalDelivered),
                    assetCode: streamConnection.destinationAssetCode,
                    assetScale: streamConnection.destinationAssetScale
                },
                requested: (requestedAmount) ? {
                    amount: requestedAmount,
                    assetCode: streamConnection.destinationAssetCode,
                    assetScale: streamConnection.destinationAssetScale
                } : undefined
            };
        }
        else {
            throw new Error(`Unable to send to ${receiver} as it does not support the STREAM protocol.`);
        }
    });
}
exports.pay = pay;
//# sourceMappingURL=spsp.js.map