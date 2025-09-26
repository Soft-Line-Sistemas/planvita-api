import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { ApiResponse } from "../types";

/**
 * Generate a unique UUID
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a secure API key
 */
export function generateApiKey(): string {
  return `pk_${crypto.randomBytes(32).toString("hex")}`;
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 12);
}

/**
 * Verify an API key against its hash
 */
export async function verifyApiKey(
  apiKey: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(apiKey, hash);
}

/**
 * Create a standardized API response
 */
export function createApiResponse<T>(
  success: boolean,
  data?: T,
  error?: { code: string; message: string; details?: any },
  metadata?: { requestId?: string; provider?: string; tenantId?: string },
): ApiResponse<T> {
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
export function createSuccessResponse<T>(
  data: T,
  metadata?: {
    requestId?: string;
    provider?: string;
  },
): ApiResponse<T> {
  return createApiResponse(true, data, undefined, metadata);
}

/**
 * Create an error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: any,
  metadata?: {
    requestId?: string;
    provider?: string;
  },
): ApiResponse {
  return createApiResponse(
    false,
    undefined,
    { code, message, details },
    metadata,
  );
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Brazilian CPF
 */
export function isValidCPF(cpf: string): boolean {
  // Remove non-numeric characters
  const cleanCpf = cpf.replace(/\D/g, "");

  // Check if has 11 digits
  if (cleanCpf.length !== 11) return false;

  // Check if all digits are the same
  if (/^(\d)\1{10}$/.test(cleanCpf)) return false;

  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanCpf.charAt(i)) * (10 - i);
  }
  let remainder = sum % 11;
  let digit1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(cleanCpf.charAt(9)) !== digit1) return false;

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
export function isValidCNPJ(cnpj: string): boolean {
  // Remove non-numeric characters
  const cleanCnpj = cnpj.replace(/\D/g, "");

  // Check if has 14 digits
  if (cleanCnpj.length !== 14) return false;

  // Check if all digits are the same
  if (/^(\d)\1{13}$/.test(cleanCnpj)) return false;

  // Validate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleanCnpj.charAt(i)) * weights1[i];
  }
  let remainder = sum % 11;
  let digit1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(cleanCnpj.charAt(12)) !== digit1) return false;

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
export function isValidDocument(document: string): boolean {
  const cleanDoc = document.replace(/\D/g, "");

  if (cleanDoc.length === 11) {
    return isValidCPF(cleanDoc);
  } else if (cleanDoc.length === 14) {
    return isValidCNPJ(cleanDoc);
  }

  return false;
}

/**
 * Format currency value
 */
export function formatCurrency(
  amount: number,
  currency: string = "BRL",
): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency,
  }).format(amount);
}

/**
 * Convert amount to cents (for API calls)
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert amount from cents
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Sanitize phone number
 */
export function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Format phone number for display
 */
export function formatPhone(phone: string): string {
  const clean = sanitizePhone(phone);

  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  } else if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }

  return phone;
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitiveData(
  data: string,
  visibleChars: number = 4,
): string {
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
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const cloned = {} as T;
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
export function isEmpty(obj: any): boolean {
  if (obj == null) return true;
  if (Array.isArray(obj) || typeof obj === "string") return obj.length === 0;
  if (typeof obj === "object") return Object.keys(obj).length === 0;
  return false;
}

/**
 * Generate a random string
 */
export function randomString(length: number = 10): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}
