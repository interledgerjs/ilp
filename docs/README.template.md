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

{{#module name="Client"~}}
{{>body~}}
{{>members~}}
{{/module}}

{{#module name="PaymentRequest"~}}
{{>body~}}
{{>members~}}
{{/module}}
