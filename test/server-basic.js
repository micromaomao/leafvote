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
  })
