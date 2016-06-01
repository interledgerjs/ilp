<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP Client
</h1>

<h4 align="center">
A JS client library for sending and receiving [Interledger](https://interledger.org) payments.
</h4>

<br>

This is a low-level interface to ILP, largely intended for building ILP into other [Application layer](https://github.com/interledger/rfcs/tree/master/0001-interledger-architecture) protocols.

For a simple, high-level interface see the [Wallet Client](https://github.com/interledger/five-bells-wallet-client).  

#### The ILP Client does:

* Generate payment requests ([ILP Packets](https://github.com/interledger/rfcs/tree/master/0003-interledger-protocol)) for any Transport protocol*
* Pay for a payment request using any Transport protocol*
* Initiate Optimistic payments*
* Connect to multiple ledger types using the [Ledger Plugin Interface](https://github.com/interledger/rfcs/tree/master/0004-ledger-plugin-interface)
* Communicate with [ILP Connectors](https://github.com/interledger/five-bells-connector) to send Interledger payments 
* Optionally handle [Crypto Condition](https://github.com/interledger/rfcs/tree/master/0002-crypto-conditions) generation and fulfillment

*See note on [Payment Initiation + Request/Response Flow](#payment-initiation-request-response-flow) below

#### The ILP Client does **not** handle:

* Account discovery
* Amount negotiation
* Condition communication from recipient to sender


## Installation

`npm install --save ilp`


## Simple Request / Pay

The default behavior is to use the Universal transport protocol and the recipient's client will automatically generate and fulfill the condition.

### Requesting + Handling Incoming Payments

```js
'use strict'
const ILP = require('ilp')
const client = new ILP.Client({
  account: 'https://far-far-away-ledger.example/accounts/bob',
  password: 'super-secret-password'
})

// Helper function to generate an ILP packet using our account as destinationAddress
const paymentRequest = client.createRequest({
  destinationAmount: '10',
  timeout: 10000
})

// XXX: user implements this
sendRequestToPayer(paymentRequest.toJSON())

paymentRequest.autoAcceptPayment()
  .then((result) => {
    console.log('Got paid ' + result.destinationAmount)
  })
  .catch((err) => {
    // e.g. payment did not arrive before the timeout  
    console.error(err)
  })
```

Alternative:

```js
'use strict'
const ILP = require('ilp')
const client = new ILP.Client({
  account: 'https://far-far-away-ledger.example/accounts/bob',
  password: 'super-secret-password'
})

// Helper function to generate an ILP packet using our account as destinationAddress
const paymentRequest = client.createRequest({
  destinationAmount: '10',
  timeout: 10000
})
// returns Buffer

// XXX: user implements this
sendRequestToPayer(paymentRequest)

client.autoAcceptPayment(paymentRequest)
  .then((result) => {
    console.log('Got paid ' + result.destinationAmount)
  })
  .catch((err) => {
    // e.g. payment did not arrive before the timeout  
    console.error(err)
  })
```

### Paying
```js
'use strict'
const ILP = require('ilp')
const client = new ILP.Client({
  account: 'https://ledgers.example/accounts/alice',
  password: 'ultra-secret-password'
  // maxHoldTime: 10000
})

// XXX: user implements this
const paymentRequest = { /* request from recipient */ }

const localTransfer = {
  maxSourceAmount: '11'
}

client.send(localTransfer, paymentRequest)
  .then((result) => {
    console.log('Sent ' + result.sourceAmount + ' to ' + result.destination)
    console.log('Got condition fulfillment: ' + result.fulfillment)
  }).catch((err) => {
    console.error(err)
  })
```

## Other Payment Options

### Requests with Custom Conditions

```js
import ILP from 'ilp'
import crypto from 'crypto'
import cc from 'cc'
const client = new ILP.Client({
  account: 'https://far-far-away-ledger.example/accounts/bob',
  password: 'super-secret-password'
})

// Create condition
const hashPreimage = crypto.randomBytes(32)
// XXX: store hashPreimage in database for persistence or for use across multiple processes
const conditionFulfillment = new cc.PreimageSha256()
conditionFulfillment.setPreimage(hashPreimage)
const condition = conditionFulfillment.getConditionUri()

// Generate request
const paymentRequest = client.createRequest({
  destinationAmount: '10',
  destinationExpireBy: Date.now() + 10000,
  condition: condition
})

// XXX: user implements this
sendRequestToPayer(paymentRequest.toJSON())

client.on('pending', (payment, callback) => {
  // Check if incoming prepared payments match the request we sent 
  if (payment.matches(paymentRequest)) {
    callback(null, conditionFulfillment.serializeUri())
  }
})
client.on('incoming', (payment) => {
  console.log('Got paid ' + payment.destinationAmount)
})
```

### Sending Optimistic Payments

**WARNING**: Optimistic payments do not use conditions and holds so **money can be lost**.

Make sure you understand [Optimistic ILP](https://github.com/interledger/rfcs/tree/master/0005-optimistic-transport-protocol) before using this.

```js
import ILP from 'ilp'
const client = new ILP.Client({
  account: 'https://ledgers.example/accounts/alice',
  password: 'ultra-secret-password'
})

// Automatically gets quote and generates ILP Packet
client.sendPayment({
  sourceAmount: '10',
  destinationAccount: 'https://far-far-away-ledger.example/accounts/bob'
})

```


## Payment Initiation + Request/Response Flow

**TODO**
