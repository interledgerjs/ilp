"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class UnwrappedPromise {
    constructor() {
        this.innerPromise = new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;
        });
    }
    get promise() {
        return this.innerPromise;
    }
    resolve(value) {
        return this.resolveCallback ? this.resolveCallback(value) : undefined;
    }
    reject(reason) {
        return this.rejectCallback ? this.rejectCallback(reason) : undefined;
    }
}
exports.UnwrappedPromise = UnwrappedPromise;
//# sourceMappingURL=promise.js.map