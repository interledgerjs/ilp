// ILDCP Protocol + convenience function
import * as ILDCP from 'ilp-protocol-ildcp'
export { ILDCP }

// STREAM Protocol module
import * as STREAM from 'ilp-protocol-stream'
export { STREAM }

// SPSP Protocol module
import * as SPSP from './spsp'
export { SPSP }

// middleware extensions
import * as express from './extensions/express'
export { express }

// Types and serialization functions
import { JsonInvoice, Invoice, serializeInvoice, deserializeInvoice } from './types/invoice'
import { JsonPayee, Payee, serializePayee, deserializePayee } from './types/payee'
import { JsonAssetAmount, AssetAmount, serializeAssetAmount, deserializeAssetAmount, normalizeAmount } from './types/asset'
import { JsonReceipt, Receipt, serializeReceipt, deserializeReceipt } from './types/receipt'
import { Receiver, DEFAULT_RECEIVE_MAX } from './receiver'
export {
  JsonInvoice, Invoice, serializeInvoice, deserializeInvoice,
  JsonPayee, Payee, serializePayee, deserializePayee,
  JsonAssetAmount, AssetAmount, serializeAssetAmount, deserializeAssetAmount, normalizeAmount,
  JsonReceipt, Receipt, serializeReceipt, deserializeReceipt,
  Receiver, DEFAULT_RECEIVE_MAX
}

export {
  Client, ClientConnectOptions, ClientConnectResponse, ClientOptions, ClientServices
} from './client'
