export class NotReadyError extends Error {
    constructor() {
        super("Not ready");
    }
}

export class ClosedError extends Error {
    constructor() {
        super("Closed");
    }
}
