"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("../../generated/prisma/client");
class PrismaInstance {
    constructor() { }
    static get instance() {
        if (!PrismaInstance._instance) {
            PrismaInstance._instance = new client_1.PrismaClient({
                log: ['query', 'error', 'info'],
            });
        }
        return PrismaInstance._instance;
    }
}
exports.prisma = PrismaInstance.instance;
