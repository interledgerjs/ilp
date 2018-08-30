export class UnwrappedPromise<T> {

  private innerPromise: Promise<T>
  private resolveCallback?: (value?: T | PromiseLike<T>) => void
  private rejectCallback?: (reason?: any) => void

  constructor () {
    this.innerPromise = new Promise((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject
    })
  }

  public get promise (): Promise<T> {
    return this.innerPromise
  }

  public resolve (value?: T | PromiseLike<T>) {
    return this.resolveCallback ? this.resolveCallback(value) : undefined
  }

  public reject (reason?: any) {
    return this.rejectCallback ? this.rejectCallback(reason) : undefined
  }

}
