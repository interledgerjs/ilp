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

#### The ILP Client includes:

* [Interledger Payment Request (IPR)](#interledger-payment-request-ipr-transport-protocol) Transport Protocol, an interactive protocol in which the receiver specifies the payment details, including the condition
* [Pre-Shared Key (PSK)](#pre-shared-key-psk-transport-protocol) Transport Protocol, a non-interactive protocol in which the sender creates the payment details and uses a shared secret to generate the conditions
* Interledger Quoting and the ability to send through multiple ledger types using [Ledger Plugins](https://github.com/interledgerjs?utf8=✓&q=ilp-plugin)

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Communication of requests from recipient to sender

## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module*


## Interledger Payment Request (IPR) Transport Protocol

This protocol uses recipient-generated [Interledger Payment Requests](https://github.com/interledger/rfcs/blob/master/0011-interledger-payment-request/0011-interledger-payment-request.md), which include the condition for the payment. This means that the recipient must first generate a payment request, which the sender then fulfills.

This library handles the generation of payment requests, but **not the communication of the request details from the recipient to the sender**. In some cases, the sender and receiver might be HTTP servers, in which case HTTP would be used. In other cases, they might be using a different medium of communication.

### IPR Sending and Receiving Example

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

  // Note the user of this module must implement the method for
  // communicating payment requests from the recipient to the sender
  const paymentParams = yield sender.quoteRequest(request)
  console.log('paymentParams', paymentParams)

  const result = yield sender.payRequest(paymentParams)
  console.log('sender result:', result)
}).catch((err) => {
  console.log(err)
})

```

### Pre-Shared Key (PSK) Transport Protocol

This is a non-interactive protocol in which the sender chooses the payment
amount and generates the condition without communicating with the recipient.

PSK uses a secret shared between the sender and receiver. The key can be
generated by the receiver and retrieved by the sender using a higher-level
protocol such as SPSP, or any other method. In the example below,
the pre-shared key is simply passed to the sender inside javascript.

When sending a payment using PSK, the sender generates an HMAC key from the
PSK, and HMACs the payment to get the fulfillment, which is hashed to get the
condition. The sender also encrypts their optional extra data using AES. On
receipt of the payment, the receiver decrypts the extra data, and HMACs the
payment to get the fulfillment.

In order to receive payments using PSK, the receiver must also register a
`reviewPayment` handler. `reviewPayment` is a callback that returns either a
promise or a value, and will prevent the receiver from fulfilling a payment if
it throws an error. This callback is important, because it stops the receiver
from getting unwanted funds.

### PSK Sending and Receiving Example

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
  password: 'bobbob',
  // A callback can be specified to review incoming payments.
  // This is required when using PSK.
  reviewPayment: (payment, transfer) => {
    if (+transfer.amount > 100) {
      return Promise.reject(new Error('payment is too big!'))
    }
  }
})

co(function * () {
  yield receiver.listen()
  receiver.on('incoming', (transfer, fulfillment) => {
    console.log('received transfer:', transfer)
    console.log('fulfilled transfer hold with fulfillment:', fulfillment)
  })
  // The user of this module is responsible for communicating the
  // PSK parameters from the recipient to the sender
  const pskParams = receiver.generatePskParams()

  // Note the payment is created by the sender
  const request = sender.createRequest({
    destinationAmount: '10',
    destinationAccount: pskParams.destinationAccount,
    sharedSecret: pskParams.sharedSecret
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

<a name="module_SPSP..Client"></a>

### SPSP~Client
SPSP Client

**Kind**: inner class of <code>[SPSP](#module_SPSP)</code>  

* [~Client](#module_SPSP..Client)
    * [new Client(opts)](#new_module_SPSP..Client_new)
    * [.quoteSource](#module_SPSP..Client.Client+quoteSource) ⇒ <code>Promise.&lt;SpspPayment&gt;</code>
    * [.quoteDestination](#module_SPSP..Client.Client+quoteDestination) ⇒ <code>Promise.&lt;SpspPayment&gt;</code>
    * [.sendPayment](#module_SPSP..Client.Client+sendPayment) ⇒ <code>Promise.&lt;PaymentResult&gt;</code>
    * [.query](#module_SPSP..Client.Client+query) ⇒ <code>Object</code>

<a name="new_module_SPSP..Client_new"></a>

#### new Client(opts)
Create an SPSP client.


| Param | Type | Description |
| --- | --- | --- |
| opts | <code>Object</code> | plugin options |
| opts._plugin | <code>function</code> | (optional) plugin constructor. Defaults to PluginBells |

<a name="module_SPSP..Client.Client+quoteSource"></a>

#### client.quoteSource ⇒ <code>Promise.&lt;SpspPayment&gt;</code>
Get payment params via SPSP query and ILQP quote, based on source amount

**Kind**: instance property of <code>[Client](#module_SPSP..Client)</code>  
**Returns**: <code>Promise.&lt;SpspPayment&gt;</code> - Resolves with the parameters that can be passed to sendPayment  

| Param | Type | Description |
| --- | --- | --- |
| receiver | <code>String</code> | webfinger identifier of receiver |
| sourceAmount | <code>String</code> | Amount that you will send |

<a name="module_SPSP..Client.Client+quoteDestination"></a>

#### client.quoteDestination ⇒ <code>Promise.&lt;SpspPayment&gt;</code>
Get payment params via SPSP query and ILQP quote, based on destination amount

**Kind**: instance property of <code>[Client](#module_SPSP..Client)</code>  
**Returns**: <code>Promise.&lt;SpspPayment&gt;</code> - Resolves with the parameters that can be passed to sendPayment  

| Param | Type | Description |
| --- | --- | --- |
| receiver | <code>String</code> | webfinger identifier of receiver |
| destinationAmount | <code>String</code> | Amount that the receiver will get |

<a name="module_SPSP..Client.Client+sendPayment"></a>

#### client.sendPayment ⇒ <code>Promise.&lt;PaymentResult&gt;</code>
Sends a payment using the PaymentParams

**Kind**: instance property of <code>[Client](#module_SPSP..Client)</code>  
**Returns**: <code>Promise.&lt;PaymentResult&gt;</code> - Returns payment result  

| Param | Type | Description |
| --- | --- | --- |
| payment | <code>SpspPayment</code> | params, returned by quoteSource or quoteDestination |

<a name="module_SPSP..Client.Client+query"></a>

#### client.query ⇒ <code>Object</code>
Queries an SPSP endpoint

**Kind**: instance property of <code>[Client](#module_SPSP..Client)</code>  
**Returns**: <code>Object</code> - result Result from SPSP endpoint  

| Param | Type | Description |
| --- | --- | --- |
| receiver | <code>String</code> | A URL or an account |

<a name="module_SPSP..SpspPayment"></a>

### SPSP~SpspPayment : <code>Object</code>
Parameters for an SPSP payment

**Kind**: inner typedef of <code>[SPSP](#module_SPSP)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>id</code> | UUID to ensure idempotence between calls to sendPayment |
| source_amount | <code>string</code> | Decimal string, representing the amount that will be paid on the sender's ledger. |
| destination_amount | <code>string</code> | Decimal string, representing the amount that the receiver will be credited on their ledger. |
| destination_account | <code>string</code> | Receiver's ILP address. |
| connector_account | <code>string</code> | The connector's account on the sender's ledger. The initial transfer on the sender's ledger is made to this account. |
| spsp | <code>string</code> | SPSP response object, containing details to contruct transfers. |
| data | <code>string</code> | extra data to attach to transfer. |


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
| params.destinationAmount | <code>String</code> |  | Amount that should arrive in the recipient's account |
| params.destinationAccount | <code>String</code> |  | Target account's ILP address |
| params.sharedSecret | <code>String</code> |  | Shared secret for PSK protocol |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>30 seconds from now</code> | Expiry of request |
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
    * [~generatePskParams()](#module_Receiver..createReceiver..generatePskParams) ⇒ <code>PskParams</code>
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

<a name="module_Receiver..createReceiver..generatePskParams"></a>

#### createReceiver~generatePskParams() ⇒ <code>PskParams</code>
Generate shared secret for Pre-Shared Key (PSK) transport protocol.

**Kind**: inner method of <code>[createReceiver](#module_Receiver..createReceiver)</code>  
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

<a name="module_Receiver..PskParams"></a>

### Receiver~PskParams : <code>Object</code>
**Kind**: inner typedef of <code>[Receiver](#module_Receiver)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| destinationAccount | <code>string</code> | Receiver's ILP address |
| sharedSecret | <code>string</code> | Base64Url-encoded shared secret |
