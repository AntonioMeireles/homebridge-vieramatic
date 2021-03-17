// loosely based in the previously used https://github.com/bazwilliams/node-upnp-subscription

import { EventEmitter } from 'events'
import http from 'http'
import { AddressInfo } from 'net'
import { networkInterfaces } from 'os'

import parser from 'fast-xml-parser'

class UPNPSubscription extends EventEmitter {
  private readonly subscriptions = new Map()

  private timeoutSeconds: number
  private resubscribeTimeout!: NodeJS.Timeout

  private sid: string | string[] | undefined

  private httpServerPort!: number
  private httpServerStarting = false
  private httpServerStarted = false

  private readonly baseConfig: Record<string, unknown>

  private readonly publicIP = Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i?.internal)?.address

  constructor(host: string, port: number, eventSub: string, requestedTimeoutSeconds = 3) {
    super()
    this.setMaxListeners(100)

    this.timeoutSeconds = requestedTimeoutSeconds

    this.baseConfig = {
      host,
      method: 'SUBSCRIBE',
      path: eventSub,
      port
    }

    this.httpServerStarted ? this.init.bind(this) : this.bootstrap(this.init.bind(this))
  }

  private bootstrap(callback: (...args: unknown[]) => void): void {
    if (this.httpServerStarting) this.once('started', callback)
    else {
      this.httpServerStarting = true
      const httpSubscriptionResponseServer = http.createServer()

      httpSubscriptionResponseServer.listen(0, () => {
        this.httpServerStarted = true
        this.emit('started')
        this.httpServerStarting = false
        this.httpServerPort = (httpSubscriptionResponseServer.address() as AddressInfo).port

        httpSubscriptionResponseServer.on('request', (req, res) => {
          const sid = req.headers.sid
          let data = ''

          req
            .setEncoding('utf8')
            .on('data', (chunk: string) => (data += chunk))
            .on('end', () => {
              if (res != null) res.end()
              const emitter = this.subscriptions.get(sid)
              if (emitter != null) emitter.emit('message', { body: parser.parse(data), sid: sid })
            })
        })
        callback()
      })
    }
  }

  private resubscribe(): void {
    if (this.sid != null)
      http
        .request(
          Object.assign(this.baseConfig, {
            headers: {
              SID: this.sid,
              TIMEOUT: `Second-${this.timeoutSeconds}`
            }
          }),
          () => {
            this.emit('resubscribed', { sid: this.sid })
            this.resubscribeTimeout = setTimeout(this.resubscribe, (this.timeoutSeconds - 1) * 1000)
          }
        )
        .on('error', (error) => this.emit('error:resubscribe', { error: error, sid: this.sid }))
        .end()
  }

  unsubscribe(): void {
    clearTimeout(this.resubscribeTimeout)
    if (this.sid != null) {
      http
        .request(
          Object.assign(this.baseConfig, {
            headers: { SID: this.sid },
            method: 'UNSUBSCRIBE'
          }),
          () => this.emit('unsubscribed', { sid: this.sid })
        )
        .on('error', (error) => this.emit('error:unsubscribe', error))
        .setTimeout(3000, () => this.emit('unsubscribed', { sid: this.sid }))
        .end()
      this.subscriptions.delete(this.sid)
    } else this.emit('error:unsubscribe', Error('No SID for subscription'))
  }

  private init(): void {
    http
      .request(
        Object.assign(this.baseConfig, {
          headers: {
            CALLBACK: `<http://${this.publicIP as string}:${this.httpServerPort}>`,
            NT: 'upnp:event',
            TIMEOUT: `Second-${this.timeoutSeconds}`
          }
        }),
        (res) => {
          this.sid = res.headers.sid
          this.emit('subscribed', { sid: this.sid })

          if (res.headers.timeout != null) {
            const subscriptionTimeout = res.headers.timeout.toString().match(/\d+/)

            if (subscriptionTimeout != null)
              this.timeoutSeconds = Number.parseInt(subscriptionTimeout[0], 10)
          }
          this.resubscribeTimeout = setTimeout(this.resubscribe, (this.timeoutSeconds - 1) * 1000)
          this.subscriptions.set(this.sid, this)
        }
      )
      .on('error', (error) => {
        this.emit('error', error)
        this.subscriptions.delete(this.sid)
      })
      .end()
  }
}

export default UPNPSubscription
