import dotenv from 'dotenv';

dotenv.config();

export const TOTAL_CHECKBOXES = Number(process.env.TOTAL_CHECKBOXES) || 100000;
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
export const PORT = Number(process.env.PORT) || 3000;
export const WS_RATE_LIMIT_WINDOW = 10;
export const WS_RATE_LIMIT_MAX = 20;
export const HTTP_RATE_LIMIT_WINDOW = 60;
export const HTTP_RATE_LIMIT_MAX = 100;
export const OIDC_ISSUER = process.env.OIDC_ISSUER || 'http://localhost:3000/oidc';
export const CLIENT_ID = process.env.CLIENT_ID || 'checkbox-app';
export const CLIENT_SECRET = process.env.CLIENT_SECRET || 'checkbox-secret';
export const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback';
