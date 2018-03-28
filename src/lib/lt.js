const crypto = require('crypto')
const IlpPacket = require('ilp-packet')
const IlDcp = require('ilp-protocol-ildcp')

function sha256 (preimage) {
  return crypto.createHash('sha256').update(preimage).digest()
}

class Loop {
  constructor (plugin1, plugin2, destination) {
    this.pending = {}
    this.destination = destination
    this.plugin1 = plugin1
    this.plugin2 = plugin2
    this.plugin2.registerDataHandler(this._loopbackPrepareHandler.bind(this))
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
    const resultPacket = await this.plugin1.sendData(packet)
    delete this.pending[executionCondition]
    const result = IlpPacket.deserializeIlpPacket(resultPacket)
    return (result.typeString === 'ilp_fulfill')
  }
}

async function createLoop (plugin1, plugin2) {
  // use il-dcp on plugin2 to determine the loopback address:
  const req = IlDcp.serializeIldcpRequest()
  const resBuf = await plugin2.sendData(req)
  const destination = IlDcp.deserializeIldcpResponse(resBuf).clientAddress

  return new Loop(plugin1, plugin2, destination)
}

module.exports = {
  createLoop
}
