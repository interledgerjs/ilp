<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP
</h1>

<h4 align="center">
A low-level JS <a href="https://interledger.org">Interledger</a> library
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

This module bundles low-level and high-level interfaces to ILP, largely intended for building ILP into other [Application layer](https://github.com/interledger/rfcs/tree/master/0001-interledger-architecture) protocols.

#### The ILP module includes:

* [Interledger Payment Request (IPR)](#interledger-payment-request-ipr-transport-protocol) Transport Protocol, an interactive protocol in which the receiver specifies the payment details, including the condition
* [Pre-Shared Key (PSK)](#pre-shared-key-psk-transport-protocol) Transport Protocol, a non-interactive protocol in which the sender creates the payment details and uses a shared secret to generate the conditions
* [Simple Payment Setup Protocol (SPSP)](#simple-payment-setup-protocol-spsp), a higher level interface for sending ILP payments, which requires the receiver to have an SPSP server.
* Interledger Quoting and the ability to send through multiple ledger types using [Ledger Plugins](https://github.com/interledgerjs?utf8=✓&q=ilp-plugin)

## Installation

`npm install --save ilp ilp-plugin-bells`

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module*

## Simple Payment Setup Protocol (SPSP)

If you are sending to an SPSP receiver with a `user@example.com` identifier, the SPSP module
provides a high-level interface:

```js
'use strict'

const co = require('co')
const SPSP = require('ilp').SPSP
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')

const plugin = new FiveBellsLedgerPlugin({
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice'
})

co(function * () {
  const payment = yield SPSP.quote(plugin, {
    receiver: 'bob@blue.ilpdemo.org'
    sourceAmount: '1',
  })

  console.log('got SPSP payment details:', payment)

  const { fulfillment } = yield SPSP.sendPayment(plugin, payment)
  console.log('sent! fulfillment:', fulfillment)
})
```

## Interledger Payment Request (IPR) Transport Protocol

This protocol uses recipient-generated [Interledger Payment Requests](https://github.com/interledger/rfcs/blob/master/0011-interledger-payment-request/0011-interledger-payment-request.md), which include the condition for the payment. This means that the recipient must first generate a payment request, which the sender then fulfills.

This library handles the generation of payment requests, but **not the communication of the request details from the recipient to the sender**. In some cases, the sender and receiver might be HTTP servers, in which case HTTP would be used. In other cases, they might be using a different medium of communication.

### IPR Sending and Receiving Example

```js
'use strict'

const uuid = require('uuid')
const co = require('co')
const ILP = require('ilp')
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')

const sender = new FiveBellsLedgerPlugin({
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice'
})

const receiver = new FiveBellsLedgerPlugin({
  account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
  password: 'bobbob'
})

co(function * () {
  const stopListening = yield ILP.IPR.listen(receiver, {
    secret: Buffer.from('secret', 'utf8')
  }, (params) => {
    console.log('got transfer:', params.transfer)

    console.log('fulfilling.')
    return params.fulfill()
  })

  const { packet, condition } = ILP.IPR.createPacketAndCondition({
    secret: Buffer.from('secret', 'utf8')
    destinationAccount: receiver.getAccount(),
    destinationAmount: '10',
  })

  // Note the user of this module must implement the method for
  // communicating packet and condition from the recipient to the sender

  const quote = yield ILP.ILQP.quoteByPacket(sender, packet)
  console.log('got quote:', quote)

  yield sender.sendTransfer({
    id: uuid(),
    to: quote.connectorAccount,
    amount: quote.sourceAmount,
    expiresAt: quote.expiresAt,
    executionCondition: condition,
    ilp: packet
  })

  sender.on('outgoing_fulfill', (transfer, fulfillment) => {
    console.log(transfer.id, 'was fulfilled with', fulfillment)
    stopListening()
  })
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

const uuid = require('uuid')
const co = require('co')
const ILP = require('ilp')
const FiveBellsLedgerPlugin = require('ilp-plugin-bells')

const sender = new FiveBellsLedgerPlugin({
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice'
})

const receiver = new FiveBellsLedgerPlugin({
  account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
  password: 'bobbob'
})

const { sharedSecret, destinationAccount } = ILP.PSK.generateParams(receiver, 

// Note the user of this module must implement the method for
// communicating sharedSecret and destinationAccount from the recipient
// to the sender

co(function * () {
  const stopListening = yield ILP.PSK.listen(receiver, { sharedSecret }, (params) => {
    console.log('got transfer:', params.transfer)

    console.log('fulfilling.')
    return params.fulfill()
  })

  // the sender can generate these, via the sharedSecret and destinationAccount
  // given to them by the receiver.
  const { packet, condition } = ILP.PSK.createPacketAndCondition({
    sharedSecret,
    destinationAccount,
    destinationAmount: '10',
  })

  const quote = yield ILP.ILQP.quoteByPacket(sender, packet)
  console.log('got quote:', quote)

  yield sender.sendTransfer({
    id: uuid(),
    to: quote.connectorAccount,
    amount: quote.sourceAmount,
    expiresAt: quote.expiresAt,
    executionCondition: condition,
    ilp: packet
  })

  sender.on('outgoing_fulfill', (transfer, fulfillment) => {
    console.log(transfer.id, 'was fulfilled with', fulfillment)
    stopListening()
  })
}).catch((err) => {
  console.log(err)
})
```

## API Reference

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


ERROR, Cannot find module.
ERROR, Cannot find module.
