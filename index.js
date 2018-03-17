const express = require.main.require('express')
const path = require('path')
const fs = require('fs')
const mongoose = require.main.require('mongoose')

let indexPath = path.join(__dirname, 'dist/index.html')
let indexHtml = fs.readFileSync(indexPath)
if (process.env.NODE_ENV !== 'production') {
  fs.watch(indexPath, list => {
    fs.readFile(indexPath, { encoding: 'utf8' }, (err, data) => {
      if (err) {
        console.error(err)
        process.exit(1)
      } else {
        indexHtml = data
      }
    })
  })
}

module.exports = ({mongodb: db, addWSHandler}) => {
  let rMain = express.Router()

  require('./lib/dbModel.js')(db).then(({}) => {
    rMain.get('/', function (req, res, next) {
      res.type('html')
      res.send(indexHtml)
    })

    rMain.use('/resources', express.static(path.join(__dirname, 'dist')))
  }, err => {
    rMain.use(function (req, res, next) {
      next(err)
    })
    console.error(err)
  })

  addWSHandler({
    hostname: 'leafvote.mww.moe',
    shouldHandle: function (req) {
      return req.url === '/'
    },
    onConnection: function (ws, req) {
      let closed = false
      ws.on('message', function (msg) {
        if (closed) return
        if (typeof msg !== 'string') {
          ws.close(1, 'Invalid message, should be UTF-8 string.')
          closed = true
          return
        }
        let obj
        try {
          obj = JSON.parse(msg)
          if (typeof obj !== 'object') throw new Error()
        } catch (e) {
          ws.close(1, 'Invalid JSON.')
          closed = true
          return
        }
        function reply (ct) {
          ws.send(JSON.stringify(Object.assign(ct, {_id: obj._id})))
        }
        if (obj.type === 'ping') {
          reply({})
        } else {
          reply({err: `Invalid message type ${obj.type}`})
        }
      })
    }
  })

  return rMain
}
