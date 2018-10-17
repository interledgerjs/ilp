import { AssetAmount, JsonAssetAmount, serializeAssetAmount, deserializeAssetAmount } from './asset'

export interface JsonReceipt {
  destination_account: string
  source_account: string
  received?: JsonAssetAmount
  sent?: JsonAssetAmount
  requested?: JsonAssetAmount
}

export interface Receipt {
  destinationAccount: string
  sourceAccount: string
  received?: AssetAmount
  sent?: AssetAmount
  requested?: AssetAmount
}

export function serializeReceipt (receipt: Receipt): JsonReceipt {
  return {
    destination_account: receipt.destinationAccount,
    source_account: receipt.sourceAccount,
    received: (receipt.received) ? serializeAssetAmount(receipt.received) : undefined,
    sent: (receipt.sent) ? serializeAssetAmount(receipt.sent) : undefined,
    requested: (receipt.requested) ? serializeAssetAmount(receipt.requested) : undefined
  }
}

export function deserializeReceipt (json: JsonReceipt): Receipt {
  return {
    destinationAccount: json.destination_account,
    sourceAccount: json.source_account,
    received: (json.received) ? deserializeAssetAmount(json.received) : undefined,
    sent: (json.sent) ? deserializeAssetAmount(json.sent) : undefined,
    requested: (json.requested) ? deserializeAssetAmount(json.requested) : undefined
  }
}
