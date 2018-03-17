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
      latency: null,
      login: null,
      loginning: null
    }
    this.messageCallbacks = []
    this.messageId = 0
    this.latencySetTimeout = null
    this.testLatency = this.testLatency.bind(this)
    this.handleLogin = this.handleLogin.bind(this)
    this.handleCreateManager = this.handleCreateManager.bind(this)
    this.handleLogout = this.handleLogout.bind(this)
  }

  initSocket () {
    if (this.state.socket) {
      if (this.state.socket.readyState === WebSocket.OPEN) return
    }
    for (let msgCb of this.messageCallbacks) {
      try {
        msgCb(new Error('disconnected'), null)
      } catch (e) {}
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
      let errored = false
      socket.addEventListener('error', evt => {
        let socketError = evt.error
        if (!socketError) socketError = new Error('Network error')
        this.setState({socketState: 'disconnected', socketError, socket: null})
        try {
          socket.close(0, 'error occured.')
        } catch (e) {}
        setTimeout(() => {
          this.initSocket()
        }, 100)
        errored = true
      })
      socket.addEventListener('close', evt => {
        if (errored) return
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
    if (this.state.loginning) {
      if (prevState.loginning && this.state.loginning.section && this.state.loginning.section !== prevState.loginning.section && this.secretInput) {
        this.secretInput.focus()
      } else if (!prevState.loginning && this.state.loginning.section && this.secretInput) {
        this.secretInput.focus()
      }
    }
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
          {this.getLoggedInAs()}
          {this.state.login ? <div className='logout' onClick={this.handleLogout}>Log out</div> : null}
        </div>
        {this.state.login === null ? (
          <div className='view login'>
            <h1>Who are you?</h1>
            {(() => {
              // voter section
              let selectedThis = this.state.loginning && this.state.loginning.section === 'voter'
              if (!selectedThis) {
                return <div className='section unselected voter' onClick={evt => this.setState({loginning: {section: 'voter'}})}>Voter</div>
              } else {
                return <div className='section selected voter'>
                  Voter
                  <div>
                    You should have received a voting ticket with a QR code on it. Scan the code to login. If you are unable to scan, enter the secret shown
                    on the paper below:<br />
                    {this.getSecretInput()}
                    {this.getLoginError()}
                  </div>
                </div>
              }
            })()}
            {(() => {
              // manager section
              let selectedThis = this.state.loginning && this.state.loginning.section === 'manager'
              if (!selectedThis) {
                return <div className='section unselected manager' onClick={evt => this.setState({loginning: {section: 'manager'}})}>Manager</div>
              } else {
                return <div className='section selected manager'>
                  Manager
                  <div>
                    Enter your access token:<br />
                    {!this.state.loginning.managerCreationLoading ? this.getSecretInput() : null}
                    {!this.state.loginning.managerCreationLoading ? this.getLoginError() : null}
                    {!this.state.loginning.managerCreationLoading ? (
                      !this.state.loginning.managerCreationDone ? (
                        <div>
                          You may also <a className='createbtn' onClick={this.handleCreateManager}>register one</a>. Do
                          not register if you are trying to vote.
                        </div>
                      ) : (
                        <div>
                          The string above is your secret (access token). Keep a note of it, ensure that you never lose nor disclose it, and tap "enter".
                        </div>
                      )
                    ) : (
                      <div className='loading'>Registering new token&hellip;</div>
                    )}
                    {this.state.loginning.managerCreationError ? <div className='error'>{this.state.loginning.managerCreationError.message}</div> : null}
                  </div>
                </div>
              }
            })()}
          </div>
        ) : null}
      </div>
    )
  }

  getSecretInput () {
    if (!this.state.loginning) return null
    if (this.state.loginning.loading) return <div className='loading'>Logging in&hellip;</div>
    return (
      <div className='inputcontain'>
        <input type='text' value={this.state.loginning.secretInput || ''} placeholder='Your secret' onChange={evt => this.setState({
          loginning: Object.assign({}, this.state.loginning, {secretInput: evt.target.value})
        })} ref={f => this.secretInput = f}/>
        <div className='enter' onClick={this.handleLogin}>enter</div>
      </div>
    )
  }

  handleLogin (evt) {
    let loginning = Object.assign({}, this.state.loginning, {loading: true, error: null, managerCreationError: null})
    this.setState({
      loginning
    })
    this.sendMessage({type: 'login', secret: loginning.secretInput, role: loginning.section}).then(res => {
      if (res.error) {
        if (this.state.loginning !== loginning) return
        this.setState({loginning: Object.assign({}, loginning, {error: new Error(res.error), loading: false})})
      } else {
        this.setState({login: {type: loginning.section, secret: loginning.secretInput}, loginning: null})
      }
    }, err => {
      if (this.state.loginning !== loginning) return
      this.setState({loginning: Object.assign({}, loginning, {error: err, loading: false})})
    })
  }

  getLoginError () {
    let loginning = this.state.loginning
    if (!loginning) return null
    if (!loginning.error) return null
    return <div className='error'>{loginning.error.message}</div>
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

  getLoggedInAs () {
    if (this.state.login === null) {
      return null
    }
    if (this.state.login.type === 'voter') {
      return <div className='id voter'>Logged in as voter</div>
    }
    if (this.state.login.type === 'manager') {
      return <div className='id voter'>Logged in as manager</div>
    }
  }

  handleCreateManager () {
    let loginning = Object.assign({}, this.state.loginning, {
      managerCreationLoading: true,
      managerCreationError: null,
      error: null // error from login
    })
    this.setState({loginning})
    this.sendMessage({type: 'register'}).then(res => {
      if (res.error) {
        if (this.state.loginning !== loginning) return
        this.setState({loginning: Object.assign({}, loginning, {managerCreationError: new Error(res.error), managerCreationLoading: false})})
      } else {
        this.setState({loginning: Object.assign({}, loginning, {managerCreationLoading: false, secretInput: res.secret, managerCreationDone: true})})
      }
    }, err => {
      if (this.state.loginning !== loginning) return
      this.setState({loginning: Object.assign({}, loginning, {managerCreationError: err, managerCreationLoading: false})})
    })
  }

  handleLogout (evt) {
    this.setState({
      login: null,
      loginning: null
    })
  }
}

let reactRootElement = document.getElementsByClassName('react-root')[0]

ReactDOM.render(
  <AppMain />,
  reactRootElement
)
