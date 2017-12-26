'use strict'

const BaseError = require('extensible-error')
const { codes } = require('../utils/ilp-errors')

class UnexpectedPaymentError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F06_UNEXPECTED_PAYMENT
  }
}

module.exports = UnexpectedPaymentError
