"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const config_1 = __importDefault(require("./config"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const tenant_middleware_1 = require("./middlewares/tenant.middleware");
const rateLimit_middleware_1 = __importDefault(require("./middlewares/rateLimit.middleware"));
const error_middleware_1 = require("./middlewares/error.middleware");
const api_middleware_1 = require("./middlewares/api.middleware");
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const beneficiariotipo_routes_1 = __importDefault(require("./routes/beneficiariotipo.routes"));
const beneficio_routes_1 = __importDefault(require("./routes/beneficio.routes"));
const comissao_routes_1 = __importDefault(require("./routes/comissao.routes"));
const consultor_routes_1 = __importDefault(require("./routes/consultor.routes"));
const corresponsavel_routes_1 = __importDefault(require("./routes/corresponsavel.routes"));
const dependente_routes_1 = __importDefault(require("./routes/dependente.routes"));
const documento_routes_1 = __importDefault(require("./routes/documento.routes"));
const layoutconfig_routes_1 = __importDefault(require("./routes/layoutconfig.routes"));
const pagamento_routes_1 = __importDefault(require("./routes/pagamento.routes"));
const plano_routes_1 = __importDefault(require("./routes/plano.routes"));
const titular_routes_1 = __importDefault(require("./routes/titular.routes"));
const role_routes_1 = __importDefault(require("./routes/role.routes"));
const permission_routes_1 = __importDefault(require("./routes/permission.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
dotenv_1.default.config({ quiet: true });
const app = (0, express_1.default)();
app.set('trust proxy', 1);
app.use(express_1.default.json({ limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, helmet_1.default)({
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
}));
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        console.log('Origin request:', origin);
        if (!origin)
            return callback(null, true);
        const allowed = config_1.default.server.allowedOrigins.map((o) => o.toLowerCase().trim());
        if (allowed.includes(origin.toLowerCase())) {
            callback(null, true);
        }
        else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
}));
const API_VERSION = config_1.default.server.apiVersionStatic;
// app.use(morgan("combined"));
app.use(api_middleware_1.addRequestId);
app.use(api_middleware_1.logRequest);
// Rate limiting
app.use('/api', rateLimit_middleware_1.default.general);
app.use('/health', rateLimit_middleware_1.default.healthCheck);
// Unauthenticated
app.use('/health', health_routes_1.default);
// Authenticated
app.use(tenant_middleware_1.tenantMiddleware);
app.use(`/api/${API_VERSION}/auth`, auth_routes_1.default);
app.use(`/api/${API_VERSION}/beneficiario/tipo`, beneficiariotipo_routes_1.default);
app.use(`/api/${API_VERSION}/beneficio`, beneficio_routes_1.default);
app.use(`/api/${API_VERSION}/comissao`, comissao_routes_1.default);
app.use(`/api/${API_VERSION}/consultor`, consultor_routes_1.default);
app.use(`/api/${API_VERSION}/corresponsavel`, corresponsavel_routes_1.default);
app.use(`/api/${API_VERSION}/dependente`, dependente_routes_1.default);
app.use(`/api/${API_VERSION}/documento`, documento_routes_1.default);
app.use(`/api/${API_VERSION}/layout`, layoutconfig_routes_1.default);
app.use(`/api/${API_VERSION}/pagamento`, pagamento_routes_1.default);
app.use(`/api/${API_VERSION}/plano`, plano_routes_1.default);
app.use(`/api/${API_VERSION}/titular`, titular_routes_1.default);
app.use(`/api/${API_VERSION}/roles`, role_routes_1.default);
app.use(`/api/${API_VERSION}/permissions`, permission_routes_1.default);
app.use(`/api/${API_VERSION}/users`, user_routes_1.default);
// Handler error
app.use(error_middleware_1.notFoundHandler);
app.use(error_middleware_1.errorHandler);
exports.default = app;
