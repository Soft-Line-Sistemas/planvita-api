import { Request } from 'express';

export type UserPayload = {
  id: number;
  nome: string;
  email: string;
  role: {
    id: number;
    name: string;
  } | null;
  permissions: string[];
  tenant: string;
};

export interface AuthRequest extends Request {
  user?: UserPayload;
}
