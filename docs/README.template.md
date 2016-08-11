<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP Client
</h1>

<h4 align="center">
A low-level JS <a href="https://interledger.org">Interledger</a> sender/receiver library
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

#### The ILP Client does:

* Generate payment requests on the receiving side, including handling [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment (using the [Interactive Transport Protocol (ITP)](https://github.com/interledger/rfcs/blob/master/0011-interactive-transport-protocol/0011-interactive-transport-protocol.md) )
* Pay for payment requests on the sending side
* Quote and send payments through multiple ledger types (using [`ilp-core`](https://github.com/interledger/js-ilp-core))

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Communication of requests from recipient to sender

For a higher-level interface that includes the above features, see the [Wallet Client](https://github.com/interledger/five-bells-wallet-client).  


## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module


## ITP Request / Pay

The client implements the [Interactive Transport Protocol (ITP)](https://github.com/interledger/rfcs/blob/master/0011-interactive-transport-protocol/0011-interactive-transport-protocol.md) for generating and fulfilling payment requests.

ITP uses recipient-generated conditions to secure payments. This means that the recipient must first generate a payment request, which the sender then fulfills. This client library handles the generation of such requests, but **not** the communication of the request details from the recipient to the sender.

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
  password: 'alice'
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

## API Reference

{{#module name="Sender"~}}
{{>body~}}
{{>members~}}
{{/module}}

{{#module name="Receiver"~}}
{{>body~}}
{{>members~}}
{{/module}}
