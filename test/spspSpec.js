'use strict'

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const assert = chai.assert
const MockPlugin = require('./mocks/mockPlugin')
const nock = require('nock')
const SPSP = require('../src/lib/spsp')
const webfinger = {
  links: [{
    rel: 'https://interledger.org/rel/spsp/v1',
    href: 'https://example.com/spsp' 
  }]
}
const spspResponse = {
  shared_secret: 'itsasecret',
  destination_account: 'test.other.alice',
  maximum_destination_amount: '20',
  minimum_destination_amount: '10',
  ledger_info: {
    scale: 2
  }
}

describe('SPSP', function () {
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

  describe('quote', function () {
    beforeEach(function () {
      this.plugin.sendMessage = (msg) => {
        this.plugin.emit('incoming_message', {
          data: {
            id: msg.data.id,
            method: 'quote_response',
            data: {
              source_amount: '1',
              destination_amount: '1',
              source_connector_account: 'test.example.connie',
              source_expiry_duration: '10'
            }
          }
        })
        return Promise.resolve()
      }

      this.id = '622d0846-2063-45c3-9dc0-ddf5182f833c'
      this.result = {
        connectorAccount: 'test.example.connie',
        destinationAccount: 'test.other.alice',
        sourceExpiryDuration: '10',
        // amounts are converted according to src and dest scales of 2
        sourceAmount: '0.01',
        destinationAmount: "0.12",
        id: this.id,
        spsp: spspResponse
      }

      this.params = {
        receiver: 'alice@example.com',
        // amounts are converted according to src and dest scales of 2
        destinationAmount: '0.12',
        timeout: 200,
        id: this.id
      }
    })

    it('should return a valid SPSP payment', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, webfinger)

      nock('https://example.com')
        .get('/spsp')
        .reply(200, spspResponse)

      const payment = yield SPSP.quote(this.plugin, this.params)
      assert.deepEqual(payment, this.result)
    })

    it('should return an error if webfinger can\'t be reached', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(404)
      
      yield expect(SPSP.quote(this.plugin, this.params))
        .to.eventually.be.rejectedWith(/Not Found/)
    })

    it('should return an error if webfinger is missing fields', function * () {
      nock('https://example.com')
        .get('/.well-known/webfinger?resource=acct:alice@example.com')
        .reply(200, {links: []})

      yield expect(SPSP.quote(this.plugin, this.params))
        .to.eventually.be.rejectedWith(/spsp\/v1 not found/)
    })

    it('should fail without an amount', function * () {
      delete this.params.destinationAmount
      yield expect(SPSP.quote(this.plugin, this.params))
        .to.eventually.be
        .rejectedWith(/destinationAmount or sourceAmount must be specified/)
    })

    describe('sendPayment', function () {
      beforeEach(function * () {
        nock('https://example.com')
          .get('/.well-known/webfinger?resource=acct:alice@example.com')
          .reply(200, webfinger)

        nock('https://example.com')
          .get('/spsp')
          .reply(200, spspResponse)

        this.payment = yield SPSP.quote(this.plugin, this.params)
      })

      it('should successfuly send a payment', function * () {
        this.plugin.sendTransfer = (transfer) => {
          this.plugin.emit('outgoing_fulfill', transfer, 'fulfillment')
          return Promise.resolve(null)
        }
        
        const result = yield SPSP.sendPayment(this.plugin, this.payment)
        expect(result).to.deep.equal({ fulfillment: 'fulfillment' })
      })

      it('should reject if payment times out', function * () {
        this.plugin.sendTransfer = (transfer) => {
          this.plugin.emit('outgoing_cancel', transfer)
          return Promise.resolve(null)
        }
        
        yield expect(SPSP.sendPayment(this.plugin, this.payment))
          .to.eventually.be.rejectedWith(/transfer .+ failed/)
      })

      it('should reject if payment is rejected', function * () {
        this.plugin.sendTransfer = (transfer) => {
          this.plugin.emit('outgoing_reject', transfer)
          return Promise.resolve(null)
        }
        
        yield expect(SPSP.sendPayment(this.plugin, this.payment))
          .to.eventually.be.rejectedWith(/transfer .+ failed/)
      })
    })
  })

})
