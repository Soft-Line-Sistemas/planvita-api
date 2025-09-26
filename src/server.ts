import app from './app';
import { startServer } from './utils/server';

if (require.main === module) {
  startServer(app);
}
