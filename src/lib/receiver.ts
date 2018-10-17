import * as assert from 'assert'
import BigNumber from 'bignumber.js'
import * as crypto from 'crypto'
import { Connection as StreamConnection, Server as StreamServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import { Receipt } from './types/receipt'
import { UnwrappedPromise } from './util/unwrapped-promise'
import { serializeInvoice, JsonInvoice, Invoice } from './types/invoice'
import { AssetInfo, createLogger } from 'ilp-module-loader'
const log = createLogger('ilp::Receiver')
export const DEFAULT_RECEIVE_MAX = '18446744073709551615'

/**
 * A Receiver is a stateful instance of an Invoice or Payee.
 *
 * It is created and bound to a STREAM server where it listens for an incoming connection with the correct
 * reference.
 *
 * Once established it tracks the incoming stream of money until it has received the expected amount or the
 * connection is closed.
 *
 * Calling `receive()` returns a Promise that resolves with the `Receipt` and any data sent over the connection or
 * rejects if the amount is not received before the timeout.
 */
export class Receiver implements Invoice {

  protected _amount: BigNumber
  protected _assetScale: number
  protected _assetCode: string
  protected _destinationAccount: string
  protected _sharedSecret: Buffer
  protected _connectionTag: string
  protected _receivedData: Buffer
  protected _receivedMoney: BigNumber
  protected _receivePromise: UnwrappedPromise<[Receipt, Buffer]>
  protected _timer?: NodeJS.Timer
  protected _streamConnection?: StreamConnection
  protected _completed = false

  constructor (streamServer: StreamServer, amount: BigNumber.Value = DEFAULT_RECEIVE_MAX, reference = crypto.randomBytes(16).toString('hex')) {
    assert(/^[A-Za-z0-9~_-]*$/.test(reference), 'Reference can only contain valid ILP Address characters.')
    this._amount = new BigNumber(amount)
    this._receivedMoney = new BigNumber(0)
    this._connectionTag = reference
    const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(this._connectionTag)
    this._assetCode = streamServer.assetCode
    this._assetScale = streamServer.assetScale
    this._destinationAccount = destinationAccount
    this._sharedSecret = sharedSecret
    this._receivedData = Buffer.alloc(0)
    this._receivePromise = new UnwrappedPromise<[Receipt, Buffer]>()

    streamServer.on('connection', (connection: StreamConnection) => {

      // Only track connections with the correct tag
      if (connection.connectionTag === this._connectionTag) {
        log.debug(`incoming connection. tag=${connection.connectionTag}`)
        this._streamConnection = connection

        connection.on('stream', (stream: DataAndMoneyStream) => {
          log.debug(`incoming stream created`)
          stream.setReceiveMax(this._amount)
          stream.on('money', (amountReceived) => {
            this._receivedMoney = this._receivedMoney.plus(amountReceived)
            log.trace(`${amountReceived} received, ${this._receivedMoney} in total so far`)
            if (this._receivedMoney.isGreaterThanOrEqualTo(this._amount)) {
              log.debug(`finished. Received ${this._receivedMoney} `)
              this._complete()
            }
          })
          stream.on('data', (chunk: Buffer) => {
            log.trace(`${chunk.byteLength} bytes of data received`)
            // TODO - Could be more efficient
            this._receivedData = Buffer.concat([this._receivedData, chunk])
          })
          stream.on('end', () => {
            log.debug(`finished. Stream ended. Received ${this._receivedMoney}`)
            this._complete()
          })
        })
      }

      connection.on('close', () => {
        log.debug(`finished. Connection closed by remote. Received ${this._receivedMoney}`)
        this._complete()
      })
    })
  }

  public get destinationAccount (): string {
    return this._destinationAccount
  }

  public get sharedSecret (): Buffer {
    return this._sharedSecret
  }

  public get amount (): BigNumber {
    return this._amount
  }
  public get assetInfo (): AssetInfo {
    return {
      scale: this._assetScale,
      code: this._assetCode
    }
  }

  public get reference (): string {
    return this._connectionTag
  }

  public toJSON (): JsonInvoice {
    return serializeInvoice(this)
  }

  public receive (timeout?: number): Promise<[Receipt, Buffer]> {
    if (timeout) {
      this._timer = setTimeout(() => {
        this._timeout()
      }, timeout)
    }
    return this._receivePromise.promise
  }

  public end () {
    this._complete()
  }

  protected _complete () {
    if (this._completed) {
      return
    }
    this._completed = true

    if (this._timer) {
      clearTimeout(this._timer)
    }
    if (this._streamConnection) {
      const requested = (this._amount.isEqualTo(DEFAULT_RECEIVE_MAX))
        ? undefined
        : {
          amount: this._amount,
          assetCode: this._streamConnection.sourceAssetCode,
          assetScale: this._streamConnection.sourceAssetScale
        }
      this._receivePromise.resolve([{
        sourceAccount: this._streamConnection.destinationAccount,
        destinationAccount: this._streamConnection.sourceAccount,
        received: {
          amount: this._receivedMoney,
          assetCode: this._streamConnection.sourceAssetCode,
          assetScale: this._streamConnection.sourceAssetScale
        },
        requested
      } as Receipt,
        this._receivedData
      ])
      this._streamConnection.end().catch(e => {
        log.error('Error closing connection after payment was completed.', e)
      })
    } else {
      const error = new Error('No incoming STREAM connection.')
      this._receivePromise.reject(error)
    }
  }

  protected _timeout () {
    const error = (this._streamConnection)
    ? new Error(`Timed out waiting for payment. ` +
      `Received ${this._streamConnection.totalReceived} payment ` +
      `and ${this._receivedData.byteLength} bytes of data so far.`)
    : new Error(`Timed out waiting for connection. `)

    this._receivePromise.reject(error)
    if (this._streamConnection) {
      this._streamConnection.end().catch(e => {
        log.error('Error closing connection after payment timed out.', e)
      })
    }
  }
}
