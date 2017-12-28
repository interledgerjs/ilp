'use strict'

const IlpPacket = require('ilp-packet')
const chai = require('chai')
const assert = chai.assert
const ILQP = require('..').ILQP
const Packet = require('../src/utils/packet')
const { wait } = require('../src/utils')
const MockPlugin = require('./mocks/mockPlugin')
const expect = chai.expect
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

describe('ILQP', function () {
  beforeEach(function () {
    this.plugin = new MockPlugin()

    // default data handler - some tests will override this
    this.plugin.dataHandler = msg => {
      assert.isObject(IlpPacket.deserializeIlqpBySourceRequest(msg))
      return Promise.resolve(IlpPacket.serializeIlqpBySourceResponse({
        destinationAmount: '1',
        sourceHoldDuration: 5000
      }))
    }
  })

  describe('quote', function () {
    beforeEach(function () {
      this.params = {
        sourceAddress: 'test.example.alice',
        destinationAddress: 'test.local.bob',
        sourceAmount: '1',
        destinationExpiryDuration: '10',
        timeout: 100
      }
      this.result = {
        sourceAmount: '1',
        destinationAmount: '1',
        sourceExpiryDuration: '5'
      }
    })

    it('should quote by source amount', async function () {
      const response = await ILQP.quote(this.plugin, this.params)
      this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

      assert.deepEqual(
        response,
        this.result)
    })

    it('should quote by destination amount', async function () {
      this.params.destinationAmount = this.params.sourceAmount
      delete this.params.sourceAmount

      this.plugin.dataHandler = async msg => {
        assert.isObject(IlpPacket.deserializeIlqpByDestinationRequest(msg))
        return Promise.resolve(IlpPacket.serializeIlqpByDestinationResponse({
          sourceAmount: '1',
          sourceHoldDuration: 5000
        }))
      }

      const response = await ILQP.quote(this.plugin, this.params)
      this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

      assert.deepEqual(
        response,
        this.result)
    })

    it('should reject if source and dest amounts are defined', async function () {
      this.params.destinationAmount = this.params.sourceAmount = '1'

      await expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/provide source or destination amount but not both/)
    })

    it('should reject if sendRequest returns an IlpError', async function () {
      this.plugin.dataHandler = (msg) => {
        return Promise.resolve(IlpPacket.serializeIlpError({
          code: 'F01',
          name: 'Invalid Packet',
          triggeredBy: 'example.us.ledger3.bob',
          forwardedBy: [
            'example.us.ledger2.connie',
            'example.us.ledger1.conrad'
          ],
          triggeredAt: new Date(),
          data: JSON.stringify({foo: 'bar'})
        }))
      }

      await expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/remote quote error: Invalid Packet/)
    })

    it('should reject if sendRequest returns an IlpReject', async function () {
      this.plugin.dataHandler = (msg) => {
        return Promise.resolve(IlpPacket.serializeIlpReject({
          code: 'F01',
          message: 'invalid packet.',
          triggeredBy: 'example.us.ledger3.bob',
          data: Buffer.alloc(0)
        }))
      }

      await expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/remote quote error: invalid packet./)
    })

    describe('quoteByPacket', function () {
      it('should parse quote params from packet', async function () {
        this.plugin.dataHandler = (packet) => {
          return Promise.resolve(IlpPacket.serializeIlqpByDestinationResponse({
            sourceAmount: '1',
            sourceHoldDuration: 5000
          }))
        }

        const response = await ILQP.quoteByPacket(
          this.plugin,
          Packet.serialize({
            amount: '1',
            account: 'test.local.bob'
          }),
          {
            timeout: 100
          }
        )
        this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

        assert.deepEqual(
          response,
          this.result)
      })
    })
  })

  describe('quoteByConnector', function () {
    beforeEach(function () {
      this.params = {
        plugin: this.plugin,
        connector: 'test.example.connie',
        quoteQuery: {
          destinationAccount: 'test.example.bob',
          sourceAmount: '1',
          destinationHoldDuration: 3000
        }
      }
    })

    it('should return the data from the message response', async function () {
      const responseData = {
        destinationAmount: '1',
        sourceHoldDuration: 5000
      }

      this.plugin.dataHandler = (msg) => {
        assert.deepEqual(IlpPacket.deserializeIlqpBySourceRequest(msg), {
          destinationAccount: 'test.example.bob',
          sourceAmount: '1',
          destinationHoldDuration: 3000
        })
        return Promise.resolve(IlpPacket.serializeIlqpBySourceResponse(responseData))
      }

      const response = await ILQP.quoteByConnector(this.params)
      assert.deepEqual(response,
        Object.assign(
          {responseType: 5},
          responseData))
    })

    it('should return an IlpError packet from the message response', async function () {
      const errorResponse = {
        code: 'F01',
        message: 'invalid packet.',
        triggeredBy: 'example.us.ledger3.bob',
        data: Buffer.alloc(0)
      }
      this.plugin.dataHandler = (msg) => {
        return Promise.resolve(IlpPacket.serializeIlpReject(errorResponse))
      }
      assert.deepEqual(await ILQP.quoteByConnector(this.params),
        Object.assign(
          {responseType: 14},
          errorResponse))
    })

    it('should reject on an error', async function () {
      this.params.timeout = 10
      this.plugin.sendData = () => Promise.reject(new Error('fail'))
      await expect(ILQP.quoteByConnector(this.params))
        .to.be.rejectedWith(/fail/)
    })
  })

  describe('_getCheaperQuote', function () {
    it('should choose quote1 if it costs less (source)', function () {
      assert.deepEqual(
        ILQP._getCheaperQuote({sourceAmount: '1'}, {sourceAmount: '2'}),
        {sourceAmount: '1'})
    })

    it('should choose quote1 if it pays more (destination)', function () {
      assert.deepEqual(
        ILQP._getCheaperQuote({destinationAmount: '1'}, {destinationAmount: '2'}),
        {destinationAmount: '2'})
    })

    it('should choose quote2 otherwise', function () {
      assert.deepEqual(
        ILQP._getCheaperQuote({destinationAmount: '1'}, {destinationAmount: '1'}),
        {destinationAmount: '1'})
    })
  })
})
