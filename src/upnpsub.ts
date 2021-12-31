// loosely based in the previously used https://github.com/bazwilliams/node-upnp-subscription

import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { networkInterfaces, NetworkInterfaceInfo } from 'node:os'

import { Outcome } from './helpers'
import { xml2obj } from './helpers.server'
import { VieraTV } from './viera'

const TIMEOUT_IN_SECONDS = 2

class UPnPSubscription extends EventEmitter {
  readonly #subscriptions = new Map()
  #sid: string | string[] | undefined

  #httpServerPort!: number
  readonly #httpSubscriptionResponseServer!: http.Server

  readonly #baseConfig: Record<string, unknown>

  readonly #publicIP =
    Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i.internal)?.address ?? ''

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
            if (res as unknown) res.end()
            if (emitter) emitter.emit('message', { body: xml2obj(data), sid: this.#sid })
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

    if (this.#sid) {
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

const vieraFinder = async (st: string = VieraTV.URN): Promise<Outcome<string[]>> => {
  const mcast = { host: '239.255.255.250', port: 1900 }
  const timeout = 5000
  const found = new Set<string>()
  const message = Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST:${mcast.host}:${mcast.port}`,
      'MAN:"ssdp:discover"',
      `ST:${st}`,
      'MX:1',
      '\r\n'
    ].join('\r\n')
  )
  const interfaces = ((Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal) as unknown) || []) as NetworkInterfaceInfo[]

  const sockets = interfaces.map((i) => {
    const socket = dgram.createSocket({ reuseAddr: true, type: 'udp4' })
    socket
      .bind(0, i.address)
      .on('message', (_, tv: dgram.RemoteInfo) => !found.has(tv.address) && found.add(tv.address))
      .send(message, 0, message.length, mcast.port, mcast.host)

    return socket
  })

  return await new Promise((resolve) =>
    setTimeout(() => {
      resolve({ value: [...found] })
      for (const socket of sockets) socket.close()
    }, timeout)
  )
}

export { UPnPSubscription, vieraFinder }
