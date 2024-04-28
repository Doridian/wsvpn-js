import { ClosedError } from "../util/errors.js";
import { InitParameters } from "../util/params.js";

interface PromiseResolver<T> {
    resolve(param: T): void;
    reject(err: Error): void;
}

type DefragObject = {
    time: number;
    data: Map<number, ArrayBuffer>;
    lastIndex: number;
    totalLen: number;
};

export class WSVPNErrorEvent extends ErrorEvent {
    constructor(error: Error) {
        super("error", { error });
    }
}

export class InitEvent extends Event {
    constructor(public readonly params: InitParameters) {
        super("init");
    }
}

export class PacketEvent extends Event {
    constructor(public readonly packet: ArrayBuffer) {
        super("packet");
    }
}

export class CloseEvent extends Event {
    constructor() {
        super("close");
    }
}

interface WSVPNEventTarget extends EventTarget {
    addEventListener(type: "error", callback: (evt: WSVPNErrorEvent) => void): void;
    addEventListener(type: "init", callback: (evt: InitEvent) => void): void;
    addEventListener(type: "close", callback: (evt: CloseEvent) => void): void;
    addEventListener(type: "packet", callback: (evt: PacketEvent) => void): void;
}

const wsvpnEventTargetOverride = EventTarget as {new(): WSVPNEventTarget; prototype: WSVPNEventTarget};

export abstract class WSVPNBase extends wsvpnEventTargetOverride {
    private remoteFeatures: Set<string> = new Set();
    private usedFeatures: Set<string> = new Set();
    private localFeatures: Set<string> = new Set([
        "fragmentation",
    ]);
    private fragmentationEnabled: boolean = false;
    private replyPromises: Map<string, PromiseResolver<string>> = new Map();

    private readyResolver?: PromiseResolver<InitParameters>;

    private defragBuffer: Map<number, DefragObject> = new Map();
    private defragPacketId: number = 0;

    private defragCleanupInterval?: number;

    protected constructor(protected url: string, private maxPacketSize: number = 65535) {
        super();
    }

    private defragCleanup(): void {
        const minTime = Date.now() - 30000;
        const rmIdx: number[] = [];

        for (const [idx, defrag] of this.defragBuffer.entries()) {
            if (defrag.time < minTime) {
                rmIdx.push(idx);
            }
        }

        for (const idx of rmIdx) {
            this.defragBuffer.delete(idx);
        }
    }

    public async connect(): Promise<InitParameters> {
        await this.closeNoEvent();

        const readyPromise = new Promise<InitParameters>((resolve, reject) => {
            this.readyResolver = {
                resolve,
                reject,
            };
        });

        await this.connectInternal();
        
        await this.sendCommand("version", {
            version: "wsvpn web",
            protocol_version: 12,
            enabled_features: [...this.localFeatures],
        });

        this.defragCleanupInterval = setInterval(this.defragCleanup.bind(this), 1000);

        return readyPromise;
    }

    public async sendCommand(command: string, parameters: unknown, waitForReply: boolean = true, id: string = ""): Promise<string> {
        if (!id) {
            id = crypto.randomUUID();
        }

        const jsonStr = JSON.stringify({
            id,
            command,
            parameters,
        });

        let replyPromise;
        if (waitForReply) {
            replyPromise = new Promise<string>((resolve, reject) => {
                const replyPromiseObj: PromiseResolver<string> = {
                    resolve,
                    reject,
                };
                this.replyPromises.set(id, replyPromiseObj);
            });
        }

        await this.sendCommandInternal(jsonStr);

        if (replyPromise) {
            return await replyPromise;
        }

        return "";
    }

    protected async handleControl(dataStr: string): Promise<void> {
        let data;
        try {
            data = JSON.parse(dataStr);
        } catch (e) {
            console.error("Error decoding command", e);
            return;
        }

        try {
            switch (data.command) {
                case "reply":
                    const replyPromise = this.replyPromises.get(data.id);
                    if (replyPromise) {
                        this.replyPromises.delete(data.id);

                        if (data.parameters.ok) {
                            replyPromise.resolve(data.parameters.message);
                        } else {
                            replyPromise.reject(new Error(data.parameters.message));
                        }
                    }
                    return;
                case "version":
                    this.remoteFeatures = new Set(data.parameters.enabled_features);
                    this.usedFeatures = new Set([...this.localFeatures].filter(f => this.remoteFeatures.has(f)));
                    this.fragmentationEnabled = this.usedFeatures.has("fragmentation");
                    break;
                case "init":
                    this.dispatchEvent(new InitEvent(data.parameters));
                    this.readyResolver?.resolve(data.parameters);
                    this.readyResolver = undefined;
                    break;
            }
        } catch (e: any) {
            console.error("Error handling command", e);
            this.sendCommand("reply", {
                ok: false,
                message: e.toString(),
            }, false, data.id);
            return;
        }

        this.sendCommand("reply", {
            ok: true,
            message: "OK",
        }, false, data.id);
    }

    protected async handleData(data: ArrayBuffer): Promise<void> {
        if (!this.fragmentationEnabled) {
            await this.handlePacket(data);
            return;
        }

        const d8 = new Uint8Array(data);

        const fragIdent = d8[0];
        if (fragIdent === 0b10000000) {
            await this.handlePacket(data.slice(1));
            return;
        }

        const fragIndex = fragIdent & 0b01111111;
        const isLastFragment = (fragIdent & 0b10000000) === 0b10000000;

        const packetId = (d8[1] << 24) | (d8[2] << 16) | (d8[3] << 8) | d8[4];

        let defrag = this.defragBuffer.get(packetId);
        if (!defrag) {
            defrag = {
                lastIndex: -1000,
                time: 0,
                totalLen: 0,
                data: new Map(),
            };
            this.defragBuffer.set(packetId, defrag);
        }

        defrag.time = Date.now();
        const fragData = data.slice(5);
        defrag.data.set(fragIndex, fragData);
        defrag.totalLen += fragData.byteLength;

        if (isLastFragment) {
            defrag.lastIndex = fragIndex;
        }

        if (defrag.data.size === defrag.lastIndex+1) {
            this.defragBuffer.delete(packetId);

            const pkt = new ArrayBuffer(defrag.totalLen);
            const pkt8 = new Uint8Array(pkt);
            let offset = 0;
            for (let i = 0; i < defrag.lastIndex; i++) {
                const d = defrag.data.get(i)!;
                pkt8.set(new Uint8Array(d), offset);
                offset += d.byteLength;
            }

            this.handlePacket(pkt);
        }
    }

    public async sendPacket(packet: ArrayBuffer): Promise<void> {
        if (!this.fragmentationEnabled) {
            await this.sendDataInternal(packet);
            return;
        }

        const p8 = new Uint8Array(packet);

        if (packet.byteLength < this.maxPacketSize) {
            const data = new ArrayBuffer(packet.byteLength + 1);
            const d8 = new Uint8Array(data);
            d8[0] = 0b10000000;
            d8.set(p8, 1);
            await this.sendDataInternal(d8);
            return;
        }

        const packetId = this.defragPacketId++;

        let fragIndex = 0;
        for (let offset = 0; offset < packet.byteLength; offset += this.maxPacketSize) {
            const left = packet.byteLength - offset;
            
            const useLen = Math.min(this.maxPacketSize, left);
            const data = new ArrayBuffer(useLen + 5);
            const d8 = new Uint8Array(data);
            
            d8[0] = fragIndex;
            if (left < this.maxPacketSize) {
                d8[0] |= 0b10000000;
            }

            d8[1] = (packetId >>> 24) & 0xFF;
            d8[2] = (packetId >>> 16) & 0xFF;
            d8[3] = (packetId >>> 8) & 0xFF;
            d8[4] = packetId & 0xFF;

            d8.set(new Uint8Array(packet, offset, useLen), 5);

            await this.sendDataInternal(data);

            fragIndex++;
        }
    }

    public async handlePacket(packet: ArrayBuffer): Promise<void> {
        this.dispatchEvent(new PacketEvent(packet));
    }

    protected async closeOnDone(promise: Promise<unknown>): Promise<void> {
        try {
            await promise;
        } catch (e) {
            await this.closeError(e as Error);
            return;
        }
        await this.close();
    }

    public async closeError(err: Error): Promise<void> {
        this.dispatchEvent(new WSVPNErrorEvent(err));
        await this.close();
    }

    public async close(): Promise<void> {        
        await this.closeNoEvent();
        this.dispatchEvent(new CloseEvent());
    }

    private async closeNoEvent(): Promise<void> {
        this.readyResolver?.reject(new ClosedError());
        this.readyResolver = undefined;

        await this.closeInternal();
        
        if (this.defragCleanupInterval !== undefined) {
            clearInterval(this.defragCleanupInterval);
            this.defragCleanupInterval = undefined;
        }
        this.defragBuffer.clear();
    }

    protected abstract closeInternal(): Promise<void>;
    protected abstract connectInternal(): Promise<void>;

    protected abstract sendCommandInternal(dataStr: string): Promise<void>;
    protected abstract sendDataInternal(data: ArrayBuffer): Promise<void>;
}
