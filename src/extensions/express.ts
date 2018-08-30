import { createPlugin, PluginV2, STREAM, SPSP } from '..'
import { RequestHandler } from 'express'

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
 * const ilp = require('ilp')
 *  const app = require('express')()
 *  ilp.createSpspMiddleware({receiver_info:{name: 'Bob Smith'}}).then(spsp => {
 *    app.get('/.well-known/pay', (req, resp) => {
 *      const {contentType, body} = spsp()
 *      resp.set('Content-Type', contentType)
 *      resp.send(body)
 *    })
 *    app.listen(3000)
 *  })
 * ```
 * Example: To use with Koa
 *
 * ```
 * const ilp = require('ilp')
 * const Koa = require('koa')
 * const app = new Koa()
 * const middleware = ilp.createSpspMiddleware({receiver_info:{name: 'Bob Smith'}})
 *
 * app.use(async ctx => {
 *   const spsp = await middleware
 *   const {contentType, body} = spsp()
 *   ctx.set('Content-Type', contentType)
 *   ctx.body = body
 * })
 * app.listen(3000)
 * ```
 * @param {*} responseTemplate The object that will be returned in the SPSP response.
 * @param {*} plugin The plugin to use to receive payments
 */
export async function createMiddleware (
  responseTemplate?: SPSP.JsonSpspResponse,
  plugin: PluginV2 = createPlugin()): Promise<RequestHandler> {

  const server = await STREAM.createServer({ plugin })

  return (req, rsp) => {
    const { destinationAccount, sharedSecret } = server.generateAddressAndSecret()
    rsp.set('Content-Type', SPSP.CONTENT_TYPE)

    const balance = (req.query.amount) ? {
      current: '0',
      maximum: `${req.query.amount}`
    } : undefined

    rsp.send({
      ...responseTemplate,
      destination_account: destinationAccount,
      shared_secret: sharedSecret.toString('base64'),
      balance
    })
  }
}
