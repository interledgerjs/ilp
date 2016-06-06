'use strict'
/* global describe it beforeEach */

const _ = require('lodash')
const chai = require('chai')
const expect = chai.expect
const mockRequire = require('mock-require')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
chai.use(sinonChai)
const validate = require('five-bells-shared/services/validate')

const PaymentRequest = require('../src/lib/request')
const MockCore = require('./mocks/mock-core')
mockRequire('ilp-core', MockCore)
const Client = require('../src/lib/client')

const CLIENT_PARAMS = {
  auth: {
    account: 'https://ledger.example/accounts/alice',
    password: 'alice'
  },
  conditionHashlockSeed: Buffer.from('secret', 'utf8')
}

const REQUEST_PACKET = {
  account: 'https://other-ledger.example/accounts/alice',
  ledger: 'https://other-ledger.example',
  amount: '10',
  data: {
    id: '3cb34c81-5104-415d-8be8-138a22158a48',
    expiresAt: '2016-06-06T03:07:43.655Z',
    executionCondition: 'cc:0:3:jDO9-BfPkOSLUgi77QY2wEgh-CFb5vECOlmlxqYAxw8:32',
    userData: {
      foo: 'bar'
    }
  }
}

describe('PaymentRequest', function () {
  beforeEach(function () {
    this.client = new Client(_.cloneDeep(CLIENT_PARAMS))
  })

  describe('constructor', function () {
    it('should throw an error if a client and params are not provided', function () {
      expect(() => new PaymentRequest(this.client)).to.throw('PaymentRequest must be instantiated with a client and params')
    })

    it('should generate a uuid if no id is provided', function () {
      const request = new PaymentRequest(this.client, {
        destinationAmount: 10
      })

      expect(request.id).to.match(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/)
    })

    it('should throw an error if no destinationAmount is provided', function () {
      expect(() => new PaymentRequest(this.client, {})).to.throw('destinationAmount is required')
    })
  })

  describe('(static) fromPacket', function () {
    beforeEach(function () {
      this.client = new Client(_.cloneDeep(CLIENT_PARAMS))
      this.packet = _.cloneDeep(REQUEST_PACKET)
    })

    it('should throw an error if no Client is given', function () {
      expect(() => PaymentRequest.fromPacket(this.packet)).to.throw('Must provide client and packet')
    })

    it('should parse a packet with an executionCondition', function () {
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      expect(request.destinationAccount).to.equal(this.packet.account)
      expect(request.destinationAmount).to.equal(this.packet.amount)
      expect(request.destinationLedger).to.equal(this.packet.ledger)
      expect(request.id).to.equal(this.packet.data.id)
      expect(request.expiresAt).to.equal(this.packet.data.expiresAt)
      expect(request.executionCondition).to.equal(this.packet.data.executionCondition)
      expect(request.unsafeOptimisticTransport).to.be.false
      expect(request.data).to.deep.equal(this.packet.data.userData)
    })

    it('should parse an Optimistic packet with no executionCondition', function () {
      delete this.packet.data.executionCondition
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      expect(request.unsafeOptimisticTransport).to.be.true
    })
  })

  describe('getPacket', function () {
    it('should return a JSON version of the ILP packet', function () {
      const request = new PaymentRequest(this.client, {
        id: '3cb34c81-5104-415d-8be8-138a22158a48',
        destinationAmount: '10',
        data: {
          foo: 'bar'
        }
      })

      expect(validate('IlpHeader', request.getPacket()).valid).to.be.true
    })

    it('should generate an executionCondition if unsafeOptimisticTransport is not set', function () {
      const request = new PaymentRequest(this.client, {
        id: '3cb34c81-5104-415d-8be8-138a22158a48',
        destinationAmount: '10',
        expiresAt: '2016-06-06T03:00:00.000Z' // if this is not provided the condition hash will change
      })

      // hmac output (preimage) '2e6df66988ae0e00a3736ca646f083af79bf8cf7e7b50e3c9909ad525a58ac05'

      expect(request.getPacket().data.executionCondition).to.be.a('string')
      expect(request.getPacket().data.executionCondition).to.equal('cc:0:3:jDO9-BfPkOSLUgi77QY2wEgh-CFb5vECOlmlxqYAxw8:32')
    })

    it('should not generate an executionCondition if unsafeOptimisticTransport is true', function () {
      const request = new PaymentRequest(this.client, {
        id: '3cb34c81-5104-415d-8be8-138a22158a48',
        destinationAmount: '10',
        unsafeOptimisticTransport: true
      })

      expect(request.getPacket().data.executionCondition).to.be.undefined
    })
  })

  describe('quote', function () {
    beforeEach(function () {
      this.client = new Client(_.cloneDeep(CLIENT_PARAMS))
      this.packet = _.cloneDeep(REQUEST_PACKET)
    })

    it('should get a quote using the client', function (done) {
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      request.quote()
        .then((quote) => {
          expect(quote.sourceAmount).to.equal('10')
          done()
        })
        .catch(done)
    })
  })

  describe('pay', function () {
    beforeEach(function () {
      this.client = new Client(_.cloneDeep(CLIENT_PARAMS))
      this.packet = _.cloneDeep(REQUEST_PACKET)
    })

    it('should throw an error if there is no executionCondition and allowUnsafeOptimisticTransport is not set', function () {
      delete this.packet.data.executionCondition
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      expect(() => request.pay({
        maxSourceAmount: '10'
      })).to.throw('executionCondition is required unless unsafeOptimisticTransport is set to true')
    })

    it('should not set unsafeOptimisticTransport if there is an executionCondition', function (done) {
      const send = sinon.spy(this.client, 'send')
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      request.pay({
        maxSourceAmount: '10',
        allowUnsafeOptimisticTransport: true
      }).then(() => {
        expect(send).to.have.been.calledWithMatch({ allowUnsafeOptimisticTransport: undefined })
        done()
      })
      send.restore()
    })

    it('should throw an error if no maxSourceAmount is given', function () {
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      expect(() => request.pay()).to.throw('maxSourceAmount is required')
    })

    it('should send a payment using the client', function (done) {
      const request = PaymentRequest.fromPacket(this.client, this.packet)
      request.pay({
        maxSourceAmount: '10'
      }).then((result) => {
        done()
      }).catch(done)
    })
  })
})
