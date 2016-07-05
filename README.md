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

* Generate payment requests on the receiving side, including handling [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment*
* Pay for payment requests on the sending side*
* Quote and send payments through multiple ledger types (this library extends the functionality of [`ilp-core`](https://github.com/interledger/js-ilp-core))

*See note on [Request/Response Flow](#request-response-flow) below

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Communication of requests from recipient to sender

## Request/Response Flow

The [Universal Transport Protocol (UTP)](https://github.com/interledger/rfcs/blob/master/0006-universal-transport-protocol/0006-universal-transport-protocol.md) uses recipient-generated conditions to secure payments. This means that the recipient must first generate a payment request, which the sender then fulfills. This client library handles the [generation of such requests](#request-pay), but **not** the communication of the request details from the recipient to the sender.

## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module


## Request / Pay

The default behavior is to use the Universal transport protocol and the recipient's client will automatically generate and fulfill the condition.

### Requesting + Handling Incoming Payments

```js
import { Client } from 'ilp'
const client = new Client({
  type: 'bells', // indicates which ledger plugin to use
  auth: {
    account: 'https://blue.ilpdemo.org/ledger/accounts/receiver',
    password: 'receiver'
  }
})

const paymentRequest = client.createRequest({
  destinationAmount: '10',
  expiresAt: (new Date(Date.now() + 10000)).toISOString(),
  data: {
    thisIsFor: 'that thing'
  }
})

// XXX: user implements this
sendRequestToPayer(paymentRequest.getPacket())

// This automatically checks the incoming transfer and fulfills the condition
client.on('payment_request_paid', (paymentRequest, fulfillment) => {
  console.log('Got paid ' + paymentRequest.destinationAmount + ' for ' + paymentRequest.destinationMemo.thisIsFor)
})
```

### Paying
```js
import { Client } from 'ilp'
const client = new Client({
  account: 'https://red.ilpdemo.org/ledger/accounts/sender',
  password: 'sender'
})

// XXX: user implements this
const packetJson = { /* request from recipient */ }

const paymentRequest = client.parseRequest(packetJson)
client.quote(paymentRequest)
  .then((quote) => {
    client.payRequest(paymentRequest, {
      sourceAmount: quote.sourceAmount
    })
  })
```

## API Reference

<a name="module_Client..Client"></a>

### Client~Client
Low-level client for sending and receiving ILP payments (extends [Core Client](https://github.com/interledger/js-ilp-core))

**Kind**: inner class of <code>[Client](#module_Client)</code>  

* [~Client](#module_Client..Client)
    * [new Client()](#new_module_Client..Client_new)
    * [.quote()](#module_Client..Client+quote) ⇒ <code>Object</code>
    * [.sendQuotedPayment()](#module_Client..Client+sendQuotedPayment) ⇒ <code>Promise.&lt;null&gt;</code>
    * [.createRequest(params)](#module_Client..Client+createRequest) ⇒ <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>
    * [.parseRequest(input)](#module_Client..Client+parseRequest) ⇒ <code>PaymentRequest</code>
    * [.quoteRequest(paymentRequest)](#module_Client..Client+quoteRequest) ⇒ <code>module:Client~QuoteResponse</code>
    * [.payRequest(paymentRequest)](#module_Client..Client+payRequest) ⇒ <code>Promise.&lt;null&gt;</code>

<a name="new_module_Client..Client_new"></a>

#### new Client()
Instantiates an ILP client


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [opts.type] | <code>String</code> | <code>&#x27;bells&#x27;</code> | Ledger type to connect to, defaults to 'five-bells' |
| opts.auth | <code>Object</code> |  | Auth parameters for connecting to the ledger. Fields are defined by the ledger plugin corresponding to the ledgerType` |
| [opts.maxSourceHoldDuration] | <code>Number</code> | <code>10</code> | Default maximum time (in seconds) the client will allow the source funds to be held for when sending a transfer |
| [opts.conditionHashlockSeed] | <code>Buffer</code> | <code>crypto.randomBytes(32)</code> | Seed to use for generating the hashlock conditions |

<a name="module_Client..Client+quote"></a>

#### client.quote() ⇒ <code>Object</code>
Get a quote

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  
**Returns**: <code>Object</code> - Object including the amount that was not specified  

| Param | Type | Description |
| --- | --- | --- |
| [params.sourceAmount] | <code>String</code> | Either the sourceAmount or destinationAmount must be specified |
| [params.destinationAmount] | <code>String</code> | Either the sourceAmount or destinationAmount must be specified |
| params.destinationLedger | <code>String</code> | Recipient's ledger |

<a name="module_Client..Client+sendQuotedPayment"></a>

#### client.sendQuotedPayment() ⇒ <code>Promise.&lt;null&gt;</code>
Send a payment

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the payment has been submitted to the plugin  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params.sourceAmount | <code>String</code> |  | Amount to send |
| params.destinationAmount | <code>String</code> |  | Amount recipient will receive |
| params.destinationAccount | <code>String</code> |  | Recipient's account |
| params.destinationLedger | <code>String</code> |  | Recipient's ledger |
| params.connectorAccount | <code>String</code> |  | First connector's account on the source ledger (from the quote) |
| params.destinationMemo | <code>Object</code> |  | Memo for the recipient to be included with the payment |
| params.expiresAt | <code>String</code> |  | Payment expiry timestamp |
| [params.executionCondition] | <code>String</code> | <code>Error unless unsafeOptimisticTransport is true</code> | Crypto condition |
| [params.unsafeOptimisticTransport] | <code>Boolean</code> | <code>false</code> | Send payment without securing it with a condition |

<a name="module_Client..Client+createRequest"></a>

#### client.createRequest(params) ⇒ <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>
Create a PaymentRequest. This is used on the receiving side.

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>[PaymentRequestJson](#module_PaymentRequest..PaymentRequestJson)</code> | Parameters to create the PaymentRequest |

<a name="module_Client..Client+parseRequest"></a>

#### client.parseRequest(input) ⇒ <code>PaymentRequest</code>
Parse a payment request from a serialized form

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type |
| --- | --- |
| input | <code>PaymentRequestJson</code> | 

<a name="module_Client..Client+quoteRequest"></a>

#### client.quoteRequest(paymentRequest) ⇒ <code>module:Client~QuoteResponse</code>
Get a quote for how much it would cost to pay for this payment request

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type | Description |
| --- | --- | --- |
| paymentRequest | <code>PaymentRequest</code> | Parsed PaymentRequest |

<a name="module_Client..Client+payRequest"></a>

#### client.payRequest(paymentRequest) ⇒ <code>Promise.&lt;null&gt;</code>
Pay for a PaymentRequest

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  
**Returns**: <code>Promise.&lt;null&gt;</code> - Resolves when the payment has been sent  

| Param | Type | Description |
| --- | --- | --- |
| paymentRequest | <code>PaymentRequest</code> | Request to pay for |
| params.sourceAmount | <code>String</code> &#124; <code>Number</code> &#124; <code>BigNumber</code> | Amount to send. Should be determined from quote |


<a name="module_PaymentRequest..PaymentRequest"></a>

### PaymentRequest~PaymentRequest
**Kind**: inner class of <code>[PaymentRequest](#module_PaymentRequest)</code>  

* [~PaymentRequest](#module_PaymentRequest..PaymentRequest)
    * [new PaymentRequest(params)](#new_module_PaymentRequest..PaymentRequest_new)
    * _instance_
        * [.toJSON()](#module_PaymentRequest..PaymentRequest+toJSON) ⇒ <code>PaymentRequestJson</code>
        * [.setCondition(conditionUri)](#module_PaymentRequest..PaymentRequest+setCondition)
        * [.generateHashlockCondition(conditionHashlockSeed)](#module_PaymentRequest..PaymentRequest+generateHashlockCondition) ⇒ <code>Condition</code>
    * _static_
        * [.fromJSON(json)](#module_PaymentRequest..PaymentRequest.fromJSON) ⇒ <code>PaymentRequest</code>
        * [.fromTransfer([Transfer])](#module_PaymentRequest..PaymentRequest.fromTransfer) ⇒ <code>PaymentRequest</code>

<a name="new_module_PaymentRequest..PaymentRequest_new"></a>

#### new PaymentRequest(params)
Instantiates a PaymentRequest


| Param | Type |
| --- | --- |
| params | <code>PaymentRequestJson</code> | 

<a name="module_PaymentRequest..PaymentRequest+toJSON"></a>

#### paymentRequest.toJSON() ⇒ <code>PaymentRequestJson</code>
Get the JSON representation of the PaymentRequest to send to the sender.

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  
<a name="module_PaymentRequest..PaymentRequest+setCondition"></a>

#### paymentRequest.setCondition(conditionUri)
Set the request condition

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  

| Param | Type | Description |
| --- | --- | --- |
| conditionUri | <code>String</code> | String serialized condition URI |

<a name="module_PaymentRequest..PaymentRequest+generateHashlockCondition"></a>

#### paymentRequest.generateHashlockCondition(conditionHashlockSeed) ⇒ <code>Condition</code>
Generate a five-bells-condition PREIMAGE-SHA-256 Condition

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  
**Returns**: <code>Condition</code> - [five-bells-condition](https://github.com/interledger/five-bells-condition)  

| Param | Type | Description |
| --- | --- | --- |
| conditionHashlockSeed | <code>Buffer</code> | Key for the HMAC used to create the fulfillment |

<a name="module_PaymentRequest..PaymentRequest.fromJSON"></a>

#### PaymentRequest.fromJSON(json) ⇒ <code>PaymentRequest</code>
Parse PaymentRequest from JSON serialization

**Kind**: static method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  

| Param | Type |
| --- | --- |
| json | <code>PaymentRequestJson</code> | 

<a name="module_PaymentRequest..PaymentRequest.fromTransfer"></a>

#### PaymentRequest.fromTransfer([Transfer]) ⇒ <code>PaymentRequest</code>
Parse PaymentRequest from a [Transfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#class-transfer)

**Kind**: static method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  

| Param | Type | Description |
| --- | --- | --- |
| [Transfer] | <code>Transfer</code> | ledger-plugin-interface/0004-ledger-plugin-interface.md#class-transfer) |
| additionalParams.ledger | <code>String</code> | Destination ledger |
| additionalParams.account | <code>String</code> | Destination account |

<a name="module_PaymentRequest..PaymentRequestJson"></a>

### PaymentRequest~PaymentRequestJson : <code>Object</code>
**Kind**: inner typedef of <code>[PaymentRequest](#module_PaymentRequest)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [id] | <code>String</code> | <code>(random UUID v4)</code> | Unique request ID. MUST be unique because it is used to generate the condition |
| destinationAmount | <code>String</code> &#124; <code>Number</code> &#124; <code>BigNumber</code> |  | The amount to receive |
| destinationLedger | <code>String</code> |  | Receiver's ledger |
| destinationAccount | <code>String</code> |  | Receiver's account |
| [expiresAt] | <code>String</code> | <code>(never)</code> | Timestamp when request expires and will no longer be fulfilled by the recipient |
| [destinationMemo] | <code>Object</code> |  | Additional data to include in the PaymentRequest (and the sender's corresponding payment). This can be used to add metadata for use when handling incoming payments |
| [executionCondition] | <code>String</code> |  | Request condition. Required but may be set after instantiation |
