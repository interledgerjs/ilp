'use strict'

const IlpPacket = require('ilp-packet')
const chai = require('chai')
const moment = require('moment')
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
    // quote response
    this.response = {
      ilp: IlpPacket.serializeIlqpBySourceResponse({
        destinationAmount: '1',
        sourceHoldDuration: 5000
      })
    }

    this.errorResponse = {
      ilp: IlpPacket.serializeIlpError({
        code: 'F01',
        name: 'Invalid Packet',
        triggeredBy: 'example.us.ledger3.bob',
        forwardedBy: [
          'example.us.ledger2.connie',
          'example.us.ledger1.conrad'
        ],
        triggeredAt: new Date(),
        data: JSON.stringify({foo: 'bar'})
      })
    }
  })

  describe('quote', function () {
    beforeEach(function () {
      this.params = {
        sourceAddress: 'test.example.alice',
        destinationAddress: 'test.local.bob',
        sourceAmount: '1',
        destinationExpiryDuration: '10',
        connectors: [ 'test.example.connie' ]
      }
      this.result = {
        sourceAmount: '1',
        destinationAmount: '1',
        connectorAccount: 'test.example.connie',
        sourceExpiryDuration: '5'
      }

      this.plugin.sendRequest = (msg) => {
        assert.equal(msg.ledger, 'test.example.')
        assert.equal(msg.to, 'test.example.connie')
        assert.isObject(IlpPacket.deserializeIlqpBySourceRequest(Buffer.from(msg.ilp, 'base64')))
        return Promise.resolve(this.response)
      }
    })

    it('should quote by source amount', function * () {
      const response = yield ILQP.quote(this.plugin, this.params)
      this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

      assert.deepEqual(
        response,
        this.result)
    })

    it('should quote by destination amount', function * () {
      this.params.destinationAmount = this.params.sourceAmount
      delete this.params.sourceAmount

      this.plugin.sendRequest = (msg) => {
        return Promise.resolve({
          ilp: IlpPacket.serializeIlqpByDestinationResponse({
            sourceAmount: '1',
            sourceHoldDuration: 5000
          })
        })
      }

      const response = yield ILQP.quote(this.plugin, this.params)
      this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

      assert.deepEqual(
        response,
        this.result)
    })

    it('should remove incoming message listener after response', function * () {
      assert.equal(this.plugin.listeners('incoming_message').length, 0,
        'no listeners should be registered before quote')

      yield ILQP.quote(this.plugin, this.params)
      yield wait(10)

      assert.equal(this.plugin.listeners('incoming_message').length, 0,
        'no listeners should be registered after quote')
    })

    it('should default to getInfo\'s connectors', function * () {
      // remove manually provided connectors
      delete this.params.connectors

      const response = yield ILQP.quote(this.plugin, this.params)
      this.result.expiresAt = (new Date(response.expiresAt)).toISOString()

      assert.deepEqual(
        response,
        this.result)
    })

    it('should reject if getInfo returns no connectors', function * () {
      delete this.params.connectors
      this.plugin.getInfo = () => ({ prefix: 'test.example.' })

      yield expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/no connectors specified/)    
    })

    it('should return a local quote if destination is local', function * () {
      this.params.destinationAddress = 'test.example.bob'
      const response = yield ILQP.quote(this.plugin, this.params)

      // connectorAccount should be set to destination for local ILP payment
      this.result.connectorAccount = this.params.destinationAddress
      this.result.sourceExpiryDuration = '10'

      assert.deepEqual(response,
        this.result)
    })

    it('should reject if source and dest amounts are defined', function * () {
      this.params.destinationAmount = this.params.sourceAmount = '1'

      yield expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/provide source or destination amount but not both/)
    })

    it('should reject if there are no connectors', function * () {
      this.params.connectors = []
      yield expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/no connectors specified/)    
    })

    it('should reject is sendRequest returns an IlpError', function * () {
      this.plugin.sendRequest = (msg) => {
        return Promise.resolve(this.errorResponse)
      }
      yield expect(ILQP.quote(this.plugin, this.params))
        .to.be.rejectedWith(/remote quote error: Invalid Packet/)
    })

    describe('quoteByPacket', function () {
      it('should parse quote params from packet', function * () {
        this.plugin.sendRequest = (msg) => {
          return Promise.resolve({
            ilp: IlpPacket.serializeIlqpByDestinationResponse({
              sourceAmount: '1',
              sourceHoldDuration: 5000
            })
          })
        }

        const response = yield ILQP.quoteByPacket(
          this.plugin,
          Packet.serialize({
            amount: '1',
            account: 'test.local.bob'
          })
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

    it('should return the data from the message response', function * () {
      this.plugin.sendRequest = (msg) => {
        assert.equal(msg.ledger, 'test.example.')
        assert.equal(msg.to, 'test.example.connie')
        assert.deepEqual(IlpPacket.deserializeIlqpBySourceRequest(Buffer.from(msg.ilp, 'base64')), {
          destinationAccount: 'test.example.bob',
          sourceAmount: '1',
          destinationHoldDuration: 3000
        })
        assert.equal(msg.timeout, 5000)
        return Promise.resolve(this.response)
      }

      const response = yield ILQP.quoteByConnector(this.params)
      assert.deepEqual(response,
        Object.assign(
          {responseType: 5},
          IlpPacket.deserializeIlqpBySourceResponse(Buffer.from(this.response.ilp, 'base64'))))
    })

    it('should return an IlpError packet from the message response', function * () {
      this.plugin.sendRequest = (msg) => {
        return Promise.resolve(this.errorResponse)
      }
      assert.deepEqual(yield ILQP.quoteByConnector(this.params),
        Object.assign(
          {responseType: 8},
          IlpPacket.deserializeIlpError(Buffer.from(this.errorResponse.ilp, 'base64'))))
    })

    it('should reject on an error', function * () {
      this.params.timeout = 10
      this.plugin.sendRequest = () => Promise.reject(new Error('fail'))
      yield expect(ILQP.quoteByConnector(this.params))
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
