import { ArrayBufferQueue } from "../util/buffer_queue.js";
import { NotReadyError } from "../util/errors.js";
import { WSVPNBase } from "./base.js";
import { WebTransportConstructor, WebTransport, WebTransportOptions, WebTransportStream } from "./webtransport-w3c.js";

const enum ControlStreamType {
    COMMAND = 0,
    PING = 1,
    PONG = 2,
}

declare var WebTransport: WebTransportConstructor;

export class WSVPNWebTransport extends WSVPNBase {
    private transport?: WebTransport;

    private stream?: WebTransportStream;

    private controlWriter?: WritableStreamDefaultWriter<Uint8Array>;
    private controlReader?: ReadableStreamDefaultReader<Uint8Array>;
    private dataWriter?: WritableStreamDefaultWriter<Uint8Array>;
    private dataReader?: ReadableStreamDefaultReader<Uint8Array>;

    private commandState: number = 0;
    private commandLen: number = 0;

    public constructor(url: string, private options?: WebTransportOptions) {
        super(url, 1200);
    }

    protected async connectInternal(): Promise<void> {
        this.transport = new WebTransport(this.url, this.options);
        this.closeOnDone(this.transport.closed);
        await this.transport.ready;

        this.stream = await this.transport.createBidirectionalStream();
        this.controlWriter = this.stream.writable.getWriter();
        this.controlReader = this.stream.readable.getReader();
    
        this.dataWriter = this.transport.datagrams.writable.getWriter();
        this.dataReader = this.transport.datagrams.readable.getReader();

        this.closeOnDone(this.streamReader());
        this.closeOnDone(this.datagramReader());
    }

    protected async closeInternal(): Promise<void> {
        await this.transport?.close();
    }

    protected async sendCommandInternal(dataStr: string): Promise<void> {
        if (!this.controlWriter) {
            throw new NotReadyError();
        }

        const controlU8Array = new Uint8Array(dataStr.length + 3);
        controlU8Array[0] = ControlStreamType.COMMAND;
        controlU8Array[1] = (dataStr.length >> 8) & 0xFF;
        controlU8Array[2] = dataStr.length & 0xFF;
    
        for (let i = 0; i < dataStr.length; i++) {
            controlU8Array[i + 3] = dataStr.charCodeAt(i);
        }
    
        await this.controlWriter.write(controlU8Array);
    }

    private async commandDecoder(buf: ArrayBufferQueue): Promise<boolean> {
        switch (this.commandState) {
            case 1:
                const dLen = buf.readU8(2);
                if (dLen) {
                    this.commandLen = (dLen[0] << 8) | dLen[1];
                    this.commandState = 2;
                    return true;
                }
                break;
            case 2:
                const dataU8 = buf.readU8(this.commandLen);
                if (dataU8) {
                    this.commandLen = 0;
                    this.commandState = 0;
                    const dataStr = String.fromCharCode(...dataU8);
                    await this.handleControl(dataStr);
                    return true;
                }
                break;
        }
        return false;
    }

    private async streamReader(): Promise<void>{
        if (!this.controlReader || !this.controlWriter) {
            throw new NotReadyError();
        }

        const buf = new ArrayBufferQueue();

        this.commandState = 0;
        this.commandLen = 0;

        let done;
        while (!done) {
            const res = await this.controlReader.read();
            done = res.done;

            if (!res.value || res.value.length < 1) {
                continue;
            }

            buf.add(res.value.buffer);

            while (true) {
                if (await this.commandDecoder(buf)) {
                    continue;
                }
                if (this.commandState > 0) {
                    break;
                }

                const typ = buf.readU8(1);
                if (!typ) {
                    break;
                }

                switch (typ[0]) {
                    case ControlStreamType.COMMAND:
                        this.commandState = 1;
                        this.commandDecoder(buf);
                        break;
                    case ControlStreamType.PING:
                        await this.controlWriter.write(new Uint8Array([ControlStreamType.PONG]));
                    case ControlStreamType.PONG:
                        // Ignore those for now...
                        break;
                }
            }
        }

        await this.close();
    }

    protected async sendDataInternal(data: ArrayBuffer): Promise<void> {
        if (!this.dataWriter) {
            throw new NotReadyError();
        }

        await this.dataWriter.write(new Uint8Array(data));
    }

    private async datagramReader(): Promise<void> {
        if (!this.dataReader) {
            throw new NotReadyError();
        }

        let done;
        while (!done) {
            const res = await this.dataReader.read();
            done = res.done;
            if (!res.value || res.value.length < 1) {
                continue;
            }
            await this.handleData(res.value.buffer);
        }

        await this.close();
    }
}
