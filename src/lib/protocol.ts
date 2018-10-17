import { Client } from './client'
import BigNumber from 'bignumber.js'
import { Invoice } from '.'

export async function payFixedSendAmount (client: Client, sendAmount: BigNumber, minReceiveAmount?: BigNumber) {
  // TODO Get rate and calc allowable slippage (given min receive amount)

  // Send and report delivered amount
  await client.sendMoney(sendAmount.toString())
}

export async function payFixedReceiveAmount (client: Client, maxSendAmount: BigNumber, receiveAmount: BigNumber) {
  const reply = await client.sendData(Buffer.from('Some Invoice format'))
  // if (deserialize(reply).response
  // throw new Error('Not Implemented')
}

export function payInvoice (maxSendAmount: BigNumber, invoice: Invoice | string) {
  throw new Error('Not Implemented')
}
