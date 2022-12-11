import { ClosedError, NotReadyError } from "../util/errors.js";
import { WSVPNBase } from "./base.js";

export class WSVPNWebSocket extends WSVPNBase {
    private webSocket?: WebSocket;

    constructor(url: string, private protocols?: string | string[]) {
        super(url);
    }

    protected async closeInternal(): Promise<void> {
        this.webSocket?.close();
    }

    protected async connectInternal(): Promise<void> {
        this.webSocket = new WebSocket(this.url, this.protocols);
        this.webSocket.binaryType = "arraybuffer";
        this.webSocket.onmessage = this.websocketOnMessage.bind(this);
        
        return new Promise<void>((resolve, reject) => {
            this.webSocket!.onopen = () => resolve();
            this.webSocket!.onerror = (_ev: Event) => {
                const err = new Error("WebSocket error");
                this.closeError(err);
                reject(err);
            }
            this.webSocket!.onclose = () => {
                this.close();
                reject(new ClosedError())
            }
        });
    }

    private async websocketOnMessage(ev: MessageEvent<any>): Promise<void> {
        switch (typeof ev.data) {
            case "string":
                await this.handleControl(ev.data);
                return;
            case "object":
                if (ev.data instanceof Blob) {
                    await this.handleData(await ev.data.arrayBuffer());
                } else if (ev.data instanceof ArrayBuffer) {
                    await this.handleData(ev.data);
                }
                return;
        }
    }

    protected async sendCommandInternal(dataStr: string): Promise<void> {
        if (!this.webSocket) {
            throw new NotReadyError();
        }

        this.webSocket.send(dataStr);
    }

    protected async sendDataInternal(data: ArrayBuffer): Promise<void> {
        if (!this.webSocket) {
            throw new NotReadyError();
        }

        this.webSocket.send(data);
    }    
}
