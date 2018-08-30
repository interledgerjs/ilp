"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bignumber_js_1 = require("bignumber.js");
const crypto = require("crypto");
const promise_1 = require("./promise");
const createLogger = require('ilp-logger');
const log = createLogger('invoice');
class Invoice {
    constructor(amount, streamServer) {
        this.connectionTag = crypto.randomBytes(16).toString('hex');
        const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(this.connectionTag);
        this.expectedAmount = new bignumber_js_1.default(amount);
        this.ilpAddress = destinationAccount;
        this.sharedSecret = sharedSecret;
        this.receivedData = Buffer.alloc(0);
        this.dataPromise = new promise_1.UnwrappedPromise();
        this.paymentPromise = new promise_1.UnwrappedPromise();
        streamServer.on('connection', (connection) => {
            if (connection.connectionTag === this.connectionTag) {
                log.debug(`connection opened`);
                this.streamConnection = connection;
                connection.on('stream', (stream) => {
                    log.debug(`stream created`);
                    stream.setReceiveMax(amount);
                    stream.on('money', (amountReceived) => {
                        log.trace(`${amountReceived} received`);
                        if (new bignumber_js_1.default(connection.totalReceived).isGreaterThanOrEqualTo(this.expectedAmount)) {
                            this._complete();
                        }
                    });
                    stream.on('data', (dataReceived) => {
                        log.trace(`${dataReceived.byteLength} bytes of data received`);
                        this.receivedData = Buffer.concat([this.receivedData, dataReceived]);
                    });
                    stream.on('end', () => {
                        log.debug(`stream ended`);
                        this._complete();
                    });
                });
            }
        });
    }
    get address() {
        return this.ilpAddress;
    }
    get secret() {
        return this.sharedSecret;
    }
    get data() {
        return this.dataPromise.promise;
    }
    receivePayment(timeout) {
        if (timeout) {
            this.timer = setTimeout(() => {
                this._timeout();
            }, timeout);
        }
        return this.paymentPromise.promise;
    }
    _complete() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        if (this.streamConnection) {
            const received = new bignumber_js_1.default(this.streamConnection.totalReceived);
            this.paymentPromise.resolve(received);
            this.dataPromise.resolve(this.receivedData);
            this.streamConnection.end().catch(e => {
                log.error('Error closing connection after payment was completed.');
            });
        }
        else {
            const error = new Error('No incoming STREAM connection.');
            this.paymentPromise.reject(error);
            this.dataPromise.reject(error);
        }
    }
    _timeout() {
        const error = (this.streamConnection)
            ? new Error(`Timed out waiting for payment. ` +
                `Received ${this.streamConnection.totalReceived} payment ` +
                `and ${this.receivedData.byteLength} bytes of data so far.`)
            : new Error(`Timed out waiting for connection. `);
        this.paymentPromise.reject(error);
        this.dataPromise.reject(error);
        if (this.streamConnection) {
            this.streamConnection.end().catch(e => {
                log.error('Error closing connection after payment timed out.', e);
            });
        }
    }
}
exports.Invoice = Invoice;
//# sourceMappingURL=invoice.js.map