const supertest = require('supertest')
const should = require('should')

module.exports = (LeafVote, wsHnd) =>
  describe('/', function () {
    it('200 for leafvote.mww.moe/', function (done) {
      supertest(LeafVote)
        .get('/')
        .set('Host', 'leafvote.mww.moe')
        .expect('Content-Type', /html/)
        .expect(200)
        .end(done)
    })

    it('Response to ping ws message', function (done) {
      let sendFunc = null
      wsHnd.onConnection({
        on: function (evtName, func) {
          if (evtName === 'message') {
            sendFunc = function (msg) {
              sendFunc = null
              try {
                let obj = JSON.parse(msg)
                obj.should.deepEqual({_id: 0})
                done()
              } catch (e) {
                done(e)
              }
            }
            func(JSON.stringify({_id: 0, type: 'ping'}))
          }
        },
        send: function (msg) {
          if (sendFunc) sendFunc(msg)
          else {
            done(new Error('called send unexpectedly.'))
          }
        }
      })
    })

    it('Handle invalid message', function (done) {
      let sendFunc = null
      wsHnd.onConnection({
        on: function (evtName, func) {
          if (evtName === 'message') {
            sendFunc = function (msg) {
              sendFunc = null
              try {
                let obj = JSON.parse(msg)
                obj.should.deepEqual({_id: 1, err: 'Invalid message type foo'})
                done()
              } catch (e) {
                done(e)
              }
            }
            func(JSON.stringify({_id: 1, type: 'foo'}))
          }
        },
        send: function (msg) {
          if (sendFunc) sendFunc(msg)
          else {
            done(new Error('called send unexpectedly.'))
          }
        },
        close: function () {
          done(new Error('Should not close the connection.'))
        }
      })
    })

    it('Close connection for invalid JSON', function (done) {
      let shouldClose = false
      wsHnd.onConnection({
        on: function (evtName, func) {
          if (evtName === 'message') {
            shouldClose = true
            func('{')
          }
        },
        send: function (msg) {
          done(new Error('called send unexpectedly.'))
        },
        close: function () {
          if (!shouldClose) {
            done(new Error("Closed when it shouldn't"))
          } else {
            done()
          }
        }
      })
    })

    it('Close connection for array JSON', function (done) {
      let shouldClose = false
      wsHnd.onConnection({
        on: function (evtName, func) {
          if (evtName === 'message') {
            shouldClose = true
            func('[]')
          }
        },
        send: function (msg) {
          done(new Error('called send unexpectedly.'))
        },
        close: function () {
          if (!shouldClose) {
            done(new Error("Closed when it shouldn't"))
          } else {
            done()
          }
        }
      })
    })

    it('Response to ping ws message with no _id', function (done) {
      let sendFunc = null
      wsHnd.onConnection({
        on: function (evtName, func) {
          if (evtName === 'message') {
            sendFunc = function (msg) {
              sendFunc = null
              try {
                let obj = JSON.parse(msg)
                obj.should.deepEqual({_id: null})
                done()
              } catch (e) {
                done(e)
              }
            }
            func(JSON.stringify({type: 'ping'}))
          }
        },
        send: function (msg) {
          if (sendFunc) sendFunc(msg)
          else {
            done(new Error('called send unexpectedly.'))
          }
        }
      })
    })
  })
