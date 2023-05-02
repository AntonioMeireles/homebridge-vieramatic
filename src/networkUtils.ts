// loosely based in the previously used https://github.com/bazwilliams/node-upnp-subscription

import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { networkInterfaces, NetworkInterfaceInfo } from 'node:os'

import { Outcome, sleep, Success } from './helpers'
import { xml2obj } from './helpers.server'
import { VieraTV } from './viera'

const TIMEOUT_IN_SECONDS = 1
const BROADCAST = '255.255.255.255'

// eslint-disable-next-line unicorn/prefer-event-target
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
            res.end()
            const emitter = this.#subscriptions.get(this.#sid)
            if (emitter) emitter.emit('message', { body: xml2obj(data), sid: this.#sid })
          })
      })

      const headers = {
        CALLBACK: `<http://${this.#publicIP}:${this.#httpServerPort}>`,
        NT: 'upnp:event',
        TIMEOUT: `Second-${TIMEOUT_IN_SECONDS}`
      }

      http
        .request(Object.assign(this.#baseConfig, { headers }), (res) => {
          this.#sid = res.headers.sid
          this.emit('subscribed', { sid: this.#sid })
          this.#subscriptions.set(this.#sid, this)
        })
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
  // 5s
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
      .on('message', (_, tv: dgram.RemoteInfo) => found.add(tv.address))
      .send(message, 0, message.length, mcast.port, mcast.host)

    return socket
  })

  return await new Promise((resolve) =>
    setTimeout(() => {
      resolve(Success([...found]))
      for (const socket of sockets) socket.close()
    }, timeout)
  )
}

const wakeOnLan = async (mac: string, address: string, packets = 3) => {
  const [port, interval] = [9, 100]

  const socket = dgram.createSocket({ reuseAddr: true, type: 'udp4' })

  const createMagicPacket = (mac: string): Buffer => {
    /**
     * Magic packet is:
     * FF (repeat 6)
     * MAC Address (repeat 16)
     */
    const [MAC_BYTES, MAC_REPETITIONS] = [6, 16]
    const macBuffer = Buffer.alloc(MAC_BYTES)
    const magic = Buffer.alloc(MAC_BYTES + MAC_REPETITIONS * MAC_BYTES)

    for (const [i, value] of mac.split(':').entries()) macBuffer[i] = Number.parseInt(value, 16)

    // start the magic packet from 6 bytes of FF
    for (let i = 0; i < MAC_BYTES; i++) magic[i] = 0xff
    // copy mac address 16 times
    for (let i = 0; i < MAC_REPETITIONS; i++)
      macBuffer.copy(magic, (i + 1) * MAC_BYTES, 0, macBuffer.length)

    return magic
  }
  const buffer = createMagicPacket(mac)

  const sendMagicPacket = async (address: string) => {
    // wired and, with luck, wirelessly
    for (const target of [BROADCAST, address]) socket.send(buffer, 0, buffer.length, port, target)

    await sleep(interval)
  }

  socket.once('listening', () => socket.setBroadcast(true))

  for (let i = 0; i < packets; i++) await sendMagicPacket(address)

  socket.close()
}

export { UPnPSubscription, vieraFinder, wakeOnLan }
