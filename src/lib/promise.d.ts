export declare class UnwrappedPromise<T> {
    private innerPromise;
    private resolveCallback?;
    private rejectCallback?;
    constructor();
    readonly promise: Promise<T>;
    resolve(value?: T | PromiseLike<T>): void;
    reject(reason?: any): void;
}
