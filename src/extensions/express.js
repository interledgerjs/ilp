"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const __1 = require("..");
function createMiddleware(responseTemplate, plugin = __1.createPlugin()) {
    return __awaiter(this, void 0, void 0, function* () {
        const server = yield __1.STREAM.createServer({ plugin });
        return (req, rsp) => {
            const { destinationAccount, sharedSecret } = server.generateAddressAndSecret();
            rsp.set('Content-Type', __1.SPSP.CONTENT_TYPE);
            const balance = (req.query.amount) ? {
                current: '0',
                maximum: `${req.query.amount}`
            } : undefined;
            rsp.send(Object.assign({}, responseTemplate, { destination_account: destinationAccount, shared_secret: sharedSecret.toString('base64'), balance }));
        };
    });
}
exports.createMiddleware = createMiddleware;
//# sourceMappingURL=express.js.map