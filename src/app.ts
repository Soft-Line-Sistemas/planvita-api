import express from 'express';
import dotenv from 'dotenv';
import config from './config';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { tenantMiddleware, TenantRequest } from './middlewares/tenant.middleware';
import rateLimitMiddleware from './middlewares/rateLimit.middleware';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware';
import { addRequestId, logRequest } from './middlewares/api.middleware';

import healthRoutes from './routes/health.routes';
import beneficiarioTipoRoutes from './routes/beneficiariotipo.routes';
import beneficioRoutes from './routes/beneficio.routes';
import comissaoRoutes from './routes/comissao.routes';
import consultorRoutes from './routes/consultor.routes';
import corresponsavelRoutes from './routes/corresponsavel.routes';
import dependenteRoutes from './routes/dependente.routes';
import documentoRoutes from './routes/documento.routes';
import layoutConfigRoutes from './routes/layoutconfig.routes';
import pagamentoRoutes from './routes/pagamento.routes';
import planoRoutes from './routes/plano.routes';
import titularRoutes from './routes/titular.routes';
import roleRoutes from './routes/role.routes';
import permissionRoutes from './routes/permission.routes';
import userRoutes from './routes/user.routes';
import authRoutes from './routes/auth.routes';
import regrasRoutes from './routes/regras.routes';
import financeiroRoutes from './routes/financeiro.routes';
import notificacaoRoutes from './routes/notificacao.routes';
import notificacaoTemplateRoutes from './routes/notificacao-template.routes';

dotenv.config({ quiet: true });

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

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
      const allowed = config.server.allowedOrigins.map((o) => o.toLowerCase().trim());
      if (allowed.includes(origin.toLowerCase())) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }),
);

const API_VERSION = config.server.apiVersionStatic;

// app.use(morgan("combined"));

app.use(addRequestId);
app.use(logRequest);

// Rate limiting
app.use('/api', rateLimitMiddleware.general);
app.use('/health', rateLimitMiddleware.healthCheck);

// Unauthenticated
app.use('/health', healthRoutes);

// Authenticated
app.use(tenantMiddleware);
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/beneficiario/tipo`, beneficiarioTipoRoutes);
app.use(`/api/${API_VERSION}/beneficio`, beneficioRoutes);
app.use(`/api/${API_VERSION}/comissao`, comissaoRoutes);
app.use(`/api/${API_VERSION}/consultor`, consultorRoutes);
app.use(`/api/${API_VERSION}/corresponsavel`, corresponsavelRoutes);
app.use(`/api/${API_VERSION}/dependente`, dependenteRoutes);
app.use(`/api/${API_VERSION}/documento`, documentoRoutes);
app.use(`/api/${API_VERSION}/layout`, layoutConfigRoutes);
app.use(`/api/${API_VERSION}/pagamento`, pagamentoRoutes);
app.use(`/api/${API_VERSION}/plano`, planoRoutes);
app.use(`/api/${API_VERSION}/titular`, titularRoutes);
app.use(`/api/${API_VERSION}/roles`, roleRoutes);
app.use(`/api/${API_VERSION}/permissions`, permissionRoutes);
app.use(`/api/${API_VERSION}/users`, userRoutes);
app.use(`/api/${API_VERSION}/regras`, regrasRoutes);
app.use(`/api/${API_VERSION}/financeiro`, financeiroRoutes);
app.use(`/api/${API_VERSION}/notificacoes`, notificacaoRoutes);
app.use(`/api/${API_VERSION}/notificacoes/templates`, notificacaoTemplateRoutes);

// Handler error
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
