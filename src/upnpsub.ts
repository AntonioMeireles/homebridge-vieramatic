// loosely based in the previously used https://github.com/bazwilliams/node-upnp-subscription

import { EventEmitter } from 'events'
import http from 'http'
import { AddressInfo } from 'net'
import { networkInterfaces } from 'os'

import parser from 'fast-xml-parser'

const TIMEOUT_IN_SECONDS = 2

class UPNPSubscription extends EventEmitter {
  private readonly subscriptions = new Map()
  private sid: string | string[] | undefined

  private httpServerPort!: number
  private readonly httpSubscriptionResponseServer!: http.Server

  private readonly baseConfig: Record<string, unknown>

  private readonly publicIP =
    Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i?.internal)?.address ?? ''

  constructor(host: string, port: number, eventSub: string) {
    super()
    this.setMaxListeners(10)

    this.baseConfig = { host, method: 'SUBSCRIBE', path: eventSub, port }

    this.httpSubscriptionResponseServer = http.createServer()

    this.httpSubscriptionResponseServer.listen(0, () => {
      this.emit('started')
      this.httpServerPort = (this.httpSubscriptionResponseServer.address() as AddressInfo).port

      this.httpSubscriptionResponseServer.on('request', (req, res) => {
        const sid = req.headers.sid
        let data = ''

        req
          .setEncoding('utf8')
          .on('data', (chunk: string) => (data += chunk))
          .on('end', () => {
            if (res != null) res.end()
            const emitter = this.subscriptions.get(sid)
            if (emitter != null) emitter.emit('message', { body: parser.parse(data), sid })
          })
      })

      http
        .request(
          Object.assign(this.baseConfig, {
            headers: {
              CALLBACK: `<http://${this.publicIP}:${this.httpServerPort}>`,
              NT: 'upnp:event',
              TIMEOUT: `Second-${TIMEOUT_IN_SECONDS}`
            }
          }),
          (res) => {
            this.sid = res.headers.sid
            this.emit('subscribed', { sid: this.sid })
            this.subscriptions.set(this.sid, this)
          }
        )
        .on('error', (error) => {
          this.emit('error', error)
          this.subscriptions.delete(this.sid)
          this.httpSubscriptionResponseServer.close()
        })
        .end()
    })
  }

  unsubscribe(): void {
    if (this.sid != null) {
      http
        .request(
          Object.assign(this.baseConfig, { headers: { SID: this.sid }, method: 'UNSUBSCRIBE' }),
          () => this.emit('unsubscribed', { sid: this.sid })
        )
        .on('error', (error) => this.emit('error:unsubscribe', error))
        .setTimeout(TIMEOUT_IN_SECONDS * 1000, () => this.emit('unsubscribed', { sid: this.sid }))
        .end()
      this.subscriptions.delete(this.sid)
    } else this.emit('error:unsubscribe', Error('No SID for subscription'))

    this.httpSubscriptionResponseServer.close()
  }
}

export default UPNPSubscription
