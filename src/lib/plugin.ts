
import { EventEmitter } from 'events'
export interface FunctionWithVersion extends Function {
  version?: number
}

export type DataHandler = (data: Buffer) => Promise<Buffer>

export type MoneyHandler = (amount: string) => Promise<void>

export interface PluginV2 extends EventEmitter {
  constructor: FunctionWithVersion
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean
  sendData: DataHandler
  sendMoney: MoneyHandler
  registerDataHandler: (handler: DataHandler) => void
  deregisterDataHandler: () => void
  registerMoneyHandler: (handler: MoneyHandler) => void
  deregisterMoneyHandler: () => void
}
