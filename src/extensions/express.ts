import { createPlugin, JsonInvoice, PluginApi, STREAM, SPSP, receive, InvoiceReceiver } from '..'
import { RequestHandler } from 'express'
import { serializePayee } from '../lib/invoice'

/**
 * Get a simple middleware function that will return an SPSP response to any request.
 *
 * The function creates a STREAM server using the provided plugin and each time the middleware is called it
 * generates a new address and secret and adds these to the default response.
 *
 * If the middleware is called with a `receiveAmount` then the balance property is set.
 *
 * The `destination_account` and `shared_secret` should not be set on the
 * `defaultResponse` as these will be overwritten.
 *
 * Example: To use with express
 *
 * ```js
 *  const ilp = require('ilp')
 *  const app = require('express')()
 *  ilp.createMiddleware({receiver_info:{name: 'Bob Smith'}}).then(spsp => {
 *    app.get('/.well-known/pay', (req, resp) => {
 *      const {contentType, body} = spsp()
 *      resp.set('Content-Type', contentType)
 *      resp.send(body)
 *    })
 *    app.listen(3000)
 *  })
 * ```
 * @param {*} responseTemplate The object that will be returned in the SPSP response.
 * @param {*} plugin The plugin to use to receive payments
 */
export async function createMiddleware (
  responseTemplate?: JsonInvoice,
  plugin: PluginApi.PluginV2 = createPlugin()): Promise<RequestHandler> {

  const server = await STREAM.createServer({ plugin })

  return (req, rsp) => {

    const reference = req.query.reference || undefined

    const payee = (req.query.amount && !isNaN(+req.query.amount))
      ? new InvoiceReceiver(+req.query.amount, reference, server)
      : server.generateAddressAndSecret(reference)

    const jsonPayee = serializePayee(payee)

    rsp.set('Content-Type', SPSP.CONTENT_TYPE)
    rsp.send({
      ...responseTemplate,
      ...jsonPayee
    })
  }
}
