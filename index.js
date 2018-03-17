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
  let {Manager, Voter, Poll, Vote, GetSecret} = require('./lib/dbModel')(db)

  rMain.get('/', function (req, res, next) {
    res.type('html')
    res.send(indexHtml)
  })

  rMain.use('/resources', express.static(path.join(__dirname, 'dist')))

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
          if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error()
        } catch (e) {
          ws.close(1, 'Invalid JSON.')
          closed = true
          return
        }
        if (!Number.isSafeInteger(obj._id)) obj._id = null
        function reply (ct) {
          // TODO
          setTimeout(() => {
            ws.send(JSON.stringify(Object.assign(ct, {_id: obj._id})))
          }, 1000)
        }
        try {
          if (obj.type === 'ping') {
            return reply({})
          } else if (obj.type === 'login') {
            let sSecret = (obj.secret || '').trim()
            if (!sSecret) return reply({error: 'Empty secret'})
            let secret = Buffer.from(sSecret, 'base64')
            if (obj.role === 'voter') {
              Voter.findOne({secret}).then(voter => {
                if (!voter) {
                  reply({error: 'Invalid secret'})
                } else {
                  reply({})
                }
              }, err => reply({error: err.message}))
            } else if (obj.role === 'manager') {
              Manager.findOne({secret}).then(manager => {
                if (!manager) {
                  reply({error: 'Invalid secret'})
                } else {
                  Poll.find({manager: manager._id}).then(polls => {
                    reply({polls})
                  }, err => {
                    reply({})
                  })
                }
              })
            } else {
              throw new Error(`Invalid role ${obj.role}`)
            }
          } else if (obj.type === 'register') {
            GetSecret().then(secret => {
              let m = new Manager({
                secret
              })
              m.save().then(() => {
                reply({secret: secret.toString('base64')})
              }, err => {
                reply({error: err.message})
              })
            }, err => {
              reply({error: err.message})
            })
          } else {
            throw new Error(`Invalid message type ${obj.type}`)
          }
        } catch (e) {
          reply({error: e.message})
        }
      })
    }
  })

  return rMain
}
