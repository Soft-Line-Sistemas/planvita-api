"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = generateId;
exports.generateRequestId = generateRequestId;
exports.generateApiKey = generateApiKey;
exports.hashApiKey = hashApiKey;
exports.verifyApiKey = verifyApiKey;
exports.createApiResponse = createApiResponse;
exports.createSuccessResponse = createSuccessResponse;
exports.createErrorResponse = createErrorResponse;
exports.isValidEmail = isValidEmail;
exports.isValidCPF = isValidCPF;
exports.isValidCNPJ = isValidCNPJ;
exports.isValidDocument = isValidDocument;
exports.formatCurrency = formatCurrency;
exports.toCents = toCents;
exports.fromCents = fromCents;
exports.sanitizePhone = sanitizePhone;
exports.formatPhone = formatPhone;
exports.maskSensitiveData = maskSensitiveData;
exports.sleep = sleep;
exports.retry = retry;
exports.deepClone = deepClone;
exports.isEmpty = isEmpty;
exports.randomString = randomString;
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
/**
 * Generate a unique UUID
 */
function generateId() {
    return (0, uuid_1.v4)();
}
/**
 * Generate a unique request ID for tracing
 */
function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Generate a secure API key
 */
function generateApiKey() {
    return `pk_${crypto_1.default.randomBytes(32).toString("hex")}`;
}
/**
 * Hash an API key for storage
 */
async function hashApiKey(apiKey) {
    return bcryptjs_1.default.hash(apiKey, 12);
}
/**
 * Verify an API key against its hash
 */
async function verifyApiKey(apiKey, hash) {
    return bcryptjs_1.default.compare(apiKey, hash);
}
/**
 * Create a standardized API response
 */
function createApiResponse(success, data, error, metadata) {
    return {
        success,
        data,
        error,
        metadata: {
            timestamp: new Date().toISOString(),
            requestId: metadata?.requestId ?? generateRequestId(),
            ...metadata,
        },
    };
}
/**
 * Create a success response
 */
function createSuccessResponse(data, metadata) {
    return createApiResponse(true, data, undefined, metadata);
}
/**
 * Create an error response
 */
function createErrorResponse(code, message, details, metadata) {
    return createApiResponse(false, undefined, { code, message, details }, metadata);
}
/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
/**
 * Validate Brazilian CPF
 */
function isValidCPF(cpf) {
    // Remove non-numeric characters
    const cleanCpf = cpf.replace(/\D/g, "");
    // Check if has 11 digits
    if (cleanCpf.length !== 11)
        return false;
    // Check if all digits are the same
    if (/^(\d)\1{10}$/.test(cleanCpf))
        return false;
    // Validate first check digit
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(cleanCpf.charAt(i)) * (10 - i);
    }
    let remainder = sum % 11;
    let digit1 = remainder < 2 ? 0 : 11 - remainder;
    if (parseInt(cleanCpf.charAt(9)) !== digit1)
        return false;
    // Validate second check digit
    sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(cleanCpf.charAt(i)) * (11 - i);
    }
    remainder = sum % 11;
    let digit2 = remainder < 2 ? 0 : 11 - remainder;
    return parseInt(cleanCpf.charAt(10)) === digit2;
}
/**
 * Validate Brazilian CNPJ
 */
function isValidCNPJ(cnpj) {
    // Remove non-numeric characters
    const cleanCnpj = cnpj.replace(/\D/g, "");
    // Check if has 14 digits
    if (cleanCnpj.length !== 14)
        return false;
    // Check if all digits are the same
    if (/^(\d)\1{13}$/.test(cleanCnpj))
        return false;
    // Validate first check digit
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(cleanCnpj.charAt(i)) * weights1[i];
    }
    let remainder = sum % 11;
    let digit1 = remainder < 2 ? 0 : 11 - remainder;
    if (parseInt(cleanCnpj.charAt(12)) !== digit1)
        return false;
    // Validate second check digit
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    sum = 0;
    for (let i = 0; i < 13; i++) {
        sum += parseInt(cleanCnpj.charAt(i)) * weights2[i];
    }
    remainder = sum % 11;
    let digit2 = remainder < 2 ? 0 : 11 - remainder;
    return parseInt(cleanCnpj.charAt(13)) === digit2;
}
/**
 * Validate Brazilian document (CPF or CNPJ)
 */
function isValidDocument(document) {
    const cleanDoc = document.replace(/\D/g, "");
    if (cleanDoc.length === 11) {
        return isValidCPF(cleanDoc);
    }
    else if (cleanDoc.length === 14) {
        return isValidCNPJ(cleanDoc);
    }
    return false;
}
/**
 * Format currency value
 */
function formatCurrency(amount, currency = "BRL") {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: currency,
    }).format(amount);
}
/**
 * Convert amount to cents (for API calls)
 */
function toCents(amount) {
    return Math.round(amount * 100);
}
/**
 * Convert amount from cents
 */
function fromCents(cents) {
    return cents / 100;
}
/**
 * Sanitize phone number
 */
function sanitizePhone(phone) {
    return phone.replace(/\D/g, "");
}
/**
 * Format phone number for display
 */
function formatPhone(phone) {
    const clean = sanitizePhone(phone);
    if (clean.length === 10) {
        return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
    }
    else if (clean.length === 11) {
        return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
    }
    return phone;
}
/**
 * Mask sensitive data for logging
 */
function maskSensitiveData(data, visibleChars = 4) {
    if (data.length <= visibleChars) {
        return "*".repeat(data.length);
    }
    const visible = data.slice(-visibleChars);
    const masked = "*".repeat(data.length - visibleChars);
    return masked + visible;
}
/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Retry function with exponential backoff
 */
async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === maxAttempts) {
                throw lastError;
            }
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await sleep(delay);
        }
    }
    throw lastError;
}
/**
 * Deep clone an object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== "object") {
        return obj;
    }
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    if (obj instanceof Array) {
        return obj.map((item) => deepClone(item));
    }
    if (typeof obj === "object") {
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }
    return obj;
}
/**
 * Check if object is empty
 */
function isEmpty(obj) {
    if (obj == null)
        return true;
    if (Array.isArray(obj) || typeof obj === "string")
        return obj.length === 0;
    if (typeof obj === "object")
        return Object.keys(obj).length === 0;
    return false;
}
/**
 * Generate a random string
 */
function randomString(length = 10) {
    return crypto_1.default
        .randomBytes(Math.ceil(length / 2))
        .toString("hex")
        .slice(0, length);
}
