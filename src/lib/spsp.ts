import { URL } from 'url'
import fetch from 'node-fetch'
import BigNumber from 'bignumber.js'
import { Invoice } from './types/invoice'
import { JsonPayee, Payee, deserializePayee, serializePayee } from './types/payee'

export const CONTENT_TYPE = 'application/spsp4+json'

export interface JsonSpspResponse extends JsonPayee {
  balance?: {
    current: string,
    maximum: string
  }
}

export interface SpspResponse extends Payee {
  balance?: {
    current: BigNumber,
    maximum: BigNumber
  }
  contentType: string
}

export function serializeSpspResponse (response: SpspResponse): JsonSpspResponse {
  const balance = (response.balance)
  ? {
    current: response.balance.current.toString(),
    maximum: response.balance.maximum.toString()
  }
  : undefined

  return {
    ...serializePayee(response),
    balance
  }
}
export function deserializeSpspResponse (json: JsonSpspResponse, contentType: string): SpspResponse {
  const balance = (json.balance)
    ? {
      current: new BigNumber(json.balance.current),
      maximum: new BigNumber(json.balance.maximum)
    }
    : undefined
  return {
    ...deserializePayee(json),
    balance,
    contentType
  }
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

  const json = await response.json() as JsonSpspResponse
  return deserializeSpspResponse(json, response.headers.get('Content-Type') as string)
}
export function convertSpspResponse (response: SpspResponse): Invoice | Payee {
  if (response.balance) {
    const amount = response.balance.maximum.minus(response.balance.current)
    return {
      destinationAccount: response.destinationAccount,
      sharedSecret: response.sharedSecret,
      assetInfo: response.assetInfo,
      receiverInfo: response.receiverInfo,
      amount
    }
  }
  return {
    destinationAccount: response.destinationAccount,
    sharedSecret: response.sharedSecret,
    assetInfo: response.assetInfo,
    receiverInfo: response.receiverInfo
  }
}
export interface PayOptions {
  receiver: string
  maxSendAmount: BigNumber.Value
  /**
   * @deprecated Use `maxSendAmount` instead.
   */
  sourceAmount?: BigNumber.Value
  data?: Buffer
}
