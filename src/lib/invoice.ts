import BigNumber from 'bignumber.js'
import * as crypto from 'crypto'
import { STREAM, Receipt } from '..'
import { UnwrappedPromise } from './promise'
import * as assert from 'assert'
const createLogger = require('ilp-logger')
const log = createLogger('invoice')

export interface JsonInvoice {
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

export interface Payee {
  destinationAccount: string,
  sharedSecret: Buffer,
}

export interface Invoice extends Payee {
  amount: BigNumber,
  assetScale?: number,
  assetCode?: string
}

export class InvoiceReceiver implements Invoice {

  private _expectedAmount: BigNumber
  private _assetScale: number
  private _assetCode: string
  private _destinationAccount: string
  private _sharedSecret: Buffer
  private _connectionTag: string
  private _receivedData: Buffer
  private _paymentPromise: UnwrappedPromise<Receipt>
  private _dataPromise: UnwrappedPromise<Buffer>
  private _timer?: NodeJS.Timer
  private _streamConnection?: STREAM.Connection

  constructor (amount: BigNumber.Value, reference = crypto.randomBytes(16).toString('hex'), streamServer: STREAM.Server) {
    assert(/^[A-Za-z0-9~_-]*$/.test(reference), 'Reference can only contain valid ILP Address characters.')
    this._connectionTag = reference
    const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(this._connectionTag)
    this._expectedAmount = new BigNumber(amount)
    this._assetCode = streamServer.assetCode
    this._assetScale = streamServer.assetScale
    this._destinationAccount = destinationAccount
    this._sharedSecret = sharedSecret
    this._receivedData = Buffer.alloc(0)
    this._dataPromise = new UnwrappedPromise<Buffer>()
    this._paymentPromise = new UnwrappedPromise<Receipt>()

    streamServer.on('connection', (connection: STREAM.Connection) => {
      if (connection.connectionTag === this._connectionTag) {
        log.debug(`connection opened`)
        this._streamConnection = connection
        connection.on('stream', (stream: STREAM.DataAndMoneyStream) => {
          log.debug(`stream created`)
          stream.setReceiveMax(this._expectedAmount)
          stream.on('money', (amountReceived) => {
            log.trace(`${amountReceived} received`)
            if (new BigNumber(connection.totalReceived).isGreaterThanOrEqualTo(this._expectedAmount)) {
              this._complete()
            }
          })
          stream.on('data', (dataReceived) => {
            log.trace(`${(dataReceived as Buffer).byteLength} bytes of data received`)
            this._receivedData = Buffer.concat([this._receivedData, dataReceived as Buffer])
          })
          stream.on('end', () => {
            log.debug(`stream ended`)
            this._complete()
          })
        })
      }
    })
  }

  public get destinationAccount (): string {
    return this._destinationAccount
  }

  public get sharedSecret (): Buffer {
    return this._sharedSecret
  }

  public get amount (): BigNumber {
    return this._expectedAmount
  }

  public get assetScale (): number {
    return this._assetScale
  }
  public get assetCode (): string {
    return this._assetCode
  }

  public toJSON (): JsonInvoice {
    return serializePayee(this)
  }

  public receiveData (): Promise<Buffer> {
    return this._dataPromise.promise
  }

  public receivePayment (timeout?: number): Promise<Receipt> {
    if (timeout) {
      this._timer = setTimeout(() => {
        this._timeout()
      }, timeout)
    }
    return this._paymentPromise.promise
  }

  private _complete () {
    if (this._timer) {
      clearTimeout(this._timer)
    }
    if (this._streamConnection) {
      this._paymentPromise.resolve({
        sourceAccount: this._streamConnection.destinationAccount,
        destinationAccount: this._streamConnection.sourceAccount,
        received: {
          amount: this._streamConnection.totalReceived,
          assetCode: this._streamConnection.sourceAssetCode,
          assetScale: this._streamConnection.sourceAssetScale
        },
        requested: {
          amount: this._expectedAmount,
          assetCode: this._streamConnection.sourceAssetCode,
          assetScale: this._streamConnection.sourceAssetScale
        }
      } as Receipt)
      this._dataPromise.resolve(this._receivedData)
      this._streamConnection.end().catch(e => {
        log.error('Error closing connection after payment was completed.', e)
      })
    } else {
      const error = new Error('No incoming STREAM connection.')
      this._paymentPromise.reject(error)
      this._dataPromise.reject(error)
    }
  }

  private _timeout () {
    const error = (this._streamConnection)
    ? new Error(`Timed out waiting for payment. ` +
      `Received ${this._streamConnection.totalReceived} payment ` +
      `and ${this._receivedData.byteLength} bytes of data so far.`)
    : new Error(`Timed out waiting for connection. `)

    this._paymentPromise.reject(error)
    this._dataPromise.reject(error)
    if (this._streamConnection) {
      this._streamConnection.end().catch(e => {
        log.error('Error closing connection after payment timed out.', e)
      })
    }
  }

}

export function serializePayee (receiver: Invoice | Payee): JsonInvoice {

  const invoice = receiver as Invoice
  const balance = (invoice.amount)
    ? {
      current: '0',
      maximum: invoice.amount.toString()
    }
    : undefined

  // tslint:disable-next-line:variable-name
  const asset_info = (invoice.assetCode && invoice.assetScale)
    ? {
      code: invoice.assetCode,
      scale: invoice.assetScale
    }
    : undefined

  return {
    destination_account: invoice.destinationAccount,
    shared_secret: invoice.sharedSecret.toString('base64'),
    balance,
    asset_info
  }
}
