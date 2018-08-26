<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP
</h1>

<h4 align="center">
The Javascript client library for <a href="https://interledger.org">Interledger</a>
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

#### The ILP module includes:

* [Simple Payment Setup Protocol (SPSP)](#simple-payment-setup-protocol-spsp), a higher level interface for sending ILP payments, which requires the receiver to have an SPSP server.
* [Interledger Dynamic Configuration Protocol (ILDCP)](#interledger-dynamic-configuration-protocol-ildcp), a protocol for exchanging configuration between nodes.
* [STREAM](#stream), the recommended Transport Protocol to use for most Interledger applications.
* [createLogger](#create-logger), a function to create a name spaced logger.
* [createMiddleware](#create-middleware), a function to create server middleware for an SPSP receiver.
* [createPlugin](#create-plugin), a function to get an ILP plugin from the environment or testnet.
* [createServer](#create-server), a function to create a STREAM server listening for new incoming connections.
* [pay](#pay), a function to make a STREAM payment to either a Payment Pointer or an ILP Address using appropriate shared secret.

## Installation

`npm install --save ilp`

*Note that [ilp plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module unless you simply use BTP*

## Create Plugin

Using `ilp.createPlugin` is an alias for `ilp-plugin.getPlugin`. It creates an instance of a BTP plugin that will attempt to connect to a local `moneyd` instance by default. This can be overridden using environment variables.

The module looks for `ILP_CREDENTIALS` and `ILP_PLUGIN`. `ILP_CREDENTIALS` must contain a JSON object and will be passed into the constructor of a new plugin instance. The name of the plugin type to instantiate must be stored as a string in the environment variable `ILP_PLUGIN` or it will default to `ilp-plugin-btp`.

By default (i.e. `ILP_CREDENTIALS` and `ILP_PLUGIN` are not set), a random secret will be generated and a new instance of `ilp-plugin-btp` will be configured to connect to btp+ws://localhost:7768.

## [Simple Payment Setup Protocol (SPSP)](https://interledger.org/rfcs/0009-simple-payment-setup-protocol/draft-6.html)

If you are sending to an SPSPv4 receiver using a [Payment Pointer](https://interledger.org/rfcs/0026-payment-pointers), the SPSP module provides a high-level interface to `pay` and `query` the server:

```js
'use strict'

const ilp = require('ilp')

;(async function () {
  await ilp.SPSP.pay(ilp.createPlugin(), {
    receiver: '$bob.example.com',
    sourceAmount: '1000'
  })
})()
```

For more details read the docs for the [SPSP module](https://www.npmjs.com/package/ilp-protocol-spsp).

### Create Middleware

The `ilp` module provides a convenience function to create server middleware that exposes an SPSP endpoint for receiving payments.

```js
'use strict'

const ilp = require('ilp')
const app = require('express')()

app.get('/.well-known/pay', ilp.createMiddleware({name: 'Bob'}))
app.listen(443)
```

## [Interledger Dynamic Configuration Protocol (ILDCP)](https://github.com/interledger/rfcs/blob/master/0031-dynamic-configuration-protocol/0031-dynamic-configuration-protocol.md)

The ILDCP module allows clients to get their configured address, asset and scale from an upstream parent connector.

```js
'use strict'

const ilp = require('ilp')

;(async function () {
  const plugin = ilp.createPlugin()
  await plugin.connect()
  const { clientAddress, assetScale, assetCode } = await ilp.ILDCP.fetch(plugin.sendData.bind(plugin))
  console.log(`Plugin connected and configured with address ${clientAddress} using asset ${assetCode} and scale ${assetScale}`)
})()
```

## [STREAM](https://interledger.org/rfcs/0029-stream/)

The STREAM module provides an API to use the STREAM protocol to send and receive payments. STREAM is the recommended transport protocol for use with ILP.

The `ilp` module provides two abstractions over this module that make it simple to send and receive payments.

### Create Server

`createServer` creates an instance of a STREAM server wrapped around a given plugin (or calls `createPlugin` if none is provided). It registers event listeners for new connections and streams and writes the events to the debug log.

### Pay

`pay` will either pay a vlaid SPSP receiver or an ILP address (assuming their is a STREAM server waiting for connections at that address).

To pay using an SPSP receiver, pass the payment pointer as the payee in the form of a string:

```js
'use strict'

const ilp = require('ilp')

;(async function () {
  await ilp.pay(100, '$bob.example.com')
})()
```

To pay using a given ILP Address and shared secret pass these in as an object:

```js
'use strict'

const ilp = require('ilp')

;(async function () {
  await ilp.pay(100, { destinationAccount: 'g.bob.1234', sharedSecret: Buffer.from('******', 'base64') })
})()
```
