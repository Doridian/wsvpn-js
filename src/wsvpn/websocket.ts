import { ClosedError, NotReadyError } from "../util/errors";
import { WSVPNBase } from "./base";

export class WSVPNWebSocket extends WSVPNBase {
    private webSocket?: WebSocket;

    constructor(url: string) {
        super(url);
    }

    protected async closeInternal(): Promise<void> {
        this.webSocket?.close();
    }

    protected async connectInternal(): Promise<void> {
        this.webSocket = new WebSocket(this.url);
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
                    await this.handleData(new Uint8Array(await ev.data.arrayBuffer()));
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

    protected async sendDataInternal(data: Uint8Array): Promise<void> {
        if (!this.webSocket) {
            throw new NotReadyError();
        }

        this.webSocket.send(data);
    }    
}
