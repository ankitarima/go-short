import type { Session, User, WorkspaceRole } from '@go-short/database';

export interface AuthContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'emailVerified' | 'systemRole'>;
  session: Pick<Session, 'id' | 'csrfToken'>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      workspace?: { id: string; role: WorkspaceRole };
    }
  }
}
