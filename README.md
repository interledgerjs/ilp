<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP Client
</h1>

<h4 align="center">
A JS client library for sending and receiving <a href="https://interledger.org">Interledger</a> payments.
</h4>

<br>

This is a low-level interface to ILP, largely intended for building ILP into other [Application layer](https://github.com/interledger/rfcs/tree/master/0001-interledger-architecture) protocols.

For a simple, high-level interface see the [Wallet Client](https://github.com/interledger/five-bells-wallet-client).  

#### The ILP Client does:

* Generate payment requests for the Universal or Optimistic transport protocols (receiving side)*
* Handle [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment (receiving side)
* Pay for payment requests (sending side)*
* Initiate Optimistic payments (sending side)*
* Connect to multiple ledger types using the [Ledger Plugin Interface](https://github.com/interledger/rfcs/tree/master/0004-ledger-plugin-interface)
* Communicate with [ILP Connectors](https://github.com/interledger/five-bells-connector) to send Interledger payments

*See note on [Request/Response Flow](#request-response-flow) below

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Condition communication from recipient to sender

## Request/Response Flow

The [Universal Transport Protocol (UTP)](https://github.com/interledger/rfcs/blob/master/0006-universal-transport-protocol/0006-universal-transport-protocol.md) uses recipient-generated conditions to secure payments. This means that the recipient must first generate a payment request, which the sender then fulfills. This client library handles the [generation of such requests](#request-pay), but **not** the communication of the request details from the recipient to the sender.

Since the [Optimistic Transport Protocol (OTP)](https://github.com/interledger/rfcs/blob/master/0005-optimistic-transport-protocol/0005-optimistic-transport-protocol.md) does not use conditions, payments can be [initiated by the sender](#initiating-optimistic-payments).

## Installation

`npm install --save ilp`


## Request / Pay

The default behavior is to use the Universal transport protocol and the recipient's client will automatically generate and fulfill the condition.

### Requesting + Handling Incoming Payments

```js
import { Client } from 'ilp'
const client = new Client({
  ledgerType: 'five-bells',
  auth: {
    account: 'https://far-far-away-ledger.example/accounts/bob',
    password: 'super-secret-password'
  }
})

const paymentRequest = client.createRequest({
  destinationAmount: '10',
  timeout: 10000,
  data: {
    thisIsFor: 'that thing'
  }
})

// XXX: user implements this
sendRequestToPayer(paymentRequest.getPacket())

// This automatically checks the incoming transfer and fulfills the condition
client.on('incoming', (transfer, paymentRequest) => {
  console.log('Got paid ' + paymentRequest.destinationAmount + ' for ' + paymentRequest.data.thisIsFor)
})
```

### Paying
```js
import { Client } from 'ilp'
const client = new ILP.Client({
  account: 'https://ledgers.example/accounts/alice',
  password: 'ultra-secret-password'
})

// XXX: user implements this
const packetJson = { /* request from recipient */ }

const paymentRequest = client.parseRequest(packetJson)
paymentRequest.quote()
  .then((quote) => {
    paymentRequest.pay({
      maxSourceAmount: quote.sourceAmount
    })
  })
```

## Initiating Optimistic Payments

**WARNING**: Optimistic payments do not use conditions and holds so **money can be lost**.

Make sure you understand [Optimistic ILP](https://github.com/interledger/rfcs/tree/master/0005-optimistic-transport-protocol) before using this.

### Sending

```js
import ILP from 'ilp'
const client = new ILP.Client({
  account: 'https://ledgers.example/accounts/alice',
  password: 'ultra-secret-password'
})

// Automatically gets quote and generates ILP Packet
client.send({
  destinationAccount: 'https://far-far-away-ledger.example/accounts/bob',
  destinationAmount: '0.0001',
  maxSourceAmount: '0.0002',
  unsafeOptimisticTransport: true,
  data: {
    hi: 'there'
  }
})
```

### Receiving

```js
import ILP from 'ilp'
const client = new ILP.Client({
  account: 'https://far-far-away-ledger.example/accounts/bob',
  password: 'super-secret-password'
})

client.on('incoming', (transfer) => {
  console.log('Got payment of ' + transfer.amount + ' with data ' + transfer.data.toString())
})
```


## API Reference

<a name="module_Client..Client"></a>

### Client~Client
Low-level client for sending and receiving ILP payments

**Kind**: inner class of <code>[Client](#module_Client)</code>  

* [~Client](#module_Client..Client)
    * [new Client()](#new_module_Client..Client_new)
    * [.getAccount()](#module_Client..Client+getAccount) ⇒ <code>String</code>
    * [.quote(params)](#module_Client..Client+quote) ⇒ <code>QuoteResponse</code>
    * [.send(params)](#module_Client..Client+send) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.createRequest(params)](#module_Client..Client+createRequest) ⇒ <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>
    * [.parseRequest(packet)](#module_Client..Client+parseRequest) ⇒ <code>module:PaymentRequest#PaymentRequest</code>

<a name="new_module_Client..Client_new"></a>

#### new Client()
Instantiates an ILP client


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [opts.ledgerType] | <code>String</code> | <code>&#x27;five-bells&#x27;</code> | Ledger type to connect to, defaults to 'five-bells' |
| opts.auth | <code>Object</code> |  | Auth parameters for connecting to the ledger. Fields are defined by the ledger plugin corresponding to the ledgerType` |
| [opts.maxSourceHoldDuration] | <code>Number</code> | <code>10</code> | Default maximum time (in seconds) the client will allow the source funds to be held for when sending a transfer |
| [opts.conditionHashlockSeed] | <code>Buffer</code> | <code>crypto.randomBytes(32)</code> | Seed to use for generating the hashlock conditions |

<a name="module_Client..Client+getAccount"></a>

#### client.getAccount() ⇒ <code>String</code>
Returns the account URI

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  
<a name="module_Client..Client+quote"></a>

#### client.quote(params) ⇒ <code>QuoteResponse</code>
Get a quote

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | Payment params, see ilp-core docs |

<a name="module_Client..Client+send"></a>

#### client.send(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Send an ILP payment

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Resolves when the payment has been sent  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  | Payment params, see ilp-core docs |
| params.maxSourceAmount | <code>String</code> &#124; <code>Number</code> &#124; <code>BigNumber</code> |  | Reject if the quoted source amount exceeds this value |
| [params.maxSourceHoldDuration] | <code>Number</code> | <code>client.maxSourceHoldDuration</code> | Maximum time (in seconds) the client will allow the source funds to be held for |
| [params.unsafeOptimisticTransport] | <code>Boolean</code> | <code>false</code> | Allow sending without a condition using the Optimistic transport |

<a name="module_Client..Client+createRequest"></a>

#### client.createRequest(params) ⇒ <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>
Create a PaymentRequest. This is used on the receiving side.

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>[Params](#module_PaymentRequest..Params)</code> | Parameters to create the PaymentRequest |

<a name="module_Client..Client+parseRequest"></a>

#### client.parseRequest(packet) ⇒ <code>module:PaymentRequest#PaymentRequest</code>
Parse a PaymentRequest from an ILP packet. This is used on the sending side.

**Kind**: instance method of <code>[Client](#module_Client..Client)</code>  

| Param | Type | Description |
| --- | --- | --- |
| packet | <code>Object</code> | [ILP Packet](https://github.com/interledger/five-bells-shared/blob/master/schemas/IlpHeader.json) |

<a name="module_Client..QuoteResponse"></a>

### Client~QuoteResponse : <code>Object</code>
**Kind**: inner typedef of <code>[Client](#module_Client)</code>  

| Param | Type |
| --- | --- |
| sourceAmount | <code>String</code> | 
| destinationAmount | <code>String</code> | 


<a name="module_PaymentRequest..PaymentRequest"></a>

### PaymentRequest~PaymentRequest
**Kind**: inner class of <code>[PaymentRequest](#module_PaymentRequest)</code>  

* [~PaymentRequest](#module_PaymentRequest..PaymentRequest)
    * [new PaymentRequest(client, params)](#new_module_PaymentRequest..PaymentRequest_new)
    * [.getPacket()](#module_PaymentRequest..PaymentRequest+getPacket) ⇒ <code>Object</code>
    * [.quote()](#module_PaymentRequest..PaymentRequest+quote) ⇒ <code>[QuoteResponse](#module_Client..QuoteResponse)</code>
    * [.pay()](#module_PaymentRequest..PaymentRequest+pay) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_module_PaymentRequest..PaymentRequest_new"></a>

#### new PaymentRequest(client, params)
Instantiates a PaymentRequest


| Param | Type | Description |
| --- | --- | --- |
| client | <code>[Client](#module_Client..Client)</code> | ILP client used for quoting and paying |
| params | <code>Params</code> | PaymentRequest parameters |

<a name="module_PaymentRequest..PaymentRequest+getPacket"></a>

#### paymentRequest.getPacket() ⇒ <code>Object</code>
Get the ILP packet to send to the sender.

If unsafeOptimisticTransport is not set, this will deterministically generate a condition from the packet fields.
Note that it is **VERY IMPORTANT** that the PaymentRequest ID be unique, otherwise multiple requests will have the same condition.

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  
<a name="module_PaymentRequest..PaymentRequest+quote"></a>

#### paymentRequest.quote() ⇒ <code>[QuoteResponse](#module_Client..QuoteResponse)</code>
Get a quote for how much it would cost to pay for this payment request

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  
<a name="module_PaymentRequest..PaymentRequest+pay"></a>

#### paymentRequest.pay() ⇒ <code>Promise.&lt;Object&gt;</code>
Pay for the payment request

**Kind**: instance method of <code>[PaymentRequest](#module_PaymentRequest..PaymentRequest)</code>  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Resolves when the payment has been sent  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params.maxSourceAmount | <code>String</code> &#124; <code>Number</code> &#124; <code>BigNumber</code> |  | Maximum amount to send |
| [params.maxSourceHoldDuration] | <code>Number</code> | <code>client.maxSourceHoldDuration</code> | Maximum time (in seconds) the client will allow the source funds to be held for |
| [params.allowUnsafeOptimisticTransport] | <code>Boolean</code> | <code>false</code> | If false, do not send Optimistic payments, even if they are requested (because they may be lost in transit) |

<a name="module_PaymentRequest..Params"></a>

### PaymentRequest~Params : <code>Object</code>
**Kind**: inner typedef of <code>[PaymentRequest](#module_PaymentRequest)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [id] | <code>String</code> | <code>(random UUID v4)</code> | Unique request ID. MUST be unique because it is used to generate the condition |
| destinationAmount | <code>String</code> &#124; <code>Number</code> &#124; <code>BigNumber</code> |  | The amount to receive |
| [timeout] | <code>Number</code> | <code>10000</code> | Number of milliseconds to expire request after |
| [data] | <code>Object</code> |  | Additional data to include in the PaymentRequest (and the sender's corresponding payment). This can be used to add metadata for use when handling incoming payments |
| [unsafeOptimisticTransport] | <code>Boolean</code> | <code>false</code> | Don't use a condition to secure the payment, use the Optimistic Transport Protocol |
