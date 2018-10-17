import { Payee, JsonPayee, serializePayee, deserializePayee } from './payee'
import BigNumber from 'bignumber.js'

export interface JsonInvoice extends JsonPayee {
  amount: string
  reference?: string
}

export interface Invoice extends Payee {
  amount: BigNumber
  reference?: string
}

export function serializeInvoice (invoice: Invoice): JsonInvoice {
  const reference = invoice.reference
  const amount = invoice.amount.toString()
  return {
    ...serializePayee(invoice),
    amount,
    reference
  }
}

export function deserializeInvoice (json: JsonInvoice): Invoice {
  const amount = new BigNumber(json.amount)
  const reference = json.reference
  return {
    ...deserializePayee(json),
    amount,
    reference
  }
}
