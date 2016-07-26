<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP Client
</h1>

<h4 align="center">
A JS client library for sending and receiving <a href="https://interledger.org">Interledger</a> payments.
</h4>

<br>

[![npm][npm-image]][npm-url] [![standard][standard-image]][standard-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp
[standard-image]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat
[standard-url]: http://standardjs.com/
[circle-image]: https://img.shields.io/circleci/project/interledger/js-ilp/master.svg?style=flat
[circle-url]: https://circleci.com/gh/interledger/js-ilp
[codecov-image]: https://img.shields.io/codecov/c/github/interledger/js-ilp.svg?style=flat
[codecov-url]: https://codecov.io/gh/interledger/js-ilp

This is a low-level interface to ILP, largely intended for building ILP into other [Application layer](https://github.com/interledger/rfcs/tree/master/0001-interledger-architecture) protocols.

For a simple, high-level interface see the [Wallet Client](https://github.com/interledger/five-bells-wallet-client).  

#### The ILP Client does:

* Generate payment requests on the receiving side, including handling [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment
* Pay for payment requests on the sending side*
* Quote and send payments through multiple ledger types (this library extends the functionality of [`ilp-core`](https://github.com/interledger/js-ilp-core))

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Communication of requests from recipient to sender


## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module


## Request / Pay

The client implements the [Interactive Transport Protocol (ITP)](https://github.com/interledger/rfcs/blob/master/0011-interactive-transport-protocol/0011-interactive-transport-protocol.md), which uses recipient-generated conditions to secure payments. This means that the recipient must first generate a payment request, which the sender then fulfills. This client library handles the [generation of such requests](#request-pay), but **not** the communication of the request details from the recipient to the sender.

### Requesting + Handling Incoming Payments

```js
'use strict'

const ILP = require('ilp')
const receiver = ILP.createReceiver({
  ledgerType: 'bells', // indicates which ledger plugin to use
  auth: {
    account: 'https://blue.ilpdemo.org/ledger/accounts/receiver',
    password: 'receiver'
  }
})
receiver.listen()

const paymentRequest = receiver.createRequest({
  amount: 10
})

// XXX: user implements this
sendRequestToPayer(paymentRequest)

// This automatically checks the incoming transfer and fulfills the condition
receiver.on('incoming', (transfer, fulfillment) => {
  console.log('Got paid ' + paymentRequest.destinationAmount + ' for ' + paymentRequest.destinationMemo.thisIsFor)
})
```

### Paying
```js
'use strict'

const ILP = require('ilp')
const sender = new sender({
  account: 'https://red.ilpdemo.org/ledger/accounts/sender',
  password: 'sender'
})

// XXX: user implements this
const paymentRequest = { /* request from recipient */ }

sender.quoteRequest(paymentRequest)
  .then((paymentParams) => {
    return sender.payRequest(paymentParams)
  })
```

### Combined Example

```js
'use strict'

const co = require('co')
const ILP = require('ilp')

const sender = ILP.createSender({
  ledgerType: 'bells',
  auth: {
    account: 'https://red.ilpdemo.org/ledger/accounts/alice',
    password: 'alice'
  }
})

const receiver = ILP.createReceiver({
  ledgerType: 'bells',
  auth: {
    account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
    password: 'bobbob'
  }
})

co(function * () {
  yield receiver.listen()
  receiver.on('incoming', (transfer, fulfillment) => {
    console.log('received transfer:', transfer)
    console.log('fulfilled transfer hold with fulfillment:', fulfillment)
  })

  const request = receiver.createRequest({
    amount: '10',
  })
  console.log('request:', request)

  const paymentParams = yield sender.quoteRequest(request)
  console.log('paymentParams', paymentParams)

  const result = yield sender.payRequest(paymentParams)
  console.log('sender result:', result)
}).catch((err) => {
  console.log(err)
})

```

## API Reference

<a name="module_Sender..createSender"></a>

### Sender~createSender() ⇒ <code>Sender</code>
Returns an ITP/ILP Sender to quote and pay for payment requests.

**Kind**: inner method of <code>[Sender](#module_Sender)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| opts.ledgerType | <code>String</code> |  | Type of ledger to connect to, passed to [ilp-core](https://github.com/interledger/js-ilp-core) |
| opts.auth | <code>Objct</code> |  | Auth parameters for the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core) |
| [opts.maxHoldDuration] | <code>Buffer</code> | <code>10</code> | Maximum time in seconds to allow money to be held for |


* [~createSender()](#module_Sender..createSender) ⇒ <code>Sender</code>
    * [~quoteRequest(paymentRequest)](#module_Sender..createSender..quoteRequest) ⇒ <code>Promise.&lt;PaymentParams&gt;</code>
    * [~payRequest(paymentParams)](#module_Sender..createSender..payRequest) ⇒ <code>Promise.&lt;String&gt;</code>

<a name="module_Sender..createSender..quoteRequest"></a>

#### createSender~quoteRequest(paymentRequest) ⇒ <code>Promise.&lt;PaymentParams&gt;</code>
Quote a request from a receiver

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;PaymentParams&gt;</code> - Resolves with the parameters that can be passed to payRequest  

| Param | Type | Description |
| --- | --- | --- |
| paymentRequest | <code>Object</code> | Payment request generated by an ITP/ILP Receiver |

<a name="module_Sender..createSender..payRequest"></a>

#### createSender~payRequest(paymentParams) ⇒ <code>Promise.&lt;String&gt;</code>
Pay for a payment request

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;String&gt;</code> - Resolves with the condition fulfillment  

| Param | Type | Description |
| --- | --- | --- |
| paymentParams | <code>PaymentParams</code> | Respose from quoteRequest |


<a name="module_Receiver..createReceiver"></a>

### Receiver~createReceiver() ⇒ <code>Receiver</code>
Returns an ITP/ILP Receiver to create payment requests,
listen for incoming transfers, and automatically fulfill conditions
of transfers paying for the payment requests created by the Receiver.

**Kind**: inner method of <code>[Receiver](#module_Receiver)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| opts.ledgerType | <code>String</code> |  | Type of ledger to connect to, passed to [ilp-core](https://github.com/interledger/js-ilp-core) |
| opts.auth | <code>Objct</code> |  | Auth parameters for the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core) |
| [opts.hmacKey] | <code>Buffer</code> | <code>crypto.randomBytes(32)</code> | 32-byte secret used for generating request conditions |
| [opts.defaultRequestTimeout] | <code>Number</code> | <code>30</code> | Default time in seconds that requests will be valid for |


* [~createReceiver()](#module_Receiver..createReceiver) ⇒ <code>Receiver</code>
    * [~createRequest()](#module_Receiver..createReceiver..createRequest) ⇒ <code>Object</code>
    * [~listen()](#module_Receiver..createReceiver..listen) ⇒ <code>Promise.&lt;null&gt;</code>

<a name="module_Receiver..createReceiver..createRequest"></a>

#### createReceiver~createRequest() ⇒ <code>Object</code>
Create a payment request

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params.amount | <code>String</code> |  | Amount to request |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>30 seconds from now</code> | Expiry of request |

<a name="module_Receiver..createReceiver..listen"></a>

#### createReceiver~listen() ⇒ <code>Promise.&lt;null&gt;</code>
Listen for incoming transfers and automatically fulfill
conditions for transfers corresponding to requests this
receiver created.

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the receiver is connected  
**Emits**: <code>[incoming](#event_incoming)</code>  
<a name="event_incoming"></a>

### "incoming"
[IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string

**Kind**: event emitted by <code>[Receiver](#module_Receiver)</code>
