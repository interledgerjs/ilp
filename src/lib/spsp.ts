import { createConnection } from 'ilp-protocol-stream'
import { URL } from 'url'
import fetch from 'node-fetch'
import { PluginV2 } from './plugin'
import BigNumber from 'bignumber.js'

export const CONTENT_TYPE = 'application/spsp4+json'
export interface JsonSpspResponse {
  destination_account: string
  shared_secret: string
  balance?: {
    maximum: string,
    current: string
  }
  asset_info?: {
    code: string,
    scale: number
  }
  receiver_info?: {
    name?: string,
    image_url?: string
  }
}

export interface SpspResponse {
  destinationAccount: string
  sharedSecret: Buffer
  balance?: {
    maximum: string,
    current: string
  }
  assetInfo?: {
    code: string,
    scale: number
  }
  receiverInfo?: {
    name?: string,
    imageUrl?: string
  }
  contentType: string
}

export async function query (receiver: string): Promise<SpspResponse> {

  // TODO: further validation required on payment-pointer?
  const endpoint = new URL(receiver.startsWith('$')
    ? 'https://' + receiver.substring(1)
    : receiver)

  endpoint.pathname = (endpoint.pathname === '/')
    ? '/.well-known/pay'
    : endpoint.pathname

  // TODO: make sure that this fetch can never crash this node process. because
  // this could be called from autonomous code, that would pose big problems.
  const response = await fetch(endpoint.href, {
    headers: { accept: CONTENT_TYPE }
  })

  if (response.status !== 200) {
    throw new Error('Got error response from spsp receiver.' +
      ' endpoint="' + endpoint.href + '"' +
      ' status=' + response.status +
      ' message="' + (await response.text()) + '"')
  }

  const json = await response.json()

  return {
    destinationAccount: json.destination_account,
    sharedSecret: Buffer.from(json.shared_secret, 'base64'),
    balance: json.balance,
    assetInfo: json.ledger_info,
    receiverInfo: json.receiver_info,
    contentType: response.headers.get('Content-Type') as string
  }
}

export interface PayOptions {
  receiver: string,
  sourceAmount: BigNumber.Value,
  data?: Buffer
}

export interface PayResult {
  sent: BigNumber.Value,
  received: BigNumber.Value,
  requested?: BigNumber.Value
}

export async function pay (plugin: PluginV2, options: PayOptions): Promise<PayResult> {
  const { receiver, sourceAmount, data } = options
  const pluginWasConnected = plugin.isConnected
  const [ response ] = await Promise.all([
    query(receiver),
    plugin.connect()
  ])

  const { destinationAccount, sharedSecret, contentType, balance } = response

  if (contentType.indexOf(CONTENT_TYPE) !== -1) {

    const streamConnection = await createConnection({
      plugin,
      destinationAccount,
      sharedSecret
    })

    const stream = streamConnection.createStream()
    if (data) {
      stream.write(data)
    }
    await Promise.race([
      stream.sendTotal(sourceAmount).then(() => stream.end()),
      new Promise(resolve => stream.on('end', resolve))
    ])

    const requested = (balance)
    ? new BigNumber(balance.maximum).minus(new BigNumber(balance.current))
    : undefined

    await streamConnection.end()

    if (!pluginWasConnected) {
      await plugin.disconnect()
    }

    return {
      sent: new BigNumber(streamConnection.totalSent),
      received: new BigNumber(streamConnection.totalDelivered),
      requested
    }
  } else {
    throw new Error(`Unable to send to ${receiver} as it does not support the STREAM protocol.`)
  }
}
