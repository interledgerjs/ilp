'use strict'

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const assert = chai.assert
const MockPlugin = require('ilp-core/test/mocks/mock-plugin')
const nock = require('nock')

delete require.cache[require.resolve('../src/lib/spsp')]
const mockRequire = require('mock-require')
const MockClient = require('./mocks/mockCore').Client

mockRequire('ilp-core', {
  Client: MockClient
})

const paymentRequest = require('./data/paymentRequest.json')
const paymentParams = require('./data/paymentParams.json')
const webfinger = {
  links: [{
    rel: 'https://interledger.org/rel/receiver',
    href: 'https://example.com/receiver' 
  }, {
    rel: 'https://interledger.org/rel/ilpAddress',
    href: 'example.alice' 
  }]
}

const SPSP = require('../src/lib/spsp')

describe('SPSP Module', function () {
  beforeEach(function () {
    this.quoteRequestCalled = false
    this.quoteSourceAmountCalled = false
    this.plugin = new MockPlugin()
  })

  afterEach(function () {
    assert.isTrue(nock.isDone())
  })

  describe('quoteDestination', function () {
    it('should query the right endpoints', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      nock('https://example.com')
        .post('/receiver')
        .reply(200, paymentRequest)

      const payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
      assert.deepEqual(payment, {
        destinationAccount: "example.alice",
        connectorAccount: "example.connie",
        sourceAmount: "10",
        destinationAmount: "10",
        receiverEndpoint: "https://example.com/receiver"
      })

      yield SPSP.sendPayment(this.plugin, payment)
        .catch((e) => {
          if (e.message !== 'Transfer expired, money returned') throw e 
        })
    })

    it('should return an error if webfinger can\'t be reached', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(404)
      
      yield expect(SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')).to.eventually.be.rejected
    })

    it('should return an error if webfinger is missing fields', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, {links: []})
      
      yield expect(SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')).to.eventually.be.rejected
    })

    it('should return an error if receiver doesn\'t exist', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)
      
      const payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
      payment.receiver = undefined

      yield expect(SPSP.sendPayment(this.plugin, payment)
        .catch((e) => {
          if (e.message !== 'Transfer expired, money returned') throw e 
        })).to.eventually.be.rejected
    })

    it('should fail without an amount', function * () {
      yield expect(SPSP.quoteDestination(this.plugin, 'alice@example.com')).to.eventually.be.rejected
    })
  })

  describe('quoteSource', function () {
    it('should query the right endpoints', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      nock('https://example.com')
        .post('/receiver')
        .reply(200, paymentRequest)

      const payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
      assert.deepEqual(payment, {
        destinationAccount: "example.alice",
        connectorAccount: "example.connie",
        sourceAmount: "10",
        destinationAmount: "10",
        receiverEndpoint: "https://example.com/receiver"
      })

      yield SPSP.sendPayment(this.plugin, payment)
        .catch((e) => {
          if (e.message !== 'Transfer expired, money returned') throw e 
        })
    })

    it('should fail without a sender', function * () {
      yield expect(SPSP.quoteSource(undefined, 'alice@example.com', '10')).to.eventually.be.rejected
    })

    it('should fail without an identifier', function * () {
      yield expect(SPSP.quoteSource(this.plugin, undefined, '10')).to.eventually.be.rejected
    })

    it('should fail without an amount', function * () {
      yield expect(SPSP.quoteSource(this.plugin, 'alice@example.com')).to.eventually.be.rejected
    })
  })

  describe('sendPayment', function () {
    beforeEach(function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      this.payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
    })

    it('should fail without client', function * () {
      yield expect(SPSP.sendPayment(undefined, this.payment)).to.eventually.be.rejected
    })

    it('should fail without payment', function * () {
      yield expect(SPSP.sendPayment(this.plugin, undefined)).to.eventually.be.rejected
    })

    it('should fail without destinationAccount', function * () {
      delete this.payment.destinationAccount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without destinationAmount', function * () {
      delete this.payment.destinationAmount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without sourceAmount', function * () {
      delete this.payment.sourceAmount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without connectorAccount', function * () {
      delete this.payment.connectorAccount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without receiver', function * () {
      delete this.payment.receiver
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })
  })

  describe('Client', function () {
    it('should construct an object with SPSP methods', function * () {
      const client = new SPSP.Client({
        account: 'http://example.com/accounts/alice',
        password: 'password'
      })

      assert.isFunction(client.quoteSource)
      assert.isFunction(client.quoteDestination)
      assert.isFunction(client.sendPayment)
    })
  })
})
