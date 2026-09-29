import { handleRequest } from '../src/admin/server.ts';

export default async function handler(req: Parameters<typeof handleRequest>[0], res: Parameters<typeof handleRequest>[1]) {
  return handleRequest(req, res);
}
