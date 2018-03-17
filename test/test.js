const should = require('should')
const _leafvote = require('../index')
const express = require('express')
let LeafVote = null
let dbModel = null
const mongoose = require('mongoose')
mongoose.Promise = global.Promise

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection: ' + reason)
  console.error(reason.stack)
  process.exit(1)
})

const { MONGODB: DB } = process.env

try {
  DB.should.be.a.String().and.should.not.be.empty()
} catch (e) {
  console.log('You need to provide env MONGODB. E.g. MONGODB=127.0.0.1')
  process.exit(1)
}

let db = mongoose.createConnection()
db.openUri(DB).catch(err => {
  console.error(err)
  process.exit(1)
})
db.on('error', function (err) {
  console.error(err)
  process.exit(1)
})
let wsHnd
db.on('open', function () {
  LeafVote = express()
  LeafVote.use(function (req, res, next) {
    console.log(`\x1b[2;37m    ${req.method.toUpperCase()} ${req.path}\x1b[0m`)
    next()
  })
  LeafVote.use(_leafvote({mongodb: db, addWSHandler: function (hnd) {
    wsHnd = hnd
  }}))
  LeafVote.use(function (err, req, res, next) {
    console.error(err)
    next(err)
  })
  require('../lib/dbModel.js')(db).then(_dbModel => {
    dbModel = _dbModel
    doTests()
  })
})

function doTests () {
  require('./server-basic.js')(LeafVote, wsHnd)
  run()
}
