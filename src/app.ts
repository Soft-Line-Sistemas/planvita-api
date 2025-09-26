import express from 'express';
import dotenv from 'dotenv';
import healthRoutes from './routes/healthRoutes';
import config from './config';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { tenantMiddleware, TenantRequest } from './middlewares/tenant';

dotenv.config({ quiet: true });

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.server.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const API_VERSION = config.server.apiVersion;

// app.use(morgan("combined"));

app.use(tenantMiddleware);
app.use('/health', healthRoutes);

// app.use(`/api/${API_VERSION}/auth`, authRoutes);

export default app;
