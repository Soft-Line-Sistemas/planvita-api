import express from 'express';
import dotenv from 'dotenv';
import healthRoutes from './routes/healthRoutes';
import config from './config';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';

dotenv.config({ quiet: true });

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_VERSION = config.server.apiVersion;

// app.use(morgan("combined"));

app.use('/health', healthRoutes);
// app.use(`/api/${API_VERSION}/auth`, authRoutes);

export default app;
