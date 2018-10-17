import BigNumber from 'bignumber.js'
import * as ILDCP from 'ilp-protocol-ildcp'
import * as STREAM from 'ilp-protocol-stream'
import { AssetInfo, ModuleConstructorOptions, ModuleServices, IlpPlugin, IlpLogger, createLogger, createPlugin, PluginConnectOptions, IlpBackend, createBackend, DataHandler, MoneyHandler } from 'ilp-module-loader'
import { Invoice } from './types/invoice'
import { Receipt } from './types/receipt'
import { Payee } from './types/payee'
import * as SPSP from './spsp'
import { EventEmitter } from 'events'

export interface ClientOptions extends ModuleConstructorOptions {
  slippage?: BigNumber
  minExchangeRatePrecision?: number
  idleTimeout?: number
}

export interface ClientConnectOptions extends PluginConnectOptions {
  payee?: Payee | Invoice
  paymentPointer?: string
}

export interface ClientConnectResponse {
  amountRequested?: BigNumber
  remoteName?: string
  remoteImageUrl?: string
  reference?: string
}

export interface ClientServices extends ModuleServices {
  plugin?: IlpPlugin
  backend?: IlpBackend
}

export class Client extends EventEmitter implements Payee, IlpPlugin {

  protected _log: IlpLogger
  protected _plugin: IlpPlugin
  private _dataHandler?: DataHandler
  private _moneyHandler?: MoneyHandler
  protected _localAddress: string
  protected _localAssetInfo: AssetInfo
  protected _remoteAddress: string
  protected _remoteSecret: Buffer
  protected _remoteAssetInfo?: AssetInfo
  protected _connection?: STREAM.Connection
  protected _currentRate: BigNumber
  protected _options: ClientOptions

  constructor (options: ClientOptions, services: ClientServices) {
    super()
    this._log = (services && services.log) ? services.log : createLogger('ilp:client')
    this._plugin = (services && services.plugin) ? services.plugin : createPlugin()
    this._options = options
  }

  /**
   * Connect the client to a remote ILP address using a provided address and secret or by first looking up the details using SPSP.
   *
   * @param options Connection options
   */
  public async connect (options: ClientConnectOptions): Promise<void> {
    if (this._connection) {
      return
    }

    // Connect plugin
    if (!this._plugin.isConnected()) {
      try {
        this._log.debug('Connecting plugin...')
        await this._plugin.connect(options)
      } catch (e) {
        this._log.error(`Unable to connect plugin`)
        throw e
      }
    }

    // Get local address and asset info
    try {
      this._log.debug('Getting local address and asset info...')
      const ildcpResponse = await ILDCP.fetch(this._plugin.sendData.bind(this._plugin))
      this._localAssetInfo = {
        scale: ildcpResponse.assetScale,
        code: ildcpResponse.assetCode
      }
      this._localAddress = ildcpResponse.clientAddress
    } catch (e) {
      this._log.error(`Unable to get local address and asset info from plugin.`)
      throw e
    }

    // Gather remote details
    let reference: string | undefined
    if (options.paymentPointer) {
      try {
        this._log.debug('Querying remote details from payment pointer...')
        const spspResponse = await SPSP.query(options.paymentPointer)
        const { contentType } = spspResponse
        if (contentType.indexOf(SPSP.CONTENT_TYPE) === -1) {
          throw new Error(`Unable to connect to ${options.paymentPointer} as it does not support the STREAM protocol.`)
        }
        const invoice = SPSP.convertSpspResponse(spspResponse) as Invoice
        this._remoteAddress = invoice.destinationAccount
        this._remoteSecret = invoice.sharedSecret
        this._remoteAssetInfo = invoice.assetInfo
        reference = invoice.reference
        this.emit('data', Buffer.from(JSON.stringify(SPSP.serializeSpspResponse(spspResponse)), 'utf8'))
      } catch (e) {
        this._log.error(`Unable to get remote details from payment pointer: ${options.paymentPointer}`)
        throw e
      }
    } else if (options.payee) {
      this._remoteAddress = options.payee.destinationAccount
      this._remoteSecret = options.payee.sharedSecret
      if (options.payee.assetInfo) {
        this._remoteAssetInfo = options.payee.assetInfo
      }
      reference = (options.payee as Invoice).reference
    } else {
      throw new Error(`Invalid connect options. Not enough information provided to connect to remote payee.`)
    }

    // Create STREAM connection
    this._log.debug(`Connecting to ${this._remoteAddress}...`)
    this._connection = await STREAM.createConnection({
      destinationAccount: this._remoteAddress,
      sharedSecret: this._remoteSecret,
      plugin: this._plugin,
      connectionTag: reference,
      ...this._options
    })

    this._connection.once('close', () => {
      delete(this._connection)
    })

    this._connection.on('stream', (stream: STREAM.DataAndMoneyStream) => {

      stream.on('money', (amount) => {
        if (this._moneyHandler) {
          this._moneyHandler(amount)
        }
      })

      // TODO !!! We are not framing our messages !!!
      // This will break if the message is split over multiple chunks
      stream.on('data', (chunk) => {
        if (this._dataHandler) {
          this._dataHandler(chunk).then(reply => {
            stream.write(reply)
            stream.end()
          })
        }
      })

    })

    // Validate remote info from the connection
    if (this._connection.destinationAssetCode && this._connection.destinationAssetScale) {
      if (this._remoteAssetInfo) {
        // We already have what we believe to be correct info so let's check
        if (this._connection.destinationAssetCode &&
          (this._connection.destinationAssetCode !== this._remoteAssetInfo.code)) {
          throw new Error('Inconsistent remote asset code from connection.' +
            `provided=${this._remoteAssetInfo.code}, connection=${this._connection.destinationAssetCode}`)
        }
        if (this._connection.destinationAssetScale &&
          (this._connection.destinationAssetScale !== this._remoteAssetInfo.scale)) {
          throw new Error('Inconsistent remote asset scale from connection.' +
            `provided=${this._remoteAssetInfo.scale}, connection=${this._connection.destinationAssetScale}`)
        }
      } else {
        this._remoteAssetInfo = {
          code: this._connection.destinationAssetCode,
          scale: this._connection.destinationAssetScale
        }
      }
    }

    // TODO - In future we may not want to contiue if we don't have this info
    // if (!this._remoteAssetInfo) {
    //   throw new Error(`No remote asset info provided and unable to determine info from connection.`)
    // }

    // TODO Should we allow remote to change address?
    if (this._connection.destinationAccount) {
      if (this._remoteAddress !== this._connection.destinationAccount) {
        throw new Error('Inconsistent remote account from connection.' +
        `provided=${this._remoteAddress}, connection=${this._connection.destinationAccount}`)
      }
    }

    this._currentRate = new BigNumber(this._connection.lastPacketExchangeRate)
    this.emit('connect')
  }

  public async disconnect (): Promise<void> {
    if (!this._connection) {
      return
    }
    await this._connection.end()
    this.emit('disconnect')
  }

  public isConnected (): boolean {
    return (typeof this._connection !== 'undefined')
  }

  public async sendData (data: Buffer, timeout?: number): Promise<Buffer> {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before calling 'sendData'`)
    }
    const stream = this._connection.createStream()
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let timer: NodeJS.Timer
      if (timeout) {
        timer = setTimeout(() => {
          reject(new Error('Timed out waiting for reply'))
        }, timeout)
      }
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      stream.on('end', () => {
        if (timer) {
          clearTimeout(timer)
        }
        resolve(Buffer.concat(chunks))
      })
      stream.on('error', (e) => {
        stream.end()
        reject(e)
      })
      stream.write(data)
    })
  }

  public async sendMoney (amount: string, timeout?: number): Promise<void> {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before calling 'sendMoney'`)
    }
    const stream = this._connection.createStream()
    return stream.sendTotal(amount, { timeout })
  }
  public registerDataHandler (handler: DataHandler) {
    if (this._dataHandler) {
      throw new Error('A data handler is already registered')
    }
    this._log.debug('Registered data handler')
    this._dataHandler = handler
  }
  public deregisterDataHandler () {
    this._log.debug('Deregistered data handler')
    delete(this._dataHandler)
  }
  public registerMoneyHandler (handler: MoneyHandler) {
    if (this._moneyHandler) {
      throw new Error('A money handler is already registered')
    }
    this._log.debug('Registered money handler')
    this._moneyHandler = handler
  }
  public deregisterMoneyHandler () {
    this._log.debug('Deregistered money handler')
    delete(this._moneyHandler)
  }

  public get localAssetInfo (): AssetInfo {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before accessing 'localAssetInfo'`)
    }
    return this._localAssetInfo
  }

  public get destinationAccount (): string {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before accessing 'destinationAccount'`)
    }
    return this._remoteAddress
  }

  public get sharedSecret (): Buffer {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before accessing 'sharedSecret'`)
    }
    return this._remoteSecret
  }

  public get assetInfo (): AssetInfo | undefined {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before accessing 'assetInfo'`)
    }
    return this._remoteAssetInfo
  }

  public get currentRate (): BigNumber {
    if (!this._connection) {
      throw new Error(`Client is not connected. 'connect()' must be called before accessing 'currentRate'`)
    }
    return this._currentRate
  }

}
