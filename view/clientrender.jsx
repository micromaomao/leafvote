'use strict'

require('babel-polyfill')
require('fetch-polyfill')

const React = require('react')
const ReactDOM = require('react-dom')

// Polyfill
window.requestIdleCallback = window.requestIdleCallback || (func => setTimeout(func, 1000))
window.cancelIdleCallback = window.cancelIdleCallback || (id => clearTimeout(id))

require('style-loader!./layout.sass')

class AppMain extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      error: null,
      errorInfo: null
    }
    this.handleWindowResize = this.handleWindowResize.bind(this)
    this.handleReload = this.handleReload.bind(this)
    this.animationFrame = null
  }

  componentDidMount () {
    window.addEventListener('resize', this.handleWindowResize)
  }
  handleWindowResize (evt) {
    if (this.animationFrame === null) {
      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = null
        if (this.app === null) return
        this.app.forceUpdate()
      })
    }
  }
  componentWillUnmount () {
    window.removeEventListener('resize', this.handleWindowResize)
  }

  render () {
    if (this.state.error) {
      return (
        <div className='schsrch-main-crash'>
          <h1>:(</h1>
          <h2>Something went terribly wrong&hellip;</h2>
          <p>LeafVote has run into an error and must be reloaded before it can work again.</p>
          <div className='reload-btn-contain'>
            <a className='reload-btn' onClick={this.handleReload}>Reload</a>
          </div>
          <p>Sorry for this&hellip;</p>
          <pre>{this.state.error.message + '\n' + this.state.error.stack}</pre>
          <pre>{this.state.errorInfo.componentStack.toString()}</pre>
        </div>
      )
    }
    return <LeafVote ref={f => this.app = f} />
  }

  componentDidCatch (error, info) {
    this.setState({error, errorInfo: info})
    console.error(error)
    console.error(info)
  }

  handleReload (evt) {
    window.location.reload(false)
  }
}

class LeafVote extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      socket: null,
      socketState: 'disconnected',
      latency: null
    }
    this.messageCallbacks = []
    this.messageId = 0
    this.latencySetTimeout = null
    this.testLatency = this.testLatency.bind(this)
  }

  initSocket () {
    if (this.state.socket) {
      if (this.state.socket.readyState === WebSocket.OPEN) return
    }
    for (let msgCb of this.messageCallbacks) {
      msgCb(new Error('disconnected'), null)
    }
    this.messageCallbacks = []
    try {
      let socket = new WebSocket('wss://leafvote.mww.moe')
      this.setState({socket})
      socket.addEventListener('open', evt => {
        this.setState({socketState: 'ready', socketError: null})
        if (this.latencySetTimeout !== null) clearTimeout(this.latencySetTimeout)
        this.testLatency()
      })
      socket.addEventListener('error', evt => {
        let socketError = evt.error
        if (!socketError) socketError = new Error('Network error')
        this.setState({socketState: 'disconnected', socketError, socket: null})
        try {
          socket.close(0, 'error occured.')
        } catch (e) {}
        this.initSocket()
      })
      socket.addEventListener('close', evt => {
        this.setState({socketState: 'disconnected'})
        this.initSocket()
      })
      socket.addEventListener('message', evt => {
        let {messageCallbacks} = this
        let msg = evt.data
        if (typeof msg !== 'string') {
          return
        }
        try {
          msg = JSON.parse(msg)
        } catch (e) {
          socket.close(1, 'invalid message.')
          this.initSocket()
          return
        }
        if (!Number.isSafeInteger(msg._id)) return
        if (!messageCallbacks[msg._id]) return
        messageCallbacks[msg._id](null, msg)
        delete messageCallbacks[msg._id]
      })
    } catch (e) {
      this.setState({socketState: 'disconnected', socketError: e, socket: null})
      setTimeout(() => this.initSocket(), 1000)
    }
  }

  testLatency () {
    if (this.latencySetTimeout !== null) clearTimeout(this.latencySetTimeout)
    this.latencySetTimeout = null
    let time = Date.now()
    this.sendMessage({type: 'ping'}).then(() => {
      let nTime = Date.now()
      let latency = (nTime - time) / 2
      this.setState({latency: `${latency}ms`})
      this.latencySetTimeout = setTimeout(this.testLatency, 10000)
    }, err => {
      this.setState({latency: null})
    })
  }

  sendMessage (msg, callback) {
    return new Promise((resolve, reject) => {
      if (!this.state.socket) {
        reject(new Error('Offline.'))
      }
      let id = this.messageId++
      this.messageCallbacks[id] = (err, reply) => {
        if (err) {
          return void reject(err)
        }
        resolve(reply)
      }
      let socket = this.state.socket
      socket.send(JSON.stringify(Object.assign({}, msg, {
        _id: id
      })))
    })
  }

  componentDidMount () {
    this.initSocket()
  }
  componentDidUpdate (prevProps, prevState) {
  }

  render () {
    return (
      <div className='leafvote'>
        <div className='topbar'>
          <div className='logo'>
            <b>Leaf</b>Vote
          </div>
          <div className='dash'>&mdash;</div>
          {this.getConnectionStatusUI()}
        </div>
      </div>
    )
  }

  getConnectionStatusUI () {
    if (this.state.socketState === 'disconnected' && this.state.socketError) {
      return <div className='connection error'>Unable to connect: {this.state.socketError.message}. Retrying</div>
    }
    if (this.state.socketState === 'disconnected' && !this.state.socketError) {
      return <div className='connection disconnected'>Connecting</div>
    }
    if (this.state.socketState === 'ready') {
      return <div className='connection ready'>{this.state.latency || '✓'}</div>
    }
    return <div className='connection'>{this.state.socketState}</div>
  }
}

let reactRootElement = document.getElementsByClassName('react-root')[0]

ReactDOM.render(
  <AppMain />,
  reactRootElement
)
