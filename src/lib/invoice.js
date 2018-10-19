"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bignumber_js_1 = require("bignumber.js");
const crypto = require("crypto");
const promise_1 = require("./promise");
const assert = require("assert");
const createLogger = require('ilp-logger');
const log = createLogger('invoice');
class InvoiceReceiver {
    constructor(amount, reference = crypto.randomBytes(16).toString('hex'), streamServer) {
        assert(/^[A-Za-z0-9~_-]*$/.test(reference), 'Reference can only contain valid ILP Address characters.');
        this._connectionTag = reference;
        const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(this._connectionTag);
        this._expectedAmount = new bignumber_js_1.default(amount);
        this._assetCode = streamServer.assetCode;
        this._assetScale = streamServer.assetScale;
        this._destinationAccount = destinationAccount;
        this._sharedSecret = sharedSecret;
        this._receivedData = Buffer.alloc(0);
        this._dataPromise = new promise_1.UnwrappedPromise();
        this._paymentPromise = new promise_1.UnwrappedPromise();
        streamServer.on('connection', (connection) => {
            if (connection.connectionTag === this._connectionTag) {
                log.debug(`connection opened`);
                this._streamConnection = connection;
                connection.on('stream', (stream) => {
                    log.debug(`stream created`);
                    stream.setReceiveMax(this._expectedAmount);
                    stream.on('money', (amountReceived) => {
                        log.trace(`${amountReceived} received`);
                        if (new bignumber_js_1.default(connection.totalReceived).isGreaterThanOrEqualTo(this._expectedAmount)) {
                            this._complete();
                        }
                    });
                    stream.on('data', (dataReceived) => {
                        log.trace(`${dataReceived.byteLength} bytes of data received`);
                        this._receivedData = Buffer.concat([this._receivedData, dataReceived]);
                    });
                    stream.on('end', () => {
                        log.debug(`stream ended`);
                        this._complete();
                    });
                });
            }
        });
    }
    get destinationAccount() {
        return this._destinationAccount;
    }
    get sharedSecret() {
        return this._sharedSecret;
    }
    get amount() {
        return this._expectedAmount;
    }
    get assetScale() {
        return this._assetScale;
    }
    get assetCode() {
        return this._assetCode;
    }
    toJSON() {
        return serializePayee(this);
    }
    receiveData() {
        return this._dataPromise.promise;
    }
    receivePayment(timeout) {
        if (timeout) {
            this._timer = setTimeout(() => {
                this._timeout();
            }, timeout);
        }
        return this._paymentPromise.promise;
    }
    _complete() {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        if (this._streamConnection) {
            this._paymentPromise.resolve({
                sourceAccount: this._streamConnection.destinationAccount,
                destinationAccount: this._streamConnection.sourceAccount,
                received: {
                    amount: this._streamConnection.totalReceived,
                    assetCode: this._streamConnection.sourceAssetCode,
                    assetScale: this._streamConnection.sourceAssetScale
                },
                requested: {
                    amount: this._expectedAmount,
                    assetCode: this._streamConnection.sourceAssetCode,
                    assetScale: this._streamConnection.sourceAssetScale
                }
            });
            this._dataPromise.resolve(this._receivedData);
            this._streamConnection.end().catch(e => {
                log.error('Error closing connection after payment was completed.', e);
            });
        }
        else {
            const error = new Error('No incoming STREAM connection.');
            this._paymentPromise.reject(error);
            this._dataPromise.reject(error);
        }
    }
    _timeout() {
        const error = (this._streamConnection)
            ? new Error(`Timed out waiting for payment. ` +
                `Received ${this._streamConnection.totalReceived} payment ` +
                `and ${this._receivedData.byteLength} bytes of data so far.`)
            : new Error(`Timed out waiting for connection. `);
        this._paymentPromise.reject(error);
        this._dataPromise.reject(error);
        if (this._streamConnection) {
            this._streamConnection.end().catch(e => {
                log.error('Error closing connection after payment timed out.', e);
            });
        }
    }
}
exports.InvoiceReceiver = InvoiceReceiver;
function serializePayee(receiver) {
    const invoice = receiver;
    const balance = (invoice.amount)
        ? {
            current: '0',
            maximum: invoice.amount.toString()
        }
        : undefined;
    const asset_info = (invoice.assetCode && invoice.assetScale)
        ? {
            code: invoice.assetCode,
            scale: invoice.assetScale
        }
        : undefined;
    return {
        destination_account: invoice.destinationAccount,
        shared_secret: invoice.sharedSecret.toString('base64'),
        balance,
        asset_info
    };
}
exports.serializePayee = serializePayee;
//# sourceMappingURL=invoice.js.map