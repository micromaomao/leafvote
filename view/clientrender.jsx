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
    }
  }

  render () {
    return <div>
      Hello world.
    </div>
  }
}

let reactRootElement = document.getElementsByClassName('react-root')[0]

ReactDOM.render(
  <AppMain />,
  reactRootElement
)
