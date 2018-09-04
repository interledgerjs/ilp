import BigNumber from 'bignumber.js'
import * as crypto from 'crypto'
import * as ILDCP from 'ilp-protocol-ildcp'
import * as SPSP from './lib/spsp'
import * as STREAM from 'ilp-protocol-stream'
import * as express from './extensions/express'
import { JsonInvoice, InvoiceReceiver, Invoice } from './lib/invoice'
import * as PluginApi from './lib/plugin'
import { Receipt } from './lib/receipt'
const createLogger = require('ilp-logger')
const log = createLogger('ilp')

export const DEFAULT_PLUGIN_MODULE = 'ilp-plugin-btp'

/**
 * Create an instance of an ILP plugin
 *
 * This functions loads an instance of an ILP plugin.
 *
 * The constructor options and module name can be passed to the function as parameters.
 * If no parameters are provided then it willattempt to find the config in environment variables.
 * If these are not found it will load a plugin connected to a local moneyd instance on port 7768.
 *
 * The Environment variables that can be set are:
 *  - ILP_PLUGIN : The name/path of the plugin module
 *  - ILP_PLUGIN_OPTIONS : The options passed to the constructor, serialized as a JSON object.
 *
 * This function replaces the module 'ilp-plugin' which has been deprecated.
 *
 * Example 1: Explicit config
 *
 * ```js
 * const plugin = createPlugin({ "server" : "btp+ws://myname:0a0cfd180fb5a5d32ebdf5344ce9c076@localhost:7768" })
 * ```
 *
 * Example 2: Config from env
 *
 * ```sh
 *  $ ILP_PLUGIN="ilp-plugin-btp" \
 *    ILP_PLUGIN_OPTIONS="{\"server\":\"btp+ws://myname:0a0cfd180fb5a5d32ebdf5344ce9c076@localhost:7768\"}" \
 *    node app.js
 * ```
 *
 * Where `app.js` has the following:
 *
 * ```js
 * const plugin = createPlugin()
 * ```
 * @param {*} pluginOptions The options passed to the plugin constructor
 * @param {*} pluginModuleName The module name of the plugin, defaults to `ilp.DEFAULT_PLUGIN_MODULE`
 */
function createPlugin (pluginOptions?: any, pluginModuleName: string = DEFAULT_PLUGIN_MODULE): PluginApi.PluginV2 {
  const envModuleName = process.env.ILP_PLUGIN || DEFAULT_PLUGIN_MODULE
  const envOptions = process.env.ILP_PLUGIN_OPTIONS || process.env.ILP_CREDENTIALS

  const moduleName = pluginModuleName || envModuleName
  let options = envOptions ? JSON.parse(envOptions) : {}

  // TODO: Deprecated behaviour can be removed in future
  if (process.env.ILP_CREDENTIALS && !process.env.ILP_PLUGIN_OPTIONS) {
    log.warn(`Loading options from environment var ILP_CREDENTIALS is deprecated, use ILP_PLUGIN_OPTIONS instead.`)
  }

  // Replicate behaviour of 'ilp-module' for backwards compatability
  // TODO: Deprecated behaviour can be removed in future
  if (moduleName === 'ilp-plugin-btp') {
    const name = (pluginOptions && pluginOptions.name) || ''
    if (name) {
      log.warn(`'pluginOptions.name' is deprecated. ` +
        `Please provide the correct options for the plugin. ` +
        `Example: '{ "server" : "btp+ws://<name>:<secret>@localhost:7768" }'`)
    } else {
      if (pluginOptions) {
        options = pluginOptions
      }
    }
    if (Object.keys(options).length === 0) {
      options.server = `btp+ws://${name}:${crypto.randomBytes(16).toString('hex')}@localhost:7768`
    }
  } else {
    options = pluginOptions
  }

  const Plugin = require(moduleName)
  return new Plugin(options) as PluginApi.PluginV2
}

/**
 * Get the dynamic configuration provided for a plugin from the upstream server
 *
 * @param plugin The plugin used to connect to the upstream service
 */
async function fetchConfig (plugin: PluginApi.PluginV2): Promise<ILDCP.IldcpResponse> {
  if (!plugin.isConnected) {
    throw Error('Plugin must be connected to get config.')
  }
  return ILDCP.fetch(plugin.sendData.bind(plugin))
}

/**
 * Create a new `Invoice` that is paid when a specific amount is received.
 *
 * This will create or use a STREAM Server to generate an ILP Address and secret for the sender to use.
 * These are returned as properties of the `Invoice`.
 *
 * Calling `receivePayment()` on the invoice returns a promise that will resolve with the actual amount received,
 * or reject if it times out.
 *
 * @param {*} amount The amount to receive
 * @param {*} reference The payment reference
 * @param {*} pluginOrServer The plugin to use to receive payments or an existing STREAM server to use
 */
async function receive (amount: BigNumber.Value, reference: string, pluginOrServer: PluginApi.PluginV2 | STREAM.Server = createPlugin()) {

  const server = (pluginOrServer instanceof STREAM.Server)
    ? pluginOrServer
    : await STREAM.createServer({ plugin : pluginOrServer })

  return new InvoiceReceiver(amount, reference, server)
}

type PaymentPointerAndAmount = { amount: BigNumber.Value, paymentPointer: string }

/**
 */
async function pay (payee: PaymentPointerAndAmount | Invoice, plugin: PluginApi.PluginV2 = createPlugin()): Promise<Receipt> {

  const paymentPointerReceiver = payee as PaymentPointerAndAmount
  if (paymentPointerReceiver.paymentPointer) {
    return SPSP.pay(plugin, {
      receiver: paymentPointerReceiver.paymentPointer,
      sourceAmount: paymentPointerReceiver.amount
    })
  } else {
    const { destinationAccount, sharedSecret, amount } = payee as Invoice
    const connection = await STREAM.createConnection({
      destinationAccount,
      plugin,
      sharedSecret
    })

    const stream = connection.createStream()
    await stream.sendTotal(amount)
    await connection.end()
    return {
      sourceAccount: connection.sourceAccount,
      destinationAccount: destinationAccount,
      sent: {
        amount: new BigNumber(connection.totalSent),
        assetCode: connection.sourceAssetCode,
        assetScale: connection.sourceAssetScale
      },
      received: {
        amount: new BigNumber(connection.totalDelivered),
        assetCode: connection.destinationAssetCode,
        assetScale: connection.destinationAssetScale
      }
    }
  }
}

export {
  ILDCP, // ILDCP Protocol module
  STREAM, // STREAM Protocol module
  SPSP, // SPSP Protocol module
  PluginApi, // Plugin API types
  express, // express extensions
  InvoiceReceiver, // a receiver invoice
  JsonInvoice, // JSON serialized invoice (used in SPSP response)
  Receipt, // a receipt with the details of a completed payment
  createLogger, // utility logging function
  createPlugin, // utility plugin initializer
  fetchConfig, // Use ILDCP to get the config for a plugin
  receive, // receive a payment (creates an invoice)
  pay // make a payment
}
