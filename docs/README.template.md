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
* Generate shared secrets for PSK transport, and then use the shared secret to generate and fulfill payments.
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

### Shared Secret Example (Pre-Shared Key Transport Protocol)

Sometimes it is desirable that the sender can choose the amount and generate the
condition without communicating with the recipient. This is an example of a
payment using the Pre-Shared Key (PSK) transport protocol, which implements this type of
flow.

PSK works by using a pre-shared secret that the sender and receiver have. The pre-shared
secret can be retrieved by the sender using SPSP, or any other method. In the example below,
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
      throw new Error('payment is too big!')
    }
  }
})

co(function * () {

## API Reference

{{#module name="Sender"~}}
{{>body~}}
{{>members~}}
{{/module}}

{{#module name="Receiver"~}}
{{>body~}}
{{>members~}}
{{/module}}
