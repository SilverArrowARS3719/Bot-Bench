import { httpRouter } from 'convex/server';
import { auth } from './auth';

const http = httpRouter();
auth.addHttpRoutes(http); // Google sign-in comes back through these
export default http;
