import AMQPBaseClient from './amqp-base-client.js'
import { Buffer } from 'buffer'
import './amqp-view.js'

/** 
 * WebSocket client for AMQP 0-9-1 servers
 */
export default class AMQPWebSocketClient extends AMQPBaseClient {
  readonly url: string
  private socket?: WebSocket

/** 
 * @param url to the websocket endpoint, example: wss://server/ws/amqp
 */
  constructor(url: string, vhost = "/", username = "guest", password = "guest", name?: string) {
    super(vhost, username, password, name, AMQPWebSocketClient.platform())
    this.url = url
  }

  /**
   * Establish a AMQP connection over WebSocket
   */
  override connect(): Promise<AMQPBaseClient> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = this.handleMessage.bind(this)
    return new Promise((resolve, reject) => {
      this.connectPromise = [resolve, reject]
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => socket.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
    })
  }

  /**
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  override send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        try {
          this.socket.send(bytes)
          resolve()
        } catch (err) {
          reject(err)
        }
      } else {
        reject("Socket not connected")
      }
    })
  }

  protected override closeSocket() {
    if (this.socket) this.socket.close()
  }

  private framePos = 0
  private frameSize = 0
  private frameBuffer = Buffer.alloc(4096)

  private handleMessage(event: MessageEvent) {
    const buf = Buffer.from(event.data)
    // A socket read can contain 0 or more frames, so find frame boundries
    let bufPos = 0
    while (bufPos < buf.byteLength) {
      // read frame size of next frame
      if (this.frameSize === 0) {
        // first 7 bytes of a frame was split over two reads, this reads the second part
        if (this.framePos !== 0) {
          const len = buf.byteLength - bufPos
          this.frameBuffer.set(new Uint8Array(buf, bufPos), this.framePos)
          this.frameSize = this.frameBuffer.readInt32BE(bufPos + 3) + 8
          this.framePos += len
          bufPos += len
          continue
        }
        // frame header is split over multiple reads, copy to frameBuffer
        if (bufPos + 3 + 4 > buf.byteLength) {
          const len = buf.byteLength - bufPos
          buf.copy(this.frameBuffer, this.framePos, bufPos, bufPos + len)
          this.framePos += len
          break
        }

        this.frameSize = buf.readInt32BE(bufPos + 3) + 8

        // avoid copying if the whole frame is in the read buffer
        if (buf.byteLength - bufPos >= this.frameSize) {
          this.parseFrames(buf.subarray(bufPos, bufPos + this.frameSize))
          bufPos += this.frameSize
          this.frameSize = 0
          continue
        }
      }

      const leftOfFrame = this.frameSize - this.framePos
      const copyBytes = Math.min(leftOfFrame, buf.byteLength - bufPos)

      buf.copy(this.frameBuffer, this.framePos, bufPos, bufPos + copyBytes)
      this.framePos += copyBytes
      bufPos += copyBytes
      if (this.framePos === this.frameSize) {
        this.parseFrames(this.frameBuffer.subarray(bufPos, bufPos + this.frameSize))
        this.frameSize = this.framePos = 0
      }
    }
  }

  static platform(): string {
    if (typeof(window) !== 'undefined')
      return window.navigator.userAgent
    else
      return `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
  }
}