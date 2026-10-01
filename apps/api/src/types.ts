import type { Session, User, WorkspaceRole } from '@go-short/database';

export interface AuthContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'emailVerified' | 'systemRole'>;
  /** How the caller authenticated. API keys act as their creator but never get session-only powers. */
  method: 'session' | 'api_key';
  session?: Pick<Session, 'id' | 'csrfToken'>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      apiKey?: { id: string; workspaceId: string; role: WorkspaceRole };
      workspace?: { id: string; role: WorkspaceRole };
    }
  }
}
