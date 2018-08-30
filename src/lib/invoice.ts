import BigNumber from 'bignumber.js'
import * as crypto from 'crypto'
import { STREAM } from '..'
import { UnwrappedPromise } from './promise'
const createLogger = require('ilp-logger')
const log = createLogger('invoice')

export class Invoice {

  private expectedAmount: BigNumber
  private ilpAddress: string
  private sharedSecret: Buffer
  private connectionTag: string
  private receivedData: Buffer
  private paymentPromise: UnwrappedPromise<BigNumber>
  private dataPromise: UnwrappedPromise<Buffer>
  private timer?: NodeJS.Timer
  private streamConnection?: STREAM.Connection

  constructor (amount: BigNumber.Value, streamServer: STREAM.Server) {
    this.connectionTag = crypto.randomBytes(16).toString('hex')
    const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret(this.connectionTag)
    this.expectedAmount = new BigNumber(amount)
    this.ilpAddress = destinationAccount
    this.sharedSecret = sharedSecret
    this.receivedData = Buffer.alloc(0)
    this.dataPromise = new UnwrappedPromise<Buffer>()
    this.paymentPromise = new UnwrappedPromise<BigNumber>()

    streamServer.on('connection', (connection: STREAM.Connection) => {
      if (connection.connectionTag === this.connectionTag) {
        log.debug(`connection opened`)
        this.streamConnection = connection
        connection.on('stream', (stream: STREAM.DataAndMoneyStream) => {
          log.debug(`stream created`)
          stream.setReceiveMax(amount)
          stream.on('money', (amountReceived) => {
            log.trace(`${amountReceived} received`)
            if (new BigNumber(connection.totalReceived).isGreaterThanOrEqualTo(this.expectedAmount)) {
              this._complete()
            }
          })
          stream.on('data', (dataReceived) => {
            log.trace(`${(dataReceived as Buffer).byteLength} bytes of data received`)
            this.receivedData = Buffer.concat([this.receivedData, dataReceived as Buffer])
          })
          stream.on('end', () => {
            log.debug(`stream ended`)
            this._complete()
          })
        })
      }
    })
  }

  public get address (): string {
    return this.ilpAddress
  }

  public get secret (): Buffer {
    return this.sharedSecret
  }

  public get data (): Promise<Buffer> {
    return this.dataPromise.promise
  }

  public receivePayment (timeout?: number): Promise<BigNumber> {
    if (timeout) {
      this.timer = setTimeout(() => {
        this._timeout()
      }, timeout)
    }
    return this.paymentPromise.promise
  }

  private _complete () {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    if (this.streamConnection) {
      const received = new BigNumber(this.streamConnection.totalReceived)
      this.paymentPromise.resolve(received)
      this.dataPromise.resolve(this.receivedData)
      this.streamConnection.end().catch(e => {
        log.error('Error closing connection after payment was completed.')
      })
    } else {
      const error = new Error('No incoming STREAM connection.')
      this.paymentPromise.reject(error)
      this.dataPromise.reject(error)
    }
  }

  private _timeout () {
    const error = (this.streamConnection)
    ? new Error(`Timed out waiting for payment. ` +
      `Received ${this.streamConnection.totalReceived} payment ` +
      `and ${this.receivedData.byteLength} bytes of data so far.`)
    : new Error(`Timed out waiting for connection. `)

    this.paymentPromise.reject(error)
    this.dataPromise.reject(error)
    if (this.streamConnection) {
      this.streamConnection.end().catch(e => {
        log.error('Error closing connection after payment timed out.', e)
      })
    }
  }
}
