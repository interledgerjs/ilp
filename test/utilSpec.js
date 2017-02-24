'use strict'

const chai = require('chai')
const assert = chai.assert
const Crypto = require('../src/utils/crypto')
const Utils = require('../src/utils')

describe('Utils', function () {
  describe('cryptoHelper', function () {
    it('should not decrypt corrupted ciphertext', function () {
      assert
        .throws(() => Crypto.aesDecryptObject('garbage', Buffer.from('trash', 'base64')))
    })
  })
})
