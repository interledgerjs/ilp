const crypto = require('crypto')
const IlpPacket = require('ilp-packet')
const IlDcp = require('ilp-protocol-ildcp')

function sha256 (preimage) {
  return crypto.createHash('sha256').update(preimage).digest()
}

class Loop {
  constructor ({ pluginOut, pluginIn, destination }) {
    this.pending = {}
    this.destination = destination
    this.pluginOut = pluginOut
    this.pluginIn = pluginIn
    this.pluginIn.registerDataHandler(this._loopbackPrepareHandler.bind(this))
  }

  async _loopbackPrepareHandler (packet) {
    const { amount, executionCondition } = IlpPacket.deserializeIlpPrepare(packet)
    if (this.pending[executionCondition]) {
      const shouldFulfill = await this.pending[executionCondition].loopbackHandler(amount)
      if (shouldFulfill) {
        const fulfillment = this.pending[executionCondition].fulfillment
        return IlpPacket.serializeIlpFulfill({ fulfillment, data: Buffer.from([]) })
      }
    }
    return IlpPacket.serializeIlpReject({
      code: 'F04',
      triggeredBy: this.destination,
      message: 'Insufficient destination amount',
      data: Buffer.from([])
    })
  }

  async pay ({ sourceAmount, expiresAt, loopbackHandler }) {
    const fulfillment = crypto.randomBytes(32)
    const executionCondition = sha256(fulfillment)
    const packet = IlpPacket.serializeIlpPrepare({
      amount: sourceAmount,
      expiresAt,
      executionCondition,
      destination: this.destination,
      data: Buffer.from([])
    })
    this.pending[executionCondition] = { fulfillment, loopbackHandler }
    const resultPacket = await this.pluginOut.sendData(packet)
    delete this.pending[executionCondition]
    const result = IlpPacket.deserializeIlpPacket(resultPacket)
    return (result.typeString === 'ilp_fulfill')
  }
}

async function createLoop ({ pluginOut, pluginIn }) {
  // use il-dcp on pluginIn to determine the loopback address:
  const req = IlDcp.serializeIldcpRequest()
  const resBuf = await pluginIn.sendData(req)
  const destination = IlDcp.deserializeIldcpResponse(resBuf).clientAddress

  return new Loop({ pluginOut, pluginIn, destination })
}

module.exports = {
  createLoop
}
