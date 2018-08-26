'use strict'
const ILDCP = require('ilp-protocol-ildcp')
const SPSP = require('ilp-protocol-spsp')
const STREAM = require('ilp-protocol-stream')
const getPlugin = require('ilp-plugin')
const createLogger = require('ilp-logger')
const log = createLogger('ilp')

/**
 * Get a simple middleware function that will return an SPSP response to any request.
 *
 * Example: To use with express
 *
```
 const ilp = require('ilp')
 const app = require('express')()
 app.get('/.well-known/pay', ilp.createMiddleware({name: 'Bob'}))
 app.listen(3000)
```
 * @param {*} receiverInfo The 'receiver_info' object that will be returned in the SPSP response.
 * @param {*} plugin The plugin to use to receive payments
 */
async function createMiddleware (receiverInfo = {}, plugin = getPlugin()) {
  const server = await createServer(plugin)
  return (req, rsp) => {
    const { destinationAccount, sharedSecret } = server.generateAddressAndSecret()
    rsp.set('Content-Type', 'application/spsp4+json')
    rsp.send({
      destination_account: destinationAccount,
      shared_secret: sharedSecret.toString('base64'),
      receiver_info: receiverInfo
    })
  }
}

/**
 * Create a STREAM server and listen for new connections.
 *
 * Sets the `receiveMax` on any new streams to Infinity so this server will never block incoming money.
 *
 * @param {*} plugin The plugin to use to receive payments
 */
async function createServer (plugin = getPlugin()) {
  const server = await STREAM.createServer({ plugin })

  server.on('connection', (connection) => {
    connection.on('stream', (stream) => {
      // Set the maximum amount of money this stream can receive
      stream.setReceiveMax(Infinity)

      stream.on('money', (amount) => {
        log.debug(`got money on stream ${stream.id}: ${amount}`)
      })

      stream.on('data', (chunk) => {
        log.debug(`got data on stream ${stream.id}: ${chunk.toString('utf8')}`)
      })
    })
  })

  return server
}

/**
 * Make a payment to the given payee
 *
 * @param {*} amount The amount to send (scale and currency implied by the plugin that is used)
 * @param {*} payee The payee. Either an SPSP receiver (string) or `{ destinationAccount, sharedSecret }`
 * @param {*} plugin The plugin to use to send payments
 */
async function pay (amount, payee, plugin = getPlugin()) {
  if (typeof amount !== 'number') {
    throw Error('amount must be a number')
  }

  if (typeof payee === 'string') {
    return SPSP.pay(plugin, { receiver: payee, sourceAmount: amount })
  } else {
    const { destinationAccount, sharedSecret } = payee
    const connection = await STREAM.createConnection({
      plugin,
      destinationAccount,
      sharedSecret
    })

    const stream = connection.createStream()
    await stream.sendTotal(amount)
    stream.end(() => {
      connection.end()
    })
  }
}

module.exports = {
  ILDCP,
  STREAM,
  SPSP,
  createLogger,
  createMiddleware,
  createPlugin: getPlugin,
  createServer,
  pay
}
