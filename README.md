<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP Client
</h1>

<h4 align="center">
A low-level JS <a href="https://interledger.org">Interledger</a> sender/receiver library
</h4>

<br>

[![npm][npm-image]][npm-url] [![standard][standard-image]][standard-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url] [![snyk][snyk-image]][snyk-url]

[npm-image]: https://img.shields.io/npm/v/ilp.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp
[standard-image]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat
[standard-url]: http://standardjs.com/
[circle-image]: https://img.shields.io/circleci/project/interledgerjs/ilp/master.svg?style=flat
[circle-url]: https://circleci.com/gh/interledgerjs/ilp
[codecov-image]: https://img.shields.io/codecov/c/github/interledgerjs/ilp.svg?style=flat
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp
[snyk-image]: https://snyk.io/test/npm/ilp/badge.svg
[snyk-url]: https://snyk.io/test/npm/ilp

This is a low-level interface to ILP, largely intended for building ILP into other [Application layer](https://github.com/interledger/rfcs/tree/master/0001-interledger-architecture) protocols.

#### The ILP Client does:

* Generate [Interledger Payment Requests](https://github.com/interledger/rfcs/blob/master/0011-interledger-payment-request/0011-interledger-payment-request.md) on the receiving side, including handling [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment)
* Pay for payment requests on the sending side
* Quote and send payments through multiple ledger types (using [`ilp-core`](https://github.com/interledgerjs/ilp-core))

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Communication of requests from recipient to sender

For a higher-level interface that includes the above features, see the [Wallet Client](https://github.com/interledgerjs/five-bells-wallet-client).


## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module*


## Interledger Payment Request / Pay Flow

The client uses recipient-generated [Interledger Payment Requests](https://github.com/interledger/rfcs/blob/master/0011-interledger-payment-request/0011-interledger-payment-request.md), which include the condition for the payment. This means that the recipient must first generate a payment request, which the sender then fulfills.

This library handles the generation of payment requests, but **not the communication of the request details from the recipient to the sender**. In some cases, the sender and receiver might be HTTP servers, in which case HTTP would be used. In other cases, they might be using a different medium of communication.

### Requesting + Handling Incoming Payments

```js
'use strict'

const ILP = require('ilp')
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')
const receiver = ILP.createReceiver({
  _plugin: FiveBellsLedgerPlugin,
  prefix: 'ilpdemo.blue.',
  account: 'https://blue.ilpdemo.org/ledger/accounts/receiver',
  password: 'receiver'
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
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')
const sender = ILP.createSender({
  _plugin: FiveBellsLedgerPlugin,
  prefix: 'ilpdemo.red.',
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice',
  connectors: ['connie', 'otherconnectoronmyledger']
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
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')

const sender = ILP.createSender({
  _plugin: FiveBellsLedgerPlugin,
  prefix: 'ilpdemo.red.',
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice'
})

const receiver = ILP.createReceiver({
  _plugin: FiveBellsLedgerPlugin,
  prefix: 'ilpdemo.blue.',
  account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
  password: 'bobbob'
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

### Shared Secret Example

Sometimes it is desirable that the sender can choose the amount and generate the
condition without communicating with the recipient. This is an example of a
payment using the Pre-Shared Key (PSK) transport protocol, which implements this type of
flow.

```js
'use strict'

const co = require('co')
const ILP = require('.')
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')

const sender = ILP.createSender({
  _plugin: FiveBellsLedgerPlugin,
  account: 'https://localhost/ledger/accounts/alice',
  password: 'alice'
})

const receiver = ILP.createReceiver({
  _plugin: FiveBellsLedgerPlugin,
  account: 'https://localhost/ledger/accounts/bob',
  password: 'bobbob'
})

co(function * () {
  yield receiver.listen()
  receiver.on('incoming', (transfer, fulfillment) => {
    console.log('received transfer:', transfer)
    console.log('fulfilled transfer hold with fulfillment:', fulfillment)
  })

  const secret = receiver.generateSharedSecret()
  console.log('secret:', secret)

  const request = sender.createRequest(Object.assign({}, secret, {
    destination_amount: '10'
  }))
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

### Sender~createSender(opts) ⇒ <code>Sender</code>
Returns an ILP Sender to quote and pay for payment requests.

**Kind**: inner method of <code>[Sender](#module_Sender)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| opts._plugin | <code>LedgerPlugin</code> |  | Ledger plugin used to connect to the ledger, passed to [ilp-core](https://github.com/interledgerjs/ilp-core) |
| opts | <code>Objct</code> |  | Plugin parameters, passed to [ilp-core](https://github.com/interledgerjs/ilp-core) |
| [opts.client] | <code>ilp-core.Client</code> | <code>create a new instance with the plugin and opts</code> | [ilp-core](https://github.com/interledgerjs/ilp-core) Client, which can optionally be supplied instead of the previous options |
| [opts.connectors] | <code>Array</code> | <code>[]</code> | Array of connectors to use, specified by account name on the local ledger (e.g. "connie"). Some ledgers provide recommended connectors while others do not, in which case this would be required to send Interledger payments. |
| [opts.maxHoldDuration] | <code>Number</code> | <code>10</code> | Maximum time in seconds to allow money to be held for |
| [opts.defaultRequestTimeout] | <code>Number</code> | <code>30</code> | Default time in seconds that requests will be valid for |
| [opts.uuidSeed] | <code>Buffer</code> | <code>crypto.randomBytes(32)</code> | Seed to use for generating transfer UUIDs |


* [~createSender(opts)](#module_Sender..createSender) ⇒ <code>Sender</code>
    * [~quoteSourceAmount(destinationAddress, sourceAmount)](#module_Sender..createSender..quoteSourceAmount) ⇒ <code>Promise.&lt;String&gt;</code>
    * [~quoteDestinationAmount(destinationAddress, destinationAmount)](#module_Sender..createSender..quoteDestinationAmount) ⇒ <code>Promise.&lt;String&gt;</code>
    * [~quoteRequest(paymentRequest)](#module_Sender..createSender..quoteRequest) ⇒ <code>Promise.&lt;PaymentParams&gt;</code>
    * [~payRequest(paymentParams)](#module_Sender..createSender..payRequest) ⇒ <code>Promise.&lt;String&gt;</code>
    * [~createRequest(params)](#module_Sender..createSender..createRequest) ⇒ <code>Object</code>
    * [~stopListening()](#module_Sender..createSender..stopListening) ⇒ <code>Promise.&lt;null&gt;</code>

<a name="module_Sender..createSender..quoteSourceAmount"></a>

#### createSender~quoteSourceAmount(destinationAddress, sourceAmount) ⇒ <code>Promise.&lt;String&gt;</code>
Get a fixed source amount quote

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;String&gt;</code> - destinationAmount  

| Param | Type | Description |
| --- | --- | --- |
| destinationAddress | <code>String</code> | ILP Address of the receiver |
| sourceAmount | <code>String</code> &#124; <code>Number</code> | Amount the sender wants to send |

<a name="module_Sender..createSender..quoteDestinationAmount"></a>

#### createSender~quoteDestinationAmount(destinationAddress, destinationAmount) ⇒ <code>Promise.&lt;String&gt;</code>
Get a fixed destination amount quote

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;String&gt;</code> - sourceAmount  

| Param | Type | Description |
| --- | --- | --- |
| destinationAddress | <code>String</code> | ILP Address of the receiver |
| destinationAmount | <code>String</code> | Amount the receiver should recieve |

<a name="module_Sender..createSender..quoteRequest"></a>

#### createSender~quoteRequest(paymentRequest) ⇒ <code>Promise.&lt;PaymentParams&gt;</code>
Quote a request from a receiver

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;PaymentParams&gt;</code> - Resolves with the parameters that can be passed to payRequest  

| Param | Type | Description |
| --- | --- | --- |
| paymentRequest | <code>Object</code> | Payment request generated by an ILP Receiver |

<a name="module_Sender..createSender..payRequest"></a>

#### createSender~payRequest(paymentParams) ⇒ <code>Promise.&lt;String&gt;</code>
Pay for a payment request. Uses a determinstic transfer id so that paying is idempotent (as long as ledger plugins correctly reject multiple transfers with the same id)

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;String&gt;</code> - Resolves with the condition fulfillment  

| Param | Type | Description |
| --- | --- | --- |
| paymentParams | <code>PaymentParams</code> | Respose from quoteRequest |

<a name="module_Sender..createSender..createRequest"></a>

#### createSender~createRequest(params) ⇒ <code>Object</code>
Create a payment request using a Pre-Shared Key (PSK).

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Object</code> - Payment request  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.destination_amount | <code>String</code> |  | Amount that should arrive in the recipient's account |
| params.destination_account | <code>String</code> |  | Target account's ILP address |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expires_at] | <code>String</code> | <code>30 seconds from now</code> | Expiry of request |
| [params.data] | <code>Object</code> | <code></code> | Additional data to include in the request |

<a name="module_Sender..createSender..stopListening"></a>

#### createSender~stopListening() ⇒ <code>Promise.&lt;null&gt;</code>
Disconnect from the ledger and stop listening for events.

**Kind**: inner method of <code>[createSender](#module_Sender..createSender)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the sender is disconnected.  

<a name="module_Receiver..createReceiver"></a>

### Receiver~createReceiver(opts) ⇒ <code>Receiver</code>
Returns an ILP Receiver to create payment requests,
listen for incoming transfers, and automatically fulfill conditions
of transfers paying for the payment requests created by the Receiver.

**Kind**: inner method of <code>[Receiver](#module_Receiver)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| opts._plugin | <code>LedgerPlugin</code> |  | Ledger plugin used to connect to the ledger, passed to [ilp-core](https://github.com/interledgerjs/ilp-core) |
| opts | <code>Object</code> |  | Plugin parameters, passed to [ilp-core](https://github.com/interledgerjs/ilp-core) |
| [opts.client] | <code>ilp-core.Client</code> | <code>create a new instance with the plugin and opts</code> | [ilp-core](https://github.com/interledgerjs/ilp-core) Client, which can optionally be supplied instead of the previous options |
| [opts.hmacKey] | <code>Buffer</code> | <code>crypto.randomBytes(32)</code> | 32-byte secret used for generating request conditions |
| [opts.defaultRequestTimeout] | <code>Number</code> | <code>30</code> | Default time in seconds that requests will be valid for |
| [opts.allowOverPayment] | <code>Boolean</code> | <code>false</code> | Allow transfers where the amount is greater than requested |
| [opts.roundingMode] | <code>String</code> | <code></code> | Round request amounts with too many decimal places, possible values are "UP", "DOWN", "HALF_UP", "HALF_DOWN" as described in https://mikemcl.github.io/bignumber.js/#constructor-properties |
| [opts.connectionTimeout] | <code>Number</code> | <code>10</code> | Time in seconds to wait for the ledger to connect |
| [opts.reviewPayment] | <code>reviewPaymentCallback</code> |  | called before fulfilling any incoming payments. The receiver doesn't fulfill the payment if reviewPayment rejects. PSK will not be used if reviewPayment is not provided. |


* [~createReceiver(opts)](#module_Receiver..createReceiver) ⇒ <code>Receiver</code>
    * [~getAddress()](#module_Receiver..createReceiver..getAddress) ⇒ <code>String</code>
    * [~createRequest()](#module_Receiver..createReceiver..createRequest) ⇒ <code>Object</code>
    * [~generateSharedSecret()](#module_Receiver..createReceiver..generateSharedSecret) ⇒ <code>Object</code>
    * [~listen()](#module_Receiver..createReceiver..listen) ⇒ <code>Promise.&lt;null&gt;</code>
    * [~stopListening()](#module_Receiver..createReceiver..stopListening) ⇒ <code>Promise.&lt;null&gt;</code>

<a name="module_Receiver..createReceiver..getAddress"></a>

#### createReceiver~getAddress() ⇒ <code>String</code>
Get ILP address

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
<a name="module_Receiver..createReceiver..createRequest"></a>

#### createReceiver~createRequest() ⇒ <code>Object</code>
Create a payment request

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params.amount | <code>String</code> |  | Amount to request. It will throw an error if the amount has too many decimal places or significant digits, unless the receiver option roundRequestsAmounts is set |
| [params.account] | <code>String</code> | <code>client.getAccount()</code> | Optionally specify an account other than the one the receiver would get from the connected plugin |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>30 seconds from now</code> | Expiry of request |
| [params.data] | <code>Object</code> | <code></code> | Additional data to include in the request |
| [params.roundingMode] | <code>String</code> | <code>receiver.roundingMode</code> | Round request amounts with too many decimal places, possible values are "UP", "DOWN", "HALF_UP", "HALF_DOWN" as described in https://mikemcl.github.io/bignumber.js/#constructor-properties |

<a name="module_Receiver..createReceiver..generateSharedSecret"></a>

#### createReceiver~generateSharedSecret() ⇒ <code>Object</code>
Generate shared secret for Pre-Shared Key (PSK) transport protocol.

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
**Returns**: <code>Object</code> - Object containing destination address and shared secret  
<a name="module_Receiver..createReceiver..listen"></a>

#### createReceiver~listen() ⇒ <code>Promise.&lt;null&gt;</code>
Listen for incoming transfers and automatically fulfill
conditions for transfers corresponding to requests this
receiver created.

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the receiver is connected  
**Emits**: <code>[incoming](#event_incoming)</code>, <code>incoming:&lt;requestid&gt;</code>, <code>incoming:psk:&lt;token&gt;</code>  
<a name="module_Receiver..createReceiver..stopListening"></a>

#### createReceiver~stopListening() ⇒ <code>Promise.&lt;null&gt;</code>
Disconnect from the ledger and stop listening for events.

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the receiver is disconnected.  
<a name="event_incoming"></a>

### "incoming"
[IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string

**Kind**: event emitted by <code>[Receiver](#module_Receiver)</code>  
<a name="module_Receiver..incoming_ipr_<requestid>"></a>

### "incoming:ipr:<requestid>"
[IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string for a specific request

**Kind**: event emitted by <code>[Receiver](#module_Receiver)</code>  
<a name="module_Receiver..incoming_psk_<token>"></a>

### "incoming:psk:<token>"
[IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string for a specific token

**Kind**: event emitted by <code>[Receiver](#module_Receiver)</code>  
<a name="module_Receiver..reviewPaymentCallback"></a>

### Receiver~reviewPaymentCallback ⇒ <code>Promise.&lt;null&gt;</code> &#124; <code>null</code>
**Kind**: inner typedef of <code>[Receiver](#module_Receiver)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> &#124; <code>null</code> - cancels the payment if it rejects/throws an error.  

| Param | Type | Description |
| --- | --- | --- |
| payment | <code>PaymentRequest</code> | payment request object |
| transfer | <code>Transfer</code> | transfer object for the payment being reviewed |
