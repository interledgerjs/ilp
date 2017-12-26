'use strict'

const BaseError = require('extensible-error')
const { codes } = require('../utils/ilp-errors')

class WrongConditionError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F05_WRONG_CONDITION
  }
}

module.exports = WrongConditionError
