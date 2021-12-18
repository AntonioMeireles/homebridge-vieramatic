// loosely based in the previously used https://github.com/bazwilliams/node-upnp-subscription

import { EventEmitter } from 'events'
import http from 'http'
import { AddressInfo } from 'net'
import { networkInterfaces } from 'os'

import { xml2obj } from './helpers.server'

const TIMEOUT_IN_SECONDS = 2

class UPNPSubscription extends EventEmitter {
  readonly #subscriptions = new Map()
  #sid: string | string[] | undefined

  #httpServerPort!: number
  readonly #httpSubscriptionResponseServer!: http.Server

  readonly #baseConfig: Record<string, unknown>

  readonly #publicIP =
    Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i?.internal)?.address ?? ''

  constructor(host: string, port: number, eventSub: string) {
    super()
    this.setMaxListeners(10)

    this.#baseConfig = { host, method: 'SUBSCRIBE', path: eventSub, port }

    this.#httpSubscriptionResponseServer = http.createServer()

    this.#httpSubscriptionResponseServer.listen(0, () => {
      this.emit('started')
      this.#httpServerPort = (this.#httpSubscriptionResponseServer.address() as AddressInfo).port

      this.#httpSubscriptionResponseServer.on('request', (req, res) => {
        let data = ''

        req
          .setEncoding('utf8')
          .on('data', (chunk: string) => (data += chunk))
          .on('end', () => {
            const emitter = this.#subscriptions.get(this.#sid)
            if (res != null) res.end()
            if (emitter != null) emitter.emit('message', { body: xml2obj(data), sid: this.#sid })
          })
      })

      http
        .request(
          Object.assign(this.#baseConfig, {
            headers: {
              CALLBACK: `<http://${this.#publicIP}:${this.#httpServerPort}>`,
              NT: 'upnp:event',
              TIMEOUT: `Second-${TIMEOUT_IN_SECONDS}`
            }
          }),
          (res) => {
            this.#sid = res.headers.sid
            this.emit('subscribed', { sid: this.#sid })
            this.#subscriptions.set(this.#sid, this)
          }
        )
        .on('error', (error) => {
          this.emit('error', error)
          this.#subscriptions.delete(this.#sid)
          this.#httpSubscriptionResponseServer.close()
        })
        .end()
    })
  }

  unsubscribe = (): void => {
    const didIt = (): boolean => this.emit('unsubscribed', { sid: this.#sid })
    const didnt = (error: Error): boolean => this.emit('error:unsubscribe', error)

    if (this.#sid != null) {
      const method = { headers: { SID: this.#sid }, method: 'UNSUBSCRIBE' }
      http
        .request(Object.assign(this.#baseConfig, method), didIt)
        .on('error', didnt)
        .setTimeout(TIMEOUT_IN_SECONDS * 1000, didIt)
        .end()
      this.#subscriptions.delete(this.#sid)
    } else didnt(Error('No SID for subscription'))

    this.#httpSubscriptionResponseServer.close()
  }
}

export default UPNPSubscription
