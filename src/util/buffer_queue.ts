export class ArrayBufferQueue {
    private buf: ArrayBuffer[] = [];
    private buflen: number = 0;

    public add(data: ArrayBuffer): void {
        this.buf.push(data); 
        this.buflen += data.byteLength;
    }

    private shift(): ArrayBuffer | undefined {
        const d = this.buf.shift();
        if (d) {
            this.buflen -= d.byteLength;
        }
        return d;
    }

    private unshift(d: ArrayBuffer): void {
        this.buf.unshift(d);
        this.buflen += d.byteLength;
    }

    public read(count: number): ArrayBuffer | undefined {
        if (count < 1) {
            throw new Error("Can not read less than 1 byte");
        }

        if (this.buflen < count) {
            return undefined;
        }

        let left = count;
        let offset = 0;
        const res = new ArrayBuffer(count);
        const resView = new Uint8Array(res);

        while (true) {
            const d = this.shift()!;

            const diff = d.byteLength - left;

            if (diff >= 0) {
                resView.set(new Uint8Array(d, 0, left), offset);
                if (diff > 0) {
                    this.unshift(d.slice(left));
                }
                break;
            }

            resView.set(new Uint8Array(d), offset);
            offset += d.byteLength;
            left -= d.byteLength;
        }

        return res;
    }

    public readU8(count: number): Uint8Array | undefined {
        const d = this.read(count);
        if (!d) {
            return undefined;
        }
        return new Uint8Array(d);
    }
}
