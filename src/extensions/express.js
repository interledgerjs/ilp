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
const invoice_1 = require("../lib/invoice");
function createMiddleware(responseTemplate, plugin = __1.createPlugin()) {
    return __awaiter(this, void 0, void 0, function* () {
        const server = yield __1.STREAM.createServer({ plugin });
        return (req, rsp) => {
            const reference = req.query.reference || undefined;
            const payee = (req.query.amount && !isNaN(+req.query.amount))
                ? new __1.InvoiceReceiver(+req.query.amount, reference, server)
                : server.generateAddressAndSecret(reference);
            const jsonPayee = invoice_1.serializePayee(payee);
            rsp.set('Content-Type', __1.SPSP.CONTENT_TYPE);
            rsp.send(Object.assign({}, responseTemplate, jsonPayee));
        };
    });
}
exports.createMiddleware = createMiddleware;
//# sourceMappingURL=express.js.map