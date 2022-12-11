// These interfaces are according to https://www.w3.org/TR/webtransport/#dom-webtransport-webtransport

export interface WebTransport {
    ready: Promise<void>;
    closed: Promise<void>;

    createBidirectionalStream(): WebTransportStream;
    datagrams: WebTransportStream;

    close(): void | Promise<void>;
}

export interface WebTransportHash {
    algorithm: string;
    value: BufferSource;
}

export interface WebTransportOptions {
    allowPooling?: boolean;
    requireUnreliable?: boolean;
    serverCertificateHashes?: WebTransportHash[];
}

export interface WebTransportStream {
    writable: WritableStream<Uint8Array>;
    readable: ReadableStream<Uint8Array>;
}

// Usage: `declare var WebTransport: WebTransportConstructor;`
export interface WebTransportConstructor {
    prototype: WebTransport;
    new(url: string, options?: WebTransportOptions): WebTransport;
}
