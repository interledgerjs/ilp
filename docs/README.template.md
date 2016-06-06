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

{{#module name="Client"~}}
{{>body~}}
{{>members~}}
{{/module}}

{{#module name="PaymentRequest"~}}
{{>body~}}
{{>members~}}
{{/module}}
