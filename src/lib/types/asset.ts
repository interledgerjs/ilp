import BigNumber from 'bignumber.js'
import { AssetInfo } from 'ilp-module-loader'

/**
 * An amount of an asset including the amount and asset info.
 *
 * To get a normalized amount the amount is multiplied by 10^(-scale)
 */
export interface AssetAmount {
  amount: BigNumber
  assetInfo?: AssetInfo
}

/**
 * An asset amount, modifed for JSON serialization by converting all property names to snake-case
 */
export interface JsonAssetAmount {
  amount: string
  asset_info?: AssetInfo
}

export function serializeAssetAmount (assetAmount: AssetAmount): JsonAssetAmount {
  // tslint:disable-next-line:variable-name
  const asset_info = (assetAmount.assetInfo) || undefined
  return {
    amount: assetAmount.amount.toString(),
    asset_info
  }
}

export function deserializeAssetAmount (assetAmount: JsonAssetAmount): AssetAmount {
  // tslint:disable-next-line:variable-name
  const assetInfo = (assetAmount.asset_info) || undefined
  return {
    amount: new BigNumber(assetAmount.amount),
    assetInfo
  }
}

/**
 * Takes an asset amount object and normalizes it to a string
 *
 * @param assetAmount the asset amount to normalize
 */
export function normalizeAmount (assetAmount: AssetAmount) {
  if (assetAmount.assetInfo) {
    const value = assetAmount.amount.shiftedBy(-(assetAmount.assetInfo.scale))
    return `${value.toString()} ${assetAmount.assetInfo.code}`
  }
  return `${assetAmount.amount} units`
}
