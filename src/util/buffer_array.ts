export class BufferArray {
    private buf: Uint8Array[] = [];
    private buflen: number = 0;

    public add(data: Uint8Array): void {
        this.buf.push(data); 
        this.buflen += data.length;
    }

    private shift(): Uint8Array | undefined {
        const d = this.buf.shift();
        if (d) {
            this.buflen -= d.length;
        }
        return d;
    }

    private unshift(d: Uint8Array): void {
        this.buf.unshift(d);
        this.buflen += d.length;
    }

    public read(count: number): Uint8Array | undefined {
        if (count < 1) {
            throw new Error("Can not read less than 1 byte");
        }

        if (this.buflen < count) {
            return undefined;
        }

        let left = count;
        let offset = 0;
        const res = new Uint8Array(count);

        while (true) {
            const d = this.shift()!;

            const diff = d.length - left;

            if (diff >= 0) {
                res.set(d.slice(0, left), offset);
                if (diff > 0) {
                    this.unshift(d.slice(left));
                }
                break;
            }

            res.set(d, offset);
            offset += d.length;
            left -= d.length;
        }

        return res;
    }
}
