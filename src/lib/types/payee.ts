import { AssetInfo } from 'ilp-module-loader'

/**
 * A recipient of an ILP payment
 */
export interface Payee {
  destinationAccount: string
  sharedSecret: Buffer
  assetInfo?: AssetInfo
  receiverInfo?: {
    name?: string
    imageUrl?: string
  }
}

export interface JsonPayee {
  destination_account: string
  shared_secret: string
  asset_info?: {
    code: string,
    scale: number
  }
  receiver_info?: {
    name?: string,
    image_url?: string
  }
}

export function serializePayee (payee: Payee): JsonPayee {

  // tslint:disable-next-line:variable-name
  const asset_info = payee.assetInfo || undefined

  // tslint:disable-next-line:variable-name
  const receiver_info = (payee.receiverInfo)
    ? {
      name: payee.receiverInfo.name,
      image_url: payee.receiverInfo.imageUrl
    }
    : undefined

  return {
    destination_account: payee.destinationAccount,
    shared_secret: payee.sharedSecret.toString('base64'),
    asset_info,
    receiver_info
  }
}

export function deserializePayee (json: JsonPayee): Payee {

  const assetInfo = json.asset_info || undefined
  const receiverInfo = (json.receiver_info)
    ? {
      name: json.receiver_info.name,
      imageUrl: json.receiver_info.image_url
    } : undefined

  return {
    destinationAccount: json.destination_account,
    sharedSecret: Buffer.from(json.shared_secret, 'base64'),
    assetInfo,
    receiverInfo
  }
}
