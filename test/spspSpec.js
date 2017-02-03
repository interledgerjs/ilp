'use strict'

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const sinon = require('sinon')
chai.use(chaiAsPromised)
const expect = chai.expect
const assert = chai.assert
const MockPlugin = require('ilp-core/test/mocks/mock-plugin')
const nock = require('nock')
const timekeeper = require('timekeeper')

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
    rel: 'https://interledger.org/rel/spsp/v1',
    href: 'https://example.com/spsp' 
  }]
}
const spspResponse = {
  shared_secret: 'itsasecret',
  destination_account: 'example.alice',
  maximum_destination_amount: '20',
  minimum_destination_amount: '10'
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

  describe('query', function () {
    it('should query the right endpoints', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      nock('https://example.com')
        .get('/spsp')
        .reply(200, spspResponse)

      expect(yield SPSP.query('alice@example.com'))
        .to.deep.equal(spspResponse)
    })
  })

  describe('quoteDestination', function () {
    it('should query the right endpoints', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      nock('https://example.com')
        .get('/spsp')
        .reply(200, spspResponse)

      const payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
      assert.deepEqual(payment, {
        destinationAccount: "example.alice",
        connectorAccount: "example.connie",
        sourceAmount: "10",
        id: payment.id,
        destinationAmount: "10",
        spsp: spspResponse
      })

      yield SPSP.sendPayment(this.plugin, payment, { defaultRequestTimeout: 0.1 })
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
        .get('/spsp')
        .reply(200, spspResponse)

      const payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
      assert.deepEqual(payment, {
        destinationAccount: "example.alice",
        connectorAccount: "example.connie",
        sourceAmount: "10",
        id: payment.id,
        destinationAmount: "10",
        spsp: spspResponse
      })

      yield SPSP.sendPayment(this.plugin, payment, { defaultRequestTimeout: 0.1 })
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

      nock('https://example.com')
        .get('/spsp')
        .reply(200, spspResponse)

      this.payment = yield SPSP.quoteDestination(this.plugin, 'alice@example.com', '10')
    })

    it.skip('should successfuly send a payment', function * () {

    })

    it('should fail without client', function * () {
      yield expect(SPSP.sendPayment(undefined, this.payment)).to.eventually.be.rejected
    })

    it('should fail without payment', function * () {
      yield expect(SPSP.sendPayment(this.plugin, undefined)).to.eventually.be.rejected
    })

    it('should fail without destinationAccount', function * () {
      delete this.payment.destination_account
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without destinationAmount', function * () {
      delete this.payment.destination_amount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without sourceAmount', function * () {
      delete this.payment.source_amount
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without connectorAccount', function * () {
      delete this.payment.connector_account
      yield expect(SPSP.sendPayment(this.plugin, this.payment)).to.eventually.be.rejected
    })

    it('should fail without spsp info', function * () {
      delete this.payment.spsp
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
