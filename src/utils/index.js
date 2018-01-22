'use strict'

const DEFAULT_CONNECT_TIMEOUT = 10000

function safeConnect (plugin, timeoutOption) {
  const timeout = timeoutOption || DEFAULT_CONNECT_TIMEOUT
  let timer
  return Promise.race([
    plugin.connect().then(() => { clearTimeout(timer) }),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeout)
    }).then(() => {
      throw new Error('plugin timed out during connect (' + timeout + ' ms)')
    })
  ])
}

function xor (a, b) {
  return ((a || b) && (!a || !b))
}

function wait (duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

function startsWith (subject, prefix) {
  return typeof subject === 'string' && subject.startsWith(prefix)
}

function omitUndefined (subject) {
  return Object.keys(subject).reduce((agg, key) => {
    if (typeof subject[key] !== 'undefined') {
      agg[key] = subject[key]
    }
    return agg
  }, {})
}

module.exports = {
  xor,
  wait,
  startsWith,
  safeConnect,
  omitUndefined
}
